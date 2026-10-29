import { expect, type Page, test } from "@playwright/test";
import { createInvitation } from "../../apps/hub/src/domain/teams.js";
import { type Hub, startHub } from "../../apps/hub/test/harness.js";
import { signIn } from "./fixtures.js";

// Members, Tokens, My data and Settings with the keyboard and on a phone: every stop shows its focus and says what it acts
// on, a person's actions open from their menu and ask first, the forms keep their order, and nothing scrolls sideways.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
test.beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  await createInvitation(hub.db, {
    teamId: team.teamId,
    email: "ines@acme.test",
    role: "member",
    invitedBy: team.lea.userId,
    via: "console",
  });
});
test.afterAll(() => hub.stop());

// The name a screen reader gives the focused element: its aria-label, its label, or its text.
const tab = async (page: Page) => {
  await page.keyboard.press("Tab");
  const f = await page.evaluate(() => {
    const el = document.activeElement as HTMLInputElement;
    const s = getComputedStyle(el);
    const label = el.getAttribute("aria-label") ?? el.labels?.[0]?.innerText ?? el.innerText;
    return { text: label.replace(/\s+/g, " ").trim(), outline: `${s.outlineStyle} ${s.outlineWidth}` };
  });
  expect(f.outline, f.text).toBe("solid 2px");
  return f.text;
};
const tabs = async (page: Page, n: number) => {
  const names = [];
  for (let i = 0; i < n; i++) names.push(await tab(page));
  return names;
};

for (const scheme of ["light", "dark"] as const)
  test(`members, ${scheme}: the invitation form, each invitation's revoke, then each person's menu, which asks first`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, hub.url, team.lea);
    await page.goto(`${hub.url}/console/members`);
    expect(await tab(page)).toBe("Skip to content");
    await page.keyboard.press("Enter");
    expect(await tabs(page, 4)).toEqual([
      "Invite a member",
      "Revoke the invitation for ines@acme.test…",
      "Actions for Léa",
      "Actions for Sam",
    ]);
    await page.keyboard.press("Enter");
    // The handle first, with its rule; then the roles Sam does not have, then revoking access.
    expect(await tabs(page, 6)).toEqual([
      "Handle",
      "Rename",
      "Make owner Sam…",
      "Make admin Sam…",
      "Make guest Sam…",
      "Revoke access Sam…",
    ]);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Revoke Sam's access?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("What they wrote stays with the team.");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).innerText.trim())).toBe("Cancel");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator('summary[aria-label="Actions for Sam"]')).toBeFocused();
    await expect(page.locator("tr", { hasText: "sam@acme.test" })).toHaveCount(1);
  });

test("invite a member: the form opens under the page header, and the link shows with its Copy", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/members`);
  await page.locator("summary", { hasText: "Invite a member" }).focus();
  await page.keyboard.press("Enter");
  // Open, the form takes the width of the page header instead of squeezing beside the title.
  const width = async (selector: string) => (await page.locator(selector).boundingBox())?.width ?? 0;
  expect(await width(".head-form details[open]")).toBeGreaterThan((await width(".page-head")) / 2);
  expect(await tab(page)).toBe("Email");
  await page.keyboard.type("zoe@acme.test");
  expect(await tabs(page, 3)).toEqual(["Role", "Valid for", "Invite"]);
  await page.keyboard.press("Enter");
  await expect(page.locator("#invite-result")).toContainText("Invitation ready for zoe@acme.test.");
  expect(await tab(page)).toBe("Copy the invitation link");
});

test("tokens: create one by keyboard, then copy the token and its commands", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.sam);
  await page.goto(`${hub.url}/console/tokens`);
  expect(await tab(page)).toBe("Skip to content");
  await page.keyboard.press("Enter");
  expect(await tab(page)).toBe("Create a token");
  await page.keyboard.press("Enter");
  expect(await tab(page)).toBe("Label");
  await page.keyboard.type("sam desktop");
  expect(await tab(page)).toBe("Create a token");
  await page.keyboard.press("Enter");
  await expect(page.locator("#new-token")).toContainText("Token created. Copy it now: you won't see it again.");
  expect(await tabs(page, 4)).toEqual([
    "Copy the token",
    "Copy the sign-in command",
    "Copy the plugin command",
    "Revoke the token sam laptop…",
  ]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Revoke the token sam laptop?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Revoke the token sam laptop…" })).toBeFocused();
});

test("my data and settings: every field in order, each named, each with a visible focus", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/me`);
  expect(await tab(page)).toBe("Skip to content");
  await page.keyboard.press("Enter");
  expect(await tabs(page, 6)).toEqual(["Display name", "Save", "Download my data", "Link Slack", "Type erase to confirm", "Erase my data"]);

  await page.goto(`${hub.url}/console/settings`);
  expect(await tab(page)).toBe("Skip to content");
  await page.keyboard.press("Enter");
  expect(await tabs(page, 14)).toEqual([
    "Ask the person",
    "Allow rewake push",
    "Link a new repository when a member starts a session in it",
    "Loop orchestrator optional",
    "Who accepts team memory",
    "Accept team memory from Claude Code too",
    "Keep messages for",
    "Extra secret patterns optional",
    "Slack channel optional",
    "Save settings",
    "Create the webhook",
    "Team name",
    "Rename the team",
    "Copy the public key",
  ]);
  // The two answers to a claimed file are one group: the arrows move between them.
  await page.locator('input[name="claims_enforcement"][value="ask"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('input[name="claims_enforcement"][value="warn"]')).toBeChecked();
});

for (const lang of ["en", "fr"])
  test(`phone, ${lang}: no page of the batch scrolls sideways at 360 px, with its forms and menus open`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page, hub.url, team.lea);
    await page.context().addCookies([{ name: "lang", value: lang, url: hub.url }]);
    const wide = () => page.evaluate(() => document.documentElement.scrollWidth);
    for (const path of ["/console/members", "/console/tokens", "/console/me", "/console/settings"]) {
      await page.goto(`${hub.url}${path}`);
      expect(await wide(), path).toBeLessThanOrEqual(360);
    }
    await page.goto(`${hub.url}/console/members`);
    await page.locator(".head-form summary").click();
    expect(await wide()).toBeLessThanOrEqual(360);
    await page.locator('summary[aria-label^="Actions"]').last().click();
    expect(await wide()).toBeLessThanOrEqual(360);
    // The menu opens inside the screen.
    const pop = await page.locator("details.row-menu[open] .pop").boundingBox();
    expect(pop && pop.x >= 0 && pop.x + pop.width <= 360).toBe(true);
  });
