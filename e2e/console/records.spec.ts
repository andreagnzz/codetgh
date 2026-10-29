import { expect, type Page, test } from "@playwright/test";
import { claim, memoryItem, task } from "../../apps/hub/src/db/schema.js";
import { RateLimiter } from "../../apps/hub/src/domain/limits.js";
import { type Hub, startHub } from "../../apps/hub/test/harness.js";
import { signIn } from "./fixtures.js";

// Audit log, team memory, claims and tasks with the keyboard and on a phone: every stop shows its focus, an event's hashes
// open and close from its number, releasing a claim asks first and gives the keyboard back, the New task form opens under the
// page header, and nothing scrolls sideways.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let clock = 0;
const LONG = "packages/billing/src/exports/quarterly/a-very-long-directory-name-for-the-layout-check/invoice-rounding.test.ts";
test.beforeAll(async () => {
  hub = await startHub({ limiter: new RateLimiter(() => (clock += 3_600_000)) });
  team = await hub.seed();
  const res = await fetch(`${hub.url}/v1/agents/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${team.sam.token}`, "content-type": "application/json" },
    body: JSON.stringify({ session_id: "sam-web", branch: "feature/a-very-long-branch-name-that-keeps-going" }),
  });
  const { agent_id: agentId } = (await res.json()) as { agent_id: string };
  await hub.db.insert(claim).values({
    id: "clm_01KEYBOARDCLAIM000000000000",
    teamId: team.teamId,
    holderUserId: team.sam.userId,
    holderAgentId: agentId,
    scopeType: "path",
    scope: LONG,
    mode: "exclusive",
    reason: "Moving every invoice rounding rule under one function, then the credit notes and the quarterly export",
    ttlS: 3600,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  await hub.db.insert(task).values({
    id: "tsk_01KEYBOARDTASK0000000000000",
    teamId: team.teamId,
    title: "Move every login error under its own field, then the signup form, the password reset and the invitation page",
    body: "Each field gets its own message.",
    createdByUser: team.lea.userId,
  });
  await hub.db.insert(memoryItem).values({
    id: "mit_01KEYBOARDMEMORY00000000000",
    teamId: team.teamId,
    number: 1,
    kind: "decision",
    title: "Invoices round half-even, to the cent, once per line, and credit notes follow the invoice they cancel",
    body: "Every amount rounds half-even.",
    proposedByUser: team.sam.userId,
    proposedByAgent: agentId,
    authoredBy: "agent",
  });
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
  test(`audit, ${scheme}: the header's two actions, then each event's number opens its hashes and Escape closes them`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page, hub.url, team.lea);
    await page.goto(`${hub.url}/console/audit`);
    expect(await tab(page)).toBe("Skip to content");
    await page.keyboard.press("Enter");
    expect(await tab(page)).toBe("Export JSON");
    expect(await tab(page)).toBe("Verify chain");
    expect(await tab(page)).toMatch(/^Hashes of event \d+$/);
    await page.keyboard.press("Enter");
    const pop = page.locator("details.audit-hash[open] .pop");
    await expect(pop).toBeVisible();
    await expect(pop).toContainText("Previous hash");
    await page.keyboard.press("Escape");
    await expect(pop).toBeHidden();
    await expect(page.locator("details.audit-hash > summary").first()).toBeFocused();
    // Verify, from the keyboard: the result is a banner, announced politely.
    await page.getByRole("button", { name: "Verify chain" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#verify-result .banner")).toContainText("Chain intact.");
    await expect(page.locator("#verify-result")).toHaveAttribute("aria-live", "polite");
  });

test("claims: Release asks first in a dialog named after the scope, Cancel has the focus, Escape gives it back", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/claims`);
  const release = page.getByRole("button", { name: `Release ${LONG}…` });
  await release.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: `Release the claim on ${LONG}?` });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (document.activeElement as HTMLElement).innerText.trim())).toBe("Cancel");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(release).toBeFocused();
});

test("tasks: New task opens under the page header, its fields in order, Create task last", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/tasks`);
  const summary = page.locator(".new-task summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  const width = async (selector: string) => (await page.locator(selector).boundingBox())?.width ?? 0;
  expect(await width(".new-task details[open]")).toBeGreaterThan((await width(".page-head")) / 2);
  await tab(page);
  await expect(page.locator("#task-title")).toBeFocused();
  await tab(page);
  await expect(page.locator("#task-body")).toBeFocused();
  await tab(page);
  await expect(page.locator("#task-assignee")).toBeFocused();
  expect(await tab(page)).toBe("Create task");
});

test("memory: the status tabs, then on a proposal the note, Accept and Reject", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/memory`);
  await page.getByRole("link", { name: /^Proposed/ }).focus();
  for (const name of ["Accepted 0", "Superseded 0", "Rejected 0", "All 1"]) expect(await tab(page)).toBe(name);
  await page.goto(`${hub.url}/console/memory/mit_01KEYBOARDMEMORY00000000000`);
  await page.locator("#decision-note").focus();
  expect(await tab(page)).toBe("Accept");
  expect(await tab(page)).toBe("Reject");
});

for (const lang of ["en", "fr"])
  test(`phone, ${lang}: no page of the batch scrolls sideways at 360 px, long paths and titles included`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page, hub.url, team.lea);
    await page.context().addCookies([{ name: "lang", value: lang, url: hub.url }]);
    for (const path of [
      "/console/audit",
      "/console/memory?status=all",
      "/console/memory/mit_01KEYBOARDMEMORY00000000000",
      "/console/claims",
      "/console/tasks?project=",
      "/console/tasks/tsk_01KEYBOARDTASK0000000000000",
    ]) {
      await page.goto(`${hub.url}${path}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(360);
    }
    // An event's hashes, open, fit too.
    await page.goto(`${hub.url}/console/audit`);
    await page.locator("details.audit-hash > summary").first().click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
