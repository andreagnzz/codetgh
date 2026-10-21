import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { agent, membership, project } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { gitRepo, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

// Seen in production: a session started in the home folder registered with no project and never showed under one.
const home = () => mkdtempSync(join(tmpdir(), "codetgh-home-"));
const row = async (session: string) => (await hub.db.select().from(agent).where(eq(agent.sessionId, session)))[0];
const projectsOf = (origin: string) =>
  hub.db
    .select()
    .from(project)
    .where(eq(project.repoFingerprint, repoFingerprint(origin)));
const line = (r: Awaited<ReturnType<typeof runHook>>) => String((r.out as { systemMessage?: string } | null)?.systemMessage ?? "");

it("links a session started outside a repository once it moves into one, and keeps it there", async () => {
  const env = hookEnv(hub.url, team.sam.token);
  const start = home();
  await runHook("session-start", { session_id: "sam-home", source: "startup", cwd: start }, env);
  expect((await row("sam-home"))?.projectId).toBeNull();

  const repo = gitRepo("git@github.com:acme/cwd-link.git");
  const r = await runHook("cwd-changed", { session_id: "sam-home", cwd: repo, old_cwd: start, new_cwd: repo }, env);
  expect(line(r)).toBe("CodeTgh: this session is now on cwd-link");
  const [prj] = await projectsOf("git@github.com:acme/cwd-link.git");
  expect((await row("sam-home"))?.projectId).toBe(prj?.id);

  // A session belongs to one project: entering another repository does not move it.
  const other = gitRepo("git@github.com:acme/cwd-other.git");
  const again = await runHook("cwd-changed", { session_id: "sam-home", cwd: other, old_cwd: repo, new_cwd: other }, env);
  expect(again.out).toBeNull();
  expect((await row("sam-home"))?.projectId).toBe(prj?.id);
  expect(await projectsOf("git@github.com:acme/cwd-other.git")).toHaveLength(0);
});

it("links a session from a directory added with /add-dir", async () => {
  const env = hookEnv(hub.url, team.sam.token);
  const start = home();
  await runHook("session-start", { session_id: "sam-add-dir", source: "startup", cwd: start }, env);
  const repo = gitRepo("git@github.com:acme/webapp.git");
  const r = await runHook("cwd-changed", { session_id: "sam-add-dir", cwd: start, directory: repo, source: "slash_command" }, env);
  expect(line(r)).toMatch(/^CodeTgh: this session is now on /);
  expect((await row("sam-add-dir"))?.projectId).not.toBeNull();
});

it("does nothing when the new directory is not a repository", async () => {
  const env = hookEnv(hub.url, team.sam.token);
  const start = home();
  await runHook("session-start", { session_id: "sam-home-2", source: "startup", cwd: start }, env);
  const elsewhere = home();
  const r = await runHook("cwd-changed", { session_id: "sam-home-2", cwd: elsewhere, old_cwd: start, new_cwd: elsewhere }, env);
  expect(r.out).toBeNull();
  expect((await row("sam-home-2"))?.projectId).toBeNull();
});

it("does not link a guest's session to a repository nobody linked, and says to ask an admin", async () => {
  const env = hookEnv(hub.url, team.malik.token);
  await hub.db.update(membership).set({ role: "guest" }).where(eq(membership.userId, team.malik.userId));
  const start = home();
  await runHook("session-start", { session_id: "malik-home", source: "startup", cwd: start }, env);
  const repo = gitRepo("git@github.com:client-under-nda/cwd-app.git");
  const r = await runHook("cwd-changed", { session_id: "malik-home", cwd: repo, old_cwd: start, new_cwd: repo }, env);
  await hub.db.update(membership).set({ role: "member" }).where(eq(membership.userId, team.malik.userId));
  expect(line(r)).toMatch(/not a team project yet/);
  expect(await projectsOf("git@github.com:client-under-nda/cwd-app.git")).toHaveLength(0);
  expect((await row("malik-home"))?.projectId).toBeNull();
});
