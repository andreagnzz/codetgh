import type { Role } from "@codetgh/shared";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { Db } from "./db/index.js";
import { membership, personalToken, type TeamSettings, team, user } from "./db/schema.js";
import { HubError } from "./errors.js";
import { hashToken } from "./tokens.js";

export type Principal = {
  user: { id: string; name: string; email: string };
  teamId: string;
  teamName: string;
  settings: TeamSettings;
  paused: boolean;
  // The member's own pause (codetgh pause), unlike `paused`, which is the team's kill switch.
  agentsPaused: boolean;
  membershipId: string;
  role: Role;
  handle: string;
  tokenId: string | null;
  auth: "personal_token" | "oauth" | "console";
};

const columns = {
  user: { id: user.id, name: user.name, email: user.email },
  teamId: team.id,
  teamName: team.name,
  settings: team.settings,
  killSwitchAt: team.killSwitchAt,
  membershipId: membership.id,
  role: membership.role,
  handle: membership.handle,
  agentsPausedAt: membership.agentsPausedAt,
};

type Row = {
  user: Principal["user"];
  teamId: string;
  teamName: string;
  settings: TeamSettings;
  killSwitchAt: Date | null;
  membershipId: string;
  role: Role;
  handle: string;
  agentsPausedAt: Date | null;
};
const toPrincipal = ({ killSwitchAt, agentsPausedAt, ...r }: Row, tokenId: string | null, auth: Principal["auth"]): Principal => ({
  ...r,
  paused: killSwitchAt !== null,
  agentsPaused: agentsPausedAt !== null,
  tokenId,
  auth,
});

// One indexed query per request and no cache: a revoked member or a kill switch takes effect on the next call.
// An A2A token opens /a2a only, and a member's token never opens /a2a.
export async function principalForToken(db: Db, token: string, surface: "member" | "a2a" = "member") {
  const [row] = await db
    .select({ ...columns, tokenId: personalToken.id })
    .from(personalToken)
    .innerJoin(
      membership,
      and(eq(membership.userId, personalToken.userId), eq(membership.teamId, personalToken.teamId), eq(membership.status, "active")),
    )
    .innerJoin(user, eq(user.id, personalToken.userId))
    .innerJoin(team, eq(team.id, personalToken.teamId))
    .where(
      and(
        eq(personalToken.hash, hashToken(token)),
        isNull(personalToken.revokedAt),
        gt(personalToken.expiresAt, new Date()),
        surface === "a2a" ? eq(personalToken.kind, "a2a") : ne(personalToken.kind, "a2a"),
      ),
    );
  return row ? toPrincipal(row, row.tokenId, "personal_token") : null;
}

export async function principalForUser(db: Db, userId: string, auth: "oauth" | "console") {
  const rows = await db
    .select(columns)
    .from(membership)
    .innerJoin(user, eq(user.id, membership.userId))
    .innerJoin(team, eq(team.id, membership.teamId))
    .where(and(eq(membership.userId, userId), eq(membership.status, "active")));
  if (rows.length > 1) throw new HubError("E_FORBIDDEN", "You belong to several teams: use a personal token created for one team.");
  const [row] = rows;
  return row ? toPrincipal(row, null, auth) : null;
}
