import { expect, type Locator, type Page, test } from "@playwright/test";
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
// What an eye or a pointer finds at the middle of an element: false when a menu covers it, or when a frame around it clips it
// or had to scroll to show it (focus scrolls the nearest frame). Only the page scrolls to bring it into view.
const unobscured = (locator: Locator) =>
  locator.evaluate((el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) if (n.scrollTop > 0) return false;
    scrollTo(0, el.getBoundingClientRect().top + scrollY - innerHeight / 2);
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && el.contains(hit));
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
  // The trigger opens the dialog, so it ends in "…"; the dialog's button runs the action under the bare label.
  const trigger = page.locator("#demo-confirm-host").getByRole("button", { name: "Revoke token…", exact: true });
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
  // The focus does not fall back to the body with the toast that held it.
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("main");

  // Refused after confirmation: the reason shows in the dialog, which stays open.
  await page.getByRole("button", { name: "Remove agent…", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: "Remove agent" }).click();
  await expect(page.locator("#confirm-error")).toHaveText("The hub refuses this demo action, to show where its reason appears.");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
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

for (const width of [1280, 360])
  test(`row menu, ${width} px: the last row's menu opens over what follows, every item in reach, Escape closes it`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await signIn(page, hub.url, team.lea);
    await page.goto(`${hub.url}/console/catalogue`);
    const summary = page.locator('summary[aria-label="Actions for deploy bot"]');
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("details.row-menu[open] .menu-items button")).toHaveCount(3);
    for (const name of ["Rename", "Show its last uses", "Revoke…"]) {
      expect(await tab(page)).toBe(name);
      expect(await unobscured(page.locator(":focus")), name).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(page.locator("details.row-menu[open]")).toHaveCount(0);
    await expect(summary).toBeFocused();
  });

test("a menu closes when the keyboard leaves it, so it never covers the next stop", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/catalogue`);
  await page.locator("details.account > summary").focus();
  await page.keyboard.press("Enter");
  for (const name of ["My data", "Tokens", "Français"]) expect(await tab(page)).toBe(name);
  expect(await tab(page)).toBe("Overview");
  await expect(page.locator("details.account")).not.toHaveAttribute("open", "");
  expect(await tab(page)).toBe("Page action");
  expect(await unobscured(page.locator(":focus"))).toBe(true);

  await page.locator('summary[aria-label="Actions for lea laptop"]').focus();
  await page.keyboard.press("Enter");
  for (const name of ["Rename", "Revoke…"]) expect(await tab(page)).toBe(name);
  // The next row's link: its ring is drawn around the whole row, by the link's ::after.
  await page.keyboard.press("Tab");
  expect((await focused(page)).text).toBe("ci (GitHub Actions)");
  await expect(page.locator("details.row-menu[open]")).toHaveCount(0);
});

test("a table wider than its frame is a named stop whose arrows scroll it; one that fits is not a stop", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/audit`);
  const frame = page.locator(".table-wrap").first();
  // The audit log fits its frame at 768 px now: made wider than it, it stands for any table that does not.
  await frame.evaluate((wrap) => {
    wrap.querySelector("table")?.style.setProperty("min-width", "1400px");
    dispatchEvent(new Event("resize"));
  });
  await expect(frame).toHaveAttribute("role", "region");
  await expect(frame).toHaveAttribute("tabindex", "0");
  await expect(frame).toHaveAccessibleName(/\S/);
  await frame.focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => frame.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await page.goto(`${hub.url}/console/catalogue`);
  await expect(page.locator(".table-wrap").first()).not.toHaveAttribute("tabindex", "0");
});
