import { expect, test } from "@playwright/test";
import { call, type Hub, mcpClient, startHub, startSession } from "../../apps/hub/test/harness.js";
import { signIn } from "./fixtures.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
test.beforeEach(async () => {
  hub = await startHub();
  team = await hub.seed();
  await startSession(hub.url, team.sam.token, "sam-line");
  const sam = await mcpClient(hub.url, team.sam.token);
  await call(sam, "send_message", { to: "@lea", kind: "note", body: "first", allow_offline: true });
  await sam.close();
});
test.afterEach(() => hub.stop());

const send = async (body: string) => {
  const sam = await mcpClient(hub.url, team.sam.token);
  await call(sam, "send_message", { to: "@lea", kind: "question", body, allow_offline: true });
  await sam.close();
};

test("only a message that arrives live traces its wire, and it is announced politely", async ({ page }) => {
  await signIn(page, hub.url, team.lea);
  await expect(page.locator(".wire-row")).toHaveCount(1);
  await expect(page.locator(".wire-row.fresh")).toHaveCount(0);
  await send("second");
  await expect(page.locator(".wire-row")).toHaveCount(2);
  await expect(page.locator(".wire-row.fresh")).toHaveCount(1);
  await expect(page.locator("#line-announce")).toHaveText(/New message: Sam \(agent\) → @lea/);
  await expect(page.locator("#line-announce")).toHaveAttribute("aria-live", "polite");
  expect(await page.locator(".wire-row.fresh .link").evaluate((el) => getComputedStyle(el).animationName)).toBe("trace");
});

test("no motion with prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page, hub.url, team.lea);
  await send("second");
  await expect(page.locator(".wire-row.fresh")).toHaveCount(1);
  expect(await page.locator(".wire-row.fresh .link").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

test("a refused action shows its reason under the form; the skip link comes first on the keyboard", async ({ page }) => {
  await signIn(page, hub.url, team.sam);
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText("Skip to content");
  await page.goto(`${hub.url}/console/me`);
  await page.getByLabel("Type erase to confirm").fill("nope");
  await page.getByRole("button", { name: "Erase my data" }).click();
  await expect(page.locator(".field-error")).toHaveText("type erase to confirm");
  await expect(page.locator(".field-error")).toHaveAttribute("role", "alert");
});
