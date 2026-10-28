import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { auditEvent, message } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const threadPage = async (cookie: string, id: string) => (await fetch(`${hub.url}/console/threads/${id}`, { headers: { cookie } })).text();

it("shows a reply addressed to one person only to them in the console, as over MCP", async () => {
  await startSession(hub.url, team.lea.token, "lea-vis");
  await startSession(hub.url, team.sam.token, "sam-vis");
  const lea = await mcpClient(hub.url, team.lea.token);
  const sam = await mcpClient(hub.url, team.sam.token);
  await call(lea, "send_message", { to: "@team", kind: "question", body: "Who owns the billing cron?" });
  const [q] = await hub.db.select().from(message).where(eq(message.body, "Who owns the billing cron?"));
  // No `to`: the answer goes to the question's author only.
  await call(sam, "send_message", { reply_to: q?.id, kind: "answer", body: "Private: me, until Friday." });

  const malik = await threadPage(team.malik.cookie, q?.threadId ?? "");
  expect(malik).toContain("Who owns the billing cron?");
  expect(malik).not.toContain("Private: me, until Friday.");
  expect(await threadPage(team.lea.cookie, q?.threadId ?? "")).toContain("Private: me, until Friday.");
  expect(await threadPage(team.sam.cookie, q?.threadId ?? "")).toContain("Private: me, until Friday.");
});

it("audits an admin's opening of someone else's direct thread once, and gives that page no live refresh", async () => {
  await startSession(hub.url, team.sam.token, "sam-dm");
  const sam = await mcpClient(hub.url, team.sam.token);
  await call(sam, "send_message", { to: "@malik", kind: "note", body: "DM between Sam and Malik", allow_offline: true });
  const [dm] = await hub.db.select().from(message).where(eq(message.body, "DM between Sam and Malik"));
  const id = dm?.threadId ?? "";
  const reads = () =>
    hub.db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.action, "thread.read_by_admin"), eq(auditEvent.subjectId, id)));

  const admin = await threadPage(team.lea.cookie, id);
  expect(admin).toContain("DM between Sam and Malik");
  expect(admin).not.toContain("sse:activity");
  expect(await reads()).toHaveLength(1);
  // A participant's page still follows the thread live, and opening it is not an admin read.
  expect(await threadPage(team.malik.cookie, id)).toContain("sse:activity");
  expect(await reads()).toHaveLength(1);
  await sam.close();
});

it("lists someone else's direct thread to an admin without its subject, which only the audited opening shows", async () => {
  const sam = await mcpClient(hub.url, team.sam.token);
  const sent = JSON.parse(
    (await call(sam, "send_message", { to: "@malik", kind: "note", subject: "Perf review for Lea", body: "b", allow_offline: true })).text,
  );
  const reads = () =>
    hub.db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.action, "thread.read_by_admin"), eq(auditEvent.subjectId, sent.thread)));
  const list = await (await fetch(`${hub.url}/console/threads`, { headers: { cookie: team.lea.cookie } })).text();
  expect(list).toContain(sent.thread);
  expect(list).not.toContain("Perf review for Lea");
  expect(await reads()).toHaveLength(0);
  // Its participants still see it in their list.
  expect(await (await fetch(`${hub.url}/console/threads`, { headers: { cookie: team.malik.cookie } })).text()).toContain(
    "Perf review for Lea",
  );
  expect(await threadPage(team.lea.cookie, sent.thread)).toContain("Perf review for Lea");
  expect(await reads()).toHaveLength(1);
  await sam.close();
});

const dashboard = async (cookie: string) => (await fetch(`${hub.url}/console`, { headers: { cookie } })).text();

it("keeps a reply addressed to one person off the other members' activity line", async () => {
  await startSession(hub.url, team.lea.token, "lea-line");
  await startSession(hub.url, team.sam.token, "sam-line");
  const lea = await mcpClient(hub.url, team.lea.token);
  const sam = await mcpClient(hub.url, team.sam.token);
  await call(lea, "send_message", { to: "@team", kind: "question", body: "Who deploys on Friday?" });
  const [q] = await hub.db.select().from(message).where(eq(message.body, "Who deploys on Friday?"));
  await call(sam, "send_message", { reply_to: q?.id, kind: "answer", body: "Private: Sam deploys." });
  const [a] = await hub.db.select().from(message).where(eq(message.body, "Private: Sam deploys."));

  const malik = await dashboard(team.malik.cookie);
  expect(malik).toContain(`data-mid="${q?.id}"`);
  expect(malik).not.toContain(`data-mid="${a?.id}"`);
  expect(await dashboard(team.lea.cookie)).toContain(`data-mid="${a?.id}"`);
  expect(await dashboard(team.sam.cookie)).toContain(`data-mid="${a?.id}"`);
  await lea.close();
  await sam.close();
});

it("names the recipient of an answer on the activity line instead of its internal address", async () => {
  await startSession(hub.url, team.lea.token, "lea-who");
  await startSession(hub.url, team.sam.token, "sam-who");
  const lea = await mcpClient(hub.url, team.lea.token);
  const sam = await mcpClient(hub.url, team.sam.token);
  await call(lea, "send_message", { to: "@sam", kind: "question", body: "Where is staging?", allow_offline: true });
  const [q] = await hub.db.select().from(message).where(eq(message.body, "Where is staging?"));
  await call(sam, "send_message", { reply_to: q?.id, kind: "answer", body: "On the usual box." });
  const [a] = await hub.db.select().from(message).where(eq(message.body, "On the usual box."));

  const html = await dashboard(team.lea.cookie);
  expect(html).toContain(`data-mid="${a?.id}" data-summary="New message: Sam (agent) → @lea"`);
  expect(html).not.toMatch(/agent:agt_|user:usr_/);
  await lea.close();
  await sam.close();
});
