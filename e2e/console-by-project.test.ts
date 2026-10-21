import { repoFingerprint } from "@codetgh/shared/repo";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { membership, message, project, receipt, task, team as teamTable, thread } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let acme: string;
let webapp: string;
const ids = { acmeThread: "", webThread: "", looseThread: "", acmeTask: "", webTask: "", looseTask: "" };
let leaContext = "";

beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  const ofName = async (name: string) => (await hub.db.select().from(project).where(eq(project.name, name)))[0]?.id ?? "";
  acme = await ofName("acme");
  webapp = await ofName("acme/webapp");
  await startSession(hub.url, team.malik.token, "malik-acme", { repo: ACME_REPO, branch: "feat/acme" });
  await startSession(hub.url, team.sam.token, "sam-web", {
    repo: repoFingerprint("git@github.com:acme/webapp.git"),
    branch: "feat/web",
  });
  await startSession(hub.url, team.malik.token, "malik-loose", { branch: "spike" });
  leaContext = (await startSession(hub.url, team.lea.token, "lea-acme", { repo: ACME_REPO, branch: "main" })).context ?? "";
  const lea = await mcpClient(hub.url, team.lea.token);
  const sam = await mcpClient(hub.url, team.sam.token);
  const malik = await mcpClient(hub.url, team.malik.token);
  const send = async (c: typeof lea, subject: string) =>
    JSON.parse((await call(c, "send_message", { to: "@team", kind: "note", subject, body: "b" })).text).thread as string;
  ids.acmeThread = await send(lea, "acme plan");
  ids.webThread = await send(sam, "web plan");
  ids.looseThread = await send(malik, "loose plan");
  const create = async (c: typeof lea, title: string) => JSON.parse((await call(c, "task_create", { title })).text).id as string;
  ids.acmeTask = await create(lea, "Acme task");
  ids.webTask = await create(sam, "Web task");
  ids.looseTask = await create(malik, "Loose task");
});
afterAll(() => hub.stop());

const get = async (path: string, cookie = team.lea.cookie) => (await fetch(`${hub.url}${path}`, { headers: { cookie } })).text();
const section = (html: string, id: string) => {
  const start = html.indexOf(`id="p-${id}"`);
  return start < 0 ? "" : html.slice(start, html.indexOf("</section>", start));
};

