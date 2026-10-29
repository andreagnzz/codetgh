/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import { type Agent, presence } from "../domain/agents.js";
import type { Lang } from "../i18n.js";
import { Action, Chip, CodeBlock, EmptyState, Pill, RowMenu, Table, When } from "./pages.js";

// Agents, Projects and Delegations. A session reads the same on the three pages: the person, the session's label as typed in
// a terminal, its short id as the startup line prints it, then its state in words; pills only for what needs a look (idle,
// paused, quarantined, external, prompts off). Every value is rendered by JSX, which escapes text: agent-written labels,
// branches and statuses never become HTML.
type Tr = ((s: string) => string) & { lang: Lang };
export type SessionRow = { agent: Agent; name: string; handle?: string | null; project?: string | null; paused: Date | null };

// "agt_01M5…ABCD": the first 8 and the last 4 characters, as `CodeTgh ✓` prints it when the session starts.
const short = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
const KIND: Record<string, string> = { "claude-ai": "claude.ai", "agent-sdk": "Agent SDK", bridge: "Bridge", other: "Other client" };
const kindOf = (a: Agent) => (a.sessionId.startsWith("cli-") ? "CLI" : KIND[a.kind]);
const named = (s: string, key: string, value: string) => s.replace(key, () => value);

export const Session: FC<{ r: SessionRow; _: Tr }> = ({ r, _ }) => {
  const a = r.agent;
  const kind = kindOf(a);
  // The label is usually handle@branch: the branch shows on its own only when the label does not end with it.
  const branch = a.branch && !a.label.endsWith(a.branch) ? a.branch : null;
  return (
    <div class="session-cell">
      <p class="session-head">
        <span class="session-name">{r.name}</span>
        {a.kind === "a2a" ? r.handle && <Chip>{`@${r.handle}`}</Chip> : <Chip>{a.label}</Chip>}
      </p>
      <p class="session-id meta">
        <span class="machine">{short(a.id)}</span>
        {kind && ` · ${_(kind)}`}
        {branch && (
          <>
            {" · "}
            <span class="machine">{branch}</span>
          </>
        )}
      </p>
    </div>
  );
};

// Online is plain text; idle, paused, quarantined and external are pills; offline says when the session was last seen.
export const SessionState: FC<{ r: SessionRow; _: Tr }> = ({ r, _ }) => {
  const state = presence(r.agent);
  const external = r.agent.kind === "a2a";
  return (
    <div class="session-state">
      <p class="state-line">
        {state === "online" ? (
          <span>{_("Online")}</span>
        ) : state === "idle" ? (
          <Pill>{_("Idle")}</Pill>
        ) : (
          <span class="state-off">{_("Offline")}</span>
        )}
        {r.paused && <Pill tone="warn">{_("Paused")}</Pill>}
        {external ? <Pill>{_("External")}</Pill> : r.agent.trustLevel === "quarantined" && <Pill tone="danger">{_("Quarantined")}</Pill>}
      </p>
      {state !== "online" && (
        <p class="meta">
          {_("Last seen")} <When at={r.agent.lastSeenAt} lang={_.lang} />
        </p>
      )}
    </div>
  );
};

const notReported = (_: Tr) => <span class="not-reported">{_("Not reported")}</span>;

