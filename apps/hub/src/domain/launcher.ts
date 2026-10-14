import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { launchTarget, project } from "../db/schema.js";
import { HubError } from "../errors.js";
import type { Principal } from "../principal.js";
import { appendAudit } from "./audit.js";

// The bounded launcher: the owner only says "on" or "off" for a project. Which folder and which command run is decided
// by the launcher's own config on the owner's machine; the hub never sends a path or a command.
const requireOwner = (p: Principal) => {
  if (p.role !== "owner") throw new HubError("E_FORBIDDEN", "only the team owner controls the Remote Control launcher");
};

export async function setLaunchDesired(db: Db, p: Principal, projectId: string, on: boolean) {
  requireOwner(p);
  await db.transaction(async (tx) => {
    const [pr] = await tx
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, projectId), eq(project.teamId, p.teamId)));
    if (!pr) throw new HubError("E_NOT_FOUND", "project not found");
    const values = { desired: on, updatedBy: p.user.id, updatedAt: new Date() };
    await tx
      .insert(launchTarget)
      .values({ projectId, teamId: p.teamId, ...values })
      .onConflictDoUpdate({ target: launchTarget.projectId, set: values });
    await appendAudit(tx, {
      teamId: p.teamId,
      actorType: "user",
      actorUserId: p.user.id,
      via: "console",
      action: on ? "launcher.requested" : "launcher.stopped",
      subjectId: projectId,
    });
  });
}

export async function launcherTargets(db: Db, p: Principal) {
  requireOwner(p);
  const rows = await db
    .select({ projectId: launchTarget.projectId, name: project.name, desired: launchTarget.desired })
    .from(launchTarget)
    .innerJoin(project, eq(project.id, launchTarget.projectId))
    .where(eq(launchTarget.teamId, p.teamId));
  return { targets: rows.map((r) => ({ project_id: r.projectId, project_name: r.name, desired: r.desired })) };
}

export async function reportLaunch(db: Db, p: Principal, input: { project_id: string; running: boolean; error?: string }) {
  requireOwner(p);
  await db
    .update(launchTarget)
    .set({ running: input.running, reportedAt: new Date(), reportedError: input.error?.slice(0, 300) ?? null })
    .where(and(eq(launchTarget.projectId, input.project_id), eq(launchTarget.teamId, p.teamId)));
}

export async function launchStates(db: Db, teamId: string) {
  return db.select().from(launchTarget).where(eq(launchTarget.teamId, teamId));
}
