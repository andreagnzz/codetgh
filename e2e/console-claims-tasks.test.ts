import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvent, claim, task } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, callOnce, type Hub, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const get = async (cookie: string, path: string) => (await fetch(`${hub.url}${path}`, { headers: { cookie } })).text();
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

describe("console claims", () => {
  it("lists active claims to members and lets only an admin release one", async () => {
    await startSession(hub.url, team.sam.token, "sam-c", { repo: ACME_REPO });
    await callOnce(hub.url, team.sam.token, "claim", { scope: ["api/console.ts"], reason: "refactor" });
    const [c] = await hub.db.select().from(claim).where(eq(claim.scope, "api/console.ts"));
    if (!c) throw new Error("no claim");

    const seen = await get(team.malik.cookie, "/console/claims");
    // The scope breaks after its slashes.
    expect(seen).toContain("api/<wbr/>console.ts");
    expect(seen).toContain("Sam");
    expect(seen).toContain("<span>Exclusive</span>");
    expect(seen).not.toContain(`/console/claims/${c.id}/release`);
    expect((await consolePost(hub.url, team.malik.cookie, `/console/claims/${c.id}/release`)).status).toBe(403);

    expect(await get(team.lea.cookie, "/console/claims")).toContain(`/console/claims/${c.id}/release`);
    expect((await consolePost(hub.url, team.lea.cookie, `/console/claims/${c.id}/release`)).status).toBeLessThan(400);
    const [after] = await hub.db.select().from(claim).where(eq(claim.id, c.id));
    expect(after).toMatchObject({ releaseReason: "admin", releasedBy: team.lea.userId });
    expect(
      await hub.db
        .select()
        .from(auditEvent)
        .where(and(eq(auditEvent.action, "claim.released"), eq(auditEvent.subjectId, c.id))),
    ).toHaveLength(1);
    expect(await get(team.malik.cookie, "/console/claims")).not.toContain("api/<wbr/>console.ts");
  });
});

describe("console tasks", () => {
  it("creates, assigns and shows the history of a task by status", async () => {
    const created = await consolePost(hub.url, team.malik.cookie, "/console/tasks", {
      title: "Migrate <b>users</b>",
      body: "Move the users table",
      assignee: "@sam",
    });
    expect(created.status).toBeLessThan(400);
    const [t] = await hub.db.select().from(task).where(eq(task.createdByUser, team.malik.userId));
    if (!t) throw new Error("no task");
    expect(t).toMatchObject({ status: "todo", assigneeUserId: team.sam.userId, createdByAgent: null });

    const board = await get(team.lea.cookie, "/console/tasks");
    expect(board).toContain('To do <span class="count">1</span>');
    expect(board).toContain("Migrate &lt;b&gt;users&lt;/b&gt;");

    const upd = await consolePost(hub.url, team.malik.cookie, `/console/tasks/${t.id}`, {
      expected_version: "1",
      assignee: "@malik",
      note: "taking it over",
    });
    expect(upd.status).toBeLessThan(400);
    const stale = await consolePost(hub.url, team.malik.cookie, `/console/tasks/${t.id}`, { expected_version: "1", note: "again" });
    expect(stale.status).toBe(409);

    const detail = await get(team.sam.cookie, `/console/tasks/${t.id}`);
    expect(detail).toContain("Move the users table");
    expect(detail).toContain("taking it over");
    expect(detail).toContain(">created the task<");
    expect(detail).toContain(">updated the task<");
    const audit = await hub.db.select().from(auditEvent).where(eq(auditEvent.subjectId, t.id));
    expect(audit.every((e) => e.via === "console" && e.actorType === "user")).toBe(true);
  });
});
