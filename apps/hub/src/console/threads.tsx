/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child, FC } from "hono/jsx";
import { MAX_EXCERPT } from "../domain/messages.js";
import type { Lang } from "../i18n.js";
import { Icon } from "../icons.js";
import { Chip, Pill, Stamp } from "./pages.js";

// Threads, a thread and alerts (batch 3 of the console redesign). Every value below is rendered by JSX, which escapes text:
// agent-written strings never become HTML.
export type Tr = ((s: string) => string) & { lang: Lang };
export const fill = (s: string, values: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (all, k: string) => (k in values ? String(values[k]) : all));

// What a thread is called: its subject, or its kind and its people. A direct thread names who it is with (the reader left
// out); a team thread, who started it.
export const threadName = (t: { kind: string; subject: string | null }, people: string[] | undefined, me: string | null, _: Tr) => {
  if (t.subject) return t.subject;
  const at = (hs: string[]) => hs.map((h) => `@${h}`).join(", ");
  if (t.kind === "direct") {
    const others = (people ?? []).filter((h) => h !== me);
    return others.length ? fill(_("Direct thread with {people}"), { people: at(others) }) : _("Direct thread");
  }
  return people?.[0] ? fill(_("Team thread from {people}"), { people: at(people.slice(0, 1)) }) : _("Team thread");
};

// A muted thread says by whom, in words; an open thread needs no word.
export const MutedPill: FC<{ t: { mutedAt: Date | null; mutedReason: string | null }; _: Tr }> = ({ t, _ }) =>
  t.mutedAt ? (
    t.mutedReason === "human" ? (
      <Pill>{_("Muted by a person")}</Pill>
    ) : (
      <Pill tone="warn">{_("Muted by the loop guard")}</Pill>
    )
  ) : null;

// The loop guard's count, in words; the ticks only repeat it.
export const Streak: FC<{ n: number; max: number; _: Tr; short?: boolean }> = ({ n, max, _, short }) => (
  <span class="streak">
    <span class="ticks" aria-hidden="true">
      {Array.from({ length: max }, (__, i) => (
        <span class={i < n ? "on" : undefined} />
      ))}
    </span>
    {fill(_(short ? "{n} of {max}" : "Agent streak {n} of {max}"), { n, max })}
  </span>
);

// Handles as terminal tokens; past four, the count of the others.
export const Handles: FC<{ handles: string[]; _: Tr }> = ({ handles, _ }) => (
  <span class="handles">
    {handles.slice(0, 4).map((h) => (
      <Chip>{`@${h}`}</Chip>
    ))}
    {handles.length > 4 && <span class="more">{fill(_("+{n} more"), { n: handles.length - 4 })}</span>}
  </span>
);

// The conversation on its people's lanes: each person on the page gets a lane under the brand's caret; a message is the
// sender's mark on their lane (a dot for an agent, a diamond for a person), and a reply to one person is an accent wire from
// the sender to the caret that points at them. On a thread page every other message reaches everyone: it draws no bus. The
// words of each message say all the drawing says, so the drawing is hidden from assistive technology. A message new on
// screen traces its wire once (console.js marks it, the stylesheet draws it).
type Wire = { from: string; human: boolean; to: string[] | "all" };
// At most ten lanes from 640 px and six under it; past that the people seen least recently share the last lane, "+n".
const MAX_LANES = 10;
const MAX_NARROW = 6;
const WIRE_Y = 18; // the middle of the message head's first line

const wireOf = (m: { authoredBy: string; to: string[] }, from: string): Wire => ({
  from,
  human: m.authoredBy !== "agent",
  to: m.to.some((a) => a.startsWith("thread:") || a === "@team") ? "all" : m.to.filter((a) => a.startsWith("@")).map((a) => a.slice(1)),
});
export type Lanes = { keys: string[]; wide: string[]; narrow?: string[] };
const cap = (keys: string[], max: number) => (keys.length <= max ? keys : [...keys.slice(0, max - 1), `+${keys.length - max + 1}`]);
export const lanesOf = (rows: Array<{ message: { authoredBy: string; to: string[] }; key: string }>): Lanes => {
  const keys = [
    ...new Set(
      rows.flatMap((r) => {
        const w = wireOf(r.message, r.key);
        return [w.from, ...(w.to === "all" ? [] : w.to)];
      }),
    ),
  ];
  return { keys, wide: cap(keys, MAX_LANES), narrow: keys.length > MAX_NARROW ? cap(keys, MAX_NARROW) : undefined };
};
const laneOf = (lanes: string[], key: string) => {
  const i = lanes.indexOf(key);
  return i >= 0 || !lanes.at(-1)?.startsWith("+") ? i : lanes.length - 1;
};
// Geometry in SVG attributes (the CSP allows them), in percent of the lanes' width, which the stylesheet sets per screen.
const x = (i: number, n: number) => `${Math.round(((i + 0.5) / n) * 10000) / 100}%`;

