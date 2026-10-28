import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { INVITE_HEADER } from "../apps/hub/src/auth.js";
import { alert, auditEvent, membership, receipt, team as teamTable, thread } from "../apps/hub/src/db/schema.js";
import { createInvitation } from "../apps/hub/src/domain/teams.js";
import { createPersonalToken } from "../apps/hub/src/tokens.js";
import { ACME_REPO, call, code, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  // Sessions on one project: a loop's copy for the orchestrator reaches only its sessions on the thread's project.
  for (const m of [team.lea, team.sam, team.malik]) await startSession(hub.url, m.token, `${m.handle}-loop`, { repo: ACME_REPO });
});
afterAll(() => hub.stop());

type Member = (typeof team)["sam"];
// Two members' agents reply to each other until the hub mutes the thread; returns the last message.
// Each scenario uses its own pair: the 12-per-10-minutes pair limit stays a backstop across threads.
async function loop(a: Member, b: Member, start?: { id: string }) {
  const first = await mcpClient(hub.url, a.token);
  const second = await mcpClient(hub.url, b.token);
  let last =
    start ?? JSON.parse((await call(first, "send_message", { to: `@${b.handle}`, kind: "question", body: "Dates in UTC or local?" })).text);
  for (let i = start ? 0 : 1; i < 5; i++) {
    const r = await call(i % 2 ? second : first, "send_message", {
      to: i % 2 ? `@${a.handle}` : `@${b.handle}`,
      kind: "answer",
      reply_to: last.id,
      body: `reply ${i}`,
    });
    expect(r.isError, `message ${i + 1}: ${r.text}`).toBe(false);
    last = JSON.parse(r.text);
  }
  // Five agent messages in a row (a wrote the fifth): b's sixth is refused and the thread muted.
  expect(code(await call(second, "send_message", { to: `@${a.handle}`, kind: "answer", reply_to: last.id, body: "again" }))).toBe(
    "E_LOOP_GUARD",
  );
  return last as { id: string; thread: string };
}

it("without an orchestrator, mutes after five agent messages and waits for a human", async () => {
  const last = await loop(team.sam, team.malik);
  const [t] = await hub.db.select().from(thread).where(eq(thread.id, last.thread));
  expect(t?.mutedReason).toBe("loop_guard");
});

it("lets the team's orchestrator judge a loop, reopen it once, and leaves the second loop to a human", async () => {
  expect(
    (
      await consolePost(hub.url, team.lea.cookie, "/console/settings", {
        retention_days: "90",
        secret_patterns: "",
        loop_orchestrator: "malik",
      })
    ).status,
  ).toBeLessThan(400);
  const [settings] = await hub.db.select({ s: teamTable.settings }).from(teamTable).where(eq(teamTable.id, team.teamId));
  expect(settings?.s.loop_orchestrator).toBe("malik");

  const last = await loop(team.sam, team.lea);
  const malik = await mcpClient(hub.url, team.malik.token);
  // The orchestrator now has the loop in its inbox: the thread's last messages.
  const inbox = (await call(malik, "inbox_read", { thread: last.thread })).text;
  expect(inbox).toContain("Dates in UTC or local?");
  expect(inbox).toContain("reply 4");

  // Nobody else may post a verdict.
  const lea = await mcpClient(hub.url, team.lea.token);
  expect(code(await call(lea, "send_message", { kind: "status", reply_to: last.id, body: "done", loop_verdict: { reopen: true } }))).toBe(
    "E_FORBIDDEN",
  );

  const verdict = await call(malik, "send_message", {
    kind: "status",
    reply_to: last.id,
    body: "Use UTC everywhere. Sam updates the API, Léa the UI. Stop debating.",
    loop_verdict: { reopen: true },
  });
  expect(verdict.isError).toBe(false);
  // Both looping agents receive the verdict, and the thread is open again.
  expect((await call(lea, "inbox_read", { thread: last.thread })).text).toContain("Use UTC everywhere");
  const sam = await mcpClient(hub.url, team.sam.token);
  expect((await call(sam, "inbox_read", { thread: last.thread })).text).toContain("Use UTC everywhere");
  const [open] = await hub.db.select().from(thread).where(eq(thread.id, last.thread));
  expect(open?.mutedAt).toBeNull();

  // A second loop on the same thread: the orchestrator may judge it, but not reopen it.
  const again = await loop(team.sam, team.lea, JSON.parse(verdict.text));
  const second = await call(malik, "send_message", {
    kind: "status",
    reply_to: again.id,
    body: "Still stuck.",
    loop_verdict: { reopen: true },
  });
  expect(second.isError, second.text).toBe(false);
  const [muted] = await hub.db.select().from(thread).where(eq(thread.id, last.thread));
  expect(muted?.mutedAt).not.toBeNull();
  expect(
    await hub.db
      .select()
      .from(alert)
      .where(and(eq(alert.threadId, last.thread), eq(alert.kind, "loop_needs_human"))),
  ).toHaveLength(1);
  // One verdict per muting.
  expect(
    code(await call(malik, "send_message", { kind: "status", reply_to: again.id, body: "Again.", loop_verdict: { reopen: false } })),
  ).toBe("E_INVALID");
});

