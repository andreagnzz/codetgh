/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { diffLines } from "diff";
import type { Child, FC } from "hono/jsx";
import type { auditEvent, memoryItem } from "../db/schema.js";
import { memoryRef } from "../domain/memory.js";
import type { Lang } from "../i18n.js";
import { Icon } from "../icons.js";
import { Banner, Chip, EmptyState, Field, fieldAria, Panel, Pill, Stamp, Table, type Tone, When } from "./pages.js";

// The audit log, team memory, claims and tasks. People and objects read by name, the machine keys and ids stay underneath
// in mono; a state is a word, a pill only reinforces it. Every value is rendered by JSX, which escapes text: titles, bodies,
// notes and scopes that agents wrote never become HTML.
type Tr = ((s: string) => string) & { lang: Lang };
type AuditEvent = typeof auditEvent.$inferSelect;
type MemoryItem = typeof memoryItem.$inferSelect;

// Names the route looked up for the ids on the page (display only): people, sessions, threads, tasks, memory, projects.
export type Names = { names: Map<string, string>; threads: Map<string, { kind: string; subject: string | null }> };

// A value for a {key} in a translated sentence: a $ in it is not a replacement pattern.
export const fill = (s: string, vars: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
// The same, with markup for a value: the sentence is split around its placeholders.
const fillNodes = (s: string, vars: Record<string, Child>) =>
  s.split(/(\{\w+\})/).map((part) => {
    const key = part.match(/^\{(\w+)\}$/)?.[1];
    return key && key in vars ? vars[key] : part;
  });
// "tsk_01M6…ABCD": the start and the end of an id, enough to tell two apart and to find the whole one in an export.
export const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
// A dotted key breaks after its dots, never inside a word.
const key = (k: string) => <code class="rec-key">{k.split(/(?<=\.)/).map((part, i) => (i ? [<wbr />, part] : part))}</code>;
// A cell on two lines: what a person reads, then what identifies it.
const Lines: FC<{ main: Child; sub?: Child }> = ({ main, sub }) => (
  <>
    <span class="rec-main">{main}</span>
    {sub !== undefined && sub !== null && sub !== false && <span class="rec-sub meta">{sub}</span>}
  </>
);
const none = (text: string) => <span class="rec-none">{text}</span>;

// A memory item as its people type it: its ref and version ("D-1 v2").
export const memoryLabel = (i: Pick<MemoryItem, "kind" | "number" | "version">) => `${memoryRef(i)} v${i.version}`;

// ---- Audit log ----

// Every action key the hub writes, in words. An unknown key (a newer hub, a test) shows only the key.
const AUDIT: Record<string, string> = {
  "agent.a2a_created": "External agent added",
  "agent.delegate_stopped": "Delegation turned off",
  "agent.project_set": "Session attached to a project",
  "agent.quarantined": "Quarantine started",
  "agent.removed": "Session removed",
  "agent.session_ended": "Session ended",
  "agent.session_expired": "Session expired",
  "agent.session_started": "Session started",
  "agent.status_set": "Status set",
  "agent.trusted": "Quarantine lifted",
  "agents.paused": "Agents paused",
  "agents.resumed": "Agents resumed",
  "alert.created": "Alert raised",
  "alert.dismissed": "Alert dismissed",
  "alert.false_positive": "Alert marked as a false positive",
  "alert.fingerprint_allowed": "Secret fingerprint allowed",
  "audit.exported": "Audit log exported",
  "claim.created": "Claim made",
  "claim.intent_created": "Intent announced",
  "claim.released": "Claim released",
  "claim.renewed": "Claim renewed",
  "device.approved": "Terminal sign-in approved",
  "device.denied": "Terminal sign-in denied",
  "github.webhook_created": "GitHub webhook created",
  "invitation.accepted": "Invitation accepted",
  "invitation.created": "Invitation created",
  "invitation.revoked": "Invitation revoked",
  "key.published": "Encryption key published",
  "kill_switch.off": "Agent traffic resumed",
  "kill_switch.on": "Agent traffic stopped",
  "launcher.requested": "Remote Control requested",
  "launcher.stopped": "Remote Control stopped",
  "member.data_exported": "Personal data exported",
  "member.erased": "Personal data erased",
  "member.handle_changed": "Handle changed",
  "member.renamed": "Display name changed",
  "member.revoked": "Member revoked",
  "member.role_changed": "Role changed",
  "memory.accepted": "Memory accepted",
  "memory.pinned": "Memory pinned",
  "memory.proposed": "Memory proposed",
  "memory.rejected": "Memory rejected",
  "memory.unpinned": "Memory unpinned",
  "message.acked": "Message acknowledged",
  "message.blocked": "Message blocked",
  "message.sent": "Message sent",
  "runner.leased": "Runner took a task",
  "runner.lease_expired": "Runner's hold on a task ran out",
  "runner.merged": "Pull request merged",
  "runner.pr_closed": "Pull request closed",
  "runner.requested": "Runner requested",
  "runner.retried": "Runner task retried",
  "runner.stopped": "Runner stopped",
  "runner.updated": "Runner updated a task",
  "settings.updated": "Settings changed",
  "slack.link_code_created": "Slack link code created",
  "slack.linked": "Slack linked",
  "task.claimed": "Task claimed",
  "task.created": "Task created",
  "task.handed_off": "Task handed off",
  "task.taken_over": "Task taken over",
  "task.updated": "Task updated",
  "task.verified_by_tag": "Task finished by its tag",
  "task.verify_skipped": "Tag check skipped",
  "team.created": "Team created",
  "team.renamed": "Team renamed",
  "thread.loop_verdict": "Loop verdict posted",
  "thread.muted": "Thread muted",
  "thread.read_by_admin": "Thread read by an admin",
  "thread.read_by_orchestrator": "Thread read by the loop orchestrator",
  "thread.reopened": "Thread reopened",
  "thread.reopened_by_orchestrator": "Thread reopened by the loop orchestrator",
  "token.created": "Token created",
  "token.revoked": "Token revoked",
};
const VIA: Record<string, string> = { console: "Console", mcp: "MCP", rest: "REST API", hook: "Hook", system: "Hub" };
// Objects the log names by kind only: their own pages are not the admin's to read here.
const KIND_OF: Record<string, string> = {
  alr: "An alert",
  clm: "A claim",
  dev: "A terminal sign-in",
  inv: "An invitation",
  msg: "A message",
  tok: "A token",
};

const threadName = (id: string, names: Names, _: Tr) => {
  const t = names.threads.get(id);
  if (!t) return _("A thread");
  // The subject of a direct thread is part of it: only its participants, or an admin's audited opening, show it.
  return t.kind === "team" && t.subject ? t.subject : _(t.kind === "direct" ? "A direct thread" : "A team thread");
};

const Actor: FC<{ e: Pick<AuditEvent, "actorType" | "actorUserId" | "actorAgentId">; names: Names; _: Tr }> = ({ e, names, _ }) => {
  if (e.actorType === "hub") return <Lines main={_("Hub")} />;
  const name = (e.actorUserId && names.names.get(e.actorUserId)) || _("A former member");
  if (e.actorType === "agent" && e.actorAgentId)
    return <Lines main={name} sub={<Chip>{names.names.get(e.actorAgentId) ?? short(e.actorAgentId)}</Chip>} />;
  return <Lines main={name} sub={_("Person")} />;
};

const Subject: FC<{ e: AuditEvent; names: Names; teamName: string; _: Tr }> = ({ e, names, teamName, _ }) => {
  const id = e.subjectId;
  if (!id) return none(_("None"));
  const prefix = id.slice(0, id.indexOf("_"));
  const thread = typeof e.data.thread === "string" ? e.data.thread : null;
  const name =
    prefix === "team"
      ? teamName
      : prefix === "thr"
        ? threadName(id, names, _)
        : prefix === "msg" && thread
          ? threadName(thread, names, _)
          : (names.names.get(id) ?? (KIND_OF[prefix] ? _(KIND_OF[prefix] ?? "") : null));
  // A session is named as typed in a terminal.
  const shown = name && prefix === "agt" && names.names.has(id) ? <Chip>{name}</Chip> : name;
  return (
    <Lines main={shown ?? <code class="rec-key">{short(id)}</code>} sub={name ? <code class="rec-key">{short(id)}</code> : undefined} />
  );
};

// The event's number opens its hash and the previous one: the chain a verification walks.
const Hash: FC<{ e: AuditEvent; _: Tr }> = ({ e, _ }) => (
  <details class="row-menu audit-hash">
    <summary aria-label={fill(_("Hashes of event {n}"), { n: e.seq })}>
      {e.seq}
      <Icon name="chevron-down" />
    </summary>
    <div class="pop">
      <dl>
        <dt>{_("Hash")}</dt>
        <dd>
          <code>{e.hash}</code>
        </dd>
        <dt>{_("Previous hash")}</dt>
        <dd>
          <code>{e.prevHash}</code>
        </dd>
      </dl>
    </div>
  </details>
);

export const AuditTable: FC<{ rows: AuditEvent[]; names: Names; teamName: string; _: Tr }> = ({ rows, names, teamName, _ }) => (
  <div class="audit-log">
    <Table
      lang={_.lang}
      caption={_("Audit log")}
      head={["#", _("Time"), _("Actor"), _("Via"), _("Action"), _("Object")]}
      sort={{ column: 0, dir: "descending" }}
      numeric={[0]}
      primary={4}
      empty={_("Nothing yet.")}
      rows={rows.map((e) => [
        <Hash e={e} _={_} />,
        <Lines main={<Stamp at={e.at} lang={_.lang} />} sub={<When at={e.at} lang={_.lang} />} />,
        <Actor e={e} names={names} _={_} />,
        _(VIA[e.via] ?? e.via),
        <Lines main={AUDIT[e.action] ? _(AUDIT[e.action] ?? "") : key(e.action)} sub={AUDIT[e.action] && key(e.action)} />,
        <Subject e={e} names={names} teamName={teamName} _={_} />,
      ])}
    />
  </div>
);

type Verified = { ok: true; events: number; checkpoints: number } | { ok: false; seq: number; message: string };
export const VerifyResult: FC<{ r: Verified; _: Tr }> = ({ r, _ }) =>
  r.ok ? (
    <Banner tone="success" title={_("Chain intact.")}>
      {fill(
        _(
          r.checkpoints === 1
            ? "{events} events, 1 signed checkpoint, checked just now."
            : "{events} events, {checkpoints} signed checkpoints, checked just now.",
        ),
        { events: r.events, checkpoints: r.checkpoints },
      )}
    </Banner>
  ) : (
    <Banner tone="danger" title={_("The chain doesn't verify.")}>
      {fill(
        _("Something changed the log at or before event {seq}. Export it now and keep the file, then compare it with an earlier export."),
        {
          seq: r.seq,
        },
      )}{" "}
      {fill(_("The hub said: {reason}"), { reason: `${r.message}.` })}
    </Banner>
  );

export const AuditLede: FC<{ _: Tr }> = ({ _ }) => (
  <p class="lede rec-lede">
    {fillNodes(_("Every action on the team, newest first. Verify the chain here, or check an export offline with {command}."), {
      command: <code>codetgh audit verify</code>,
    })}
  </p>
);

// ---- Team memory ----

export const MEMORY_STATUSES = ["proposed", "accepted", "superseded", "rejected", "all"] as const;
const STATUS_WORD: Record<string, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  superseded: "Superseded",
  rejected: "Rejected",
  all: "All",
};
const STATUS_TONE: Record<string, Tone> = { proposed: "warn", accepted: "ok" };
const KIND: Record<string, string> = { decision: "Decision", contract: "Contract", convention: "Convention", note: "Note" };
const MemoryState: FC<{ item: Pick<MemoryItem, "status" | "pinned">; _: Tr }> = ({ item, _ }) => (
  <span class="rec-pills">
    <Pill tone={STATUS_TONE[item.status] ?? "neutral"}>{_(STATUS_WORD[item.status] ?? item.status)}</Pill>
    {item.pinned && <Pill>{_("Pinned")}</Pill>}
  </span>
);
// Who proposed: the person, then the session their agent wrote from, or that they wrote it themselves.
const Proposer: FC<{ name: string; agentLabel: string | null; item: Pick<MemoryItem, "authoredBy">; _: Tr }> = ({
  name,
  agentLabel,
  item,
  _,
}) => <Lines main={name} sub={item.authoredBy === "agent" ? <Chip>{agentLabel ?? _("Agent")}</Chip> : _("Person")} />;

