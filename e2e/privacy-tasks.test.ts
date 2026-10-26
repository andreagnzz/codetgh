import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { task } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
// Words a person typed into the columns of a task that carry no author: blocked_reason and verify_tag.
const SAM = ["raison-sam-a", "raison-sam-b", "tag-sam-a", "tag-sam-b", "tag-sam-c"];
const MALIK = ["raison-malik-d", "reprise-malik-e"];
const ids: Record<string, string> = {};
const json = (r: { text: string }) => JSON.parse(r.text.split("\n\n")[0] ?? "null");

beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  const samS = (await startSession(hub.url, team.sam.token, "sam-erase", { repo: ACME_REPO })).agent_id ?? "";
  const malikS = (await startSession(hub.url, team.malik.token, "malik-erase", { repo: ACME_REPO })).agent_id ?? "";
  const sam = await mcpClient(hub.url, team.sam.token);
  const lea = await mcpClient(hub.url, team.lea.token);
  const malik = await mcpClient(hub.url, team.malik.token);
  const upd = (c: typeof sam, id: string, version: number, patch: object, agent?: string) =>
    call(c, "task_update", { task_id: id, expected_version: version, patch, ...(agent && { agent }) });

  // A: Sam's own, blocked with his reason, under his tag.
  const a = json(await call(sam, "task_create", { agent: samS, title: "A", verify: { tag: "tag-sam-a" } }));
  const aClaimed = json(await call(sam, "task_claim", { agent: samS, task_id: a.id, expected_version: 1 }));
  await upd(sam, a.id, aClaimed.version, { status: "blocked", reason: "raison-sam-a" }, samS);
  // B: Léa's, assigned to Sam, who sets its tag and blocks it.
  const b = json(await call(lea, "task_create", { title: "B", assignee: "@sam" }));
  const bClaimed = json(await call(sam, "task_claim", { agent: samS, task_id: b.id, expected_version: 1 }));
  await upd(sam, b.id, bClaimed.version, { status: "blocked", reason: "raison-sam-b", verify: { tag: "tag-sam-b" } }, samS);
  // C: Léa's; Sam set its tag as its assignee, then Léa gave it to Malik.
  const c = json(await call(lea, "task_create", { title: "C", assignee: "@sam" }));
  const cSet = json(await upd(sam, c.id, 1, { verify: { tag: "tag-sam-c" } }, samS));
  await upd(lea, c.id, cSet.version, { assignee: "@malik" });
  // D: Sam created it, Malik blocks it.
  const d = json(await call(sam, "task_create", { agent: samS, title: "D", assignee: "@malik" }));
  const dClaimed = json(await call(malik, "task_claim", { agent: malikS, task_id: d.id, expected_version: 1 }));
  await upd(malik, d.id, dClaimed.version, { status: "blocked", reason: "raison-malik-d" }, malikS);
  // E: Malik created it for Sam, who works on it; Malik takes it over with a note while Sam is live.
  const e = json(await call(malik, "task_create", { agent: malikS, title: "E", assignee: "@sam" }));
  const eClaimed = json(await call(sam, "task_claim", { agent: samS, task_id: e.id, expected_version: 1 }));
  const eStarted = json(await upd(sam, e.id, eClaimed.version, { status: "in_progress", note: "premier jet de Sam" }, samS));
  await upd(malik, e.id, eStarted.version, { assignee: "@me", takeover_note: "reprise-malik-e" }, malikS);
  Object.assign(ids, { a: a.id, b: b.id, c: c.id, d: d.id, e: e.id });
  for (const x of [sam, lea, malik]) await x.close();
});
afterAll(() => hub.stop());

// Every task row and every message, as text: what could still hold a person's words.
async function dump() {
  const r = await hub.db.execute(sql`
    select string_agg(t::text, ' ') as all_text from (
      select row_to_json(t)::text as t from task t
      union all select row_to_json(m)::text from message m
    ) x`);
  return String((r as unknown as { rows: Array<{ all_text: string }> }).rows[0]?.all_text ?? "");
}
const erase = (cookie: string) => consolePost(hub.url, cookie, "/console/me/erase", { confirm: "erase" });

describe("a person's words in the task columns without an author", () => {
  it("are in their export, on the tasks they created, were assigned, or set the tag of", async () => {
    const data = await (await fetch(`${hub.url}/console/me/export`, { headers: { cookie: team.sam.cookie } })).json();
    const text = JSON.stringify(data.tasks);
    for (const word of [...SAM, "raison-malik-d"]) expect(text).toContain(word);
    // Task C is neither Sam's nor assigned to him now: it is there because he set its tag.
    expect(data.tasks.map((t: { id: string }) => t.id)).toContain(ids.c);
    expect(data.tasks.find((t: { id: string }) => t.id === ids.c)).toMatchObject({ verifyTag: "tag-sam-c", verifySetBy: team.sam.userId });
  });

  it("are gone from every task and message after the person erases themselves", async () => {
    expect(await dump()).toContain("raison-sam-a");
    expect((await erase(team.sam.cookie)).status).toBeLessThan(400);
    const text = await dump();
    for (const word of [...SAM, "premier jet de Sam"]) expect(text).not.toContain(word);
    // Their tasks lose the columns, not the work: what the others wrote stays (Malik's note on D, his takeover note on E).
    for (const id of [ids.a, ids.b, ids.c, ids.d])
      expect(
        await hub.db
          .select()
          .from(task)
          .where(eq(task.id, id ?? "")),
      ).toMatchObject([{ verifyTag: null, verifySetBy: null, blockedReason: null }]);
    expect(text).toContain("reprise-malik-e");
    expect(
      (
        await hub.db
          .select()
          .from(task)
          .where(eq(task.id, ids.c ?? ""))
      )[0],
    ).toMatchObject({ assigneeUserId: team.malik.userId });
  });

  it("go with a takeover note too: the note in the task and the message to the former assignee", async () => {
    const [e] = await hub.db
      .select()
      .from(task)
      .where(eq(task.id, ids.e ?? ""));
    expect(e?.notes.map((n) => n.text)).toContain("taken over by @malik: reprise-malik-e");
    expect((await erase(team.malik.cookie)).status).toBeLessThan(400);
    const text = await dump();
    for (const word of MALIK) expect(text).not.toContain(word);
    const [after] = await hub.db
      .select()
      .from(task)
      .where(eq(task.id, ids.e ?? ""));
    expect(after?.notes.every((n) => n.text === "[erased]")).toBe(true);
  });
});
