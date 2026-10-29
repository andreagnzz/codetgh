import type { Role } from "@codetgh/shared";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
import { INVITE_HEADER } from "../src/auth.js";
import { membership, personalToken, user } from "../src/db/schema.js";
import { createInvitation, createTeam, joinWithInvitation, revokeMember } from "../src/domain/teams.js";
import { createPersonalToken } from "../src/tokens.js";
import { type Hub, startHub } from "./harness.js";

// Someone who already has an account joins only by opening the invitation link and clicking Join, with the invited email verified.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let nora: { id: string; cookie: string };
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  // Nora has an account and no active team: she left another team.
  const other = await createTeam(hub.db, "Other team");
  const { token } = await invite(other, "nora@other.test", "member");
  const { user: u } = await hub.auth.api.signUpEmail({
    body: { name: "Nora", email: "nora@other.test", password: "nora-password-123" },
    headers: new Headers({ [INVITE_HEADER]: token }),
  });
  await revoke(other, u.id);
  nora = { id: u.id, cookie: await signIn("nora@other.test", "nora-password-123") };
});
afterAll(() => hub.stop());

function invite(teamId: string, email: string, role: Role) {
  return createInvitation(hub.db, { teamId, email, role, invitedBy: null, via: "system" });
}
async function signIn(email: string, password: string) {
  const res = await hub.auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return res.headers
    .getSetCookie()
    .map((c: string) => c.split(";")[0])
    .join("; ");
}
async function revoke(teamId: string, userId: string) {
  const [m] = await hub.db
    .select()
    .from(membership)
    .where(and(eq(membership.teamId, teamId), eq(membership.userId, userId)));
  await revokeMember(hub.db, { teamId, membershipId: m?.id ?? "", actorUserId: team.lea.userId, actorRole: "owner" });
}
const verified = (userId: string, emailVerified: boolean) => hub.db.update(user).set({ emailVerified }).where(eq(user.id, userId));
const inTeam = async (userId: string) =>
  (
    await hub.db
      .select()
      .from(membership)
      .where(and(eq(membership.teamId, team.teamId), eq(membership.userId, userId)))
  )[0];
// The CSRF token belongs to the session; `pageOf` names the invitation page it is read from.
async function join(token: string, cookie: string, pageOf = token) {
  const page = await (await fetch(`${hub.url}/invite/${pageOf}`, { headers: { cookie } })).text();
  const csrf = page.match(/name="csrf" value="([^"]+)"/)?.[1] ?? "";
  return fetch(`${hub.url}/invite/${token}/join`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrf }).toString(),
  });
}

it("shows a team name with $ in it as typed, never read as a replacement pattern", async () => {
  const { token } = await invite(await createTeam(hub.db, "R$'D"), "rd@acme.test", "member");
  const html = await (await fetch(`${hub.url}/invite/${token}`, { headers: { cookie: nora.cookie } })).text();
  expect(html).toContain("<title>Join R$&#39;D · CodeTgh</title>");
  expect(html).toContain(">Join R$&#39;D<");
  expect(html).not.toContain("on CodeTghD");
});

it("joins nothing at sign-in alone, even with a pending invitation for that email", async () => {
  await verified(nora.id, true);
  await invite(team.teamId, "nora@other.test", "member");
  await signIn("nora@other.test", "nora-password-123");
  expect(await inTeam(nora.id)).toBeUndefined();
});

it("refuses a join without the CSRF token, for another email, or with an unverified email", async () => {
  const { token } = await invite(team.teamId, "nora@other.test", "member");
  const forged = await fetch(`${hub.url}/invite/${token}/join`, {
    method: "POST",
    headers: { cookie: nora.cookie, "content-type": "application/x-www-form-urlencoded" },
    body: "csrf=forged",
  });
  expect(forged.status).toBe(403);
  const other = await invite(team.teamId, "someone@else.test", "member");
  // Its page offers no Join to another address, so the CSRF token comes from her own invitation's page: the hub's rule refuses.
  const another = await join(other.token, nora.cookie, token);
  expect(another.status).toBe(403);
  expect(await another.text()).toContain("This invitation is for another email address.");
  await verified(nora.id, false);
  const unverified = await join(token, nora.cookie);
  expect(unverified.status).toBe(403);
  expect(await unverified.text()).toContain("verif");
  expect(await inTeam(nora.id)).toBeUndefined();
  await verified(nora.id, true);
});

it("joins with the invited role on Join, and never twice with the same link", async () => {
  const { token } = await invite(team.teamId, "nora@other.test", "admin");
  const res = await join(token, nora.cookie);
  expect(res.status).toBe(303);
  expect(await inTeam(nora.id)).toMatchObject({ status: "active", role: "admin" });
  // Revoking ends her sessions: she signs in again and tries the used link.
  await revoke(team.teamId, nora.id);
  nora.cookie = await signIn("nora@other.test", "nora-password-123");
  const pending = await invite(team.teamId, "nora@other.test", "member");
  expect((await join(token, nora.cookie, pending.token)).status).toBe(404);
  expect((await inTeam(nora.id))?.status).toBe("revoked");
});

