import type { EngineInterface, Register } from "claude-code";

type Status = { you: { handle: string }; agents: { handle: string; presence: string }[]; unread: Record<string, number> };

let unread: number | undefined;

// Counts only: no handle, status or message text a peer wrote reaches the screen.
function counts(s: Status) {
  const online = s.agents.filter((a) => a.presence !== "offline" && a.handle !== s.you.handle).length;
  const total = Object.values(s.unread).reduce((n, k) => n + (Number(k) || 0), 0);
  return { online, unread: total };
}

async function refresh($: EngineInterface, url: string, token: string) {
  try {
    // Read on each poll: /clear and resume give the process a new session id.
    const session = encodeURIComponent(await $.session.id());
    const res = await $.http.fetch(`${url}/v1/status?session_id=${session}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const c = counts(JSON.parse(res.text) as Status);
    if (unread === 0 && c.unread > 0) $.ui.toast(`CodeTgh: ${c.unread} unread`);
    unread = c.unread;
    $.ui.status(`CodeTgh · ${c.online} online · ${c.unread} unread`);
  } catch {
    // Hub down, token refused, or fetch refused by policy: no line rather than a stale or wrong one.
    unread = undefined;
    $.ui.status(undefined);
  }
}

export const register: Register = (on, options) => {
  const url = String(options.codetgh_url ?? "").replace(/\/$/, "");
  const token = String(options.codetgh_token ?? "");
  on("session.start", async ($, e, next) => {
    if (url && token) {
      // Not awaited in the hook: session.start holds the first prompt, and a slow hub must not.
      $.clock.after(1, () => refresh($, url, token));
      $.clock.every(30_000, () => refresh($, url, token));
    }
    return next(e);
  });
};
