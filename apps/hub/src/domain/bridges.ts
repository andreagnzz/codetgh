import { and, eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { agent, membership, thread, user } from "../db/schema.js";
import { newId } from "../ids.js";
import { principalForUser } from "../principal.js";

// Each bridge speaks in a team as one system member with one agent of kind "bridge", created on first use.
export async function bridgeAuthor(db: Db, teamId: string, name: "GitHub" | "Slack") {
  const handle = `bridge-${name.toLowerCase()}`;
  let [m] = await db
    .select({ userId: membership.userId })
    .from(membership)
    .where(and(eq(membership.teamId, teamId), eq(membership.handle, handle)));
  if (!m) {
    const userId = newId("usr");
    await db.transaction(async (tx) => {
      await tx.insert(user).values({ id: userId, name, email: `${handle}-${teamId}@agents.invalid`, emailVerified: false });
      await tx.insert(membership).values({ id: newId("mem"), teamId, userId, role: "member", handle });
      await tx.insert(agent).values({ id: newId("agt"), teamId, userId, sessionId: handle, kind: "bridge", label: name });
    });
    m = { userId };
  }
  const [a] = await db
    .select()
    .from(agent)
    .where(and(eq(agent.teamId, teamId), eq(agent.userId, m.userId), eq(agent.kind, "bridge")));
  if (!a) throw new Error(`bridge agent missing for ${handle}`);
  const p = await principalForUser(db, m.userId, "console");
  if (!p) throw new Error(`bridge member missing for ${handle}`);
  return { p, agent: a };
}

// The thread a bridge posts a project's events to: the first one it opened for that project.
export async function projectThread(db: Db, teamId: string, projectId: string, bridgeUserId: string) {
  const [t] = await db
    .select({ id: thread.id })
    .from(thread)
    .where(and(eq(thread.teamId, teamId), eq(thread.projectId, projectId), eq(thread.createdByUser, bridgeUserId)))
    .limit(1);
  return t?.id ?? null;
}
