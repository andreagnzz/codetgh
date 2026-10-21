import type { EngineInterface, Register, SessionRateLimit } from "claude-code";

type Status = { you: { handle: string }; agents: { handle: string; presence: string }[]; unread: Record<string, number> };

// The Stop hook's rewake waiter listens this long (hooks.json timeout 3600 s); after it, only the mod can wake the session.
const REWAKE_MS = 3_600_000;
const WAKES = 6;
const WAKES_WINDOW_MS = 600_000;
const HANDOFF =
  "CodeTgh: this session is close to its Claude usage limit and will stop soon. Write a CodeTgh handoff for the project teammates: where the work stands, what they can do meanwhile, and that this session stops soon.";

let unread: number | undefined;
// Undefined while a main-loop turn runs.
let idleSince: number | undefined;
let wakes: number[] = [];
let handoffFor: string | undefined;
let limited = false;
// Only the rewake opt-in (push_mode, allowed by the team) lets the mod start turns; hooks mode never does.
let rewake = false;

// Counts only: no handle, status or message text a peer wrote reaches the screen.
function counts(s: Status) {
  const online = s.agents.filter((a) => a.presence !== "offline" && a.handle !== s.you.handle).length;
  const total = Object.values(s.unread).reduce((n, k) => n + (Number(k) || 0), 0);
  return { online, unread: total };
}

// Fixed texts only: at most the unread count, never a peer's handle, subject or words.
function submit($: EngineInterface, text: string, now: number) {
  if (!rewake) return;
  wakes = wakes.filter((t) => now - t < WAKES_WINDOW_MS);
  if (wakes.length >= WAKES) return;
  wakes.push(now);
  // Not awaited: it resolves only once the turn starts. A refusal or a drop after an interrupt is not retried.
  $.prompt.submit({ text }).catch(() => {});
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

async function limits($: EngineInterface, url: string, token: string, handle: string, now: number) {
  try {
    // A window past its reset is a stale reading: no API response came since it reopened.
    const live = (await $.session.usage()).rateLimits.filter((w) => !w.resetsAt || Date.parse(w.resetsAt) > now);
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
    // No usage reading, or the hub refused: nothing to tell, the session goes on.
  }
}

async function refresh($: EngineInterface, url: string, token: string) {
  let s: Status;
  let now: number;
  try {
    // Read on each poll: /clear and resume give the process a new session id.
    const session = encodeURIComponent(await $.session.id());
    const res = await $.http.fetch(`${url}/v1/status?session_id=${session}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    s = JSON.parse(res.text) as Status;
    const c = counts(s);
    now = await $.clock.now();
    if (unread === 0 && c.unread > 0) $.ui.toast(`CodeTgh: ${c.unread} unread`);
    if (unread !== undefined && c.unread > unread && idleSince !== undefined && now - idleSince >= REWAKE_MS)
      submit($, `CodeTgh: ${c.unread} new teammate messages. Read them with inbox_read.`, now);
    unread = c.unread;
    $.ui.status(`CodeTgh · ${c.online} online · ${c.unread} unread`);
  } catch {
    // Hub down, token refused, or fetch refused by policy: no line rather than a stale or wrong one.
    unread = undefined;
    $.ui.status(undefined);
    return;
  }
  await limits($, url, token, s.you.handle, now);
}

export const register: Register = (on, options) => {
  const url = String(options.codetgh_url ?? "").replace(/\/$/, "");
  const token = String(options.codetgh_token ?? "");
  rewake = options.push_mode === "rewake";
  on("session.start", async ($, e, next) => {
    if (url && token) {
      idleSince = await $.clock.now();
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
    if (!e.agentId) idleSince = await $.clock.now();
    return next(e);
  });
};