it("brings a revoked member back only with an invitation sent after the removal, with the invited role", async () => {
  await verified(team.sam.userId, true);
  const before = await invite(team.teamId, team.sam.email, "admin");
  await new Promise((r) => setTimeout(r, 10));
  await revoke(team.teamId, team.sam.userId);
  const sam = await signIn(team.sam.email, team.sam.password);
  expect((await join(before.token, sam)).status).toBe(403);
  expect((await inTeam(team.sam.userId))?.status).toBe("revoked");
  const fresh = await invite(team.teamId, team.sam.email, "guest");
  expect((await join(fresh.token, sam)).status).toBe(303);
  expect(await inTeam(team.sam.userId)).toMatchObject({ status: "active", role: "guest", revokedAt: null });
});

it("gives the next free handle when another sign-up takes the same one between the read and the insert", async () => {
  // The trigger plays a second Alex whose sign-up commits @alex just before this one inserts it.
  await hub.db.insert(user).values({ id: "usr_race", name: "Alex", email: "alex.one@acme.test" });
  await hub.db.execute(
    sql.raw(`create or replace function race_alex() returns trigger language plpgsql as $$ begin
      insert into membership (id, team_id, user_id, role, handle) values ('mem_race', new.team_id, 'usr_race', 'member', new.handle);
      return new; end $$`),
  );
  await hub.db.execute(
    sql.raw(`create trigger race_alex before insert on membership for each row
      when (new.handle = 'alex' and new.id <> 'mem_race') execute function race_alex()`),
  );
  try {
    const { token } = await invite(team.teamId, "alex.two@acme.test", "member");
    const { user: alex } = await hub.auth.api.signUpEmail({
      body: { name: "Alex", email: "alex.two@acme.test", password: "alex-password-123" },
      headers: new Headers({ [INVITE_HEADER]: token }),
    });
    expect(await inTeam("usr_race")).toMatchObject({ handle: "alex" });
    expect(await inTeam(alex.id)).toMatchObject({ status: "active", handle: "alex-2" });
  } finally {
    await hub.db.execute(sql.raw("drop trigger if exists race_alex on membership"));
    await hub.db.execute(sql.raw("drop function if exists race_alex"));
  }
});

describe("an invitation is honoured only while its author may still grant its role, and its token is valid", () => {
  // One link for Nora, who has an account, and one for a newcomer who signs up, from the same author.
  async function links(newcomer: string, invitedBy: string, role: Role, invitedByToken?: string) {
    const make = (email: string) =>
      createInvitation(hub.db, { teamId: team.teamId, email, role, invitedBy, invitedByToken, via: "console" });
    return { nora: (await make("nora@other.test")).token, newcomer, token: (await make(newcomer)).token };
  }
  // Refused as an unknown link is, on each way in: the invitation page, Join, and a sign-up through the link.
  async function expectRefused(l: Awaited<ReturnType<typeof links>>) {
    expect(await (await fetch(`${hub.url}/invite/${l.nora}`)).text()).not.toContain("invite-signup");
    await expect(
      joinWithInvitation(hub.db, { id: nora.id, name: "Nora", email: "nora@other.test", emailVerified: true }, l.nora),
    ).rejects.toMatchObject({ code: "E_NOT_FOUND" });
    await expect(
      hub.auth.api.signUpEmail({
        body: { name: "Newcomer", email: l.newcomer, password: "newcomer-password-123" },
        headers: new Headers({ [INVITE_HEADER]: l.token }),
      }),
    ).rejects.toThrow();
    expect((await inTeam(nora.id))?.status).toBe("revoked");
  }
  const changeRole = async (userId: string, role: Role) =>
    expect(
      (await consolePost(hub.url, team.lea.cookie, `/console/members/${(await inTeam(userId))?.id}/role`, { role })).status,
    ).toBeLessThan(400);

  // The role-change cleanup has run when a request that read the author's old role commits its invitation.
  it("refuses an owner invitation committed after its author went from owner to admin", async () => {
    await hub.db.update(membership).set({ role: "owner" }).where(eq(membership.userId, team.malik.userId));
    await changeRole(team.malik.userId, "admin");
    await expectRefused(await links("owner-by-admin@new.test", team.malik.userId, "owner"));
  });

  it("refuses an invitation committed after its author went from admin to member", async () => {
    await changeRole(team.malik.userId, "member");
    await expectRefused(await links("by-member@new.test", team.malik.userId, "member"));
  });

  it("refuses an invitation whose token has expired since, though nothing revoked it", async () => {
    const { id } = await createPersonalToken(hub.db, { userId: team.lea.userId, teamId: team.teamId, label: "short" });
    const l = await links("by-expired-token@new.test", team.lea.userId, "member", id);
    await hub.db
      .update(personalToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(personalToken.id, id));
    await expectRefused(l);
  });

  it("still takes an owner's invitation made with a valid token, by Join and by sign-up", async () => {
    const { id } = await createPersonalToken(hub.db, { userId: team.lea.userId, teamId: team.teamId, label: "valid" });
    const l = await links("welcome@new.test", team.lea.userId, "member", id);
    expect((await join(l.nora, nora.cookie)).status).toBe(303);
    expect(await inTeam(nora.id)).toMatchObject({ status: "active", role: "member" });
    const { user: u } = await hub.auth.api.signUpEmail({
      body: { name: "Welcome", email: l.newcomer, password: "welcome-password-123" },
      headers: new Headers({ [INVITE_HEADER]: l.token }),
    });
    expect(await inTeam(u.id)).toMatchObject({ status: "active", role: "member" });
  });
});
