import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, invitation, membership, team as teamTable, user } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { consolePost, githubBridge } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const linkOf = (html: string) => html.match(/https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/)?.[0] ?? "";
const days = (d: Date) => Math.round((d.getTime() - Date.now()) / 86_400_000);

describe("invitations", () => {
  it("lets an admin choose how long an invitation lasts, from 1 to 30 days", async () => {
    const html = await (
      await consolePost(hub.url, team.lea.cookie, "/console/members/invite", { email: "nina@acme.test", role: "member", days: "2" })
    ).text();
    expect(html).toContain("valid for 2\u00a0days");
    const [inv] = await hub.db.select().from(invitation).where(eq(invitation.email, "nina@acme.test"));
    expect(days(inv?.expiresAt ?? new Date())).toBe(2);
    const res = await consolePost(hub.url, team.lea.cookie, "/console/members/invite", {
      email: "x@acme.test",
      role: "member",
      days: "90",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("An invitation lasts 1 to 30\u00a0days. Enter a number of days in that range.");
  });

  it("revokes a pending invitation: its link stops working at once", async () => {
    const link = linkOf(
      await (await consolePost(hub.url, team.lea.cookie, "/console/members/invite", { email: "omar@acme.test", role: "member" })).text(),
    );
    const [inv] = await hub.db.select().from(invitation).where(eq(invitation.email, "omar@acme.test"));
    expect((await consolePost(hub.url, team.sam.cookie, `/console/invitations/${inv?.id}/revoke`)).status).toBe(403);
    expect((await consolePost(hub.url, team.lea.cookie, `/console/invitations/${inv?.id}/revoke`)).status).toBe(204);
    expect(await (await fetch(link)).text()).toContain("no longer valid");
    expect(await (await fetch(`${hub.url}/console/members`, { headers: { cookie: team.lea.cookie } })).text()).not.toContain(
      "omar@acme.test",
    );
  });
});

describe("members", () => {
  it("lets an admin change a member's handle, refusing duplicates and reserved names", async () => {
    const [sam] = await hub.db.select().from(membership).where(eq(membership.userId, team.sam.userId));
    const path = `/console/members/${sam?.id}/handle`;
    expect((await consolePost(hub.url, team.lea.cookie, path, { handle: "lea" })).status).toBe(400);
    expect((await consolePost(hub.url, team.lea.cookie, path, { handle: "bridge-github" })).status).toBe(400);
    expect((await consolePost(hub.url, team.lea.cookie, path, { handle: "Not Valid!" })).status).toBe(400);
    expect((await consolePost(hub.url, team.sam.cookie, path, { handle: "samuel" })).status).toBe(403);
    expect((await consolePost(hub.url, team.lea.cookie, path, { handle: "samuel" })).status).toBe(204);
    const [after] = await hub.db
      .select()
      .from(membership)
      .where(eq(membership.id, sam?.id ?? ""));
    expect(after?.handle).toBe("samuel");
  });

  it("keeps an owner's handle from an admin, who could otherwise take it and receive the owner's messages", async () => {
    await hub.db.update(membership).set({ role: "admin" }).where(eq(membership.userId, team.sam.userId));
    const [lea] = await hub.db.select().from(membership).where(eq(membership.userId, team.lea.userId));
    const path = `/console/members/${lea?.id}/handle`;
    expect((await consolePost(hub.url, team.sam.cookie, path, { handle: "lea-old" })).status).toBe(403);
    const [after] = await hub.db
      .select()
      .from(membership)
      .where(eq(membership.id, lea?.id ?? ""));
    expect(after?.handle).toBe("lea");
    const page = await (await fetch(`${hub.url}/console/members`, { headers: { cookie: team.sam.cookie } })).text();
    expect(page).not.toContain(`hx-post="${path}"`);
    expect(await (await fetch(`${hub.url}/console/members`, { headers: { cookie: team.lea.cookie } })).text()).toContain(
      `hx-post="${path}"`,
    );
    await hub.db.update(membership).set({ role: "member" }).where(eq(membership.userId, team.sam.userId));
  });

  it("moves the loop orchestrator setting along when its member gets a new handle", async () => {
    await hub.db
      .update(teamTable)
      .set({ settings: { loop_orchestrator: "malik" } })
      .where(eq(teamTable.id, team.teamId));
    const [malik] = await hub.db.select().from(membership).where(eq(membership.userId, team.malik.userId));
    expect((await consolePost(hub.url, team.lea.cookie, `/console/members/${malik?.id}/handle`, { handle: "malika" })).status).toBe(204);
    const [t] = await hub.db.select({ s: teamTable.settings }).from(teamTable).where(eq(teamTable.id, team.teamId));
    expect(t?.s.loop_orchestrator).toBe("malika");
    await hub.db.update(teamTable).set({ settings: {} }).where(eq(teamTable.id, team.teamId));
  });

  it("refuses to revoke a bridge member, so the GitHub webhook keeps working", async () => {
    const github = await githubBridge(hub.url, team.lea.cookie);
    const deliver = () =>
      github.deliver(
        JSON.stringify({
          action: "opened",
          repository: { full_name: "acme/webapp", html_url: "https://github.com/acme/webapp" },
          sender: { login: "octocat" },
          pull_request: {
            number: 9,
            title: "Add pages",
            html_url: "https://github.com/acme/webapp/pull/9",
            merged: false,
            head: { ref: "feat/p", sha: "abc1234" },
          },
        }),
      );
    expect((await deliver()).status).toBe(202);
    const [bridge] = await hub.db.select().from(membership).where(eq(membership.handle, "bridge-github"));
    expect((await consolePost(hub.url, team.lea.cookie, `/console/members/${bridge?.id}/revoke`)).status).toBe(403);
    expect((await deliver()).status).toBe(202);
    const [after] = await hub.db
      .select()
      .from(membership)
      .where(eq(membership.id, bridge?.id ?? ""));
    expect(after?.status).toBe("active");
  });

  it("revokes an a2a member, so an admin can cut an external agent whose token leaked", async () => {
    const created = await (await consolePost(hub.url, team.lea.cookie, "/console/agents/a2a", { name: "Leaky bot" })).text();
    const token = created.match(/ctgh_[A-Za-z0-9_-]+/)?.[0] ?? "";
    const [bot] = await hub.db.select().from(agent).where(eq(agent.label, "Leaky bot"));
    const [m] = await hub.db
      .select()
      .from(membership)
      .where(eq(membership.userId, bot?.userId ?? ""));
    const send = () => fetch(`${hub.url}/a2a`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{}" });
    expect((await send()).status).not.toBe(401);
    expect((await consolePost(hub.url, team.lea.cookie, `/console/members/${m?.id}/revoke`)).status).toBe(204);
    expect((await send()).status).toBe(401);
    const [after] = await hub.db
      .select()
      .from(membership)
      .where(eq(membership.id, m?.id ?? ""));
    expect(after?.status).toBe("revoked");
  });

  it("lets anyone change their own display name", async () => {
    expect((await consolePost(hub.url, team.malik.cookie, "/console/me/profile", { name: "Malik B." })).status).toBe(204);
    const [m] = await hub.db.select().from(user).where(eq(user.id, team.malik.userId));
    expect(m?.name).toBe("Malik B.");
    expect((await consolePost(hub.url, team.malik.cookie, "/console/me/profile", { name: "" })).status).toBe(400);
  });

  it("ends a member's console stream when their role changes, so a demoted admin stops getting everyone's activity", async () => {
    await hub.db.update(membership).set({ role: "admin" }).where(eq(membership.userId, team.sam.userId));
    const stream = await fetch(`${hub.url}/console/stream`, { headers: { cookie: team.sam.cookie } });
    expect(stream.status).toBe(200);
    const reader = stream.body?.getReader();
    const closed = (async () => {
      while (reader && !(await reader.read()).done);
    })();
    const [sam] = await hub.db.select().from(membership).where(eq(membership.userId, team.sam.userId));
    const started = Date.now();
    expect((await consolePost(hub.url, team.lea.cookie, `/console/members/${sam?.id}/role`, { role: "member" })).status).toBe(204);
    await closed;
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("team", () => {
  it("lets an admin rename the team", async () => {
    expect((await consolePost(hub.url, team.sam.cookie, "/console/settings/team", { name: "Nope" })).status).toBe(403);
    expect((await consolePost(hub.url, team.lea.cookie, "/console/settings/team", { name: "Acme platform" })).status).toBe(204);
    const [t] = await hub.db.select().from(teamTable).where(eq(teamTable.id, team.teamId));
    expect(t?.name).toBe("Acme platform");
  });
});
