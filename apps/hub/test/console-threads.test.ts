import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { message, thread } from "../src/db/schema.js";
import { RateLimiter } from "../src/domain/limits.js";
import { call, type Hub, mcpClient, startHub, startSession } from "./harness.js";

// Threads: what each thread is about and who is in it, in words.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let clock = 0;
beforeAll(async () => {
  // The writes below come faster than people write: a clock that moves an hour per call keeps the quotas out of the way.
  hub = await startHub({ limiter: new RateLimiter(() => (clock += 3_600_000)) });
  team = await hub.seed();
  await startSession(hub.url, team.sam.token, "sam-threads");
  await startSession(hub.url, team.malik.token, "malik-threads");
});
afterAll(() => hub.stop());

const get = async (path: string, cookie: string, lang = "en") => {
  const res = await fetch(`${hub.url}${path}`, { headers: { cookie, "accept-language": lang } });
  return { status: res.status, html: await res.text() };
};
const html = async (path: string, cookie = team.lea.cookie, lang = "en") => (await get(path, cookie, lang)).html;
// A message sent `minutesAgo` ago.
const send = async (who: "sam" | "malik" | "lea", args: Record<string, unknown>, minutesAgo = 0) => {
  const client = await mcpClient(hub.url, team[who].token);
  const r = await call(client, "send_message", { allow_offline: true, kind: "note", ...args });
  await client.close();
  if (r.isError) throw new Error(r.text);
  const sent = r.json() as { id: string; thread: string };
  const at = new Date(Date.now() - minutesAgo * 60_000);
  await hub.db.update(message).set({ createdAt: at }).where(eq(message.id, sent.id));
  await hub.db.update(thread).set({ lastMessageAt: at }).where(eq(thread.id, sent.thread));
  return sent;
};
describe("threads", () => {
  it("names each thread by its subject, or by its kind and people, never by its id", async () => {
    const named = await send("sam", { to: "@lea", subject: "Users contract", body: "Can I change /users today?" }, 30);
    const bare = await send("sam", { to: "@lea", body: "Rebased on main." }, 20);
    const team_ = await send("malik", { to: "@team", body: "Staging is free." }, 10);
    const list = await html("/console/threads");
    expect(list).toContain(`class="row-link" href="/console/threads/${named.thread}">Users contract</a>`);
    // Without a subject: the kind, and who it is with (the reader left out), or who started it.
    expect(list).toContain(`class="row-link" href="/console/threads/${bare.thread}">Direct thread with @sam</a>`);
    expect(list).toContain(`class="row-link" href="/console/threads/${team_.thread}">Team thread from @malik</a>`);
    expect((await html("/console/threads", team.sam.cookie)).match(new RegExp(`${bare.thread}">([^<]+)</a>`))?.[1]).toBe(
      "Direct thread with @lea",
    );
    // The id stays in the link, never on screen.
    expect(list).not.toMatch(/>thr_[0-9A-Z]+</);
    // Each row says what kind of thread it is and who is in it, and the list is ordered by its last message.
    expect(list).toContain('<span class="chip" translate="no" title="@sam">@sam</span>');
    expect(list).toMatch(/<th scope="col" class="num" aria-sort="descending">Last message/);
  });

  it("keeps someone else's direct thread unnamed for an admin until the audited opening", async () => {
    const sent = await send("sam", { to: "@malik", subject: "Perf review", body: "b" }, 5);
    const list = await html("/console/threads");
    const row = list.slice(list.indexOf(`/console/threads/${sent.thread}"`), list.indexOf("</tr>", list.indexOf(sent.thread)));
    expect(row).toContain(">Direct thread</a>");
    expect(row).toContain("Opening it is recorded in the audit log.");
    expect(row).not.toContain("Perf review");
    expect(row).not.toContain("@sam");
    expect(row).not.toContain("@malik");
  });

  it("puts current threads quiet for over a day under Earlier threads, and says what the tabs hold", async () => {
    const recent = await send("sam", { to: "@lea", subject: "Fresh one", body: "b" }, 60);
    const old = await send("malik", { to: "@lea", subject: "Quiet one", body: "b" }, 30 * 60);
    const list = await html("/console/threads?project=");
    const rule = list.search(/>Earlier threads<\/h[23]>/);
    expect(rule).toBeGreaterThan(list.indexOf(recent.thread));
    expect(list.indexOf(old.thread)).toBeGreaterThan(rule);
    expect(list).toContain("Threads with a message in the last day, or with a message someone hasn&#39;t read yet.");
    const archives = await html("/console/threads?archived=1");
    expect(archives).not.toContain("Earlier threads");
    expect(archives).toContain("A thread moves here after a day without messages, once every message in it is read.");
  });

  it("shows a muted thread's state in words, and the agent streak against the loop guard's limit", async () => {
    const sent = await send("sam", { to: "@lea", subject: "Rounding mode", body: "b" }, 2);
    await hub.db.update(thread).set({ mutedAt: new Date(), mutedReason: "loop_guard", agentStreak: 5 }).where(eq(thread.id, sent.thread));
    const list = await html("/console/threads");
    expect(list).toContain('<span class="pill" data-tone="warn">Muted by the loop guard</span>');
    expect(list).toContain("5 of 5");
    await hub.db.update(thread).set({ mutedReason: "human" }).where(eq(thread.id, sent.thread));
    expect(await html("/console/threads")).toContain('<span class="pill" data-tone="neutral">Muted by a person</span>');
  });

  it("says what fills an empty list: a new team, the archives, a project with nothing in it", async () => {
    const other = await startHub();
    try {
      const t = await other.seed();
      const page = async (path: string) => (await fetch(`${other.url}${path}`, { headers: { cookie: t.lea.cookie } })).text();
      const empty = await page("/console/threads");
      expect(empty).toContain('<p class="empty-title">No threads yet.</p>');
      expect(empty).toContain("A thread starts with the first message an agent or a person sends.");
      expect(await page("/console/threads?archived=1")).toContain('<p class="empty-title">No archived threads.</p>');
      const api = (await page("/console/threads")).match(/project=(prj_[0-9A-Z]+)">acme\/api</)?.[1];
      const filtered = await page(`/console/threads?project=${api}`);
      expect(filtered).toContain('<p class="empty-title">No threads in acme/api.</p>');
      expect(filtered).toContain('href="/console/threads?project=">Show all projects</a>');
    } finally {
      await other.stop();
    }
  });

  it("reads in French", async () => {
    const list = await html("/console/threads?project=", team.lea.cookie, "fr");
    expect(list).toContain("Fil direct avec @sam");
    expect(list).toContain("Fils plus anciens");
    expect(list).toContain("Dernier message");
  });
});
