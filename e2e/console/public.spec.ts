import { expect, type Page, test } from "@playwright/test";
import { type Hub, startHub } from "../../apps/hub/test/harness.js";

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
  ["fr-FR", "L'e-mail ou le mot de passe est incorrect. Vérifie les deux, puis réessaie."],
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
  await expect(page.locator("#login button[type=submit]")).not.toHaveAttribute("aria-busy", "true");
});

test("sign-in with the keyboard: providers, the form, then the folded emailed link, which says a link is on its way", async ({ page }) => {
  await page.goto(`${hub.url}/login`);
  for (const name of ["CodeTgh", "Continue with GitHub", "Email", "Password", "Sign in", "Get a sign-in link by email instead"])
    expect(await tab(page)).toBe(name);
  await page.keyboard.press("Enter");
  await expect(page.locator("details.disclosure")).toHaveAttribute("open", "");
  expect(await tab(page)).toBe("Email");
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
});
