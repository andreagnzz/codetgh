/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { raw } from "hono/html";
import type { Child, FC } from "hono/jsx";
import { BrandHead, Logo } from "../brand.js";
import { type listAgents, presence, statusOf } from "../domain/agents.js";
import { type Lang, t } from "../i18n.js";
import { Icon, type IconName } from "../icons.js";
import { Layout as PublicLayout } from "../pages.js";
import type { Principal } from "../principal.js";

// Three groups, by how often they are used. The third field is the least role that may open the page: no link to a page
// that would answer 403. My data and Tokens are in the account menu.
type NavItem = [string, string, ("member" | "admin")?];
const NAV: NavItem[][] = [
  [
    ["/console", "Overview"],
    ["/console/threads", "Threads"],
    ["/console/alerts", "Alerts", "admin"],
    ["/console/agents", "Agents"],
    ["/console/projects", "Projects", "member"],
  ],
  [
    ["/console/tasks", "Tasks", "member"],
    ["/console/claims", "Claims", "member"],
    ["/console/memory", "Memory", "member"],
    ["/console/delegations", "Delegations", "member"],
  ],
  [
    ["/console/members", "Members", "admin"],
    ["/console/audit", "Audit", "admin"],
    ["/console/settings", "Settings", "admin"],
  ],
];
const ACCOUNT: NavItem[] = [
  ["/console/me", "My data"],
  ["/console/tokens", "Tokens", "member"],
];

// The project filter: ?project=<id>, or none for what is outside a project; no value shows every project.
export type ProjectFilter = { projects: Array<{ id: string; name: string }>; selected: string | undefined };

export const Layout: FC<{
  p: Principal;
  csrf: string;
  title: string;
  path: string;
  lang: Lang;
  filter?: ProjectFilter;
  keep?: string;
  // On the Archives tab, the filter links stay on it.
  archived?: boolean;
  // A detail page: a way back above the title, a meta line under it, its one action next to it.
  back?: Child;
  head?: Child;
  actions?: Child;
  children?: Child;
}> = ({ p, csrf, title, path, lang, filter, keep, archived, back, head, actions, children }) => {
  const _ = (s: string) => t(lang, s);
  const admin = p.role === "owner" || p.role === "admin";
  const allowed = ([, , least]: NavItem) => (least === "admin" ? admin : least !== "member" || p.role !== "guest");
  const current = (href: string) =>
    href === "/console" ? path === "/console" || path === "/console/" : path === href || path.startsWith(`${href}/`);
  const link = ([href, label]: NavItem) => (
    <li>
      <a href={keep ? `${href}?project=${encodeURIComponent(keep)}` : href} aria-current={current(href) ? "page" : undefined}>
        {_(label)}
      </a>
    </li>
  );
  const groups = NAV.map((g) => g.filter(allowed)).filter((g) => g.length > 0);
  const nav = (
    <nav class="nav" aria-label={_("Console")}>
      {groups.map((g) => (
        <ul>{g.map(link)}</ul>
      ))}
    </nav>
  );
  const account = (
    <ul class="account-items">
      {ACCOUNT.filter(allowed).map(link)}
      <li>
        {lang === "fr" ? (
          <a href={`/lang/en?next=${encodeURIComponent(path)}`} hreflang="en" lang="en">
            English
          </a>
        ) : (
          <a href={`/lang/fr?next=${encodeURIComponent(path)}`} hreflang="fr" lang="fr">
            Français
          </a>
        )}
      </li>
    </ul>
  );
  return (
    <>
      {raw("<!doctype html>")}
      <html lang={lang}>
        <head>
          <meta charset="utf-8" />
          <BrandHead />
          <meta name="htmx-config" content='{"allowEval":false,"allowScriptTags":false,"includeIndicatorStyles":false}' />
          <title>{`${title} · CodeTgh`}</title>
          <script src="/assets/htmx.js" />
          <script src="/assets/sse.js" />
          <script src="/console.js" defer />
        </head>
        <body hx-headers={JSON.stringify({ "X-CSRF-Token": csrf })} hx-ext="sse" sse-connect="/console/stream">
          <a class="skip" href="#main">
            {_("Skip to content")}
          </a>
          <div class="shell">
            <aside class="sidebar">
              <Logo kind="horizontal" />
              {nav}
            </aside>
            <header class="topbar">
              <p class="team" title={p.teamName}>
                {p.teamName}
              </p>
              {/* console.js follows the live connection (htmx sse events); the words come from here. */}
              <p class="live" role="status" data-state="connecting" data-live={_("Live")} data-lost={_("Reconnecting…")}>
                {_("Connecting…")}
              </p>
              <details class="account">
                <summary>
                  {p.user.name} · {_(p.role)}
                  <Icon name="chevron-down" />
                </summary>
                <div class="pop">{account}</div>
              </details>
              <details class="menu">
                <summary>
                  <span class="menu-closed">
                    <Icon name="menu" />
                    {_("Menu")}
                  </span>
                  <span class="menu-open">
                    <Icon name="x" />
                    {_("Close")}
                  </span>
                </summary>
                {nav}
                <p class="menu-who">
                  {p.user.name} · {_(p.role)}
                </p>
                {account}
              </details>
            </header>
            {p.paused && (
              <Banner tone="danger" title={_("Agent traffic stopped")}>
                {_("Agents can't send messages until an admin resumes it.")} {admin && <a href="/console">{_("Resume agent traffic")}</a>}
              </Banner>
            )}
            <main id="main">
              <div class="page-head">
                {back && (
                  <p class="back">
                    <Icon name="chevron-left" />
                    {back}
                  </p>
                )}
                <h1>{title}</h1>
                {actions && <div class="page-actions">{actions}</div>}
                {head && <div class="page-meta">{head}</div>}
              </div>
              {filter && (
                <nav aria-label={_("Project")} class="projects-filter">
                  {[{ id: undefined, name: _("All projects") }, ...filter.projects, { id: "none", name: _("Outside a project") }].map(
                    (pr) => (
                      <a
                        href={`${path}?${archived ? "archived=1&" : ""}project=${pr.id ? encodeURIComponent(pr.id) : ""}`}
                        aria-current={pr.id === filter.selected ? "page" : undefined}
                      >
                        {pr.name}
                      </a>
                    ),
                  )}
                </nav>
              )}
              {children}
            </main>
          </div>
          {/* Outside the live-refreshed parts, so a screen reader hears each new message once. */}
          <p id="line-announce" class="sr-only" aria-live="polite" />
        </body>
      </html>
    </>
  );
};

