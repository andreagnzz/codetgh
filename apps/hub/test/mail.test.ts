import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { membership } from "../src/db/schema.js";
import { createInvitation } from "../src/domain/teams.js";
import { createMailer, type Mailer } from "../src/mailer.js";
import { type Hub, startHub } from "./harness.js";

// jsonTransport keeps mail in memory; `enabled` is forced so the hub behaves as with SMTP_URL set.
let mailer: Mailer;
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  mailer = { ...createMailer(), enabled: true };
  hub = await startHub({ mailer });
  team = await hub.seed();
});
afterAll(() => hub.stop());

async function csrf(cookie: string) {
  const html = await (await fetch(`${hub.url}/console`, { headers: { cookie } })).text();
  return html.match(/X-CSRF-Token&quot;:&quot;([^&]+)&quot;/)?.[1] ?? "";
}

it("emails the invitation link and still shows it", async () => {
  const res = await fetch(`${hub.url}/console/members/invite`, {
    method: "POST",
    headers: { cookie: team.lea.cookie, "X-CSRF-Token": await csrf(team.lea.cookie), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "zoe@acme.test", role: "member" }).toString(),
  });
  const html = await res.text();
  const mail = mailer.outbox.find((m) => m.to === "zoe@acme.test");
  const link = mail?.text.match(/http\S+\/invite\/\S+/)?.[0];
  expect(link).toBeDefined();
  expect(html).toContain(link);
  expect(html).toContain("Invitation emailed to zoe@acme.test");
});

it("offers the magic link on the login page", async () => {
  expect(await (await fetch(`${hub.url}/login`)).text()).toContain('id="magic-link"');
});

it("signs up an invited person by magic link and refuses an uninvited one", async () => {
  await createInvitation(hub.db, { teamId: team.teamId, email: "noor@acme.test", role: "member", invitedBy: null, via: "system" });
  const ask = (email: string) =>
    fetch(`${hub.url}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: hub.url },
      body: JSON.stringify({ email, name: "Noor", callbackURL: "/console" }),
    });
  expect((await ask("noor@acme.test")).ok).toBe(true);
  const url = mailer.outbox.find((m) => m.to === "noor@acme.test")?.text.match(/http\S+/)?.[0] ?? "";
  const verified = await fetch(url, { redirect: "manual" });
  const location = new URL(verified.headers.get("location") ?? "", hub.url);
  expect(location.pathname).toBe("/console");
  expect(location.searchParams.get("error")).toBeNull();
  const [m] = await hub.db.select().from(membership).where(eq(membership.handle, "noor"));
  expect(m?.role).toBe("member");

  expect((await ask("mallory@evil.test")).ok).toBe(true); // no account enumeration
  const evil = mailer.outbox.find((x) => x.to === "mallory@evil.test")?.text.match(/http\S+/)?.[0] ?? "";
  const refused = await fetch(evil, { redirect: "manual" });
  expect(new URL(refused.headers.get("location") ?? "", hub.url).searchParams.get("error")).toBeTruthy();
});
