import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, alert, claim, membership, memoryItem, project, task } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";

// Many rows from one person push the others past a page's row limit: filters must run before it, and a cut list says so.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let acme: string;
const ago = (min: number) => new Date(Date.now() - min * 60_000);
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  acme = (await hub.db.select().from(project).where(eq(project.name, "acme")))[0]?.id ?? "";
  const row = (id: string, userId: string, label: string, lastSeenAt: Date, projectId: string | null = null) => ({
    id,
    teamId: team.teamId,
    userId,
    sessionId: id,
    kind: "claude_code",
    label,
    projectId,
    lastSeenAt,
  });
  await hub.db
    .insert(agent)
    .values([
      ...Array.from({ length: 120 }, (_, i) => row(`agt_lea${i}`, team.lea.userId, `lea-busy-${i}`, ago(1))),
      row("agt_malik", team.malik.userId, "malik-on-acme", ago(120), acme),
      row("agt_sam", team.sam.userId, "sam-alone", ago(180)),
    ]);
  await hub.db
    .insert(task)
    .values(
      Array.from({ length: 210 }, (_, i) => ({ id: `tsk_${i}`, teamId: team.teamId, title: `task ${i}`, createdByUser: team.lea.userId })),
    );
  await hub.db.insert(alert).values(
    Array.from({ length: 55 }, (_, i) => ({
      id: `alr_${i}`,
      teamId: team.teamId,
      kind: "instruction_like" as const,
      excerpt: `alert number ${i}.`,
      createdAt: ago(i),
    })),
  );
  await hub.db.insert(memoryItem).values(
    Array.from({ length: 55 }, (_, i) => ({
      id: `mem_${i}`,
      teamId: team.teamId,
      number: i + 1,
      kind: "note" as const,
      title: `memory number ${i}.`,
      body: "b",
      proposedByUser: team.lea.userId,
      authoredBy: "human" as const,
      createdAt: ago(i),
    })),
  );
  await hub.db.insert(claim).values(
    Array.from({ length: 210 }, (_, i) => ({
      id: `clm_${i}`,
      teamId: team.teamId,
      holderUserId: team.lea.userId,
      holderAgentId: "agt_lea0",
      scopeType: "path" as const,
      scope: `src/f${i}.ts`,
      mode: "exclusive" as const,
      ttlS: 3600,
      expiresAt: new Date(Date.now() + 3600_000),
    })),
  );
});
afterAll(() => hub.stop());

const get = async (path: string, cookie = team.lea.cookie) => (await fetch(`${hub.url}${path}`, { headers: { cookie } })).text();

it("filters agents and project sessions by viewer and project before the row limit, and says when the list is cut", async () => {
  expect(await get(`/console/agents?project=${acme}`)).toContain("malik-on-acme");
  expect(await get("/console/agents", team.sam.cookie)).toContain("sam-alone");
  expect(await get(`/console/projects?project=${acme}`)).toContain("malik-on-acme");
  expect(await get("/console/agents?project=")).toContain("Showing 100 of 122");
});

it("counts every task in the status headings and says when the board is cut", async () => {
  const html = await get("/console/tasks?project=");
  expect(html).toContain("todo (210)");
  expect(html).toContain("Showing 200 of 210");
});

it("pages alerts and memory with an Older link, and counts the claims it cuts", async () => {
  const alerts = await get("/console/alerts");
  expect(alerts).not.toContain("alert number 54.");
  const older = alerts.match(/href="(\/console\/alerts\?before=[^"]+)"/)?.[1] ?? "";
  expect(await get(older.replaceAll("&amp;", "&"))).toContain("alert number 54.");
  const memory = await get("/console/memory?status=all");
  expect(memory).not.toContain("memory number 54.");
  const next = memory.match(/href="(\/console\/memory\?status=all&amp;before=[^"]+)"/)?.[1] ?? "";
  expect(await get(next.replaceAll("&amp;", "&"))).toContain("memory number 54.");
  expect(await get("/console/claims")).toContain("Showing 200 of 210");
});

it("counts every open alert on the dashboard and lists five of them", async () => {
  const html = await get("/console");
  expect(html).toContain("Review alerts (55)");
  expect(html.split('class="excerpt"')).toHaveLength(6);
});

it("shows a guest their own agents on the dashboard however many the team runs", async () => {
  await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.sam.userId));
  const html = await get("/console", team.sam.cookie);
  expect(html.slice(html.indexOf('id="presence-h"'), html.indexOf('id="todo-h"'))).toContain("Sam");
});