describe("console: one project at a time", () => {
  it("filters threads, tasks and sessions with ?project=", async () => {
    let html = await get(`/console/threads?project=${acme}`);
    expect(html).toContain(ids.acmeThread);
    expect(html).not.toContain(ids.webThread);
    expect(html).not.toContain(ids.looseThread);
    html = await get("/console/threads?project=none");
    expect(html).toContain(ids.looseThread);
    expect(html).not.toContain(ids.acmeThread);

    html = await get(`/console/tasks?project=${webapp}`);
    expect(html).toContain("Web task");
    expect(html).not.toContain("Acme task");
    expect(html).not.toContain("Loose task");

    html = await get(`/console/projects?project=${webapp}`);
    expect(html).toContain("sam@feat/web");
    expect(html).not.toContain("malik@feat/acme");
    expect(html).not.toContain("malik@spike");
  });

  it("groups everything under a project heading when all projects are shown, outside a project last", async () => {
    for (const [path, acmeItem, webItem, looseItem] of [
      ["/console/threads", ids.acmeThread, ids.webThread, ids.looseThread],
      ["/console/tasks", "Acme task", "Web task", "Loose task"],
      ["/console/projects", "malik@feat/acme", "sam@feat/web", "malik@spike"],
    ]) {
      const html = await get(path ?? "");
      expect(section(html, acme), path).toContain(acmeItem);
      expect(section(html, acme), path).not.toContain(webItem);
      expect(section(html, webapp), path).toContain(webItem);
      expect(section(html, "none"), path).toContain(looseItem);
      expect(html.indexOf('id="p-none"'), path).toBeGreaterThan(html.indexOf(`id="p-${webapp}"`));
    }
  });

  it("shows the filter with the team's projects, and keeps it in the links between pages", async () => {
    const html = await get(`/console/threads?project=${acme}`);
    expect(html).toContain("All projects");
    expect(html).toContain("acme/webapp");
    expect(html).toContain(`href="/console/tasks?project=${acme}"`);
    expect(html).toContain(`href="/console/threads?archived=1&amp;project=${acme}"`);
    expect(await get(`/console/threads?project=${acme}`, `${team.lea.cookie}; lang=fr`)).toContain("Tous les projets");
  });

  it("ignores an unknown or another team's project id", async () => {
    await hub.db.insert(teamTable).values({ id: "team_other", name: "Other", slug: "other" });
    await hub.db
      .insert(project)
      .values({ id: "prj_other", teamId: "team_other", name: "other/secret", repoFingerprint: repoFingerprint("git@x:o/s.git") });
    for (const id of ["prj_nope", "prj_other", "%3Cscript%3E"]) {
      const res = await fetch(`${hub.url}/console/threads?project=${id}`, { headers: { cookie: team.lea.cookie } });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain(ids.acmeThread);
      expect(html).toContain(ids.webThread);
      expect(html).not.toContain("other/secret");
      expect(html).not.toContain("<script>");
    }
  });

  it("combines with the archive tabs", async () => {
    const msgs = await hub.db.select({ id: message.id }).from(message).where(eq(message.threadId, ids.acmeThread));
    await hub.db
      .update(receipt)
      .set({ readAt: new Date() })
      .where(
        inArray(
          receipt.messageId,
          msgs.map((m) => m.id),
        ),
      );
    await hub.db
      .update(thread)
      .set({ lastMessageAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(thread.id, ids.acmeThread));
    await hub.db
      .update(task)
      .set({ status: "done", updatedAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(task.id, ids.acmeTask));

    expect(await get(`/console/threads?project=${acme}`)).not.toContain(ids.acmeThread);
    expect(await get(`/console/threads?archived=1&project=${acme}`)).toContain(ids.acmeThread);
    expect(await get(`/console/threads?archived=1&project=${webapp}`)).not.toContain(ids.acmeThread);
    expect(await get(`/console/tasks?project=${acme}`)).not.toContain("Acme task");
    expect(await get(`/console/tasks?archived=1&project=${acme}`)).toContain("Acme task");
    expect(await get(`/console/tasks?archived=1&project=${webapp}`)).not.toContain("Acme task");
  });

  it("gives a guest nothing more with the filter", async () => {
    await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.malik.userId));
    const res = await fetch(`${hub.url}/console/tasks?project=${acme}`, { headers: { cookie: team.malik.cookie } });
    expect(res.status).toBe(403);
    await hub.db.update(membership).set({ role: "member" }).where(eq(membership.userId, team.malik.userId));
  });
});

describe("MCP: who is on which project", () => {
  it("names each agent's project in team_overview, the caller's project first", async () => {
    const lea = await mcpClient(hub.url, team.lea.token);
    const ov = JSON.parse((await call(lea, "team_overview", { scope: "team" })).text);
    expect(ov.team_activity).toContain("acme/webapp");
    expect(ov.team_activity).toMatch(/@malik: [^\n]*· acme ·/);
    const first = ov.team_activity.split("\n").find((l: string) => l.startsWith("@"));
    expect(first).toContain("feat/acme");
  });

  it("names each online agent's project at session start, the session's project first", () => {
    const online = leaContext.split("\n").find((l) => l.startsWith("Online:")) ?? "";
    expect(online).toContain("acme/webapp");
    expect(online.indexOf("feat/acme")).toBeGreaterThan(-1);
    expect(online.indexOf("feat/acme")).toBeLessThan(online.indexOf("feat/web"));
  });
});