async function join(name: string) {
  const email = `${name.toLowerCase()}2@acme.test`;
  const invite = await createInvitation(hub.db, { teamId: team.teamId, email, role: "member", invitedBy: null, via: "system" });
  const { user } = await hub.auth.api.signUpEmail({
    body: { name, email, password: `${name.toLowerCase()}-password-123` },
    headers: new Headers({ [INVITE_HEADER]: invite.token }),
  });
  const { token } = await createPersonalToken(hub.db, { userId: user.id, teamId: team.teamId, label: `${name} laptop` });
  const [m] = await hub.db.select().from(membership).where(eq(membership.userId, user.id));
  await startSession(hub.url, token, `${name.toLowerCase()}-loop`, { repo: ACME_REPO });
  return { ...team.sam, userId: user.id, token, handle: m?.handle ?? "" };
}

it("does not hand the orchestrator role to a newcomer who takes the handle of a member who left", async () => {
  await consolePost(hub.url, team.lea.cookie, "/console/settings", {
    retention_days: "90",
    secret_patterns: "",
    loop_orchestrator: "malik",
  });
  expect((await consolePost(hub.url, team.malik.cookie, "/console/me/erase", { confirm: "erase" })).status).toBeLessThan(400);
  const malik = await join("Malik");
  const nina = await join("Nina");
  const omar = await join("Omar");
  expect(malik.handle).toBe("malik");

  const stuck = await loop(omar, nina);
  const orchestrator = await mcpClient(hub.url, malik.token);
  const r = await call(orchestrator, "send_message", {
    kind: "status",
    reply_to: stuck.id,
    body: "Mine now.",
    loop_verdict: { reopen: true },
  });
  expect(code(r), r.text).toBe("E_FORBIDDEN");
  const [t] = await hub.db.select().from(thread).where(eq(thread.id, stuck.thread));
  expect(t?.mutedAt).not.toBeNull();
});

it("delivers a verdict to the looping members still in the team only", async () => {
  await consolePost(hub.url, team.lea.cookie, "/console/settings", {
    retention_days: "90",
    secret_patterns: "",
    loop_orchestrator: "sam",
  });
  const sol = await join("Sol");
  const quinn = await join("Quinn");
  const stuck = await loop(sol, quinn);
  const [gone] = await hub.db.select().from(membership).where(eq(membership.userId, quinn.userId));
  expect((await consolePost(hub.url, team.lea.cookie, `/console/members/${gone?.id}/revoke`)).status).toBeLessThan(400);
  const received = async (userId: string) => (await hub.db.select().from(receipt).where(eq(receipt.recipientUserId, userId))).length;
  const before = await received(quinn.userId);

  const sam = await mcpClient(hub.url, team.sam.token);
  const verdict = await call(sam, "send_message", {
    kind: "status",
    reply_to: stuck.id,
    body: "Sol picks the format.",
    loop_verdict: { reopen: true },
  });
  expect(verdict.isError, verdict.text).toBe(false);
  expect(await received(quinn.userId)).toBe(before);
  expect((await call(await mcpClient(hub.url, sol.token), "inbox_read", { thread: stuck.thread })).text).toContain("Sol picks the format.");
});

it("hands the orchestrator only the loop of a direct thread, and audits that read like an admin's", async () => {
  const pia = await join("Pia");
  const rita = await join("Rita");
  await consolePost(hub.url, team.lea.cookie, "/console/settings", {
    retention_days: "90",
    secret_patterns: "",
    loop_orchestrator: rita.handle,
  });
  const piaClient = await mcpClient(hub.url, pia.token);
  const first = JSON.parse(
    (await call(piaClient, "send_message", { to: "@lea", kind: "note", body: "Private context before the loop" })).text,
  );
  await piaClient.close();
  // Léa's own words in the console: the agent streak starts again after them.
  expect((await consolePost(hub.url, team.lea.cookie, `/console/threads/${first.thread}/reply`, { body: "Lea's own words" })).status).toBe(
    204,
  );
  const stuck = await loop(pia, team.lea, first);
  const orchestrator = await mcpClient(hub.url, rita.token);
  const inbox = (await call(orchestrator, "inbox_read", { thread: stuck.thread })).text;
  await orchestrator.close();
  expect(inbox).toContain("reply 4");
  expect(inbox).not.toContain("Private context before the loop");
  expect(inbox).not.toContain("Lea's own words");
  const reads = await hub.db
    .select()
    .from(auditEvent)
    .where(and(eq(auditEvent.action, "thread.read_by_orchestrator"), eq(auditEvent.subjectId, stuck.thread)));
  expect(reads).toHaveLength(1);
  expect(reads[0]?.actorUserId).toBe(rita.userId);

  // The loop is all it gets: Léa's reply after it reaches Pia, not the orchestrator.
  expect(
    (await consolePost(hub.url, team.lea.cookie, `/console/threads/${stuck.thread}/reply`, { body: "Lea after the loop" })).status,
  ).toBe(204);
  const piaAgain = await mcpClient(hub.url, pia.token);
  expect((await call(piaAgain, "inbox_read", { thread: stuck.thread })).text).toContain("Lea after the loop");
  await piaAgain.close();
  const later = await mcpClient(hub.url, rita.token);
  expect((await call(later, "inbox_read", { thread: stuck.thread })).text).not.toContain("Lea after the loop");
  await later.close();
});
