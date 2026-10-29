import { expect, type Page, type Route, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { invitation } from "../../apps/hub/src/db/schema.js";
import { createInvitation } from "../../apps/hub/src/domain/teams.js";
import { type Hub, startHub } from "../../apps/hub/test/harness.js";
import { signIn } from "./fixtures.js";

// The public pages and the device page with a browser and a keyboard: what the hub refused, in the reader's language and
// under what it is about; the control that waits on the hub says so; every stop shows its focus.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
test.beforeAll(async () => {
  // A fictitious provider id, so the sign-in page shows its button; it leads nowhere.
  process.env.AUTH_GITHUB_ID = "test-github-client";
  hub = await startHub({ mailer: { enabled: true, outbox: [], send: async () => {} } });
  team = await hub.seed();
});
test.afterAll(async () => {
  delete process.env.AUTH_GITHUB_ID;
  await hub.stop();
});

// The focused element's name, and whether its focus ring shows.
const tab = async (page: Page) => {
  await page.keyboard.press("Tab");
  const f = await page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement;
    const s = getComputedStyle(el);
    const name =
      el.getAttribute("aria-label") ?? el.labels?.[0]?.firstChild?.textContent ?? (el.innerText.trim() || el.querySelector("img")?.alt);
    return { name: (name ?? "").trim(), outline: s.outlineStyle, width: s.outlineWidth };
  });
  expect(f.outline, f.name).toBe("solid");
  expect(f.width, f.name).toBe("2px");
  return f.name;
};
const submit = async (page: Page, password: string) => {
  await page.locator("#login input[name=email]").fill(team.lea.email);
  await page.locator("#login input[name=password]").fill(password);
  await page.locator("#login button[type=submit]").click();
};

for (const [locale, refused] of [
  ["en-US", "The email or password is wrong. Check both, then try again."],
  ["fr-FR", "Le courriel ou le mot de passe est incorrect. Vérifie les deux, puis réessaie."],
] as const)
  test.describe(locale, () => {
    test.use({ locale });
    test("sign-in refused: what happened and what to do, under the fields, which turn invalid until the next try", async ({ page }) => {
      await page.goto(`${hub.url}/login`);
      await submit(page, "wrong-password-123");
      await expect(page.locator("#login #error[role=alert]")).toHaveText(refused);
      for (const field of ["email", "password"])
        await expect(page.locator(`#login input[name=${field}]`)).toHaveAttribute("aria-invalid", "true");
      await submit(page, team.lea.password);
      await expect(page).toHaveURL(/\/console$/);
    });
  });

test("sign-in: the button says it waits on the hub, and an unreachable hub is said in words", async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((r) => {
    release = r;
  });
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto(`${hub.url}/login`);
  await submit(page, team.lea.password);
  await expect(page.locator("#login button[type=submit]")).toHaveAttribute("aria-busy", "true");
  release();
  await expect(page).toHaveURL(/\/console$/);

  await page.context().clearCookies();
  await page.unrouteAll();
  await page.route("**/api/auth/sign-in/email", (route) => route.abort());
  await page.goto(`${hub.url}/login`);
  await submit(page, team.lea.password);
  await expect(page.locator("#error")).toHaveText("The hub does not answer. Check your connection, then try again.");
  await expect(page.locator("#login [aria-invalid]")).toHaveCount(0);
  await expect(page.locator("#login button[type=submit]")).not.toHaveAttribute("aria-busy", "true");
});

test("sign-in: too many tries in a row is said in the reader's words, not the hub's", async ({ page }) => {
  // How better-auth answers past 3 sign-ins in 10 s from one address (its rate limiter, on in production): no code, an
  // English message.
  const slow = (route: Route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "X-Retry-After": "8" },
      body: JSON.stringify({ message: "Too many requests. Please try again later." }),
    });
  await page.route("**/api/auth/sign-in/email", slow);
  await page.route("**/api/auth/sign-in/magic-link", slow);
  await page.goto(`${hub.url}/login`);
  await submit(page, "wrong-password-123");
  await expect(page.locator("#login #error[role=alert]")).toHaveText("Too many tries. Wait a few seconds, then try again.");
  // Nothing typed is wrong: no field turns invalid.
  await expect(page.locator("#login [aria-invalid]")).toHaveCount(0);
  await page.locator("details.disclosure > summary").click();
  await page.locator("#magic-link input[name=email]").fill("ines@acme.test");
  await page.locator("#magic-link button[type=submit]").click();
  await expect(page.locator("#link-result")).toHaveText("Too many tries. Wait a few seconds, then try again.");
});

