import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { session } from "../apps/hub/src/db/auth-schema.js";
import { agent, auditEvent, membership, personalToken } from "../apps/hub/src/db/schema.js";
import { RateLimiter } from "../apps/hub/src/domain/limits.js";
import { revokeMember } from "../apps/hub/src/domain/teams.js";
import { type Hub, startHub } from "../apps/hub/test/harness.js";
import { consolePost } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
// Each test starts with a full per-address budget: every request here comes from the same address.
let clock = Date.now();
beforeEach(() => {
  clock += 3600_000;
});
beforeAll(async () => {
  hub = await startHub({ limiter: new RateLimiter(() => clock) });
  team = await hub.seed();
});
afterAll(() => hub.stop());
afterEach(() => vi.restoreAllMocks());

const post = (path: string, body: unknown) =>
  fetch(`${hub.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const start = async (label = "sam-laptop") => {
  const res = await post("/v1/device/start", { label });
  expect(res.status).toBe(200);
  return (await res.json()) as { device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number };
};
const poll = (deviceCode: string) => post("/v1/device/token", { device_code: deviceCode });

describe("browser sign-in (device authorization)", () => {
  it("start → approve in the console → the token comes back once and works", async () => {
    const s = await start("sam-laptop <b>");
    expect(s.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/);
    expect(s.device_code.length).toBeGreaterThanOrEqual(43);
    expect(s.verification_url).toBe(`${hub.url}/console/device`);
    expect(s.expires_in).toBeLessThanOrEqual(600);

    const pending = await poll(s.device_code);
    expect(pending.status).toBe(200);
    expect(await pending.json()).toEqual({ status: "pending" });

    // The person types the code (any case, with or without the dash) and sees the machine label, escaped.
    const shown = await consolePost(hub.url, team.sam.cookie, "/console/device", { user_code: s.user_code.replace("-", "").toLowerCase() });
    expect(shown.status).toBe(200);
    const html = await shown.text();
    expect(html).toContain("sam-laptop &lt;b&gt;");
    expect(html).not.toContain("<b>");
    // When the request started, and that the label is the requester's word, not a checked machine name.
    expect(html).toMatch(/Started<\/dt><dd><time datetime="[^"]+"/);
    // The page's polite live region announces the panel: the panel itself is no status.
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Anyone can send any name, so compare the code, not the name.");
    // The code as the terminal prints it, whatever the person typed.
    expect(html).toContain(`<code class="user-code" translate="no">${s.user_code}</code>`);

    const approved = await consolePost(hub.url, team.sam.cookie, "/console/device/approve", { user_code: s.user_code });
    expect(approved.status).toBe(200);

    const res = await poll(s.device_code);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { status: string; token: string };
    expect(body.status).toBe("approved");
    expect(body.token).toMatch(/^ctgh_/);

    const who = await fetch(`${hub.url}/v1/whoami`, { headers: { Authorization: `Bearer ${body.token}` } });
    expect(who.status).toBe(200);
    expect(((await who.json()) as { handle: string }).handle).toBe("sam");

    // Single use: the device code is consumed, and so is the user code.
    expect((await poll(s.device_code)).status).toBe(404);
    expect((await consolePost(hub.url, team.sam.cookie, "/console/device/approve", { user_code: s.user_code })).status).toBe(404);

    // A personal token like the console's (90 days, the machine label), and an audit trail of the approval.
    const [tok] = await hub.db.select().from(personalToken).where(eq(personalToken.label, "sam-laptop <b>"));
    expect(tok?.userId).toBe(team.sam.userId);
    expect(Math.round(((tok?.expiresAt.getTime() ?? 0) - Date.now()) / 86_400_000)).toBe(90);
    const actions = (
      await hub.db
        .select({ action: auditEvent.action })
        .from(auditEvent)
        .where(and(eq(auditEvent.teamId, team.teamId), eq(auditEvent.actorUserId, team.sam.userId)))
    ).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["device.approved", "token.created"]));
  });

  it("deny: the CLI is told, and no token is created", async () => {
    const s = await start("malik-desktop");
    expect((await consolePost(hub.url, team.malik.cookie, "/console/device/deny", { user_code: s.user_code })).status).toBe(200);
    const res = await poll(s.device_code);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { message: string }).message).toMatch(/denied/);
    expect(await hub.db.select().from(personalToken).where(eq(personalToken.label, "malik-desktop"))).toHaveLength(0);
    const [denied] = await hub.db.select().from(auditEvent).where(eq(auditEvent.action, "device.denied"));
    expect(denied).toMatchObject({ actorUserId: team.malik.userId, via: "console" });
  });

  it("expiry: a code older than its lifetime can neither be approved nor polled", async () => {
    const s = await start();
    const later = Date.now() + (s.expires_in + 1) * 1000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    // Signed in just now, so only the code's age refuses the approval.
    await hub.db
      .update(session)
      .set({ createdAt: new Date(later) })
      .where(eq(session.userId, team.sam.userId));
    expect((await consolePost(hub.url, team.sam.cookie, "/console/device/approve", { user_code: s.user_code })).status).toBe(404);
    await hub.db.update(session).set({ createdAt: new Date() }).where(eq(session.userId, team.sam.userId));
    const res = await poll(s.device_code);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { message: string }).message).toMatch(/expired/);
  });

  it("wrong user codes: a few tries, then refused even with the right one", async () => {
    const s = await start();
    // Each refusal in the reader's words, which the device page shows under the form.
    const first = await consolePost(hub.url, `${team.lea.cookie}; lang=fr`, "/console/device", { user_code: "BBBB-BBBB" });
    expect(first.status).toBe(404);
    expect(await first.text()).toContain("Ce code est inconnu ou a expiré. Vérifie le code dans ton terminal, ou relance codetgh login.");
    for (let i = 1; i < 5; i++)
      expect((await consolePost(hub.url, team.lea.cookie, "/console/device", { user_code: "BBBB-BBBB" })).status).toBe(404);
    const blocked = await consolePost(hub.url, team.lea.cookie, "/console/device", { user_code: s.user_code });
    expect(blocked.status).toBe(429);
    expect(await blocked.text()).toContain("Too many wrong codes. Wait a few minutes, then type the code again.");
    expect((await consolePost(hub.url, team.lea.cookie, "/console/device/approve", { user_code: s.user_code })).status).toBe(429);
    expect(((await (await poll(s.device_code)).json()) as { status: string }).status).toBe("pending");
  });

  it("refuses bad input and an unknown device code", async () => {
    expect((await post("/v1/device/start", { label: "" })).status).toBe(400);
    expect((await post("/v1/device/start", { label: "x".repeat(61) })).status).toBe(400);
    expect((await poll("not-a-code")).status).toBe(400);
    expect((await poll("A".repeat(43))).status).toBe(404);
  });

  it("an unauthenticated visit goes to the login page, which comes back to the device page", async () => {
    const res = await fetch(`${hub.url}/console/device`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?next=/console/device");
    const page = await fetch(`${hub.url}/console/device`, { headers: { cookie: team.sam.cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('name="user_code"');
  });

  it("limits sign-in requests per address", async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await post("/v1/device/start", { label: "flood" })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("an approval needs a fresh sign-in: an older session approves nothing", async () => {
    const s = await start("phished-laptop");
    const ago = new Date(Date.now() - 11 * 60_000);
    await hub.db.update(session).set({ createdAt: ago }).where(eq(session.userId, team.sam.userId));
    const res = await consolePost(hub.url, team.sam.cookie, "/console/device/approve", { user_code: s.user_code });
    await hub.db.update(session).set({ createdAt: new Date() }).where(eq(session.userId, team.sam.userId));
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/Sign in again/);
    expect(await (await poll(s.device_code)).json()).toEqual({ status: "pending" });
  });

  it("mints no token when the approver's membership is revoked before the CLI polls", async () => {
    const s = await start("revoked-laptop");
    expect((await consolePost(hub.url, team.malik.cookie, "/console/device/approve", { user_code: s.user_code })).status).toBe(200);
    const [m] = await hub.db.select().from(membership).where(eq(membership.userId, team.malik.userId));
    await revokeMember(hub.db, { teamId: team.teamId, membershipId: m?.id ?? "", actorUserId: team.lea.userId, actorRole: "owner" });
    expect((await poll(s.device_code)).status).toBe(403);
    expect(await hub.db.select().from(personalToken).where(eq(personalToken.label, "revoked-laptop"))).toHaveLength(0);
  });

  it("a token or an A2A agent needs a fresh sign-in too: an older session creates neither", async () => {
    const tokens = () => hub.db.select().from(personalToken).where(eq(personalToken.label, "stale-ci"));
    const agents = () => hub.db.select().from(agent).where(eq(agent.label, "stale-partner"));
    const staleFor = async (userId: string, run: () => Promise<Response>) => {
      await hub.db
        .update(session)
        .set({ createdAt: new Date(Date.now() - 11 * 60_000) })
        .where(eq(session.userId, userId));
      const res = await run();
      await hub.db.update(session).set({ createdAt: new Date() }).where(eq(session.userId, userId));
      return res;
    };
    const stale = await staleFor(team.sam.userId, () => consolePost(hub.url, team.sam.cookie, "/console/tokens", { label: "stale-ci" }));
    expect(stale.status).toBe(403);
    expect(await stale.text()).toMatch(/Sign in again/);
    expect(await tokens()).toHaveLength(0);
    const a2a = await staleFor(team.lea.userId, () =>
      consolePost(hub.url, team.lea.cookie, "/console/agents/a2a", { name: "stale-partner" }),
    );
    expect(a2a.status).toBe(403);
    expect(await a2a.text()).toMatch(/Sign in again/);
    expect(await agents()).toHaveLength(0);

    const fresh = await consolePost(hub.url, team.sam.cookie, "/console/tokens", { label: "stale-ci" });
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toMatch(/ctgh_/);
    expect(await tokens()).toHaveLength(1);
    expect((await consolePost(hub.url, team.lea.cookie, "/console/agents/a2a", { name: "stale-partner" })).status).toBe(200);
    expect(await agents()).toHaveLength(1);
  });

  it("an approval needs the console's CSRF token", async () => {
    const s = await start();
    const res = await fetch(`${hub.url}/console/device/approve`, {
      method: "POST",
      headers: { cookie: team.sam.cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ user_code: s.user_code }).toString(),
    });
    expect(res.status).toBe(403);
  });
});
