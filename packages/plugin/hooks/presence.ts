import type { EngineInterface, Register, SessionRateLimit } from "claude-code";

type Status = { you: { handle: string }; people: { handle: string; sessions: unknown[] }[]; unread: Record<string, number> };

// The Stop hook's rewake waiter gives up after this (REWAKE_BUDGET_MS in hook.ts); after it, only the mod can wake the session.
const REWAKE_MS = 3_540_000;
const WAKES = 6;
const WAKES_WINDOW_MS = 600_000;
const HANDOFF =
  "CodeTgh: this session is close to its Claude usage limit and will stop soon. Write a CodeTgh handoff for the project teammates: where the work stands, what they can do meanwhile, and that this session stops soon.";

let unread: number | undefined;
// The count the session has been woken or run a turn for: polls alone never move it up, so a message the waiter
// did not wake the session for (wake cap, error, the gap after its budget) still wakes it once the mod takes over.
let seen: number | undefined;
// Undefined while a main-loop turn runs.
let idleSince: number | undefined;
// The Stop hook arms its rewake waiter at the end of a turn: before the first one, nothing else listens.
let waiter = false;
let wakes: number[] = [];
let handoffFor: string | undefined;
let limited = false;
// Only the rewake opt-in (push_mode, allowed by the team) lets the mod start turns; hooks mode never does.
let rewake = false;

// Counts only: no handle, status or message text a peer wrote reaches the screen.
function counts(s: Status) {
  // Teammates with a live session: the hub lists only live sessions.
  const online = s.people.filter((p) => p.sessions.length && p.handle !== s.you.handle).length;
  const total = Object.values(s.unread).reduce((n, k) => n + (Number(k) || 0), 0);
  return { online, unread: total };
}

// Fixed texts only: at most the unread count, never a peer's handle, subject or words.
function submit($: EngineInterface, text: string, now: number) {
  if (!rewake) return false;
  wakes = wakes.filter((t) => now - t < WAKES_WINDOW_MS);
  if (wakes.length >= WAKES) return false;
  wakes.push(now);
  // Not awaited: it resolves only once the turn starts. A refusal or a drop after an interrupt is not retried.
  $.prompt.submit({ text }).catch(() => {});
  return true;
}