export const MemoryTabs: FC<{ status: string; counts: Record<string, number>; _: Tr }> = ({ status, counts, _ }) => (
  <nav class="tabs" aria-label={_("Status")}>
    {MEMORY_STATUSES.map((s) => (
      <a href={`/console/memory?status=${s}`} aria-current={s === status ? "page" : undefined}>
        {_(STATUS_WORD[s] ?? s)}
        <span class="count">{counts[s] ?? 0}</span>
      </a>
    ))}
  </nav>
);

export type MemoryRow = { item: MemoryItem; name: string; agentLabel: string | null };
export const MemoryTable: FC<{ rows: MemoryRow[]; status: string; _: Tr }> = ({ rows, status, _ }) => (
  <Table
    lang={_.lang}
    caption={_("Team memory")}
    head={[_("Item"), ...(status === "all" ? [_("Status")] : []), _("Proposed by"), _("When")]}
    primary={0}
    sort={{ column: status === "all" ? 3 : 2, dir: "descending" }}
    empty={<MemoryEmpty status={status} _={_} />}
    rows={rows.map(({ item, name, agentLabel }) => [
      <Lines
        main={
          <>
            <Chip>{memoryLabel(item)}</Chip>{" "}
            <a class="row-link" href={`/console/memory/${item.id}`}>
              {item.title}
            </a>
          </>
        }
        sub={
          <>
            {_(KIND[item.kind] ?? item.kind)}
            {status !== "all" && item.pinned && (
              <>
                {" "}
                <Pill>{_("Pinned")}</Pill>
              </>
            )}
          </>
        }
      />,
      ...(status === "all" ? [<MemoryState item={item} _={_} />] : []),
      <Proposer name={name} agentLabel={agentLabel} item={item} _={_} />,
      <When at={item.createdAt} lang={_.lang} />,
    ])}
  />
);