const WireSvg: FC<{ lanes: string[]; wire: Wire; set?: "wide" | "narrow" }> = ({ lanes, wire, set }) => {
  const n = lanes.length;
  const s = laneOf(lanes, wire.from);
  const to = wire.to === "all" ? [] : [...new Set(wire.to.map((k) => laneOf(lanes, k)))].filter((i) => i >= 0 && i !== s);
  // One wire on each side that has a recipient, drawn from the sender, so the trace starts at the sender's mark.
  const left = to.filter((i) => i < s);
  const right = to.filter((i) => i > s);
  const ends = [...(left.length ? [Math.min(...left)] : []), ...(right.length ? [Math.max(...right)] : [])];
  return (
    <svg class={set ? `convo-svg ${set}` : "convo-svg"} aria-hidden="true" focusable="false">
      {lanes.map((__, i) => (
        <line class="lane" x1={x(i, n)} x2={x(i, n)} y1="0" y2="100%" />
      ))}
      {ends.map((e) => (
        <line class="link" x1={x(s, n)} x2={x(e, n)} y1={WIRE_Y} y2={WIRE_Y} pathLength="1" transform-origin={e > s ? "0% 0" : "100% 0"} />
      ))}
      {to.map((i) => (
        <svg x={x(i, n)} y={WIRE_Y} overflow="visible" aria-hidden="true">
          <path class="caret" d={i > s ? "M-5 -5 0 0-5 5" : "M5 -5 0 0 5 5"} />
        </svg>
      ))}
      {wire.human ? (
        <svg x={x(s, n)} y={WIRE_Y} overflow="visible" aria-hidden="true">
          <path class="end" d="M0 -5 5 0 0 5-5 0z" />
        </svg>
      ) : (
        <circle class="end" cx={x(s, n)} cy={WIRE_Y} r="4" />
      )}
    </svg>
  );
};

const Carets: FC<{ lanes: string[]; set?: "wide" | "narrow" }> = ({ lanes, set }) => (
  <svg class={set ? `convo-svg heads ${set}` : "convo-svg heads"} aria-hidden="true" focusable="false">
    {lanes.map((__, i) => (
      <>
        <svg x={x(i, lanes.length)} y="8" overflow="visible" aria-hidden="true">
          <path class="caret" d="M-3 -5 2 0-3 5" />
        </svg>
        <line class="lane" x1={x(i, lanes.length)} x2={x(i, lanes.length)} y1="18" y2="100%" />
      </>
    ))}
  </svg>
);

// What the hub noticed in a message: a title and what to do, one small alert each.
const FLAG: Record<string, [string, string]> = {
  "instruction-like": ["Looks like an instruction", "The hub flagged this text. It's shown here, never run."],
  "secret-suspect": ["May hold a secret", "Don't copy it anywhere before checking it."],
  "external-link": ["Links to another site", "Check where a link leads before you open it."],
  encrypted: ["End-to-end encrypted", "Read it in a participant's terminal with codetgh inbox."],
};
const PRIORITY: Record<string, string> = { low: "Low priority", high: "High priority", blocking: "Blocking" };
// Who a message went to, in words: a handle, the thread, or a teammate the page cannot name.
const recipients = (to: string[], _: Tr) =>
  to.map((a) => (a.startsWith("thread:") || a === "@team" ? _("the thread") : a.startsWith("@") ? a : _("a teammate"))).join(", ");

