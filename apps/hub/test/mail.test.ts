import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { consolePost } from "../../../e2e/helpers.js";
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

it("emails the invitation link and still shows it", async () => {
  const res = await consolePost(hub.url, team.lea.cookie, "/console/members/invite", { email: "zoe@acme.test", role: "member" });
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
  expect(mailer.outbox.some((x) => x.to === "mallory@evil.test")).toBe(false);
});

it("mails a sign-in link to an existing member", async () => {
  expect(
    (
      await fetch(`${hub.url}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: hub.url },
        body: JSON.stringify({ email: team.sam.email, callbackURL: "/console" }),
      })
    ).ok,
  ).toBe(true);
  expect(mailer.outbox.some((x) => x.to === team.sam.email)).toBe(true);
});
