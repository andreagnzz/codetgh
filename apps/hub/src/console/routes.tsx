/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { CLAIM_ENFORCEMENT, ROLES, type Role, TASK_STATUSES, TaskCreateInput, TaskUpdateInput } from "@codetgh/shared";
import { AgentProjectForm, UserCodeForm } from "@codetgh/shared/rest";
import { diffLines } from "diff";
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, not, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { secureHeaders } from "hono/secure-headers";
import { streamSSE } from "hono/streaming";
import type { Auth } from "../auth.js";
import type { Config } from "../config.js";
import type { Db } from "../db/index.js";
import {
  agent,
  alert,
  auditEvent,
  claim,
  invitation,
  membership,
  memoryItem,
  message,
  personalToken,
  project,
  receipt,
  task,
  thread,
  user,
} from "../db/schema.js";
import { createExternalAgent } from "../domain/a2a.js";
import {
  byUser,
  changeRole,
  isAdmin,
  isSessionAgent,
  removeAgent,
  requireAdmin,
  requireMember,
  resolveAlert,
  resumeKillSwitch,
  revokeToken,
  setAgentProject,
  setAgentTrust,
  setKillSwitch,
  stopDelegate,
  updateSettings,
} from "../domain/admin.js";
import { listAgents, listDelegates, presence } from "../domain/agents.js";
import { type AuditKey, appendAudit, exportAudit, verifyTeamAudit, writeCheckpoint } from "../domain/audit.js";
import type { Bus } from "../domain/bus.js";
import { adminReleaseClaim } from "../domain/claims.js";
import { clientIp, type DeviceAuth } from "../domain/device.js";
import { createGithubHook } from "../domain/github.js";
import { launchStates, setLaunchDesired } from "../domain/launcher.js";
import { canDecide, decideMemory, memoryRef, setPinned } from "../domain/memory.js";
import { archivedThread, ENCRYPTED_PLACEHOLDER, type MessagingDeps, sendMessage, sentOrReceivedBy } from "../domain/messages.js";
import { eraseMe, exportMyData } from "../domain/privacy.js";
import { runStates, setRunDesired } from "../domain/runner.js";
import { createSlackCode } from "../domain/slack.js";
import { archivedTask, createTask, updateTask } from "../domain/tasks.js";
import {
  findInvitation,
  inviteMember,
  joinWithInvitation,
  renameTeam,
  revokeInvitations,
  revokeMember,
  setDisplayName,
  setMemberHandle,
} from "../domain/teams.js";
import { HTTP_STATUS, HubError } from "../errors.js";
import { langOf, t } from "../i18n.js";
import type { Mailer } from "../mailer.js";
import { ErrorPage } from "../pages.js";
import { type Principal, principalForUser } from "../principal.js";
import { createPersonalToken } from "../tokens.js";
import {
  Action,
  ArchiveTabs,
  Bypass,
  InvitePage,
  Layout,
  Line,
  People,
  Pill,
  type ProjectFilter,
  Result,
  Table,
  toneOf,
  When,
} from "./pages.js";

type Env = { Variables: { principal: Principal; csrf: string; sessionCreatedAt: Date } };
type Deps = {
  config: Config;
  db: Db;
  auth: Auth;
  bus: Bus;
  messaging: MessagingDeps;
  mailer: Mailer;
  auditKey: AuditKey;
  hold: (key: string, max: number) => () => void;
  device: DeviceAuth;
};

const FRESH_AUTH_MS = 10 * 60_000;
const PAGE = 50;

const require = createRequire(import.meta.url);
const ASSETS: Record<string, [string, string]> = {
  "htmx.js": [readFileSync(require.resolve("htmx.org/dist/htmx.min.js"), "utf8"), "text/javascript"],
  "sse.js": [readFileSync(require.resolve("htmx-ext-sse/dist/sse.min.js"), "utf8"), "text/javascript"],
};