// Every value below is rendered by JSX, which escapes text: agent-written strings never become HTML.
export const Table: FC<{ head: string[]; rows: Child[][]; empty: Child }> = ({ head, rows, empty }) =>
  rows.length ? (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              {r.map((cell, i) => (
                <td data-label={head[i]}>
                  <div class="cell">{cell}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p class="empty">{empty}</p>
  );

// A state always reads as text; the tone only reinforces it.
export type Tone = "ok" | "warn" | "danger" | "neutral";
export const Pill: FC<{ tone?: Tone; children?: Child }> = ({ tone = "neutral", children }) => (
  <span class="pill" data-tone={tone}>
    {children}
  </span>
);

// Current items, or the archives: threads quiet for a day with nothing unread, tasks finished a day ago.
export const ArchiveTabs: FC<{ base: string; archived: boolean; lang: Lang; project?: string }> = ({ base, archived, lang, project }) => (
  <nav class="tabs" aria-label={t(lang, "Archives")}>
    <a href={project ? `${base}?project=${encodeURIComponent(project)}` : base} aria-current={archived ? undefined : "page"}>
      {t(lang, "Current")}
    </a>{" "}
    <a href={`${base}?archived=1${project ? `&project=${encodeURIComponent(project)}` : ""}`} aria-current={archived ? "page" : undefined}>
      {t(lang, "Archives")}
    </a>
  </nav>
);

export const toneOf = (state: string): Tone =>
  (({ online: "ok", trusted: "ok", open: "warn", quarantined: "danger" }) as Record<string, Tone>)[state] ?? "neutral";

// A session in bypassPermissions stands out; other permission modes read as plain text.
export const Bypass: FC<{ lang: Lang }> = ({ lang }) => (
  <span title={t(lang, "Permission prompts are off in this session")}>
    <Pill tone="danger">bypass</Pill>
  </span>
);

// Relative time for people, the exact instant for machines and on hover.
export const When: FC<{ at: Date; lang?: string }> = ({ at, lang = "en" }) => {
  const s = Math.round((at.getTime() - Date.now()) / 1000);
  const [n, unit]: [number, Intl.RelativeTimeFormatUnit] =
    Math.abs(s) < 60
      ? [s, "second"]
      : Math.abs(s) < 3600
        ? [Math.round(s / 60), "minute"]
        : Math.abs(s) < 86400
          ? [Math.round(s / 3600), "hour"]
          : [Math.round(s / 86400), "day"];
  const iso = at.toISOString();
  return (
    <time datetime={iso} title={iso}>
      {new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(n, unit)}
    </time>
  );
};

// One-click actions: an htmx POST answered with HX-Refresh; the CSRF header comes from <body hx-headers>. The level is the
// importance: primary (one per area), secondary (the default), tertiary (a text action), danger (destructive).
export const Action: FC<{
  post: string;
  label: string;
  vals?: Record<string, string>;
  level?: "primary" | "secondary" | "tertiary" | "danger";
}> = ({ post, label, vals, level }) => (
  <button type="button" class={level} hx-post={post} hx-vals={vals ? JSON.stringify(vals) : undefined} hx-swap="none">
    {label}
  </button>
);

// A message about a state: its icon's shape is the severity; information and success are polite, an error is an alert.
export type BannerTone = "info" | "success" | "warn" | "danger";
const BANNER_ICON: Record<BannerTone, IconName> = {
  info: "info",
  success: "circle-check",
  warn: "triangle-alert",
  danger: "octagon-alert",
};
export const Banner: FC<{ tone?: BannerTone; title: Child; actions?: Child; dismiss?: string; children?: Child }> = ({
  tone = "info",
  title,
  actions,
  dismiss,
  children,
}) => (
  <div class="banner" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
    <Icon name={BANNER_ICON[tone]} />
    <div class="banner-text">
      <p class="banner-title">{title}</p>
      {children && <p class="banner-body">{children}</p>}
      {actions && <p class="banner-actions">{actions}</p>}
    </div>
    {dismiss && (
      <button type="button" class="icon-button" aria-label={dismiss} data-dismiss>
        <Icon name="x" />
      </button>
    )}
  </div>
);

// Presence: who is live first, then a rule, then who is offline (archived, quieter).
type AgentRow = Awaited<ReturnType<typeof listAgents>>[number];
type RowAction = (r: AgentRow) => Child;
const Person: FC<{ r: AgentRow; lang: Lang; action?: RowAction }> = ({ r, lang, action }) => {
  const state = presence(r.agent);
  const status = statusOf(r.agent);
  return (
    <li>
      <span class="who-name">{r.name}</span>{" "}
      <span class="meta">
        {r.agent.label}
        {r.project && ` · ${r.project}`}
      </span>{" "}
      <Pill tone={toneOf(state)}>{t(lang, state)}</Pill>
      {(r.agent.pushMode || r.agent.clientVersion) && (
        <span class="meta">
          {" "}
          {[r.agent.pushMode && `push ${r.agent.pushMode}`, r.agent.clientVersion && `Claude Code ${r.agent.clientVersion}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
      {r.agent.permissionMode === "bypassPermissions" && (
        <>
          {" "}
          <Bypass lang={lang} />
        </>
      )}
      {r.agent.trustLevel === "quarantined" && (
        <>
          {" "}
          <Pill tone="danger">{t(lang, "quarantined")}</Pill>
        </>
      )}
      {status && (
        <span class="status meta">
          {status.text}
          {status.at && (
            <>
              {" · "}
              <When at={status.at} lang={lang} />
            </>
          )}
        </span>
      )}
      {action?.(r)}
    </li>
  );
};
export const People: FC<{ rows: AgentRow[]; lang: Lang; empty: Child; action?: RowAction }> = ({ rows, lang, empty, action }) => {
  const live = rows.filter((r) => presence(r.agent) !== "offline");
  const offline = rows.filter((r) => presence(r.agent) === "offline");
  return (
    <>
      {live.length ? (
        <ul class="people">
          {live.map((r) => (
            <Person r={r} lang={lang} action={action} />
          ))}
        </ul>
      ) : (
        <p class="empty">{empty}</p>
      )}
      {offline.length > 0 && (
        <>
          <h3 class="rule">{t(lang, "Offline")}</h3>
          <ul class="people archived">
            {offline.map((r) => (
              <Person r={r} lang={lang} action={action} />
            ))}
          </ul>
        </>
      )}
    </>
  );
};

// The activity line, the console's one memorable element: each message is a short vertical wire between the
// sender's caret and the recipient's caret, in the accent color. A message new on screen traces its wire once (console.js).
type LineRow = {
  message: { id: string; createdAt: Date; kind: string; priority: string; authoredBy: string; to: string[]; threadId: string };
  name: string;
};
export const Line: FC<{ rows: LineRow[]; _: ((s: string) => string) & { lang: Lang }; archived?: boolean }> = ({ rows, _, archived }) => (
  <ol class={archived ? "line archived" : "line"}>
    {rows.map(({ message: m, name }) => {
      const to = m.to.map((a) => (a.startsWith("thread:") ? _("the thread") : /^(user|agent):/.test(a) ? _("a teammate") : a)).join(", ");
      const from = `${name}${m.authoredBy === "agent" ? ` ${_("(agent)")}` : ""}`;
      return (
        <li class="wire-row" data-mid={m.id} data-summary={`${_("New message")}: ${from} → ${to}`}>
          <svg class="wire" viewBox="0 0 20 44" width="20" height="44" aria-hidden="true" focusable="false">
            <path class="caret" d="M5 3 L11 8 L5 13" />
            <path class="link" d="M8 15 V29" pathLength="1" />
            <path class="caret" d="M5 31 L11 36 L5 41" />
          </svg>
          <div>
            <p class="wire-who">
              <strong>{from}</strong> <span aria-hidden="true">→</span>
              <span class="sr-only">{_("to")}</span> {to}
            </p>
            <p class="meta">
              <Pill>{_(m.kind)}</Pill>
              {m.priority !== "normal" && (
                <>
                  {" "}
                  <Pill tone="warn">{m.priority}</Pill>
                </>
              )}{" "}
              <When at={m.createdAt} lang={_.lang} /> · <a href={`/console/threads/${m.threadId}`}>{_("Open thread")}</a>
            </p>
          </div>
        </li>
      );
    })}
  </ol>
);

export const Result: FC<{ children?: Child }> = ({ children }) => (
  <div class="result" role="status">
    {children}
  </div>
);

export const InvitePage: FC<{
  team: string;
  role: string;
  email: string;
  name: string;
  valid: boolean;
  join?: { token: string; csrf: string };
  lang: Lang;
}> = ({ team, role, email, name, valid, join, lang }) => {
  const _ = (s: string) => t(lang, s);
  // A replacer function: a $ in the team name is not a replacement pattern.
  const heading = _("Join {team} on CodeTgh").replace("{team}", () => team);
  return (
    <PublicLayout lang={lang} title={heading}>
      {valid ? (
        <>
          <h1>{heading}</h1>
          <p>
            {_("Invited as")} <strong>{_(role)}</strong> {_("with")} {email}.
          </p>
          {join ? (
            <form id="invite-join" method="post" action={`/invite/${join.token}/join`}>
              <input type="hidden" name="csrf" value={join.csrf} />
              <button type="submit">{_("Join {team}").replace("{team}", () => team)}</button>
            </form>
          ) : (
            <>
              {/* A guest has no Tokens page: their terminal signs in through the browser (codetgh login). */}
              <form id="invite-signup" data-next={role === "guest" ? "/console" : "/console/tokens"}>
                <input type="hidden" name="email" value={email} />
                <label>
                  {_("Your name")} <input name="name" required maxlength={60} value={name.slice(0, 60)} autocomplete="name" />
                </label>
                <label>
                  {_("Password")} <input name="password" type="password" required minlength={12} autocomplete="new-password" />
                </label>
                <button type="submit">{_("Create my account")}</button>
              </form>
              <p>
                {_("Already have an account?")} <a href="/login">{_("Sign in")}</a>.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <h1>{_("This invitation is no longer valid.")}</h1>
          <p>{_("Ask the person who invited you for a new link.")}</p>
        </>
      )}
    </PublicLayout>
  );
};
