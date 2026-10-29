/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { type ErrorCode, TASK_STATUSES, type TaskStatus } from "@codetgh/shared";
import { diffLines } from "diff";
import type { Child, FC } from "hono/jsx";
import type { auditEvent, claim, memoryItem, task } from "../db/schema.js";
import { memoryRef } from "../domain/memory.js";
import type { Lang } from "../i18n.js";
import { Icon } from "../icons.js";
import {
  Action,
  Banner,
  Chip,
  EmptyState,
  Field,
  fieldAria,
  Panel,
  Pill,
  Stamp,
  Table,
  Timeline,
  type TimelineEvent,
  type Tone,
  When,
} from "./pages.js";

// The audit log, team memory, claims and tasks. People and objects read by name, the machine keys and ids stay underneath
// in mono; a state is a word, a pill only reinforces it. Every value is rendered by JSX, which escapes text: titles, bodies,
// notes and scopes that agents wrote never become HTML.
type Tr = ((s: string) => string) & { lang: Lang };
type AuditEvent = typeof auditEvent.$inferSelect;
type Task = typeof task.$inferSelect;
type MemoryItem = typeof memoryItem.$inferSelect;
type Claim = typeof claim.$inferSelect;

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
// A dotted key breaks after its dots, a path after its slashes, never inside a word.
const breakAfter = (text: string, at: RegExp) => text.split(at).map((part, i) => (i ? [<wbr />, part] : part));
const key = (k: string) => <code class="rec-key">{breakAfter(k, /(?<=\.)/)}</code>;
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
    <Lines
      main={shown ?? <code class="rec-key rec-id">{short(id)}</code>}
      sub={name ? <code class="rec-key rec-id">{short(id)}</code> : undefined}
    />
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
// In a list, only a proposal waits for a person: its state is a pill; the other states, and a pin, read as words.
const ListState: FC<{ item: Pick<MemoryItem, "status" | "pinned">; _: Tr }> = ({ item, _ }) =>
  item.status === "proposed" ? (
    <Pill tone="warn">{_("Proposed")}</Pill>
  ) : (
    <span>{dots([_(STATUS_WORD[item.status] ?? item.status), item.pinned && _("Pinned")])}</span>
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
        sub={dots([_(KIND[item.kind] ?? item.kind), status !== "all" && item.pinned && _("Pinned")])}
      />,
      ...(status === "all" ? [<ListState item={item} _={_} />] : []),
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
  replacedBy: MemoryItem | undefined;
  proposed: MemoryItem[];
  decide: Child;
  _: Tr;
}> = ({ item, proposer, decider, old, replacedBy, proposed, decide, _ }) => (
  <div class="rec-detail">
    <Props label={_("About this item")}>
      {/* When goes with who, as for the decision: a time from today needs no "on". */}
      <Prop term={_("Proposed by")}>
        <Proposer name={proposer.name} agentLabel={proposer.agentLabel} item={item} _={_} />
        <span class="rec-sub">
          <Stamp at={item.createdAt} lang={_.lang} />
        </span>
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
      {replacedBy && (
        <Prop term={_("Replaced by")}>
          <a href={`/console/memory/${replacedBy.id}`}>{memoryLabel(replacedBy)}</a>
        </Prop>
      )}
    </Props>
    <div class="rec-body">
      <Flags flags={item.flags} _={_} />
      {/* Agents still read this version until a person accepts the newer one. */}
      {proposed.length > 0 && (
        <Banner
          title={fillNodes(_("A newer version is proposed: {items}."), {
            items: proposed.flatMap((n, i) => [i ? ", " : "", <a href={`/console/memory/${n.id}`}>{memoryLabel(n)}</a>]),
          })}
        />
      )}
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
        {/* Rejecting can't be undone: it asks first, in the dialog, which sends the button's value with the note. */}
        <button
          type="submit"
          class="secondary"
          name="decision"
          value="reject"
          data-confirm={fill(_("Reject {item}?"), { item: memoryLabel(item) })}
          data-confirm-body={_("Agents won't read it. It stays under Rejected, with your note.")}
          data-confirm-action={_("Reject")}
        >
          {`${_("Reject")}…`}
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

// ---- Claims ----

// The parts of a meta line that are there, a middle dot between them; nothing at all when none is.
const dots = (parts: Child[]) => {
  const kept = parts.filter((x) => x !== null && x !== undefined && x !== false && x !== "" && x !== 0);
  return kept.length ? kept.flatMap((x, i) => (i ? [" · ", x] : [x])) : undefined;
};

const SCOPE: Record<string, string> = { path: "File", glob: "Pattern", resource: "Resource", task: "Task" };
const MODE: Record<string, string> = { exclusive: "Exclusive", intent: "Intent", shared: "Shared" };
export type ClaimRow = { claim: Claim; name: string; agentLabel: string | null };
// The scope as typed, then its kind and mode: the columns that wrap stay wide enough to read.
export const ClaimsTable: FC<{ rows: ClaimRow[]; admin: boolean; _: Tr }> = ({ rows, admin, _ }) => (
  <div class="claims-log">
    <Table
      lang={_.lang}
      caption={_("Claims")}
      head={[_("Scope"), _("Held by"), _("Reason"), _("Ends"), ...(admin ? [_("Actions")] : [])]}
      primary={0}
      actions={admin}
      sort={{ column: 3, dir: "ascending" }}
      empty={
        <EmptyState title={_("No active claims.")} icon="info">
          {_(
            "Before an agent changes files, it claims them with the claim tool, so the others are warned. Claims show here until they end.",
          )}
        </EmptyState>
      }
      rows={rows.map(({ claim: c, name, agentLabel }) => [
        <Lines
          main={<code class="claim-scope">{breakAfter(c.scope, /(?<=\/)/)}</code>}
          sub={dots([_(SCOPE[c.scopeType] ?? c.scopeType), <span>{_(MODE[c.mode] ?? c.mode)}</span>])}
        />,
        <Lines main={name} sub={agentLabel && <Chip>{agentLabel}</Chip>} />,
        c.reason ? <span class="rec-text">{c.reason}</span> : none(_("No reason given")),
        <Lines main={<Stamp at={c.expiresAt} lang={_.lang} />} sub={<When at={c.expiresAt} lang={_.lang} />} />,
        ...(admin
          ? [
              <Action
                post={`/console/claims/${c.id}/release`}
                label={_("Release")}
                level="tertiary"
                name={`${_("Release")} ${c.scope}…`}
                confirm={{
                  title: fill(_("Release the claim on {scope}?"), { scope: c.scope }),
                  body: _("Agents can then change it without a warning. The session that held it isn't told."),
                }}
              />,
            ]
          : []),
      ])}
    />
  </div>
);

// ---- Tasks ----

export const TASK_WORD: Record<TaskStatus, string> = {
  todo: "To do",
  claimed: "Claimed",
  in_progress: "In progress",
  blocked: "Blocked",
  review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};
const TASK_TONE: Partial<Record<TaskStatus, Tone>> = { blocked: "danger", done: "ok" };
export const TaskPill: FC<{ status: TaskStatus; _: Tr }> = ({ status, _ }) => (
  <Pill tone={TASK_TONE[status] ?? "neutral"}>{_(TASK_WORD[status])}</Pill>
);

export type TaskRow = { task: Task; handle: string | null };
const Assignee: FC<{ handle: string | null; _: Tr }> = ({ handle, _ }) => (handle ? <Chip>{`@${handle}`}</Chip> : none(_("Unassigned")));

// One project's board: a group per status that has tasks, its count in the heading; the columns line up from group to group.
export const TaskBoard: FC<{
  rows: TaskRow[];
  countOf: (s: TaskStatus) => number;
  href: (id: string) => string;
  level: "h2" | "h3";
  _: Tr;
}> = ({ rows, countOf, href, level, _ }) => {
  const Heading = level;
  return (
    <>
      {TASK_STATUSES.map((s) => {
        const of = rows.filter((r) => r.task.status === s);
        return (
          of.length > 0 && (
            <div class="task-group">
              <Heading>
                {_(TASK_WORD[s])} <span class="count">{countOf(s)}</span>
              </Heading>
              <Table
                lang={_.lang}
                caption={_(TASK_WORD[s])}
                head={[_("Task"), _("Assigned to"), _("Updated")]}
                primary={0}
                empty=""
                rows={of.map(({ task: t, handle }) => [
                  <Lines
                    main={
                      <a class="row-link" href={href(t.id)}>
                        {t.title}
                      </a>
                    }
                    sub={dots([
                      t.blockedReason && <span class="rec-text">{t.blockedReason}</span>,
                      t.prNumber && fill(_("Pull request #{n}"), { n: t.prNumber }),
                      t.runner && _("Runner"),
                    ])}
                  />,
                  <Assignee handle={handle} _={_} />,
                  <When at={t.updatedAt} lang={_.lang} />,
                ])}
              />
            </div>
          )
        );
      })}
    </>
  );
};

export const TasksEmpty: FC<{ archived: boolean; project?: string | null; _: Tr }> = ({ archived, project, _ }) =>
  archived ? (
    <EmptyState title={_("No archived tasks.")} icon="info">
      {_("A task done or cancelled more than a day ago moves here.")}
    </EmptyState>
  ) : project !== undefined ? (
    <EmptyState
      title={project ? fill(_("No tasks in {project}."), { project }) : _("No tasks outside a project.")}
      icon="info"
      action={<a href="/console/tasks?project=">{_("All projects")}</a>}
    />
  ) : (
    <EmptyState title={_("No tasks yet.")} icon="info">
      {_("Create one with New task, or let agents create them with the task_create tool.")}
    </EmptyState>
  );

export const NewTaskForm: FC<{ _: Tr }> = ({ _ }) => (
  <form hx-post="/console/tasks" hx-swap="none">
    <Field id="task-title" label={_("Title")} lang={_.lang}>
      <input id="task-title" name="title" required maxlength={200} autocomplete="off" />
    </Field>
    <Field id="task-body" label={_("Description")} lang={_.lang} optional>
      <textarea id="task-body" name="body" maxlength={8000} rows={4} />
    </Field>
    <Field id="task-assignee" label={_("Assigned to")} lang={_.lang} optional help={_("A handle like @lea. Leave it empty for nobody.")}>
      <input id="task-assignee" name="assignee" autocomplete="off" spellcheck={false} {...fieldAria("task-assignee", { help: true })} />
    </Field>
    <button type="submit" class="primary">
      {_("Create task")}
    </button>
  </form>
);

// What happened to a task, oldest first: its history from the audit log and its notes, in one timeline. A sentence in words
// after the person, never the event's key.
const TASK_EVENT: Record<string, string> = {
  "task.created": "created the task",
  "task.claimed": "claimed the task",
  "task.taken_over": "took the task over",
  "task.handed_off": "handed the task off",
  "task.verified_by_tag": "finished the task with its tag",
  "task.verify_skipped": "skipped the tag check",
  "runner.leased": "gave the task to the runner",
  "runner.updated": "updated the task from the runner",
  "runner.retried": "retried the task in the runner",
  "runner.lease_expired": "lost the runner's hold on the task",
  "runner.merged": "merged the task's pull request",
  "runner.pr_closed": "closed the task's pull request",
};
// An update that only added a note shows once, as the note.
export const taskEvent = (e: AuditEvent, _: Tr): string | null => {
  const fields = Array.isArray(e.data.fields) ? (e.data.fields as string[]) : [];
  const status = e.data.status as TaskStatus | undefined;
  if (e.action === "task.updated") {
    if (fields.includes("status") && status && TASK_WORD[status])
      return fill(_("moved the task to {status}"), { status: _(TASK_WORD[status]) });
    if (fields.length && fields.every((f) => f === "note")) return null;
    return _("updated the task");
  }
  return _(TASK_EVENT[e.action] ?? AUDIT[e.action] ?? e.action);
};
// Who did it: the person, and the session when their agent did.
export const Who: FC<{ name: string; label?: string | null }> = ({ name, label }) => (
  <span class="rec-who">
    <strong>{name}</strong>
    {label && <Chip>{label}</Chip>}
  </span>
);

export const TaskDetail: FC<{
  t: Task;
  handle: string | null;
  project: string | null;
  creator: Child;
  events: TimelineEvent[];
  form: Child;
  _: Tr;
}> = ({ t, handle, project, creator, events, form, _ }) => (
  <div class="rec-detail">
    <Props label={_("About this task")}>
      <Prop term={_("Assigned to")}>
        <Assignee handle={handle} _={_} />
      </Prop>
      {project && (
        <Prop term={_("Project")}>
          <Chip>{project}</Chip>
        </Prop>
      )}
      <Prop term={_("Created by")}>
        {creator}
        <span class="rec-sub">
          <Stamp at={t.createdAt} lang={_.lang} />
        </span>
      </Prop>
      <Prop term={_("Last updated")}>
        <Stamp at={t.updatedAt} lang={_.lang} />
      </Prop>
      <Prop term={_("Version")}>{t.version}</Prop>
      {t.branch && (
        <Prop term={_("Branch")}>
          <Chip>{t.branch}</Chip>
        </Prop>
      )}
      {t.prNumber && <Prop term={_("Pull request")}>{`#${t.prNumber}`}</Prop>}
      {t.paths.length > 0 && (
        <Prop term={_("Paths")}>
          {t.paths.map((path) => (
            <Chip>{path}</Chip>
          ))}
        </Prop>
      )}
    </Props>
    <div class="rec-body">
      <Flags flags={t.flags} _={_} />
      {t.status === "blocked" && t.blockedReason && (
        <Banner tone="danger" title={_("Why it's blocked")}>
          {t.blockedReason}
        </Banner>
      )}
      {t.body ? <p class="rec-text">{t.body}</p> : <p class="empty">{_("No description.")}</p>}
      <h2>{_("History")}</h2>
      <Timeline events={events} lang={_.lang} empty={_("No history yet.")} />
      {form}
    </div>
  </div>
);

// The update form offers only the moves the task allows, and Blocked on a blocked task, to change its reason; the reason only
// where Blocked is one of them.
export const TaskUpdateForm: FC<{ t: Task; moves: TaskStatus[]; _: Tr }> = ({ t, moves, _ }) => (
  <Panel title={_("Update the task")}>
    <form hx-post={`/console/tasks/${t.id}`} hx-swap="none">
      <input type="hidden" name="expected_version" value={String(t.version)} />
      {moves.length > 0 && (
        <Field id="task-status" label={_("Status")} lang={_.lang}>
          <select id="task-status" name="status">
            <option value="">{_("Unchanged")}</option>
            {moves.map((s) => (
              <option value={s}>{_(TASK_WORD[s])}</option>
            ))}
          </select>
        </Field>
      )}
      <Field
        id="task-assignee"
        label={_("Assigned to")}
        lang={_.lang}
        optional
        help={_("A handle like @lea, or none to unassign. Leave it empty to keep it as it is.")}
      >
        <input id="task-assignee" name="assignee" autocomplete="off" spellcheck={false} {...fieldAria("task-assignee", { help: true })} />
      </Field>
      {moves.includes("blocked") && (
        <Field
          id="task-reason"
          label={_("Why it's blocked")}
          lang={_.lang}
          optional
          help={_(t.status === "blocked" ? "To change it, choose Blocked and write the new reason." : "Needed for Blocked, and only then.")}
        >
          <input id="task-reason" name="reason" maxlength={200} autocomplete="off" {...fieldAria("task-reason", { help: true })} />
        </Field>
      )}
      <Field id="task-note" label={_("Note")} lang={_.lang} optional help={_("Added to the history, for the whole team.")}>
        <input id="task-note" name="note" maxlength={500} autocomplete="off" {...fieldAria("task-note", { help: true })} />
      </Field>
      <button type="submit" class="primary">
        {_("Save")}
      </button>
    </form>
  </Panel>
);

// ---- Refusals ----

// The hub words these refusals for agents, with ids and tool names: the screens' forms say what happened and what to do, by
// the error's code and the reason's pattern. Any other reason shows as the hub wrote it, through i18n.
const REFUSALS: Array<[ErrorCode, RegExp, string]> = [
  ["E_FORBIDDEN", /^admins only$/, "Only admins can do this. Ask an admin of your team."],
  ["E_FORBIDDEN", /^your role cannot (decide on|pin) team memory$/, "Your role can't do this on this hub. Ask an admin of your team."],
  ["E_FORBIDDEN", / is assigned to someone else/, "This task is assigned to someone else. Ask them, or ask an admin to reassign it."],
  ["E_VERSION_CONFLICT", /^task /, "Someone changed this task since you opened it. Reload the page, then save again."],
  ["E_NOT_FOUND", /^no member (?<handle>\S+)$/, "Nobody in the team has the handle {handle}. Check it, or leave it empty."],
  ["E_NOT_FOUND", /^no active claim with this id$/, "This claim has already ended. Reload the page."],
  [
    "E_INVALID",
    /^this item (is already|was decided meanwhile)/,
    "Someone already decided on this item. Reload the page to see the decision.",
  ],
  ["E_INVALID", /must match pattern \/\^@/, "Write a handle like @lea: an @, then lowercase letters, digits or dashes."],
  ["E_INVALID", /^patch needs /, "Nothing to save. Choose a status or someone to assign it to, or write a note."],
  ["E_INVALID", /^reason goes with status blocked$/, "A reason goes with Blocked only. Choose Blocked, or leave Why it's blocked empty."],
  ["E_INVALID", /^blocked needs a reason/, "Say why the task is blocked, in 200 characters at most."],
  ["E_INVALID", /^blocked by .+: finish them first$/, "This task waits for others that aren't done. Finish them first."],
];
export const refusal = (e: { code: ErrorCode; message: string }, _: Tr) => {
  for (const [code, pattern, words] of REFUSALS) {
    const m = e.code === code ? e.message.match(pattern) : null;
    if (m) return fill(_(words), { ...m.groups });
  }
  return null;
};