export function consoleRoutes({ config, db, auth, bus, messaging, mailer, auditKey, hold, device }: Deps) {
  const app = new Hono<Env>();
  const csrfFor = (sessionId: string) => createHmac("sha256", config.secret).update(`csrf:${sessionId}`).digest("base64url");
  const csp = secureHeaders({
    contentSecurityPolicy: { defaultSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'"], connectSrc: ["'self'"] },
  });

  app.get("/assets/:name", (c) => {
    const asset = ASSETS[c.req.param("name")];
    if (!asset) return c.notFound();
    return c.body(asset[0], 200, { "content-type": asset[1], "cache-control": "public, max-age=3600" });
  });

  app.get("/invite/:token", csp, async (c) => {
    const inv = await findInvitation(db, c.req.param("token"));
    const valid = Boolean(inv && !inv.acceptedAt && !inv.revokedAt && inv.expiresAt > new Date());
    // Signed in already: a Join button, never an automatic join.
    const session = valid ? await auth.api.getSession({ headers: c.req.raw.headers }) : null;
    return c.html(
      <InvitePage
        team={inv?.teamName ?? ""}
        role={inv?.role ?? ""}
        email={inv?.email ?? ""}
        name={c.req.query("name") ?? ""}
        valid={valid}
        join={session ? { token: c.req.param("token"), csrf: csrfFor(session.session.id) } : undefined}
        lang={langOf(c.req.header("accept-language"), c.req.header("cookie"))}
      />,
    );
  });

  app.post("/invite/:token/join", csp, async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.redirect("/login");
    const sent = Buffer.from(String((await c.req.parseBody()).csrf ?? ""));
    const expected = Buffer.from(csrfFor(session.session.id));
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return c.text("CSRF token missing or invalid", 403);
    try {
      await joinWithInvitation(db, session.user, c.req.param("token"));
    } catch (e) {
      if (!(e instanceof HubError)) throw e;
      const lang = langOf(c.req.header("accept-language"), c.req.header("cookie"));
      return c.html(<ErrorPage status={HTTP_STATUS[e.code]} reason={e.message} lang={lang} />, HTTP_STATUS[e.code] as 403);
    }
    return c.redirect("/console", 303);
  });

  const consoleApp = new Hono<Env>();
  consoleApp.use(csp);
  // Session + active membership on every request: a revoked member is out on the next click.
  consoleApp.use(async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const principal = session ? await principalForUser(db, session.user.id, "console").catch(() => null) : null;
    if (!session || !principal) {
      // The device page is opened from a terminal: back to it after signing in.
      const login = c.req.path === "/console/device" ? "/login?next=/console/device" : "/login";
      // htmx would follow a 302 inside its request and swap the login page in, or nothing: it is told to go there.
      if (c.req.header("HX-Request") === "true") return c.body(null, 204, { "HX-Redirect": login });
      return c.redirect(login);
    }
    c.set("principal", principal);
    c.set("csrf", csrfFor(session.session.id));
    c.set("sessionCreatedAt", new Date(session.session.createdAt));
    if (c.req.method !== "GET") {
      const sent = Buffer.from(c.req.header("x-csrf-token") ?? "");
      const expected = Buffer.from(c.get("csrf"));
      if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return c.text("CSRF token missing or invalid", 403);
    }
    await next();
  });
  // An htmx request gets the bare reason, which console.js shows where the action was; a page load gets a page.
  consoleApp.onError((e, c) => {
    if (!(e instanceof HubError)) throw e;
    const status = HTTP_STATUS[e.code] as 400;
    if (c.req.header("HX-Request") === "true") return c.html(<Result>{e.message}</Result>, status);
    const lang = langOf(c.req.header("accept-language"), c.req.header("cookie"));
    return c.html(<ErrorPage status={status} reason={e.message} lang={lang} />, status);
  });
  for (const section of ["/tasks", "/memory", "/claims", "/projects", "/delegations", "/tokens"])
    consoleApp.use(`${section}/*`, async (c, next) => {
      requireMember(c.get("principal"));
      await next();
    });

  // The page language follows the browser; titles and labels go through i18n's t().
  const tr = (c: Context<Env>) => {
    const lang = langOf(c.req.header("accept-language"), c.req.header("cookie"));
    return Object.assign((s: string) => t(lang, s), { lang });
  };
  // Links keep the project filter only once it names a project of the viewer's team (the pages that filter check it).
  const kept = (c: Context<Env>) => {
    const q = c.req.query("project") ?? "";
    return /^[\w-]{1,64}$/.test(q) ? q : undefined;
  };
  const withProject = (href: string, project: string | undefined) => (project ? `${href}?project=${encodeURIComponent(project)}` : href);
  // A guest never sees the list of the team's projects.
  const page = (c: Context<Env>, title: string, body: unknown, filter?: ProjectFilter) =>
    c.html(
      <Layout
        p={c.get("principal")}
        csrf={c.get("csrf")}
        title={t(tr(c).lang, title)}
        path={c.req.path}
        lang={tr(c).lang}
        filter={c.get("principal").role === "guest" ? undefined : filter}
        keep={filter ? filter.selected : kept(c)}
        archived={c.req.query("archived") === "1"}
      >
        {body as never}
      </Layout>,
    );
  // ?project=: one of the team's projects, or none; anything else, another team's project included, shows them all.
  // Without ?project=, the browser's last choice (project cookie) applies, checked the same way.
  const projectFilter = async (c: Context<Env>): Promise<ProjectFilter> => {
    const projects = await db
      .select({ id: project.id, name: project.name })
      .from(project)
      .where(eq(project.teamId, c.get("principal").teamId))
      .orderBy(asc(project.name));
    const q = c.req.query("project");
    const id = q ?? getCookie(c, "project");
    const selected = id === "none" || projects.some((pr) => pr.id === id) ? id : undefined;
    // An explicit choice is remembered; any other value, All projects (?project=) included, forgets it.
    const secure = config.publicUrl.startsWith("https:");
    if (q !== undefined && selected)
      setCookie(c, "project", selected, { path: "/console", maxAge: 365 * 86400, httpOnly: true, sameSite: "Lax", secure });
    else if (q !== undefined) deleteCookie(c, "project", { path: "/console", secure });
    return { projects, selected };
  };
  const onProject = (col: typeof thread.projectId | typeof task.projectId | typeof agent.projectId, f: ProjectFilter) =>
    f.selected === "none" ? isNull(col) : f.selected ? eq(col, f.selected) : undefined;
  // With every project shown, items go under their project's heading, those outside a project last.
  const byProject = <T,>(f: ProjectFilter, rows: T[], of: (r: T) => string | null, outside: string) =>
    [...f.projects, { id: "none", name: outside }]
      .map((pr) => ({ ...pr, rows: rows.filter((r) => (of(r) ?? "none") === pr.id) }))
      .filter((g) => g.rows.length > 0);
  // A list cut by its row limit says so, with the real count.
  const capped = (c: Context<Env>, shown: number, total: number | undefined) =>
    total !== undefined &&
    shown < total && (
      <p class="meta">{tr(c)("Showing {shown} of {total}").replace("{shown}", String(shown)).replace("{total}", String(total))}</p>
    );
  // ?before= of the Older link: rows created or last updated before that time.
  const olderThan = (
    c: Context<Env>,
    col: typeof alert.createdAt | typeof memoryItem.createdAt | typeof thread.lastMessageAt | typeof message.createdAt,
  ) => {
    const before = c.req.query("before");
    return before && !Number.isNaN(Date.parse(before)) ? lt(col, new Date(before)) : undefined;
  };
  const refresh = (c: Context<Env>) => c.body(null, 204, { "HX-Refresh": "true" });
  const form = async (c: Context<Env>) => Object.fromEntries(Object.entries(await c.req.parseBody()).map(([k, v]) => [k, String(v)]));
  const requireFresh = (c: Context<Env>) => {
    if (Date.now() - c.get("sessionCreatedAt").getTime() > FRESH_AUTH_MS)
      throw new HubError("E_FORBIDDEN", "Sign in again (less than 10 minutes ago) to do this.");
  };

  // Invitations sent and not used yet (read-only: accepting stays on the invitation page).
  const pendingInvitations = (p: Principal) =>
    db
      .select()
      .from(invitation)
      .where(
        and(
          eq(invitation.teamId, p.teamId),
          isNull(invitation.acceptedAt),
          isNull(invitation.revokedAt),
          gt(invitation.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(invitation.createdAt));

  consoleApp.get("/", async (c) => {
    const p = c.get("principal");
    const _ = tr(c);
    const invites = isAdmin(p) ? await pendingInvitations(p) : [];
    // A guest sees only their own agents, as on /console/agents.
    const agents = await listAgents(db, p.teamId, { limit: 50, userId: p.role === "guest" ? p.user.id : undefined });
    const toValidate = canDecide(p)
      ? await db
          .select({ id: memoryItem.id })
          .from(memoryItem)
          .where(and(eq(memoryItem.teamId, p.teamId), eq(memoryItem.status, "proposed")))
      : [];
    const openAlerts = and(eq(alert.teamId, p.teamId), eq(alert.status, "open"));
    const alerts = isAdmin(p) ? await db.select().from(alert).where(openAlerts).orderBy(desc(alert.createdAt)).limit(5) : [];
    const [alertCount] = isAdmin(p) ? await db.select({ n: count() }).from(alert).where(openAlerts) : [];
    const nAlerts = alertCount?.n ?? 0;
    const line = await recentLine(p);
    const dayAgo = Date.now() - 86_400_000;
    const recent = line.filter((r) => r.message.createdAt.getTime() >= dayAgo);
    const earlier = line.filter((r) => r.message.createdAt.getTime() < dayAgo);
    return page(
      c,
      "Dashboard",
      <div
        id="live"
        hx-get="/console"
        hx-select="#live"
        hx-target="#live"
        hx-swap="outerHTML"
        hx-trigger="sse:presence, sse:attention, sse:activity"
        class="dash"
      >
        <section class="dash-line" aria-labelledby="line-h">
          <h2 id="line-h">{_("On the line")}</h2>
          {line.length === 0 && (
            <p class="empty">{_("No messages yet. When agents talk, each message appears here as a line between them.")}</p>
          )}
          {recent.length > 0 && <Line rows={recent} _={_} />}
          {earlier.length > 0 && (
            <>
              <h3 class="rule">{_("Earlier")}</h3>
              <Line rows={earlier} _={_} archived />
            </>
          )}
        </section>
        <div class="dash-side">
          <section aria-labelledby="presence-h">
            <h2 id="presence-h">{_("Presence")}</h2>
            <People
              rows={agents}
              lang={_.lang}
              empty={_(
                isAdmin(p)
                  ? "No agent connected. Copy the invitation command to add one: codetgh invite <email>."
                  : "No agent connected yet. Install CodeTgh with codetgh setup, then run codetgh start in the team's repository.",
              )}
            />
          </section>
          <section aria-labelledby="todo-h">
            <h2 id="todo-h">{_("To handle")}</h2>
            {toValidate.length === 0 && nAlerts === 0 && invites.length === 0 && <p class="empty">{_("Nothing to handle.")}</p>}
            <ul class="todo">
              {toValidate.length > 0 && (
                <li>
                  <Pill tone="warn">{_("to validate")}</Pill>{" "}
                  <a href="/console/memory?status=proposed">
                    {_("Team memory to validate")}
                    {_(": ")}
                    {toValidate.length}
                  </a>
                </li>
              )}
              {alerts.map((a) => (
                <li>
                  <Pill tone="danger">{_(a.kind)}</Pill> <span class="excerpt">{a.excerpt.slice(0, 120)}</span>{" "}
                  <When at={a.createdAt} lang={_.lang} />
                </li>
              ))}
              {nAlerts > 0 && (
                <li>
                  <a href="/console/alerts">
                    {_("Review alerts")} ({nAlerts})
                  </a>
                </li>
              )}
              {invites.length > 0 && (
                <li>
                  <Pill>{_("invited")}</Pill>{" "}
                  <a href="/console/members">
                    {_("Invitations not accepted yet")}
                    {_(": ")}
                    {invites.length}
                  </a>
                </li>
              )}
            </ul>
            {isAdmin(p) && (
              <>
                <h3>{_("Kill switch")}</h3>
                {p.paused ? (
                  <form hx-post="/console/kill-switch/resume" hx-swap="none">
                    <label>
                      {_("Type yes to resume agent traffic")} <input name="confirm" required />
                    </label>
                    <button type="submit">{_("Resume")}</button>
                  </form>
                ) : (
                  <form hx-post="/console/kill-switch" hx-swap="none">
                    <label>
                      {_("Reason")} <input id="kill-reason" hx-preserve="true" name="reason" required maxlength={500} />
                    </label>
                    <button type="submit">{_("Stop agent traffic")}</button>
                  </form>
                )}
              </>
            )}
          </section>
        </div>
      </div>,
    );
  });

  consoleApp.post("/kill-switch", async (c) => {
    requireFresh(c);
    const p = c.get("principal");
    await setKillSwitch(db, p, (await form(c)).reason ?? "");
    bus.emit("kill", { teamId: p.teamId });
    bus.emit("attention", { teamId: p.teamId });
    return refresh(c);
  });

  consoleApp.post("/kill-switch/resume", async (c) => {
    requireFresh(c);
    const p = c.get("principal");
    await resumeKillSwitch(db, p, (await form(c)).confirm ?? "");
    bus.emit("attention", { teamId: p.teamId });
    return refresh(c);
  });

  // Threads: team threads for everyone, direct threads for their participants; an admin opening someone else's DM is audited.
  const participantThreads = (p: Principal) =>
    db
      .selectDistinct({ id: message.threadId })
      .from(message)
      .leftJoin(receipt, eq(receipt.messageId, message.id))
      .where(and(eq(message.teamId, p.teamId), or(eq(message.fromUserId, p.user.id), eq(receipt.recipientUserId, p.user.id))));

  // Members see team threads and their own; a guest only their own; admins everything.
  const visibleThreads = (p: Principal, mine: string[]) =>
    isAdmin(p) ? undefined : or(p.role === "guest" ? undefined : eq(thread.kind, "team"), inArray(thread.id, mine));

  // The activity line: who wrote to whom, never what. Same visibility as the thread page: a reply addressed to one person
  // stays between them, admins excepted.
  async function recentLine(p: Principal) {
    const mine = isAdmin(p) ? [] : (await participantThreads(p)).map((r) => r.id);
    const rows = await db
      .select({ message, name: user.name })
      .from(message)
      .innerJoin(user, eq(user.id, message.fromUserId))
      .innerJoin(thread, eq(thread.id, message.threadId))
      .where(and(eq(message.teamId, p.teamId), visibleThreads(p, mine), isAdmin(p) ? undefined : sentOrReceivedBy(db, p)))
      .orderBy(desc(message.createdAt))
      .limit(40);
    // An answer sent without `to` is stored as user:<id> or agent:<id>: the line shows the person's handle.
    const ids = (prefix: string) =>
      [...new Set(rows.flatMap((r) => r.message.to).filter((a) => a.startsWith(prefix)))].map((a) => a.slice(prefix.length));
    const users = ids("user:");
    const agents = ids("agent:");
    const handles = new Map<string, string>();
    if (users.length)
      for (const r of await db
        .select({ id: membership.userId, handle: membership.handle })
        .from(membership)
        .where(and(eq(membership.teamId, p.teamId), inArray(membership.userId, users))))
        handles.set(`user:${r.id}`, `@${r.handle}`);
    if (agents.length)
      for (const r of await db
        .select({ id: agent.id, handle: membership.handle })
        .from(agent)
        .innerJoin(membership, and(eq(membership.userId, agent.userId), eq(membership.teamId, agent.teamId)))
        .where(and(eq(agent.teamId, p.teamId), inArray(agent.id, agents))))
        handles.set(`agent:${r.id}`, `@${r.handle}`);
    return rows.map((r) => ({ ...r, message: { ...r.message, to: r.message.to.map((a) => handles.get(a) ?? a) } }));
  }

  consoleApp.get("/threads", async (c) => {
    const p = c.get("principal");
    const _ = tr(c);
    const mine = (await participantThreads(p)).map((r) => r.id);
    const archived = c.req.query("archived") === "1";
    const f = await projectFilter(c);
    const found = await db
      .select()
      .from(thread)
      .where(
        and(
          eq(thread.teamId, p.teamId),
          visibleThreads(p, mine),
          onProject(thread.projectId, f),
          archived ? archivedThread() : not(archivedThread()),
          olderThan(c, thread.lastMessageAt),
        ),
      )
      .orderBy(desc(thread.lastMessageAt))
      .limit(PAGE + 1);
    const rows = found.slice(0, PAGE);
    const last = rows.at(-1);
    const table = (of: typeof rows) => (
      <Table
        head={[_("Thread"), _("Kind"), _("Subject"), _("Agent streak"), _("State"), _("Last message")]}
        rows={of.map((t) => [
          <a href={withProject(`/console/threads/${t.id}`, f.selected)}>{t.id}</a>,
          _(t.kind),
          // The subject of someone else's direct thread is part of it: only the audited opening shows it to an admin.
          t.kind === "direct" && !mine.includes(t.id) ? "" : (t.subject ?? ""),
          t.agentStreak,
          <Pill tone={t.mutedAt ? "warn" : "neutral"}>{_(t.mutedAt ? "muted" : "open")}</Pill>,
          <When at={t.lastMessageAt} lang={_.lang} />,
        ])}
        empty={
          archived ? _("No archived threads.") : _("No threads yet. A thread starts with the first message an agent or a person sends.")
        }
      />
    );
    return page(
      c,
      "Threads",
      <>
        <ArchiveTabs base="/console/threads" archived={archived} lang={_.lang} project={f.selected} />
        {/* A guest never sees the team's projects, their names as headings included. */}
        {f.selected || rows.length === 0 || p.role === "guest"
          ? table(rows)
          : byProject(f, rows, (t) => t.projectId, _("Outside a project")).map((g) => (
              <section aria-labelledby={`p-${g.id}`}>
                <h2 id={`p-${g.id}`}>{g.name}</h2>
                {table(g.rows)}
              </section>
            ))}
        {found.length > PAGE && last && (
          <a
            href={`/console/threads?${archived ? "archived=1&" : ""}${f.selected ? `project=${encodeURIComponent(f.selected)}&` : ""}before=${encodeURIComponent(last.lastMessageAt.toISOString())}`}
          >
            {_("Older")}
          </a>
        )}
      </>,
      f,
    );
  });

  const loadThread = async (c: Context<Env>) => {
    const p = c.get("principal");
    const [t] = await db
      .select()
      .from(thread)
      .where(and(eq(thread.id, c.req.param("id") ?? ""), eq(thread.teamId, p.teamId)));
    if (!t) throw new HubError("E_NOT_FOUND", "thread not found");
    const participant = (await participantThreads(p)).some((r) => r.id === t.id);
    // SPEC: an admin may open a direct thread they are not in, in full, and every opening (the page, below) is audited.
    if (!participant) requireMember(p);
    const adminRead = t.kind === "direct" && !participant;
    if (adminRead) requireAdmin(p);
    return { t, adminRead };
  };

  consoleApp.get("/threads/:id", async (c) => {
    const { t, adminRead } = await loadThread(c);
    const p = c.get("principal");
    if (adminRead) await db.transaction((tx) => appendAudit(tx, { ...byUser(p), action: "thread.read_by_admin", subjectId: t.id }));
    const project = kept(c);
    // The latest page, oldest first; Older goes back. A thread grows with every reply: never load all of it.
    const found = await db
      .select({ message, name: user.name })
      .from(message)
      .innerJoin(user, eq(user.id, message.fromUserId))
      .where(and(eq(message.threadId, t.id), adminRead ? undefined : sentOrReceivedBy(db, p), olderThan(c, message.createdAt)))
      .orderBy(desc(message.createdAt))
      .limit(PAGE + 1);
    const rows = found.slice(0, PAGE).reverse();
    const first = rows[0];
    const state = t.mutedAt ? (t.mutedReason === "human" ? "muted by a person" : "muted (loop guard)") : "open";
    // Every refresh of an admin read would be audited as a new opening, and an older page is not the latest: those stay still.
    const live =
      adminRead || c.req.query("before")
        ? {}
        : {
            "hx-get": withProject(`/console/threads/${t.id}`, project),
            "hx-select": "main",
            "hx-target": "main",
            "hx-swap": "outerHTML",
            "hx-trigger": "sse:activity",
          };
    return page(
      c,
      t.subject ?? `Thread ${t.id}`,
      <div {...live}>
        <p>
          <a href={withProject("/console/threads", project)}>{tr(c)("Back to threads")}</a>
        </p>
        <p>
          {t.kind} thread · {state} · agent streak {t.agentStreak}
        </p>
        <Table
          head={["From", "Kind", "Message", "Sent"]}
          rows={rows.map(({ message: m, name }) => [
            `${name}${m.authoredBy === "agent" ? " (agent)" : ""}`,
            `${m.kind} · ${m.priority}`,
            <>
              {m.flags.map((f) => (
                <span class="flag">{f}</span>
              ))}
              {m.subject && <strong>{m.subject}</strong>}
              <pre>{m.encrypted ? ENCRYPTED_PLACEHOLDER : m.body}</pre>
            </>,
            <When at={m.createdAt} />,
          ])}
          empty={tr(c)("Nothing yet.")}
        />
        {found.length > PAGE && first && (
          <a
            href={`/console/threads/${t.id}?${project ? `project=${encodeURIComponent(project)}&` : ""}before=${encodeURIComponent(first.message.createdAt.toISOString())}`}
          >
            {tr(c)("Older")}
          </a>
        )}
        {/* Only where a reply can succeed: not in someone else's direct thread, nor in plain text in an encrypted one. */}
        {!adminRead && !t.encrypted && (
          <form hx-post={`/console/threads/${t.id}/reply`} hx-swap="none">
            <label>
              Reply as a human <textarea id="reply-body" hx-preserve="true" name="body" required maxlength={8000} rows={3} />
            </label>
            <button type="submit">Send</button>
          </form>
        )}
        {t.mutedAt ? (
          <Action post={`/console/threads/${t.id}/reopen`} label="Reopen" />
        ) : (
          <Action post={`/console/threads/${t.id}/mute`} label="Mute" />
        )}
      </div>,
    );
  });

  // A human reply carries authored_by=human, resets the agent streak and reopens a muted thread.
  consoleApp.post("/threads/:id/reply", async (c) => {
    const { t, adminRead } = await loadThread(c);
    if (adminRead) throw new HubError("E_FORBIDDEN", "only participants reply to a direct thread");
    const body = (await form(c)).body ?? "";
    await sendMessage(
      messaging,
      { p: c.get("principal"), agent: null, via: "console" },
      { to: `thread:${t.id}`, kind: "note", body, priority: "normal", refs: [] },
    );
    return refresh(c);
  });

  consoleApp.post("/threads/:id/:action{mute|reopen}", async (c) => {
    const { t } = await loadThread(c);
    const p = c.get("principal");
    requireMember(p);
    const mute = c.req.param("action") === "mute";
    await db.transaction(async (tx) => {
      await tx
        .update(thread)
        .set(mute ? { mutedAt: new Date(), mutedReason: "human" } : { mutedAt: null, mutedReason: null, agentStreak: 0 })
        .where(eq(thread.id, t.id));
      await appendAudit(tx, { ...byUser(p), action: mute ? "thread.muted" : "thread.reopened", subjectId: t.id });
    });
    return refresh(c);
  });

  consoleApp.get("/alerts", async (c) => {
    const p = c.get("principal");
    const _ = tr(c);
    requireAdmin(p);
    const found = await db
      .select({ alert, name: user.name })
      .from(alert)
      .leftJoin(user, eq(user.id, alert.userId))
      .where(and(eq(alert.teamId, p.teamId), olderThan(c, alert.createdAt)))
      .orderBy(desc(alert.createdAt))
      .limit(PAGE + 1);
    const rows = found.slice(0, PAGE);
    const last = rows.at(-1);
    return page(
      c,
      "Alerts",
      <>
        <Table
          head={[_("Kind"), _("Sender"), _("Excerpt"), _("Status"), _("Actions")]}
          empty={_("No alerts. Messages that look like instructions, or that carry a secret, show up here for an admin to decide.")}
          rows={rows.map(({ alert: a, name }) => [
            <>
              <Pill tone="danger">{_(a.kind)}</Pill>
              <br />
              <When at={a.createdAt} lang={_.lang} />
            </>,
            name ?? "",
            <pre>{a.excerpt}</pre>,
            <Pill tone={toneOf(a.status)}>{_(a.status)}</Pill>,
            a.status === "open" && (
              <>
                <Action post={`/console/alerts/${a.id}/dismissed`} label={_("Dismiss")} />
                <Action post={`/console/alerts/${a.id}/false_positive`} label={_("False positive")} />
                {a.kind === "secret_blocked" && (
                  <Action post={`/console/alerts/${a.id}/fingerprint_allowed`} label={_("Allow this fingerprint")} />
                )}
                {a.agentId && <Action post={`/console/agents/${a.agentId}/quarantined`} label={_("Quarantine sender")} />}
              </>
            ),
          ])}
        />
        {found.length > PAGE && last && (
          <a href={`/console/alerts?before=${encodeURIComponent(last.alert.createdAt.toISOString())}`}>{_("Older")}</a>
        )}
      </>,
    );
  });

  consoleApp.post("/alerts/:id/:status{dismissed|false_positive|fingerprint_allowed}", async (c) => {
    await resolveAlert(db, c.get("principal"), c.req.param("id"), c.req.param("status") as "dismissed");
    return refresh(c);
  });

  consoleApp.get("/agents", async (c) => {
    const p = c.get("principal");
    const _ = tr(c);
    const f = await projectFilter(c);
    const rows = await listAgents(db, p.teamId, {
      limit: 100,
      userId: isAdmin(p) ? undefined : p.user.id,
      where: onProject(agent.projectId, f),
    });
    const table = (of: typeof rows) => (
      <Table
        head={[
          _("Who"),
          _("Label"),
          _("Project"),
          _("Kind"),
          _("Branch"),
          _("Push"),
          _("Permissions"),
          _("Claude Code"),
          _("Last seen"),
          _("Trust"),
          _("Actions"),
        ]}
        empty={_("No agent yet. Agents appear here once someone runs codetgh setup, then codetgh start in a team repository.")}
        rows={of.map((r) => [
          r.name,
          // The end of the agent id tells apart two sessions with the same label; it is what agent:<id> addresses.
          <>
            {r.agent.label} <code class="meta">·{r.agent.id.slice(-6)}</code>
          </>,
          r.project ?? "",
          r.agent.kind,
          r.agent.branch ?? "",
          r.agent.pushMode ?? "",
          r.agent.permissionMode === "bypassPermissions" ? <Bypass lang={_.lang} /> : (r.agent.permissionMode ?? ""),
          r.agent.clientVersion ?? "",
          <>
            <Pill tone={toneOf(presence(r.agent))}>{_(presence(r.agent))}</Pill> <When at={r.agent.lastSeenAt} lang={_.lang} />
          </>,
          <Pill tone={toneOf(r.agent.trustLevel)}>{_(r.agent.trustLevel)}</Pill>,
          <>
            {r.agent.trustLevel === "trusted" ? (
              <Action post={`/console/agents/${r.agent.id}/quarantined`} label={_("Quarantine")} />
            ) : r.agent.kind === "a2a" ? (
              _("external: always quarantined")
            ) : (
              <Action post={`/console/agents/${r.agent.id}/trusted`} label={_("Confirm")} />
            )}{" "}
            <Action post={`/console/agents/${r.agent.id}/remove`} label={_("Remove")} level="quiet" />
          </>,
        ])}
      />
    );
    return page(
      c,
      "Agents",
      <>
        {f.selected || rows.length === 0
          ? table(rows)
          : byProject(f, rows, (r) => r.agent.projectId, _("Outside a project")).map((g) => (
              <section aria-labelledby={`p-${g.id}`}>
                <h2 id={`p-${g.id}`}>{g.name}</h2>
                {table(g.rows)}
              </section>
            ))}
        {capped(c, rows.length, rows[0]?.total)}
        {isAdmin(p) && (
          <>
            <h2>{_("External agent (A2A)")}</h2>
            <p>
              {_("An external agent can ask the team questions and read the answers. It stays in quarantine: no claims, memory or tasks.")}
            </p>
            <form hx-post="/console/agents/a2a" hx-target="#a2a-result">
              <label>
                {_("Name")} <input name="name" required maxlength={60} />
              </label>
              <button type="submit">{_("Create")}</button>
            </form>
            <div id="a2a-result" />
          </>
        )}
      </>,
      f,
    );
  });

  // Every member sees which sessions run on which project: who, branch, presence, last seen. Never what they say.
  consoleApp.get("/projects", async (c) => {
    const p = c.get("principal");
    const _ = tr(c);
    const f = await projectFilter(c);
    const { projects } = f;
    const sessions = await listAgents(db, p.teamId, { limit: 200, where: onProject(agent.projectId, f) });
    const byProject = (id: string | null) => sessions.filter((r) => r.agent.projectId === id && (id || isSessionAgent(r.agent)));
    const launches = p.role === "owner" ? await launchStates(db, p.teamId) : [];
    const runs = p.role === "owner" ? await runStates(db, p.teamId) : [];
    // What the owner's launcher reports, read for people: a report older than a minute means the launcher is not running.
    const launch = (projectId: string) => {
      const l = launches.find((x) => x.projectId === projectId);
      const fresh = l?.reportedAt && Date.now() - l.reportedAt.getTime() < 60_000;
      const state = !l
        ? null
        : l.reportedError && fresh
          ? { tone: "danger" as const, text: l.reportedError }
          : l.desired && l.running && fresh
            ? { tone: "ok" as const, text: _("Remote Control running") }
            : l.desired
              ? { tone: "warn" as const, text: _("Waiting for the launcher on your machine") }
              : l.reportedAt
                ? { tone: "neutral" as const, text: _("Remote Control stopped") }
                : null;
      return (
        <p class="launcher">
          {state && <Pill tone={state.tone}>{state.text}</Pill>}{" "}
          {l?.desired ? (
            <Action post={`/console/projects/${projectId}/launch`} vals={{ on: "0" }} label={_("Stop Remote Control")} />
          ) : (
            <Action post={`/console/projects/${projectId}/launch`} vals={{ on: "1" }} label={_("Start Remote Control")} />
          )}{" "}
          {state?.tone === "ok" && <a href="https://claude.ai/code">{_("Open claude.ai/code")}</a>}
        </p>
      );
    };
    // Same reading for the runner: its last report, with the count of agents it runs.
    const runner = (projectId: string) => {
      const r = runs.find((x) => x.projectId === projectId);
      const fresh = r?.reportedAt && Date.now() - r.reportedAt.getTime() < 60_000;
      const state = !r
        ? null
        : r.reportedError && fresh
          ? { tone: "danger" as const, text: r.reportedError }
          : r.desired && fresh
            ? { tone: "ok" as const, text: `${_("Runner on")} · ${r.running} ${_("agents running")}` }
            : r.desired
              ? { tone: "warn" as const, text: _("Waiting for the runner on your machine") }
              : r.reportedAt
                ? { tone: "neutral" as const, text: _("Runner stopped") }
                : null;
      return (
        <p class="launcher">
          {state && <Pill tone={state.tone}>{state.text}</Pill>}{" "}
          {r?.desired ? (
            <Action post={`/console/projects/${projectId}/runner`} vals={{ on: "0" }} label={_("Stop the runner")} />
          ) : (
            <Action post={`/console/projects/${projectId}/runner`} vals={{ on: "1" }} label={_("Start the runner")} />
          )}
        </p>
      );
    };
    const groups = [
      ...projects.map((pr) => ({ id: pr.id, name: pr.name, rows: byProject(pr.id) })),
      { id: "none", name: _("Sessions outside a project"), rows: byProject(null) },
    ].filter((g) => (f.selected ? g.id === f.selected : g.rows.length > 0 || g.id !== "none"));
    // A member attaches their own sessions, an admin anyone's; a guest none.
    const attach = (r: (typeof sessions)[number]) =>
      projects.length > 0 &&
      p.role !== "guest" &&
      (r.agent.userId === p.user.id || isAdmin(p)) && (
        <form class="attach" hx-post={`/console/agents/${r.agent.id}/project`} hx-swap="none">
          <select name="project_id" aria-label={_("Project")}>
            {projects.map((pr) => (
              <option value={pr.id}>{pr.name}</option>
            ))}
          </select>{" "}
          <button type="submit">{_("Attach to…")}</button>
        </form>
      );
    return page(
      c,
      "Projects",
      projects.length === 0 && sessions.length === 0 ? (
        <p class="empty">
          {_("No project yet. A project appears when a member runs codetgh start in a repository, or runs codetgh project new there.")}
        </p>
      ) : (
        groups.map((g) => (
          <section aria-labelledby={`p-${g.id}`}>
            <h2 id={`p-${g.id}`}>{g.name}</h2>
            {p.role === "owner" && g.id !== "none" && (
              <>
                <p class="meta">
                  {_("Project id")} <code>{g.id}</code>
                </p>
                {launch(g.id)}
                {runner(g.id)}
              </>
            )}
            {g.id === "none" && <p class="meta">{_("Start claude inside the project's repository folder to link the session.")}</p>}
            <People
              rows={g.rows}
              lang={_.lang}
              empty={_("No session on this project right now.")}
              action={g.id === "none" ? attach : undefined}
            />
          </section>
        ))
      ),
      f,
    );
  });

  consoleApp.post("/projects/:id/launch", async (c) => {
    await setLaunchDesired(db, c.get("principal"), c.req.param("id"), (await form(c)).on === "1");
    return refresh(c);
  });

  consoleApp.post("/projects/:id/runner", async (c) => {
    await setRunDesired(db, c.get("principal"), c.req.param("id"), (await form(c)).on === "1");
    return refresh(c);
  });

  consoleApp.post("/agents/a2a", async (c) => {
    requireFresh(c);
    const created = await createExternalAgent(db, c.get("principal"), (await form(c)).name ?? "");
    c.header("Cache-Control", "no-store");
    return c.html(
      <Result>
        <p>Give these to the external agent's operator. The token is shown once.</p>
        <pre>{`Agent Card: ${config.publicUrl}/.well-known/agent-card.json\nAuthorization: Bearer ${created.token}`}</pre>
        <p>It appears to the team as {created.handle}.</p>
      </Result>,
    );
  });

  consoleApp.post("/agents/:id/project", async (c) => {
    const parsed = AgentProjectForm.safeParse(await form(c));
    if (!parsed.success) throw new HubError("E_INVALID", tr(c)("Choose a project."));
    await setAgentProject(db, c.get("principal"), c.req.param("id"), parsed.data.project_id);
    return refresh(c);
  });

  consoleApp.post("/agents/:id/remove", async (c) => {
    await removeAgent(db, c.get("principal"), c.req.param("id"));
    return refresh(c);
  });

  // Sessions started with codetgh start --accept-requests-from: who may hand them tasks; their owner or an admin turns them off.
  consoleApp.get("/delegations", async (c) => {
    const p = c.get("principal");
    const _ = tr(c);
    const rows = await listDelegates(db, p, isAdmin(p));
    return page(
      c,
      "Delegations",
      <>
        <p>{_("These sessions do tasks that the listed teammates send them, without a human, in Claude Code's auto mode.")}</p>
        <Table
          head={[_("Who"), _("Label"), _("Project"), _("Accepts requests from"), _("Last seen"), _("Actions")]}
          empty={_("No delegate session. A member starts one with codetgh start --accept-requests-from @handle.")}
          rows={rows.map((r) => [
            r.name,
            <>
              {r.agent.label} <code class="meta">·{r.agent.id.slice(-6)}</code>
            </>,
            r.project ?? "",
            r.senders.join(", "),
            <>
              <Pill tone={toneOf(presence(r.agent))}>{_(presence(r.agent))}</Pill> <When at={r.agent.lastSeenAt} lang={_.lang} />
            </>,
            <Action post={`/console/delegations/${r.agent.id}/stop`} label={_("Turn off")} />,
          ])}
        />
      </>,
    );
  });

  consoleApp.post("/delegations/:id/stop", async (c) => {
    await stopDelegate(db, c.get("principal"), c.req.param("id"));
    return refresh(c);
  });

  consoleApp.post("/agents/:id/:trust{trusted|quarantined}", async (c) => {
    await setAgentTrust(db, c.get("principal"), c.req.param("id"), c.req.param("trust") as "trusted");
    return refresh(c);
  });

  consoleApp.get("/me", (c) =>
    page(
      c,
      "My data",
      <>
        <form hx-post="/console/me/profile" hx-swap="none">
          <label>
            {tr(c)("Display name")} <input name="name" value={c.get("principal").user.name} maxlength={60} required />
          </label>
          <button type="submit">{tr(c)("Save")}</button>
        </form>
        <p>
          <a href="/console/me/export">Download everything CodeTgh stores about you (JSON)</a>
        </p>
        <h2>Slack</h2>
        <form hx-post="/console/me/slack" hx-target="#slack-code">
          <button type="submit">Link Slack</button>
        </form>
        <div id="slack-code" />
        <h2>Erase my data</h2>
        <p>
          Your messages, subjects, claim reasons and task notes become [erased], your name becomes Former member, your claims are released,
          your tasks go back to the team and your access ends. Tasks and team memory you wrote stay with the team; the audit log keeps ids
          only.
        </p>
        <form hx-post="/console/me/erase" hx-swap="none">
          <label>
            Type erase to confirm <input name="confirm" required />
          </label>
          <button type="submit">Erase my data</button>
        </form>
      </>,
    ),
  );

  consoleApp.post("/me/slack", async (c) => {
    const code = await createSlackCode(messaging, c.get("principal"));
    c.header("Cache-Control", "no-store");
    return c.html(
      <Result>
        <p>In Slack, type this within 10 minutes. Then your replies in CodeTgh threads there reach the team as you.</p>
        <pre>{`/codetgh-link ${code}`}</pre>
      </Result>,
    );
  });

  consoleApp.get("/me/export", async (c) => {
    const p = c.get("principal");
    const data = await exportMyData(db, p);
    await db.transaction((tx) => appendAudit(tx, { ...byUser(p), action: "member.data_exported", subjectId: p.membershipId }));
    return c.json(data, 200, { "content-disposition": 'attachment; filename="codetgh-my-data.json"' });
  });

  consoleApp.post("/me/erase", async (c) => {
    requireFresh(c);
    const p = c.get("principal");
    await eraseMe(db, p, (await form(c)).confirm ?? "");
    bus.emit("revoked", { teamId: p.teamId, userId: p.user.id });
    bus.emit("presence", { teamId: p.teamId });
    return c.body(null, 204, { "HX-Redirect": "/login" });
  });

  consoleApp.get("/tokens", async (c) => {
    const p = c.get("principal");
    const rows = await db
      .select()
      .from(personalToken)
      .where(and(eq(personalToken.userId, p.user.id), eq(personalToken.teamId, p.teamId), isNull(personalToken.revokedAt)))
      .orderBy(desc(personalToken.createdAt));
    return page(
      c,
      "Personal tokens",
      <>
        <form hx-post="/console/tokens" hx-target="#new-token">
          <label>
            Label (machine or use) <input name="label" required maxlength={60} />
          </label>
          <button type="submit">Create a token</button>
        </form>
        <div id="new-token" />
        <Table
          head={["Label", "Created", "Expires", "Actions"]}
          rows={rows.map((t) => [
            t.label,
            <When at={t.createdAt} />,
            <When at={t.expiresAt} />,
            <Action post={`/console/tokens/${t.id}/revoke`} label="Revoke" />,
          ])}
          empty={tr(c)("Nothing yet.")}
        />
      </>,
    );
  });

  consoleApp.post("/tokens", async (c) => {
    // A 90-day token outlives the session: same gate as the device approval.
    requireFresh(c);
    const p = c.get("principal");
    const label = ((await form(c)).label ?? "").slice(0, 60) || "token";
    const { id, token } = await createPersonalToken(db, { userId: p.user.id, teamId: p.teamId, label });
    await db.transaction((tx) => appendAudit(tx, { ...byUser(p), action: "token.created", subjectId: id }));
    c.header("Cache-Control", "no-store");
    return c.html(
      <Result>
        <p>Copy it now: it will not be shown again.</p>
        <pre>{token}</pre>
        <p>Then, on your machine:</p>
        <pre>{`codetgh login --url ${config.publicUrl}\nclaude plugin install codetgh@<marketplace>   # hub URL: ${config.publicUrl}, token: the value above`}</pre>
      </Result>,
    );
  });

  // Browser sign-in: the person types the code their terminal shows, checks the machine, then approves or denies.
  consoleApp.get("/device", (c) => {
    const _ = tr(c);
    return page(
      c,
      "Sign in a terminal",
      <>
        <form hx-post="/console/device" hx-target="#device">
          <label>
            {_("Code shown in your terminal")} <input name="user_code" required maxlength={20} autocomplete="off" />
          </label>
          <button type="submit">{_("Continue")}</button>
        </form>
        <div id="device" />
      </>,
    );
  });
  const deviceInput = async (c: Context<Env>) => {
    const parsed = UserCodeForm.safeParse(await form(c));
    if (!parsed.success) throw new HubError("E_INVALID", tr(c)("Type the 8-letter code your terminal shows."));
    return { code: parsed.data.user_code, keys: { user: c.get("principal").user.id, ip: clientIp(c, config.trustedProxy) } };
  };
  consoleApp.post("/device", async (c) => {
    const _ = tr(c);
    const { code, keys } = await deviceInput(c);
    const entry = device.find(code, keys);
    const vals = JSON.stringify({ user_code: code });
    return c.html(
      <Result>
        <p>
          {_("Machine")}: <strong>{entry.label}</strong> ({_("typed by whoever started this request, so it proves nothing")})
        </p>
        <p>
          {_("Started")} <When at={new Date(entry.startedAt)} lang={_.lang} />
        </p>
        <p>{_("Approve only if you just ran codetgh in your own terminal and it shows this code. It gets a personal token for you.")}</p>
        <button type="button" hx-post="/console/device/approve" hx-vals={vals} hx-target="#device">
          {_("Approve")}
        </button>{" "}
        <button type="button" class="quiet" hx-post="/console/device/deny" hx-vals={vals} hx-target="#device">
          {_("Deny")}
        </button>
      </Result>,
    );
  });
  consoleApp.post("/device/approve", async (c) => {
    // It mints a personal token: a stolen or left-open browser session must sign in again first.
    requireFresh(c);
    const p = c.get("principal");
    const { code, keys } = await deviceInput(c);
    const entry = device.decide(code, keys, { approve: { userId: p.user.id, teamId: p.teamId } });
    await db.transaction((tx) =>
      appendAudit(tx, { ...byUser(p), action: "device.approved", subjectId: entry.id, data: { label: entry.label } }),
    );
    return c.html(<Result>{tr(c)("Approved. Go back to your terminal: it finishes on its own.")}</Result>);
  });
  consoleApp.post("/device/deny", async (c) => {
    const p = c.get("principal");
    const { code, keys } = await deviceInput(c);
    const entry = device.decide(code, keys, { deny: true });
    await db.transaction((tx) =>
      appendAudit(tx, { ...byUser(p), action: "device.denied", subjectId: entry.id, data: { label: entry.label } }),
    );
    return c.html(<Result>{tr(c)("Denied. No token was created.")}</Result>);
  });

  consoleApp.post("/tokens/:id/revoke", async (c) => {
    const p = c.get("principal");
    const userId = await revokeToken(db, p, c.req.param("id"));
    bus.emit("revoked", { teamId: p.teamId, userId });
    return refresh(c);
  });

  consoleApp.get("/members", async (c) => {
    const p = c.get("principal");
    const _ = tr(c);
    requireAdmin(p);
    const rows = await db
      .select({ membership, name: user.name, email: user.email })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(and(eq(membership.teamId, p.teamId), eq(membership.status, "active")))
      .orderBy(membership.createdAt);
    const invites = await pendingInvitations(p);
    return page(
      c,
      "Members",
      <>
        <form hx-post="/console/members/invite" hx-target="#invite-result">
          <label>
            {_("Email")} <input name="email" type="email" required autocomplete="off" />
          </label>
          <label>
            {_("Role")}{" "}
            <select name="role">
              {ROLES.filter((r) => r !== "owner" || p.role === "owner").map((r) => (
                <option value={r} selected={r === "member"}>
                  {_(r)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {_("Valid for (days)")} <input name="days" type="number" min={1} max={30} value="7" required />
          </label>
          <button type="submit">{_("Invite")}</button>
        </form>
        <div id="invite-result" />
        <h2>{_("Invitations")}</h2>
        <Table
          head={[_("Email"), _("Role"), _("Sent"), _("Expires"), _("Actions")]}
          rows={invites.map((i) => [
            i.email,
            <Pill>{_(i.role)}</Pill>,
            <When at={i.createdAt} lang={_.lang} />,
            <When at={i.expiresAt} lang={_.lang} />,
            <Action post={`/console/invitations/${i.id}/revoke`} label={_("Revoke invitation")} />,
          ])}
          empty={_("No pending invitations. Invite someone with the form above, or run codetgh invite <email>.")}
        />
        <h2>{_("Members")}</h2>
        <Table
          head={[_("Name"), _("Handle"), _("Email"), _("Role"), _("Actions")]}
          rows={rows.map((r) => [
            r.name,
            // Only an owner renames an owner.
            r.membership.role === "owner" && p.role !== "owner" ? (
              `@${r.membership.handle}`
            ) : (
              <form hx-post={`/console/members/${r.membership.id}/handle`} hx-swap="none" class="inline">
                <label>
                  <span class="sr-only">{_("Handle")}</span>@
                  <input name="handle" value={r.membership.handle} maxlength={40} pattern="[a-z0-9][a-z0-9\-]{0,39}" size={12} />
                </label>
                <button type="submit" class="quiet">
                  {_("Rename")}
                </button>
              </form>
            ),
            r.email,
            <Pill>{_(r.membership.role)}</Pill>,
            r.membership.userId !== p.user.id && (
              <>
                {ROLES.filter((role) => role !== r.membership.role && (role !== "owner" || p.role === "owner")).map((role) => (
                  <Action post={`/console/members/${r.membership.id}/role`} vals={{ role }} label={_(`Make ${role}`)} />
                ))}
                <Action post={`/console/members/${r.membership.id}/revoke`} label={_("Revoke")} />
              </>
            ),
          ])}
          empty={_("Nothing yet.")}
        />
      </>,
    );
  });

  consoleApp.post("/members/invite", async (c) => {
    const f = await form(c);
    const _ = tr(c);
    const { link, emailed, days } = await inviteMember(
      { db, mailer, publicUrl: config.publicUrl },
      c.get("principal"),
      { email: f.email ?? "", role: f.role || "member", days: f.days ? Number(f.days) : undefined },
      "console",
    );
    return c.html(
      <Result>
        <p>
          {emailed ? `${_("Invitation emailed to")} ${f.email}.` : `${_("Send this link to")} ${f.email}`} ({_("valid")} {days} {_("days")}
          ):
        </p>
        <pre>{link}</pre>
      </Result>,
    );
  });

  consoleApp.post("/invitations/:id/revoke", async (c) => {
    await revokeInvitations(db, c.get("principal"), { id: c.req.param("id") }, "console");
    return refresh(c);
  });

  consoleApp.post("/members/:id/handle", async (c) => {
    await setMemberHandle(db, c.get("principal"), c.req.param("id"), ((await form(c)).handle ?? "").trim());
    return refresh(c);
  });

  consoleApp.post("/me/profile", async (c) => {
    await setDisplayName(db, c.get("principal"), (await form(c)).name ?? "");
    return refresh(c);
  });

  consoleApp.post("/settings/team", async (c) => {
    await renameTeam(db, c.get("principal"), (await form(c)).name ?? "");
    return refresh(c);
  });

  consoleApp.post("/members/:id/role", async (c) => {
    const role = (await form(c)).role ?? "";
    if (!(ROLES as readonly string[]).includes(role)) throw new HubError("E_INVALID", "unknown role");
    const p = c.get("principal");
    const userId = await changeRole(db, p, c.req.param("id"), role as Role);
    // Their open streams end and reconnect with the new role: a demoted admin stops getting everyone's activity.
    bus.emit("revoked", { teamId: p.teamId, userId });
    return refresh(c);
  });

  consoleApp.post("/members/:id/revoke", async (c) => {
    requireFresh(c);
    const p = c.get("principal");
    requireAdmin(p);
    const userId = await revokeMember(db, { teamId: p.teamId, membershipId: c.req.param("id"), actorUserId: p.user.id, actorRole: p.role });
    bus.emit("revoked", { teamId: p.teamId, userId });
    bus.emit("presence", { teamId: p.teamId });
    return refresh(c);
  });

  consoleApp.get("/audit", async (c) => {
    const p = c.get("principal");
    requireAdmin(p);
    const before = Number(c.req.query("before")) || undefined;
    const found = await db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.teamId, p.teamId), before ? lt(auditEvent.seq, before) : undefined))
      .orderBy(desc(auditEvent.seq))
      .limit(PAGE + 1);
    const rows = found.slice(0, PAGE);
    const last = rows.at(-1);
    return page(
      c,
      "Audit log",
      <>
        <p>
          <button type="button" hx-post="/console/audit/verify" hx-target="#verify-result">
            Verify chain
          </button>{" "}
          <a href="/console/audit/export">Export JSON</a> (check it offline with <code>codetgh audit verify</code>)
        </p>
        <div id="verify-result" />
        <Table
          head={["#", "At", "Actor", "Via", "Action", "Subject", "Hash"]}
          rows={rows.map((e) => [
            e.seq,
            <When at={e.at} />,
            e.actorAgentId ?? e.actorUserId ?? e.actorType,
            e.via,
            e.action,
            e.subjectId ?? "",
            e.hash.slice(0, 12),
          ])}
          empty={tr(c)("Nothing yet.")}
        />
        {found.length > PAGE && last && <a href={`/console/audit?before=${last.seq}`}>Older</a>}
      </>,
    );
  });

  consoleApp.post("/audit/verify", async (c) => {
    const p = c.get("principal");
    requireAdmin(p);
    await writeCheckpoint(db, p.teamId, auditKey);
    const r = await verifyTeamAudit(db, p.teamId, auditKey.publicKey);
    return c.html(
      <Result>
        {r.ok ? `Chain intact: ${r.events} events, ${r.checkpoints} signed checkpoints.` : `Problem (${r.problem}): ${r.message}.`}
      </Result>,
    );
  });

  // Offline check: codetgh audit verify <file>. Ids only: the audit log never holds message text.
  consoleApp.get("/audit/export", async (c) => {
    const p = c.get("principal");
    requireAdmin(p);
    await writeCheckpoint(db, p.teamId, auditKey);
    const { events, checkpoints } = await exportAudit(db, p.teamId);
    await db.transaction((tx) => appendAudit(tx, { ...byUser(p), action: "audit.exported" }));
    c.header("Content-Disposition", `attachment; filename="codetgh-audit-${p.teamId}.json"`);
    return c.json({
      team_id: p.teamId,
      public_key: auditKey.publicKey,
      key_id: auditKey.keyId,
      exported_at: new Date().toISOString(),
      events,
      checkpoints,
    });
  });

  consoleApp.get("/settings", async (c) => {
    const p = c.get("principal");
    requireAdmin(p);
    const _ = tr(c);
    return page(
      c,
      "Settings",
      <>
        <form hx-post="/console/settings/team" hx-swap="none">
          <label>
            {_("Team name")} <input name="name" value={p.teamName} maxlength={80} required />
          </label>
          <button type="submit">{_("Rename the team")}</button>
        </form>
        <form hx-post="/console/settings" hx-swap="none" class="settings">
          <section aria-labelledby="rules-h">
            <h2 id="rules-h">{_("Agent rules")}</h2>
            <label>
              {_("When an agent edits a file someone else claimed")}{" "}
              <select name="claims_enforcement">
                {CLAIM_ENFORCEMENT.map((level) => (
                  <option
                    value={level}
                    selected={(["warn", "off"].includes(p.settings.claims_enforcement ?? "") ? "warn" : "ask") === level}
                  >
                    {_({ warn: "warn the agent, never block", ask: "ask the human (default)" }[level])}
                  </option>
                ))}
              </select>
            </label>
            <p class="meta">
              {_(
                "Autonomous sessions (bypassPermissions) cannot answer a question: CodeTgh warns them instead of asking. Choose warn for teams that run them.",
              )}
            </p>
            <label>
              {_("Who accepts team memory")}{" "}
              <select name="memory_accept_by">
                {(["member", "admin", "owner"] as const).map((r) => (
                  <option value={r} selected={(p.settings.memory_accept_by ?? "member") === r}>
                    {_(r)} {_("and above")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" name="memory_accept_via_mcp" value="on" checked={Boolean(p.settings.memory_accept_via_mcp)} />{" "}
              {_("Allow accepting memory from Claude Code (asks the user every time; claude.ai and the Agent SDK cannot guarantee that)")}
            </label>
            <label>
              <input type="checkbox" name="auto_link_projects" value="on" checked={p.settings.auto_link_projects !== false} />{" "}
              {_("Link a new repository when a member starts a session in it (otherwise an admin runs codetgh project new)")}
            </label>
            <label>
              <input type="checkbox" name="push_rewake" value="on" checked={(p.settings.push_allowed_modes ?? []).includes("rewake")} />{" "}
              {_(
                "Allow rewake push: an idle Claude Code session wakes up when a message arrives (each member also turns it on in the plugin)",
              )}
            </label>
            <label>
              {_("Message retention (days)")}{" "}
              <input name="retention_days" type="number" min={1} max={3650} value={String(p.settings.retention_days ?? 90)} />
            </label>
            <label>
              {_("Extra secret patterns (regular expressions, one per line)")}{" "}
              <textarea name="secret_patterns" rows={4}>
                {(p.settings.secret_patterns ?? []).join("\n")}
              </textarea>
            </label>
          </section>
          <section aria-labelledby="bridges-h">
            <h2 id="bridges-h">{_("Bridges")}</h2>
            <label>
              {_("Slack channel id for alerts and blocking requests (e.g. C0123ABC)")}{" "}
              <input name="slack_channel" maxlength={40} pattern="[A-Z0-9]+" value={p.settings.slack_channel ?? ""} />
            </label>
            <label>
              {_("Loop orchestrator: handle of the member whose agent judges muted agent loops (empty: a human reopens)")}{" "}
              <input name="loop_orchestrator" maxlength={40} pattern="[a-z0-9-]+" value={p.settings.loop_orchestrator ?? ""} />
            </label>
          </section>
          <button type="submit">{_("Save")}</button>
        </form>
        <section aria-labelledby="github-h" class="settings">
          <h2 id="github-h">{_("GitHub bridge")}</h2>
          <p>
            <Pill tone={p.settings.github_hook ? "ok" : "neutral"}>
              {_(p.settings.github_hook ? "webhook configured" : "not configured")}
            </Pill>{" "}
            <button type="button" hx-post="/console/settings/github" hx-target="#github-hook">
              {_(p.settings.github_hook ? "Replace the webhook secret" : "Create the webhook")}
            </button>
          </p>
          <div id="github-hook" />
          <h2>{_("Audit public key")}</h2>
          <p class="meta">
            {_("key id")} {auditKey.keyId}
          </p>
          <pre>{auditKey.publicKey}</pre>
        </section>
      </>,
    );
  });

  // The secret is shown once; creating a new webhook replaces the old secret.
  consoleApp.post("/settings/github", async (c) => {
    requireFresh(c);
    const hook = await createGithubHook(db, c.get("principal"), config.secret);
    c.header("Cache-Control", "no-store");
    return c.html(
      <Result>
        <p>
          In your GitHub App (Settings → Webhook), set these, then subscribe to Pull request, Check suite and Create events. The secret is
          shown once.
        </p>
        <pre>{`Webhook URL: ${config.publicUrl}/bridges/github/${hook.id}\nSecret: ${hook.secret}`}</pre>
      </Result>,
    );
  });

  consoleApp.post("/settings", async (c) => {
    const f = await form(c);
    if (f.slack_channel && !/^[A-Z0-9]{1,40}$/.test(f.slack_channel)) throw new HubError("E_INVALID", "invalid Slack channel id");
    await updateSettings(db, c.get("principal"), {
      retentionDays: Number(f.retention_days) || undefined,
      secretPatterns: (f.secret_patterns ?? "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      // Prompt-time reading (hooks) is always on; rewake push is the team's opt-in.
      pushAllowedModes: f.push_rewake === "on" ? ["hooks", "rewake"] : ["hooks"],
      autoLinkProjects: f.auto_link_projects === "on",
      memoryAcceptBy: (["member", "admin", "owner"] as const).find((r) => r === f.memory_accept_by),
      memoryAcceptViaMcp: f.memory_accept_via_mcp === "on",
      slackChannel: f.slack_channel || undefined,
      loopOrchestrator: f.loop_orchestrator?.replace(/^@/, "") || undefined,
      claimsEnforcement: CLAIM_ENFORCEMENT.find((l) => l === f.claims_enforcement),
    });
    return refresh(c);
  });

  consoleApp.get("/memory", async (c) => {
    const p = c.get("principal");
    const status = c.req.query("status") ?? "proposed";
    if (!["proposed", "accepted", "superseded", "rejected", "all"].includes(status)) throw new HubError("E_INVALID", "unknown status");
    const found = await db
      .select({ item: memoryItem, name: user.name })
      .from(memoryItem)
      .innerJoin(user, eq(user.id, memoryItem.proposedByUser))
      .where(
        and(
          eq(memoryItem.teamId, p.teamId),
          status === "all" ? undefined : eq(memoryItem.status, status as "proposed"),
          olderThan(c, memoryItem.createdAt),
        ),
      )
      .orderBy(desc(memoryItem.createdAt))
      .limit(PAGE + 1);
    const rows = found.slice(0, PAGE);
    const last = rows.at(-1);
    return page(
      c,
      "Team memory",
      <>
        <nav>
          {["proposed", "accepted", "superseded", "rejected", "all"].map((s) => (
            <a href={`/console/memory?status=${s}`}>{s}</a>
          ))}
        </nav>
        <Table
          head={["Ref", "Version", "Kind", "Status", "Title", "Proposed by", "When"]}
          rows={rows.map(({ item, name }) => [
            memoryRef(item),
            item.version,
            item.kind,
            `${item.status}${item.pinned ? " · pinned" : ""}`,
            <a href={`/console/memory/${item.id}`}>{item.title}</a>,
            `${name}${item.authoredBy === "agent" ? " (agent)" : ""}`,
            <When at={item.createdAt} />,
          ])}
          empty={tr(c)("Nothing yet.")}
        />
        {found.length > PAGE && last && (
          <a href={`/console/memory?status=${status}&before=${encodeURIComponent(last.item.createdAt.toISOString())}`}>{tr(c)("Older")}</a>
        )}
      </>,
    );
  });

  consoleApp.get("/memory/:id", async (c) => {
    const p = c.get("principal");
    const [row] = await db
      .select({ item: memoryItem, name: user.name })
      .from(memoryItem)
      .innerJoin(user, eq(user.id, memoryItem.proposedByUser))
      .where(and(eq(memoryItem.id, c.req.param("id")), eq(memoryItem.teamId, p.teamId)));
    if (!row) throw new HubError("E_NOT_FOUND", "no such item");
    const { item, name } = row;
    const [old] = item.supersedesId ? await db.select().from(memoryItem).where(eq(memoryItem.id, item.supersedesId)) : [];
    return page(
      c,
      `${memoryRef(item)} v${item.version} · ${item.title}`,
      <>
        <p>
          {item.kind} · {item.status}
          {item.pinned && " · pinned"} · proposed by {name}
          {item.authoredBy === "agent" ? " (agent)" : ""} on <When at={item.createdAt} />
          {item.branch && ` · branch ${item.branch}`}
        </p>
        {old ? (
          <>
            <h2>Changes from v{old.version}</h2>
            {/* Removed text in red, added text in green; both rendered as text. */}
            <pre>
              {diffLines(old.body, item.body).map((part) => (
                <span class={part.added ? "add" : part.removed ? "del" : "same"}>{part.value}</span>
              ))}
            </pre>
          </>
        ) : (
          <pre>{item.body}</pre>
        )}
        {item.decisionNote && <p>Decision note: {item.decisionNote}</p>}
        {item.status === "proposed" && canDecide(p) && (
          <form hx-post={`/console/memory/${item.id}/decide`} hx-swap="none">
            <label>
              Note <input name="note" maxlength={500} />
            </label>
            <button type="submit" name="decision" value="accept">
              Accept
            </button>
            <button type="submit" name="decision" value="reject">
              Reject
            </button>
          </form>
        )}
        {item.status === "accepted" && canDecide(p) && (
          <Action post={`/console/memory/${item.id}/pin`} vals={{ pinned: String(!item.pinned) }} label={item.pinned ? "Unpin" : "Pin"} />
        )}
      </>,
    );
  });

  consoleApp.post("/memory/:id/decide", async (c) => {
    const f = await form(c);
    if (f.decision !== "accept" && f.decision !== "reject") throw new HubError("E_INVALID", "decision must be accept or reject");
    await decideMemory(messaging, c.get("principal"), { item_id: c.req.param("id"), decision: f.decision, note: f.note }, "console");
    bus.emit("attention", { teamId: c.get("principal").teamId });
    return refresh(c);
  });

  consoleApp.post("/memory/:id/pin", async (c) => {
    await setPinned(db, c.get("principal"), c.req.param("id"), (await form(c)).pinned === "true");
    return refresh(c);
  });

  consoleApp.get("/claims", async (c) => {
    const p = c.get("principal");
    const rows = await db
      .select({ claim, name: user.name, total: sql<number>`count(*) over ()`.mapWith(Number) })
      .from(claim)
      .innerJoin(user, eq(user.id, claim.holderUserId))
      .where(and(eq(claim.teamId, p.teamId), isNull(claim.releasedAt), gt(claim.expiresAt, new Date())))
      .orderBy(asc(claim.expiresAt))
      .limit(PAGE * 4);
    return page(
      c,
      "Claims",
      <>
        <Table
          head={["Scope", "Holder", "Mode", "Reason", "Time left", ""]}
          rows={rows.map((r) => [
            r.claim.scope,
            r.name,
            r.claim.mode,
            r.claim.reason ?? "",
            `${Math.max(1, Math.round((r.claim.expiresAt.getTime() - Date.now()) / 60_000))} min`,
            isAdmin(p) ? <Action post={`/console/claims/${r.claim.id}/release`} label="Release" /> : "",
          ])}
          empty={tr(c)("Nothing yet.")}
        />
        {capped(c, rows.length, rows[0]?.total)}
      </>,
    );
  });

  consoleApp.post("/claims/:id/release", async (c) => {
    const p = c.get("principal");
    requireAdmin(p);
    await adminReleaseClaim(db, p, c.req.param("id"));
    return refresh(c);
  });

  consoleApp.get("/tasks", async (c) => {
    const p = c.get("principal");
    const archived = c.req.query("archived") === "1";
    const f = await projectFilter(c);
    const where = and(eq(task.teamId, p.teamId), onProject(task.projectId, f), archived ? archivedTask() : not(archivedTask()));
    const rows = await db
      .select({ task, handle: membership.handle })
      .from(task)
      .leftJoin(membership, and(eq(membership.userId, task.assigneeUserId), eq(membership.teamId, task.teamId)))
      .where(where)
      .orderBy(desc(task.updatedAt))
      .limit(PAGE * 4);
    // The headings count every task, also those past the row limit.
    const counts = await db
      .select({ projectId: task.projectId, status: task.status, n: count() })
      .from(task)
      .where(where)
      .groupBy(task.projectId, task.status);
    const countOf = (s: string, projectId?: string) =>
      counts.filter((x) => x.status === s && (!projectId || (x.projectId ?? "none") === projectId)).reduce((n, x) => n + x.n, 0);
    // Under a project heading, the status headings step down one level.
    const board = (all: typeof rows, projectId?: string) =>
      TASK_STATUSES.map((s) => {
        const of = all.filter((r) => r.task.status === s);
        const Heading = projectId ? "h3" : "h2";
        return (
          of.length > 0 && (
            <>
              <Heading>
                {s} ({countOf(s, projectId)})
              </Heading>
              <Table
                head={["Title", "Assignee", "Version", "Updated"]}
                rows={of.map((r) => [
                  <a href={withProject(`/console/tasks/${r.task.id}`, f.selected)}>{r.task.title}</a>,
                  r.handle ? `@${r.handle}` : "",
                  r.task.version,
                  <When at={r.task.updatedAt} />,
                ])}
                empty={tr(c)("Nothing yet.")}
              />
            </>
          )
        );
      });
    return page(
      c,
      "Tasks",
      <>
        <ArchiveTabs base="/console/tasks" archived={archived} lang={tr(c).lang} project={f.selected} />
        {archived && rows.length === 0 && <p>{tr(c)("Nothing yet.")}</p>}
        {f.selected
          ? board(rows)
          : byProject(f, rows, (r) => r.task.projectId, tr(c)("Outside a project")).map((g) => (
              <section aria-labelledby={`p-${g.id}`}>
                <h2 id={`p-${g.id}`}>{g.name}</h2>
                {board(g.rows, g.id)}
              </section>
            ))}
        {capped(
          c,
          rows.length,
          counts.reduce((n, x) => n + x.n, 0),
        )}
        <h2>New task</h2>
        <form hx-post="/console/tasks" hx-swap="none">
          <label>
            Title <input name="title" required maxlength={200} />
          </label>
          <label>
            Description <textarea name="body" maxlength={8000} />
          </label>
          <label>
            Assignee (@handle) <input name="assignee" />
          </label>
          <button type="submit">Create</button>
        </form>
      </>,
      f,
    );
  });

  // Empty form fields mean "not set".
  const filled = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
  const parsed = <T,>(r: { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } }) => {
    if (!r.success) throw new HubError("E_INVALID", r.error.issues[0]?.message ?? "invalid input");
    return r.data;
  };

  consoleApp.post("/tasks", async (c) => {
    const input = parsed(TaskCreateInput.safeParse(filled(await form(c))));
    await createTask(messaging, c.get("principal"), null, input);
    return refresh(c);
  });

  consoleApp.get("/tasks/:id", async (c) => {
    const p = c.get("principal");
    const [t] = await db
      .select()
      .from(task)
      .where(and(eq(task.id, c.req.param("id")), eq(task.teamId, p.teamId)));
    if (!t) throw new HubError("E_NOT_FOUND", "task not found");
    const history = await db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.teamId, p.teamId), eq(auditEvent.subjectId, t.id)))
      .orderBy(asc(auditEvent.seq));
    return page(
      c,
      t.title,
      <>
        <p>
          <a href={withProject("/console/tasks", kept(c))}>{tr(c)("Back to tasks")}</a>
        </p>
        <p>
          {t.status} · version {t.version}
        </p>
        <pre>{t.body}</pre>
        <h2>Notes</h2>
        <Table head={["When", "Note"]} rows={t.notes.map((n) => [n.at, <pre>{n.text}</pre>])} empty={tr(c)("Nothing yet.")} />
        <h2>History</h2>
        <Table
          head={["#", "Action", "Via", "At"]}
          rows={history.map((e) => [e.seq, e.action, e.via, <When at={e.at} />])}
          empty={tr(c)("Nothing yet.")}
        />
        <h2>Update</h2>
        <form hx-post={`/console/tasks/${t.id}`} hx-swap="none">
          <input type="hidden" name="expected_version" value={String(t.version)} />
          <label>
            Status{" "}
            <select name="status">
              <option value="">unchanged</option>
              {TASK_STATUSES.filter((s) => s !== "claimed").map((s) => (
                <option value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Assignee (@handle or none) <input name="assignee" />
          </label>
          <label>
            Reason (needed for blocked) <input name="reason" maxlength={200} />
          </label>
          <label>
            Note <input name="note" maxlength={500} />
          </label>
          <button type="submit">Save</button>
        </form>
      </>,
    );
  });

  consoleApp.post("/tasks/:id", async (c) => {
    const { expected_version, ...patch } = filled(await form(c));
    const input = parsed(TaskUpdateInput.safeParse({ task_id: c.req.param("id"), expected_version: Number(expected_version), patch }));
    await updateTask(messaging, c.get("principal"), null, input);
    return refresh(c);
  });

  // Live updates: events are refresh signals; DM activity only reaches participants and admins.
  consoleApp.get("/stream", (c) => {
    const p = c.get("principal");
    const release = hold(`console:${p.user.id}`, 8); // a few tabs each
    return streamSSE(c, async (stream) => {
      const send = (event: string) => stream.writeSSE({ event, data: "refresh" }).catch(() => {});
      const onPresence = (e: { teamId: string }) => e.teamId === p.teamId && send("presence");
      const onAttention = (e: { teamId: string }) => e.teamId === p.teamId && send("attention");
      const onMessage = (e: { teamId: string; recipientUserIds: string[] }) =>
        e.teamId === p.teamId && (isAdmin(p) || e.recipientUserIds.includes(p.user.id)) && send("activity");
      let stop = () => {};
      const stopped = new Promise<void>((resolve) => {
        stop = resolve;
      });
      const onRevoked = (e: { userId: string }) => e.userId === p.user.id && stop();
      bus.on("presence", onPresence);
      bus.on("attention", onAttention);
      bus.on("message", onMessage);
      bus.on("revoked", onRevoked);
      stream.onAbort(stop);
      const keepAlive = setInterval(() => stream.write(": keep-alive\n\n").catch(stop), 15_000);
      // Never throws, so the cleanup below (listeners, the per-user slot) always runs.
      await stream.writeSSE({ event: "ready", data: "ok" }).catch(stop);
      await stopped;
      clearInterval(keepAlive);
      bus.off("presence", onPresence);
      bus.off("attention", onAttention);
      bus.off("message", onMessage);
      bus.off("revoked", onRevoked);
      release();
    });
  });

  app.route("/console", consoleApp);
  return app;
}
