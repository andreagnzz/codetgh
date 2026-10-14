import { createHmac } from "node:crypto";
import { newKeyPair, publicKeyOf } from "@codetgh/shared/e2e";
import { repoFingerprint } from "@codetgh/shared/repo";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvent, memberKey, message } from "../apps/hub/src/db/schema.js";
import { updateSettings } from "../apps/hub/src/domain/admin.js";
import { eraseMe, exportMyData } from "../apps/hub/src/domain/privacy.js";
import { createTeam } from "../apps/hub/src/domain/teams.js";
import { principalForToken } from "../apps/hub/src/principal.js";
import { type Hub, startHub, startSession } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe("phase 3 security review fixes", () => {
  it("an A2A token only opens /a2a, never the member REST API or MCP", async () => {
    await startSession(hub.url, team.lea.token, "lea-hard");
    const page = await (await consolePost(hub.url, team.lea.cookie, "/console/agents/a2a", { name: "Partner" })).text();
    const a2a = page.match(/ctgh_[A-Za-z0-9_-]+/)?.[0] ?? "";
    expect(a2a).not.toBe("");
    expect((await fetch(`${hub.url}/v1/whoami`, { headers: bearer(a2a) })).status).toBe(401);
    const session = await fetch(`${hub.url}/v1/agents/session`, {
      method: "POST",
      headers: { ...bearer(a2a), "content-type": "application/json" },
      body: JSON.stringify({ session_id: "x", cwd: "/tmp" }),
    });
    expect(session.status).toBe(401);
    expect((await fetch(`${hub.url}/mcp`, { method: "POST", headers: bearer(a2a) })).status).toBe(401);
    // A member's personal token is not an A2A token either.
    expect((await fetch(`${hub.url}/a2a`, { method: "POST", headers: bearer(team.lea.token), body: "{}" })).status).toBe(401);
  });

  it("relays a GitHub delivery once, even when it is replayed", async () => {
    const page = await (await consolePost(hub.url, team.lea.cookie, "/console/settings/github")).text();
    const url = page.match(/https?:\/\/\S+\/bridges\/github\/[A-Za-z0-9_-]+/)?.[0] ?? "";
    const secret = page.match(/Secret: ([A-Za-z0-9_-]{20,})/)?.[1] ?? "";
    await startSession(hub.url, team.lea.token, "lea-hard-gh", { repo: repoFingerprint("git@github.com:acme/api.git") });
    const body = JSON.stringify({
      action: "opened",
      repository: { full_name: "acme/api", html_url: "https://github.com/acme/api" },
      sender: { login: "octocat" },
      pull_request: { number: 3, title: "Replay me", html_url: "https://github.com/acme/api/pull/3", merged: false },
    });
    const deliver = () =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "72d3162e-cc78-11e3-81ab-4c9367dc0958",
          "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
        },
        body,
      });
    expect((await deliver()).status).toBe(202);
    expect((await deliver()).status).toBe(202);
    const rows = (await hub.db.select().from(message).where(eq(message.teamId, team.teamId))).filter((m) => m.body.includes("Replay me"));
    expect(rows).toHaveLength(1);
  });

  it("refuses a Slack channel another team already uses", async () => {
    const lea = await principalForToken(hub.db, team.lea.token);
    if (!lea) throw new Error("no principal");
    const base = { retentionDays: 90, secretPatterns: [], strict: false };
    await updateSettings(hub.db, lea, { ...base, slackChannel: "CSHARED1" });
    const otherTeam = await createTeam(hub.db, "Other team");
    const other = { ...lea, teamId: otherTeam, settings: {} as typeof lea.settings };
    await expect(updateSettings(hub.db, other, { ...base, slackChannel: "CSHARED1" })).rejects.toThrow(/another team/);
    await updateSettings(hub.db, other, { ...base, slackChannel: "COTHER1" });
  });

  it("does not audit a public key published again unchanged", async () => {
    const pub = publicKeyOf(newKeyPair().privateKey);
    const publish = () =>
      fetch(`${hub.url}/v1/keys`, {
        method: "POST",
        headers: { ...bearer(team.malik.token), "content-type": "application/json" },
        body: JSON.stringify({ public_key: pub }),
      });
    expect((await publish()).status).toBeLessThan(300);
    expect((await publish()).status).toBeLessThan(300);
    const events = await hub.db
      .select()
      .from(auditEvent)
      .where(
        and(eq(auditEvent.teamId, team.teamId), eq(auditEvent.action, "key.published"), eq(auditEvent.actorUserId, team.malik.userId)),
      );
    expect(events).toHaveLength(1);
  });

  it("exports the member's public key and deletes it on erasure", async () => {
    const malik = await principalForToken(hub.db, team.malik.token);
    if (!malik) throw new Error("no principal");
    const data = await exportMyData(hub.db, malik);
    expect(data.public_key?.public_key).toMatch(/.+/);
    await eraseMe(hub.db, malik, "erase");
    expect(await hub.db.select().from(memberKey).where(eq(memberKey.userId, team.malik.userId))).toHaveLength(0);
  });
});