const MemoryEmpty: FC<{ status: string; _: Tr }> = ({ status, _ }) => {
  const [title, body] = (
    {
      proposed: [
        "No proposals to review.",
        "Agents propose team decisions with the memory_propose tool; they wait here for a person to accept or reject them.",
      ],
      accepted: [
        "Nothing accepted yet.",
        "Accepted items reach every agent through memory_search and the context each session starts with.",
      ],
      superseded: ["Nothing replaced yet.", "When a newer version of an item is accepted, the one it replaces moves here."],
      rejected: ["Nothing rejected.", "Proposals a person rejected stay here, with the note they left."],
    } as Record<string, [string, string]>
  )[status] ?? ["No team memory yet.", "Agents propose team decisions with the memory_propose tool; a person accepts or rejects them."];
  return (
    <EmptyState title={_(title)} icon="info">
      {_(body)}
    </EmptyState>
  );
};

// What the hub saw in a text when it was written: shown, never run.
const FLAG: Record<string, [string, string]> = {
  "instruction-like": ["Looks like an instruction", "The hub flagged this text. It's shown here, never run."],
  "secret-suspect": ["May hold a secret", "Don't copy it anywhere before checking it."],
  "external-link": ["Links to another site", "Check where a link leads before you open it."],
};
const Flags: FC<{ flags: string[] | null; _: Tr }> = ({ flags, _ }) => (
  <>
    {(flags ?? []).map((f) => {
      const [title, body] = FLAG[f] ?? [f, ""];
      return (
        <Banner tone="warn" title={_(title)}>
          {body && _(body)}
        </Banner>
      );
    })}
  </>
);