test("sign-in with the keyboard: providers, the form, then the folded emailed link, which says a link is on its way", async ({ page }) => {
  await page.goto(`${hub.url}/login`);
  for (const name of ["CodeTgh", "Continue with GitHub", "Email", "Password", "Sign in", "Get a sign-in link by email instead"])
    expect(await tab(page)).toBe(name);
  await page.keyboard.press("Enter");
  await expect(page.locator("details.disclosure")).toHaveAttribute("open", "");
  // Its own name, so a screen reader moving by fields tells it from the sign-in form's Email.
  expect(await tab(page)).toBe("Email for the link");
  await page.keyboard.type("ines@acme.test");
  await page.keyboard.press("Enter");
  // The same answer whether or not the address has an account: the page never tells who is a member.
  await expect(page.locator("#link-result[role=status]")).toHaveText(
    "If this address has an account or an invitation, a sign-in link is on its way. It works for 10\u00a0minutes.",
  );
  expect(await tab(page)).toBe("Email me a link");
});

test("consent with the keyboard: the access asked for in words, then Allow and Deny", async ({ page }) => {
  const scope = "codetgh openid email";
  await page.goto(
    `${hub.url}/consent?client_id=${encodeURIComponent("https://client.example/oauth/client-metadata.json")}&scope=${encodeURIComponent(scope)}&redirect_uri=${encodeURIComponent("https://client.example/cb")}`,
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Allow access to your account?");
  await expect(page.locator(".scopes li")).toHaveText([
    /Use this hub as you, with your role: messages, claims, tasks and team memory\s*codetgh/,
    /Know who you are\s*openid/,
    /See your email address\s*email/,
  ]);
  for (const name of ["CodeTgh", "Allow", "Deny"]) expect(await tab(page)).toBe(name);
  // Opened without the hub's signed request (as here), the consent is refused, and the page says what to do.
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(page.locator("#error[role=alert]")).toHaveText("This request has expired or was changed. Start again from your app.");
  // The request is spent: Allow no longer reads as the way forward.
  await expect(page.locator("[data-consent=accept]")).toHaveClass("secondary");
});

test("invitation with the keyboard: the invited address is the account's, and a refused sign-up says what to do", async ({ page }) => {
  const { token } = await createInvitation(hub.db, {
    teamId: team.teamId,
    email: "nina@acme.test",
    role: "member",
    invitedBy: team.lea.userId,
    via: "console",
  });
  await page.goto(`${hub.url}/invite/${token}`);
  // The address shows as text, not a stop; the form still sends it.
  await expect(page.locator("#invite-signup .value")).toHaveText("nina@acme.test");
  await expect(page.locator("#invite-signup input[name=email]")).toHaveValue("nina@acme.test");
  for (const name of ["CodeTgh", "Your name", "Password"]) expect(await tab(page)).toBe(name);
  await page.keyboard.type("correct horse battery");
  expect(await tab(page)).toBe("Create my account");
  // Revoked while the page was open: the hub refuses the account.
  await hub.db.update(invitation).set({ revokedAt: new Date() }).where(eq(invitation.email, "nina@acme.test"));
  await page.locator("#invite-signup input[name=name]").fill("Nina");
  await page.keyboard.press("Enter");
  await expect(page.locator("#invite-signup #error[role=alert]")).toHaveText(
    "This invitation can't create an account any more. Ask the person who invited you for a new link.",
  );
});

test("device with the keyboard: type the code, check it and the machine, approve", async ({ page }) => {
  const start = await fetch(`${hub.url}/v1/device/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "lea-thinkpad" }),
  });
  const { user_code } = (await start.json()) as { user_code: string };
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/device`);
  await page.getByLabel("Code shown in your terminal").fill("BBBB-BBBB");
  await page.keyboard.press("Enter");
  await expect(page.locator(".device .field-error[role=alert]")).toHaveText(
    "This code is unknown or has expired. Check the code in your terminal, or run codetgh login again.",
  );
  await page.getByLabel("Code shown in your terminal").fill(user_code.toLowerCase());
  await page.keyboard.press("Enter");
  const check = page.locator("#device");
  await expect(check.getByRole("heading", { name: "Check this sign-in" })).toBeVisible();
  await expect(check).toContainText(user_code);
  await expect(check).toContainText("lea-thinkpad");
  await page.getByLabel("Code shown in your terminal").focus();
  for (const name of ["Continue", "Approve", "Deny"]) expect(await tab(page)).toBe(name);
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await expect(check.getByRole("status")).toContainText("Terminal approved");
});