// The session's actions, behind its "…": a table of sessions reads by its states, not by a column of red buttons. Each asks
// first. A quarantine is the person's, all their sessions; only an admin lifts it, at once.
const SessionActions: FC<{ r: SessionRow; _: Tr; admin: boolean }> = ({ r, _, admin }) => {
  const a = r.agent;
  const quarantine =
    a.trustLevel !== "quarantined" ? (
      <Action
        post={`/console/agents/${a.id}/quarantined`}
        label={_("Quarantine")}
        level="danger"
        name={`${_("Quarantine")} ${a.label}…`}
        confirm={{
          title: named(_("Quarantine {name}?"), "{name}", r.name),
          body: _(
            "All of their sessions can then send only notes, questions and answers: no claims, tasks, requests, handoffs or team memory, and no delegation. Only an admin lifts it.",
          ),
        }}
      />
    ) : (
      admin && <Action post={`/console/agents/${a.id}/trusted`} label={_("Lift quarantine")} name={`${_("Lift quarantine")} ${a.label}`} />
    );
  return (
    <RowMenu
      label={named(_("Actions for {session}"), "{session}", a.label)}
      items={[
        ...(quarantine ? [quarantine] : []),
        <Action
          post={`/console/agents/${a.id}/remove`}
          label={_("Remove")}
          level="danger"
          name={`${_("Remove")} ${a.label}…`}
          confirm={{
            title: named(_("Remove {session}?"), "{session}", a.label),
            body: _(
              "The session leaves every list and its claims are released. Its messages stay in their threads. If it resumes, it comes back.",
            ),
          }}
          done={named(_("{session} removed."), "{session}", a.label)}
        />,
      ]}
    />
  );
};

// The sessions of one project: what they are, how they are set up, their actions. Every project's table has the same columns
// at the same widths, so the page reads as one table.
export const AgentsTable: FC<{ rows: SessionRow[]; _: Tr; admin: boolean; caption?: string }> = ({ rows, _, admin, caption }) => (
  <div class="agents-table sessions">
    <Table
      lang={_.lang}
      caption={caption}
      head={[_("Session"), _("State"), _("Permissions"), _("Push"), "Claude Code", _("Actions")]}
      primary={0}
      actions
      empty=""
      rows={rows.map((r) => {
        const a = r.agent;
        return [
          <Session r={r} _={_} />,
          <SessionState r={r} _={_} />,
          a.permissionMode === "bypassPermissions" ? (
            <p class="setting">
              <Pill tone="warn">{_("Prompts off")}</Pill>
              <span class="machine meta">bypassPermissions</span>
            </p>
          ) : a.permissionMode ? (
            <span class="machine">{a.permissionMode}</span>
          ) : (
            notReported(_)
          ),
          a.pushMode ? <span class="machine">{a.pushMode}</span> : notReported(_),
          a.clientVersion ?? notReported(_),
          <SessionActions r={r} _={_} admin={admin} />,
        ];
      })}
    />
  </div>
);

// External agents (A2A) are not sessions of a teammate: their own table, whose one action removes them, token included.
export const ExternalTable: FC<{ rows: SessionRow[]; _: Tr }> = ({ rows, _ }) => (
  <div class="agents-table external">
    <Table
      lang={_.lang}
      caption={_("External agents")}
      head={[_("Name"), _("State"), _("Actions")]}
      primary={0}
      actions
      empty=""
      rows={rows.map((r) => [
        <Session r={r} _={_} />,
        <SessionState r={r} _={_} />,
        <RowMenu
          label={named(_("Actions for {session}"), "{session}", r.name)}
          items={[
            <Action
              post={`/console/agents/${r.agent.id}/remove`}
              label={_("Remove")}
              level="danger"
              name={`${_("Remove")} ${r.name}…`}
              confirm={{
                title: named(_("Remove the external agent {name}?"), "{name}", r.name),
                body: _("Its token stops working at once. Its messages stay in their threads."),
              }}
              done={named(_("External agent {name} removed."), "{name}", r.name)}
            />,
          ]}
        />,
      ])}
    />
  </div>
);

// Nothing to list: the two commands that bring a session, each to copy.
export const NoSessions: FC<{ _: Tr }> = ({ _ }) => (
  <EmptyState
    title={_("No sessions yet.")}
    icon="terminal"
    action={
      <>
        <CodeBlock lang={_.lang} command code="codetgh setup" copyLabel={_("Copy codetgh setup")} />
        <CodeBlock lang={_.lang} command code="codetgh start" copyLabel={_("Copy codetgh start")} />
      </>
    }
  >
    {_("Sessions appear here once someone sets up CodeTgh, then starts Claude Code with it in a team repository.")}
  </EmptyState>
);