// Line by line: removed lines struck out on the error tint, added ones on the success tint, a sign in front of each.
const Diff: FC<{ from: string; to: string }> = ({ from, to }) => (
  <pre class="memory-diff">
    {diffLines(from, to).flatMap((part) =>
      part.value
        .replace(/\n$/, "")
        .split("\n")
        .map((line) =>
          part.added ? <ins class="add">{line}</ins> : part.removed ? <del class="del">{line}</del> : <span class="same">{line}</span>,
        ),
    )}
  </pre>
);

const Props: FC<{ label: string; children?: Child }> = ({ label, children }) => (
  <aside class="rec-props" aria-label={label}>
    <dl>{children}</dl>
  </aside>
);
const Prop: FC<{ term: string; children?: Child }> = ({ term, children }) => (
  <div>
    <dt>{term}</dt>
    <dd>{children}</dd>
  </div>
);

export const MemoryHead: FC<{ item: MemoryItem; _: Tr }> = ({ item, _ }) => (
  <>
    <Chip>{memoryLabel(item)}</Chip>
    <span>{_(KIND[item.kind] ?? item.kind)}</span>
    <MemoryState item={item} _={_} />
  </>
);

export const MemoryDetail: FC<{
  item: MemoryItem;
  proposer: MemoryRow;
  decider: string | null;
  old: MemoryItem | undefined;
  newer: MemoryItem | undefined;
  decide: Child;
  _: Tr;
}> = ({ item, proposer, decider, old, newer, decide, _ }) => (
  <div class="rec-detail">
    <Props label={_("About this item")}>
      <Prop term={_("Proposed by")}>
        <Proposer name={proposer.name} agentLabel={proposer.agentLabel} item={item} _={_} />
      </Prop>
      <Prop term={_("Proposed on")}>
        <Stamp at={item.createdAt} lang={_.lang} />
      </Prop>
      {item.decidedAt && (
        <Prop term={_("Decided by")}>
          <Lines main={decider ?? _("A former member")} sub={<Stamp at={item.decidedAt} lang={_.lang} />} />
        </Prop>
      )}
      {item.branch && (
        <Prop term={_("Branch")}>
          <Chip>{item.branch}</Chip>
        </Prop>
      )}
      {old && (
        <Prop term={_("Replaces")}>
          <a href={`/console/memory/${old.id}`}>{memoryLabel(old)}</a>
        </Prop>
      )}
      {newer && (
        <Prop term={_("Replaced by")}>
          <a href={`/console/memory/${newer.id}`}>{memoryLabel(newer)}</a>
        </Prop>
      )}
    </Props>
    <div class="rec-body">
      <Flags flags={item.flags} _={_} />
      {old ? (
        <>
          <h2>{fill(_("Changes from v{n}"), { n: old.version })}</h2>
          <p class="meta">{_("Lines that start with + are added, lines that start with − are removed.")}</p>
          <Diff from={old.body} to={item.body} />
        </>
      ) : (
        <p class="rec-text">{item.body}</p>
      )}
      {item.decidedAt && item.status !== "proposed" && (
        <section aria-labelledby="decision-h">
          <h2 id="decision-h">{_("Decision")}</h2>
          <p>
            {fill(_(item.status === "rejected" ? "{name} rejected it." : "{name} accepted it."), {
              name: decider ?? _("A former member"),
            })}
          </p>
          {item.decisionNote && <blockquote class="rec-note">{item.decisionNote}</blockquote>}
        </section>
      )}
      {decide}
    </div>
  </div>
);