export type ConvRow = {
  message: {
    id: string;
    createdAt: Date;
    kind: string;
    priority: string;
    authoredBy: string;
    to: string[];
    subject: string | null;
    body: string;
    flags: string[];
    encrypted: boolean;
  };
  name: string;
  key: string;
  label: string | null;
};
// title: the thread's subject, which a message does not repeat under the page title.
export const Conversation: FC<{ rows: ConvRow[]; lanes: Lanes; _: Tr; title: string | null }> = ({ rows, lanes, _, title }) => {
  const phone = lanes.narrow ?? lanes.wide;
  const named = phone.map((l, i) => (l.startsWith("+") ? `${l} (${lanes.keys.slice(i).join(", ")})` : l));
  // Names that fit one lane at its narrowest (four mono letters) stand on one row; longer ones take turns on two rows, three
  // past six people, so each name has the width of as many lanes.
  const longest = Math.max(...lanes.wide.map((l) => l.length));
  const nameRows = longest <= (lanes.wide.length < MAX_LANES ? 4 : 3) ? 1 : lanes.wide.length > MAX_NARROW ? 3 : 2;
  const perSet = (draw: (lanes: string[], set?: "wide" | "narrow") => Child) =>
    lanes.narrow ? [draw(lanes.wide, "wide"), draw(lanes.narrow, "narrow")] : draw(lanes.wide);
  return (
    <div class="convo" data-lanes={lanes.wide.length} data-narrow={lanes.narrow?.length}>
      <div class="convo-head" aria-hidden="true">
        <p class="convo-caption">{fill(_("Left to right: {names}"), { names: named.join(", ") })}</p>
        <p class="convo-names" data-rows={nameRows}>
          {Array.from({ length: nameRows }, (__, k) => (
            <span class="convo-names-row">
              {lanes.wide
                .filter((___, i) => i % nameRows === k)
                .map((l) => (
                  <span class="convo-name" translate="no">
                    {l}
                  </span>
                ))}
            </span>
          ))}
        </p>
        {perSet((l, s) => (
          <Carets lanes={l} set={s} />
        ))}
      </div>
      <ol class="convo-list">
        {rows.map(({ message: m, name, key, label }) => {
          const wire = wireOf(m, key);
          const to = recipients(m.to, _);
          const agent = m.authoredBy === "agent";
          // An encrypted message says so in its body: its flag would only repeat it.
          const flags = m.encrypted ? m.flags.filter((f) => f !== "encrypted") : m.flags;
          return (
            <li class="convo-row" data-mid={m.id} data-summary={`${_("New message")}: ${name}${agent ? ` ${_("(agent)")}` : ""} → ${to}`}>
              {perSet((l, s) => (
                <WireSvg lanes={l} wire={wire} set={s} />
              ))}
              <article class="msg">
                <p class="msg-head">
                  <span class="msg-who">
                    <strong>{name}</strong> <span class="msg-by">· {_(agent ? "agent" : "person")}</span>
                  </span>
                  <Stamp at={m.createdAt} lang={_.lang} />
                  {agent && label && <Chip>{label}</Chip>}
                  {wire.to !== "all" && (
                    <span class="msg-to">
                      <span aria-hidden="true">→</span>
                      <span class="sr-only">{_("to")}</span> {to}
                    </span>
                  )}
                  {m.kind !== "note" && <span class="msg-kind">{_(m.kind)}</span>}
                  {PRIORITY[m.priority] && <Pill tone="warn">{_(PRIORITY[m.priority] ?? "")}</Pill>}
                </p>
                {flags.length > 0 && (
                  <ul class="msg-flags">
                    {flags.map((f) => {
                      const [head, text] = FLAG[f] ?? [f, ""];
                      return (
                        <li data-tone={f === "encrypted" ? "neutral" : "warn"}>
                          <Icon name={f === "encrypted" ? "info" : "triangle-alert"} />
                          <div>
                            <p class="flag-title">{_(head)}</p>
                            {text && <p>{_(text)}</p>}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {m.subject && m.subject !== title && <p class="msg-subject">{m.subject}</p>}
                {m.encrypted ? (
                  <p class="msg-body encrypted">{_("End-to-end encrypted. Read it in a participant's terminal with codetgh inbox.")}</p>
                ) : (
                  <p class="msg-body">{m.body}</p>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

// Alerts: what the hub flagged or stopped, in words. The excerpt of a flagged message is quoted as the agent wrote it; the
// hub's own notes become sentences.
export const ALERT_KIND: Record<string, string> = {
  instruction_like: "Looks like an instruction",
  secret_blocked: "Secret blocked",
  loop_guard: "Agent loop",
  loop_needs_human: "Loop waiting for a person",
  audit_tamper: "Audit log tampered with",
};
export const ALERT_STATUS: Record<string, string> = {
  open: "Open",
  dismissed: "Dismissed",
  false_positive: "False positive",
  fingerprint_allowed: "Fingerprint allowed",
};
// from: who sent the flagged message, or the hub itself, then whether as an agent or a person; which: the alert's kind and
// sender, which the link's accessible name repeats so a list of links tells the alerts apart. audited: the thread is someone
// else's direct thread, whose opening the audit log records. A decided alert reads quieter than one that waits for a decision.
export const AlertText: FC<{
  a: { kind: string; status: string; excerpt: string; threadId: string | null };
  from: string;
  which: { alert: string; from: string };
  audited: boolean;
  max: number;
  _: Tr;
}> = ({ a, from, which, audited, max, _ }) => (
  <div class={a.status === "open" ? "alert-text" : "alert-text decided"}>
    <p class="alert-kind">{_(ALERT_KIND[a.kind] ?? a.kind)}</p>
    <p class="alert-from">{from}</p>
    {a.kind === "secret_blocked" ? (
      <p class="alert-note">
        <code translate="no">{a.excerpt}</code> {_("The hub refused the message: the secret was never stored.")}
      </p>
    ) : a.kind === "loop_guard" ? (
      <p class="alert-note">{fill(_("The loop guard muted the thread after {max} agent messages in a row."), { max })}</p>
    ) : a.kind === "loop_needs_human" ? (
      <p class="alert-note">{_("The loop orchestrator already reopened this thread once: a person decides now.")}</p>
    ) : a.kind === "audit_tamper" ? (
      <p class="alert-note">{fill(_("The hub said: {reason}"), { reason: a.excerpt })}</p>
    ) : (
      // The hub keeps the start of the message: an excerpt at that length was cut, and says so.
      <p class="alert-excerpt">
        {a.excerpt}
        {a.excerpt.length >= MAX_EXCERPT && "…"}
      </p>
    )}
    {a.threadId && (
      <p class="alert-link">
        <a href={`/console/threads/${a.threadId}`} aria-label={fill(_("Open thread: {alert}, {from}"), which)}>
          {_("Open thread")}
        </a>
      </p>
    )}
    {a.threadId && audited && <p class="alert-audit">{_("You're not in it. Opening it is recorded in the audit log.")}</p>}
  </div>
);