async function tell($: EngineInterface, url: string, token: string, text: string, ttl: number, note: string) {
  const headers = { Authorization: `Bearer ${token}`, "content-type": "application/json" };
  const session = encodeURIComponent(await $.session.id());
  const me = await $.http.fetch(`${url}/v1/whoami?session_id=${session}`, { headers });
  const agent = me.ok ? (JSON.parse(me.text) as { agent: { id: string } | null }).agent?.id : undefined;
  // A session the hub does not know has no project: its note would reach no teammate's session.
  if (!agent) return;
  await $.http.fetch(`${url}/v1/status`, { method: "POST", headers, body: JSON.stringify({ agent, text, ttl_s: ttl }) });
  // @team from the session's agent opens a thread of its project, so only teammates' sessions on that project get it.
  await $.http.fetch(`${url}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ agent, to: "@team", kind: "note", body: note }),
  });
}

// The plan windows for the hub's capacity view: whole percents and reset times, nothing else of the session.
function usageQuery(live: SessionRateLimit[]) {
  return live
    .filter((w) => w.kind === "five_hour" || w.kind === "seven_day")
    .map(
      (w) =>
        `&${w.kind}=${Math.min(100, Math.max(0, Math.round(w.percentUsed)))}${w.resetsAt ? `&${w.kind}_reset=${Math.round(Date.parse(w.resetsAt) / 1000)}` : ""}`,
    )
    .join("");
}

async function limits($: EngineInterface, url: string, token: string, handle: string, now: number, live: SessionRateLimit[]) {
  try {
    const top = live.reduce<SessionRateLimit | undefined>((a, w) => (a && a.percentUsed >= w.percentUsed ? a : w), undefined);
    const used = top?.percentUsed ?? 0;
    const key = `${top?.kind}@${top?.resetsAt}`;
    if (used >= 90 && handoffFor !== key) {
      handoffFor = key;
      if (used < 100) submit($, HANDOFF, now);
    }
    // State flips before the calls: one try per transition, a hub down loses it.
    if (top && used >= 100 && !limited) {
      limited = true;
      const reset = top.resetsAt ? Date.parse(top.resetsAt) : undefined;
      const back = reset ? `around ${new Date(reset).toISOString().slice(11, 16)} UTC` : "once it resets";
      const ttl = reset ? Math.min(86400, Math.max(60, Math.round((reset - now) / 1000))) : 3600;
      const note = `@${handle} hit the Claude usage limit; back ${back}. See the latest handoff in this project.`;
      await tell($, url, token, `Hit the Claude usage limit, back ${back}`, ttl, note);
    } else if (used < 100 && limited) {
      limited = false;
      await tell($, url, token, "Back from the Claude usage limit", 600, `@${handle} is back.`);
    }
  } catch {
    // The hub refused: nothing to tell, the session goes on.
  }
}

async function refresh($: EngineInterface, url: string, token: string) {
  let s: Status;
  let now: number;
  let live: SessionRateLimit[] | undefined;
  try {
    now = await $.clock.now();
    // A window past its reset is a stale reading: no API response came since it reopened. No reading, no report.
    // undefined: usage failed or gave no window, so the limit state stays as it is (a failure is no sign of being back).
    live = await $.session.usage().then(
      (u) => (u.rateLimits.length ? u.rateLimits.filter((w) => !w.resetsAt || Date.parse(w.resetsAt) > now) : undefined),
      () => undefined,
    );
    // Read on each poll: /clear and resume give the process a new session id.
    const session = encodeURIComponent(await $.session.id());
    const res = await $.http.fetch(`${url}/v1/status?session_id=${session}${usageQuery(live ?? [])}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    s = JSON.parse(res.text) as Status;
    const c = counts(s);
    if (unread === 0 && c.unread > 0) $.ui.toast(`CodeTgh: ${c.unread} unread`);
    // Read or expired messages lower the baseline, so a later one still counts as new.
    const before = Math.min(seen ?? 0, c.unread);
    seen = seen === undefined ? undefined : before;
    if (
      c.unread > before &&
      idleSince !== undefined &&
      (!waiter || now - idleSince >= REWAKE_MS) &&
      submit($, `CodeTgh: ${c.unread} new teammate messages. Read them with inbox_read.`, now)
    )
      seen = c.unread;
    unread = c.unread;
    $.ui.status(`CodeTgh · ${c.online} online · ${c.unread} unread`);
  } catch {
    // Hub down, token refused, or fetch refused by policy: no line rather than a stale or wrong one.
    unread = undefined;
    $.ui.status(undefined);
    return;
  }
  if (live) await limits($, url, token, s.you.handle, now, live);
}

export const register: Register = (on, options) => {
  const url = String(options.codetgh_url ?? "").replace(/\/$/, "");
  const token = String(options.codetgh_token ?? "");
  rewake = options.push_mode === "rewake";
  on("session.start", async ($, e, next) => {
    if (url && token) {
      idleSince = await $.clock.now();
      waiter = false;
      // Not awaited in the hook: session.start holds the first prompt, and a slow hub must not.
      $.clock.after(1, () => refresh($, url, token));
      $.clock.every(30_000, () => refresh($, url, token));
    }
    return next(e);
  });
  on("turn.start", async (_$, e, next) => {
    idleSince = undefined;
    return next(e);
  });
  on("turn.complete", async ($, e, next) => {
    // A subagent's turn ending leaves the main loop as it was.
    if (!e.agentId) {
      idleSince = await $.clock.now();
      waiter = true;
      seen = unread;
    }
    return next(e);
  });
};
