import { repoFingerprint } from "@codetgh/shared/repo";
import { expect, type Page, test } from "@playwright/test";
import { RateLimiter } from "../../apps/hub/src/domain/limits.js";
import { type Hub, startHub } from "../../apps/hub/test/harness.js";
import { signIn } from "./fixtures.js";

// Agents, Projects and Delegations with the keyboard and on a phone: every stop shows its focus, a session's actions are
// named after it and ask first, the external agent's form opens under the page header, and nothing scrolls sideways.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let clock = 0;
const session = async (token: string, id: string, body: Record<string, unknown>) => {
  const res = await fetch(`${hub.url}/v1/agents/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ session_id: id, ...body }),
  });
  if (!res.ok) throw new Error(`${id}: ${res.status}`);
};
const repo = (name: string) => ({ repo_fingerprint: repoFingerprint(`git@github.com:acme/${name}.git`), repo_name: `acme/${name}` });
test.beforeAll(async () => {
  hub = await startHub({ limiter: new RateLimiter(() => (clock += 3_600_000)) });
  team = await hub.seed();
  await session(team.malik.token, "malik-billing", { ...repo("billing"), branch: "fix/invoice", permission_mode: "bypassPermissions" });
  await session(team.sam.token, "sam-web", { ...repo("webapp"), branch: "feat/login", push_mode: "rewake", client_version: "2.1.14" });
  await session(team.malik.token, "malik-delegate", { ...repo("api"), branch: "main", accept_requests_from: ["@sam", "@lea"] });
  await session(team.lea.token, "lea-loose", { branch: "scratch" });
});
test.afterAll(() => hub.stop());

const tab = async (page: Page) => {
  await page.keyboard.press("Tab");
  const f = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const s = getComputedStyle(el);
    return {
      text: (el.getAttribute("aria-label") ?? el.innerText).replace(/\s+/g, " ").trim(),
      outline: `${s.outlineStyle} ${s.outlineWidth}`,
    };
  });
  expect(f.outline, f.text).toBe("solid 2px");
  return f.text;
};

for (const scheme of ["light", "dark"] as const)
  test(`agents, ${scheme}: the page action, the filter, then each session's actions named after it, each with a visible focus`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, hub.url, team.lea);
    await page.goto(`${hub.url}/console/agents`);
    expect(await tab(page)).toBe("Skip to content");
    await page.keyboard.press("Enter");
    expect(await tab(page)).toBe("Add an external agent");
    expect(await tab(page)).toBe("Project: All projects");
    // acme/api comes first: Malik's delegate session, then acme/billing. Each session's actions wait behind its "…".
    expect(await tab(page)).toBe("Actions for malik@main");
    await page.keyboard.press("Enter");
    expect(await tab(page)).toBe("Quarantine malik@main…");
    expect(await tab(page)).toBe("Remove malik@main…");
    await page.keyboard.press("Escape");
    expect(await tab(page)).toBe("Actions for malik@fix/invoice");
    await page.keyboard.press("Enter");
    expect(await tab(page)).toBe("Quarantine malik@fix/invoice…");
    // The trigger asks first; Cancel has the focus; Escape gives it back to the menu the trigger was in.
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Quarantine Malik?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Only an admin lifts it.");
    expect(await page.evaluate(() => (document.activeElement as HTMLElement).innerText.trim())).toBe("Cancel");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.locator('summary[aria-label="Actions for malik@fix/invoice"]')).toBeFocused();
  });

test("add an external agent: the form opens under the page header, the token shows once with its Copy", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/agents`);
  const summary = page.locator("summary", { hasText: "Add an external agent" });
  await summary.focus();
  await page.keyboard.press("Enter");
  const panel = page.locator("details.panel[open]");
  await expect(panel).toBeVisible();
  // Open, the form takes the width of the page header instead of squeezing beside the title.
  const width = async (selector: string) => (await page.locator(selector).boundingBox())?.width ?? 0;
  expect(await width("details.panel[open]")).toBeGreaterThan((await width(".page-head")) / 2);
  expect(await tab(page)).toBe("");
  await page.keyboard.type("Partner bot");
  expect(await tab(page)).toBe("Add");
  await page.keyboard.press("Enter");
  await expect(page.locator("#a2a-result")).toContainText("Copy the token now.");
  await expect(page.locator("#a2a-result code")).toContainText("Authorization: Bearer ctgh_");
  expect(await tab(page)).toBe("Copy the two lines");
});

test("projects, wide: the owner's Remote Control and runner, a state then its action, by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/projects`);
  await expect(page.locator(".tool-state", { hasText: "Remote Control stopped" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Start Remote Control" }).first().focus();
  expect(await tab(page)).toBe("Start the runner");
});

test("delegations, wide: turning one off asks first, and Escape gives the keyboard back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/delegations`);
  const off = page.getByRole("button", { name: "Turn off malik@main…" });
  await off.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Turn off delegation for malik@main?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(off).toBeFocused();
});

for (const [lang, width] of [
  ["en", 640],
  ["en", 768],
  ["fr", 768],
] as const)
  test(`${width} px, ${lang}: every column header stays inside its column`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, hub.url, team.lea);
    await page.context().addCookies([{ name: "lang", value: lang, url: hub.url }]);
    for (const path of ["/console/agents", "/console/delegations"]) {
      await page.goto(`${hub.url}${path}`);
      // A header's words end before the gap that parts it from the next column.
      const spilled = await page.evaluate(() =>
        [...document.querySelectorAll("th")]
          .filter((th) => {
            const words = document.createRange();
            words.selectNodeContents(th);
            const gap = Number.parseFloat(getComputedStyle(th).paddingRight);
            return words.getBoundingClientRect().right > th.getBoundingClientRect().right - gap + 0.5;
          })
          .map((th) => th.textContent),
      );
      expect(spilled, path).toEqual([]);
    }
  });

for (const lang of ["en", "fr"])
  test(`phone, ${lang}: no page of the batch scrolls sideways at 360 px`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page, hub.url, team.lea);
    await page.context().addCookies([{ name: "lang", value: lang, url: hub.url }]);
    for (const path of ["/console/agents", "/console/projects", "/console/delegations"]) {
      await page.goto(`${hub.url}${path}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(360);
    }
    // The external agent's form, open, fits too.
    await page.goto(`${hub.url}/console/agents`);
    await page.locator("summary", { hasText: lang === "fr" ? "Ajouter un agent externe" : "Add an external agent" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
