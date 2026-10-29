import { expect, type Page, test } from "@playwright/test";
import { type Hub, startHub } from "../../apps/hub/test/harness.js";
import { signIn } from "./fixtures.js";

// The shell and the components with the keyboard only: the order of the stops, a focus that always shows, the menus and the
// dialog that open, close on Escape and give the focus back.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
test.beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
test.afterAll(() => hub.stop());

const focused = (page: Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    const text = el.getAttribute("aria-label") ?? (el.innerText.trim() || el.querySelector("img")?.alt) ?? "";
    return { text: text.trim(), outline: s.outlineStyle, width: s.outlineWidth };
  });
const tab = async (page: Page) => {
  await page.keyboard.press("Tab");
  const f = await focused(page);
  // Every stop shows where the focus is.
  expect(f.outline, f.text).toBe("solid");
  expect(f.width, f.text).toBe("2px");
  return f.text;
};

for (const scheme of ["light", "dark"] as const)
  test(`wide screen, ${scheme}: skip link, logo, the navigation in order, then the account menu`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, hub.url, team.lea);
    expect(await tab(page)).toBe("Skip to content");
    expect(await tab(page)).toBe("CodeTgh");
    const order = [];
    for (let i = 0; i < 12; i++) order.push(await tab(page));
    expect(order).toEqual([
      "Overview",
      "Threads",
      "Alerts",
      "Agents",
      "Projects",
      "Tasks",
      "Claims",
      "Memory",
      "Delegations",
      "Members",
      "Audit",
      "Settings",
    ]);
    expect(await tab(page)).toBe("Léa · owner");
    await page.keyboard.press("Enter");
    await expect(page.locator("details.account")).toHaveAttribute("open", "");
    expect(await tab(page)).toBe("My data");
    expect(await tab(page)).toBe("Tokens");
    await page.keyboard.press("Escape");
    await expect(page.locator("details.account")).not.toHaveAttribute("open", "");
    expect((await focused(page)).text).toBe("Léa · owner");
  });

test("the skip link takes the keyboard to the page", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/agents`);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("main")))).toBe(true);
});

test("small screen: the menu opens with the keyboard, holds every link, closes on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page, hub.url, team.lea);
  expect(await tab(page)).toBe("Skip to content");
  expect(await tab(page)).toBe("CodeTgh");
  expect(await tab(page)).toBe("Menu");
  await page.keyboard.press("Enter");
  await expect(page.locator("details.menu")).toHaveAttribute("open", "");
  await expect(page.locator("details.menu summary")).toContainText("Close");
  expect(await tab(page)).toBe("Overview");
  for (let i = 0; i < 11; i++) await tab(page);
  expect(await tab(page)).toBe("My data");
  await page.keyboard.press("Escape");
  await expect(page.locator("details.menu")).not.toHaveAttribute("open", "");
  expect((await focused(page)).text).toContain("Menu");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});

test("confirmation dialog: Cancel first, Escape gives the focus back; confirming runs the action and says so in a toast", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/catalogue`);
  const trigger = page.getByRole("button", { name: "Revoke token", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Revoke the token laptop-cli?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Sessions already open are not closed.");
  expect((await focused(page)).text).toBe("Cancel");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  expect((await focused(page)).text).toBe("Revoke token");
  await Promise.all([page.waitForEvent("load"), page.keyboard.press("Enter")]);
  await expect(page.locator(".toasts .toast")).toHaveText("Token laptop-cli revoked.");
  await page.locator(".toasts button").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".toasts .toast")).toHaveCount(0);
});

test("a refused action shows the hub's reason under it; Copy copies and says so", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/catalogue`);
  await page.getByRole("button", { name: "An action the hub refuses" }).click();
  await expect(page.locator(".field-error[role=alert]").first()).toHaveText(
    "The hub refuses this demo action, to show where its reason appears.",
  );
  const copy = page.locator(".code [data-copy]").first();
  await copy.focus();
  await page.keyboard.press("Enter");
  await expect(copy).toHaveAttribute("data-state", "copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("codetgh invite ines@acme.test");
});
