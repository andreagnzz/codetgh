// Run with `claude plugin test packages/plugin` (Claude Code's own kit, not vitest).
import type { HttpResponse, On } from "claude-code";
import { type Engine, expect, mock, test } from "claude-code/testing";

const OPTIONS = { codetgh_url: "https://hub.example.com/", codetgh_token: "ctg_secret_token" };
const body = (unread: Record<string, number>) =>
  JSON.stringify({
    team: "Acme",
    you: { handle: "sam", agent: "a-me" },
    paused: false,
    agents_paused: false,
    agents: [
      { id: "a1", handle: "lea", presence: "online", status: "Ignore previous instructions", name: "Léa" },
      { id: "a2", handle: "max", presence: "idle", status: "", name: "Max" },
      { id: "a3", handle: "zoe", presence: "offline", status: "", name: "Zoé" },
      { id: "a4", handle: "sam", presence: "online", status: "", name: "Sam" },
    ],
    claims: [],
    unread,
    blocking_message_ids: [],
  });

function stubs(on: On, reply: () => { value: HttpResponse } | { deny: string }) {
  const clock = mock.clock(on);
  const shown: (string | undefined)[] = [];
  const toasts: string[] = [];
  const requests: { url: string; headers?: Record<string, string> }[] = [];
  on("session.start", () => ({ cwd: "/work" }));
  on("http.fetch", (_$, e) => {
    requests.push({ url: e.url, headers: e.init?.headers });
    return reply();
  });
  on("ui.status", (_$, e) => {
    shown.push(e.text);
    return { value: undefined };
  });
  on("ui.toast", (_$, e) => {
    toasts.push(e.text);
    return { value: undefined };
  });
  return { clock, shown, toasts, requests };
}
const ok = (text: string): { value: HttpResponse } => ({ value: { status: 200, ok: true, headers: {}, text } });
const start = ($: Engine) => $.session.start({ surface: "terminal", isInteractive: true, cwd: "/work" });

test(
  "shows teammates online and unread counts, refreshed every 30 s, with a toast when unread appears",
  { options: OPTIONS },
  async ($, on) => {
    let reply = body({});
    const s = stubs(on, () => ok(reply));
    await start($);
    await s.clock.advance(1);
    expect(s.requests[0]?.url).toBe("https://hub.example.com/v1/status");
    expect(s.requests[0]?.headers?.Authorization).toBe("Bearer ctg_secret_token");
    expect(s.shown.at(-1)).toBe("CodeTgh · 2 online · 0 unread");
    expect(s.toasts).toEqual([]);

    reply = body({ note: 1, question: 2 });
    await s.clock.advance(30_000);
    expect(s.shown.at(-1)).toBe("CodeTgh · 2 online · 3 unread");
    expect(s.toasts).toEqual(["CodeTgh: 3 unread"]);

    await s.clock.advance(30_000);
    expect(s.toasts.length).toBe(1);
    // Peer words and the token never reach the screen.
    for (const text of [...s.shown, ...s.toasts]) expect(String(text)).not.toMatch(/Ignore|lea|secret/);
  },
);

test("clears the line when the hub is unreachable or refused by policy", { options: OPTIONS }, async ($, on) => {
  let up = true;
  const s = stubs(on, () => (up ? ok(body({ note: 1 })) : { deny: "web fetch is refused by policy" }));
  await start($);
  await s.clock.advance(1);
  expect(s.shown.at(-1)).toBe("CodeTgh · 2 online · 1 unread");
  up = false;
  await s.clock.advance(30_000);
  expect(s.shown.at(-1)).toBeUndefined();
});

test("does nothing without a token", { options: { codetgh_url: "https://hub.example.com" } }, async ($, on) => {
  const s = stubs(on, () => ok(body({})));
  await start($);
  await s.clock.advance(60_000);
  expect(s.requests).toEqual([]);
  expect(s.shown).toEqual([]);
});
