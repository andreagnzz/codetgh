import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invitation, membership, team as teamTable, user } from "../apps/hub/src/db/schema.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

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
    expect(html).toContain("valid 2 days");
    const [inv] = await hub.db.select().from(invitation).where(eq(invitation.email, "nina@acme.test"));
    expect(days(inv?.expiresAt ?? new Date())).toBe(2);
    const res = await consolePost(hub.url, team.lea.cookie, "/console/members/invite", {
      email: "x@acme.test",
      role: "member",
      days: "90",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("between 1 and 30 days");
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

  it("lets anyone change their own display name", async () => {
    expect((await consolePost(hub.url, team.malik.cookie, "/console/me/profile", { name: "Malik B." })).status).toBe(204);
    const [m] = await hub.db.select().from(user).where(eq(user.id, team.malik.userId));
    expect(m?.name).toBe("Malik B.");
    expect((await consolePost(hub.url, team.malik.cookie, "/console/me/profile", { name: "" })).status).toBe(400);
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