// Accept or reject a proposal, with a note the whole team reads; or who decides, when this person can't.
export const MemoryDecide: FC<{ item: MemoryItem; old: MemoryItem | undefined; can: boolean; acceptBy: string; _: Tr }> = ({
  item,
  old,
  can,
  acceptBy,
  _,
}) =>
  can ? (
    <Panel title={_("Accept or reject")}>
      <p>
        {old
          ? fill(_("Accepting it replaces {item}: agents then read this version."), { item: memoryLabel(old) })
          : _("Accepted, it reaches every agent through memory_search and the context each session starts with.")}
      </p>
      <form hx-post={`/console/memory/${item.id}/decide`} hx-swap="none">
        <Field
          id="decision-note"
          label={_("Note")}
          lang={_.lang}
          optional
          help={_("Shown with the decision on this page, to the whole team.")}
        >
          <input id="decision-note" name="note" maxlength={500} autocomplete="off" {...fieldAria("decision-note", { help: true })} />
        </Field>
        <button type="submit" class="primary" name="decision" value="accept">
          {_("Accept")}
        </button>
        <button type="submit" class="secondary" name="decision" value="reject">
          {_("Reject")}
        </button>
      </form>
    </Panel>
  ) : (
    <p class="lede">
      {_(
        acceptBy === "owner"
          ? "On this hub, only owners accept or reject proposals."
          : "On this hub, only admins and owners accept or reject proposals.",
      )}
    </p>
  );
