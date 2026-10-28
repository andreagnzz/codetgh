import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
import { invitation, membership, team as teamTable } from "../src/db/schema.js";
import { revokeMember } from "../src/domain/teams.js";
import { createPersonalToken } from "../src/tokens.js";
import { auth, type Hub, startHub } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const post = (path: string, token: string, body: unknown) =>
  fetch(`${hub.url}${path}`, { method: "POST", headers: auth(token), body: JSON.stringify(body) });
const pending = (email: string) =>
  hub.db
    .select()
    .from(invitation)
    .where(and(eq(invitation.email, email), isNull(invitation.revokedAt)));

describe("a personal token invites members and guests only", () => {
  it.each(["admin", "owner"])("refuses the %s role from an owner's token and creates nothing", async (role) => {
    const res = await post("/v1/invitations", team.lea.token, { email: `${role}@evil.test`, role });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("E_FORBIDDEN");
    expect(await pending(`${role}@evil.test`)).toEqual([]);
  });

  it.each(["member", "guest"])("accepts the %s role from an owner's token", async (role) => {
    const res = await post("/v1/invitations", team.lea.token, { email: `${role}@ok.test`, role });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { link: string }).link).toContain("/invite/");
  });

  it("still lets a console session invite an admin", async () => {
    const res = await consolePost(hub.url, team.lea.cookie, "/console/members/invite", { email: "ada@acme.test", role: "admin" });
    expect(res.status).toBeLessThan(400);
    expect(await pending("ada@acme.test")).toMatchObject([{ role: "admin" }]);
  });

  it("does not let a token revoke an admin invitation, but revokes a member one", async () => {
    const res = await post("/v1/invitations/revoke", team.lea.token, { email: "ada@acme.test" });
    expect(res.status).toBe(403);
    expect(await pending("ada@acme.test")).toHaveLength(1);
    expect((await post("/v1/invitations/revoke", team.lea.token, { email: "member@ok.test" })).status).toBe(200);
    expect(await pending("member@ok.test")).toEqual([]);
  });

  it("refuses a token invitation under the kill switch, and leaves the console usable", async () => {
    await hub.db.update(teamTable).set({ killSwitchAt: new Date() }).where(eq(teamTable.id, team.teamId));
    const res = await post("/v1/invitations", team.lea.token, { email: "late@ok.test", role: "member" });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("E_KILL_SWITCH");
    expect(await pending("late@ok.test")).toEqual([]);
    expect(
      (await consolePost(hub.url, team.lea.cookie, "/console/members/invite", { email: "late@ok.test", role: "member" })).status,
    ).toBeLessThan(400);
    await hub.db.update(teamTable).set({ killSwitchAt: null }).where(eq(teamTable.id, team.teamId));
  });
});

describe("a pending invitation ends with the admin rights or the token that made it", () => {
  const membershipOf = async (userId: string) =>
    (await hub.db.select({ id: membership.id }).from(membership).where(eq(membership.userId, userId)))[0]?.id ?? "";

  it("revokes the invitations a token made when that token is revoked, and keeps the others", async () => {
    const { id, token } = await createPersonalToken(hub.db, { userId: team.lea.userId, teamId: team.teamId, label: "spare" });
    expect((await post("/v1/invitations", token, { email: "spare@ok.test", role: "member" })).status).toBe(200);
    expect((await post("/v1/invitations", team.lea.token, { email: "kept@ok.test", role: "member" })).status).toBe(200);
    expect((await consolePost(hub.url, team.lea.cookie, `/console/tokens/${id}/revoke`)).status).toBeLessThan(400);
    expect(await pending("spare@ok.test")).toEqual([]);
    expect(await pending("kept@ok.test")).toHaveLength(1);
  });

  it("revokes an admin's invitations when they become a member, and when they are revoked", async () => {
    const malik = await membershipOf(team.malik.userId);
    await hub.db.update(membership).set({ role: "admin" }).where(eq(membership.id, malik));
    const invite = { email: "second-admin@evil.test", role: "admin" };
    expect((await consolePost(hub.url, team.malik.cookie, "/console/members/invite", invite)).status).toBeLessThan(400);
    expect(await pending(invite.email)).toHaveLength(1);
    expect((await consolePost(hub.url, team.lea.cookie, `/console/members/${malik}/role`, { role: "member" })).status).toBeLessThan(400);
    expect(await pending(invite.email)).toEqual([]);
    expect(await pending("kept@ok.test")).toHaveLength(1);

    await hub.db.update(membership).set({ role: "admin" }).where(eq(membership.id, malik));
    expect((await post("/v1/invitations", team.malik.token, { email: "later@evil.test", role: "member" })).status).toBe(200);
    await revokeMember(hub.db, { teamId: team.teamId, membershipId: malik, actorUserId: team.lea.userId, actorRole: "owner" });
    expect(await pending("later@evil.test")).toEqual([]);
  });
});
