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
  await expect(page.locator(".field-error")).toHaveText("Nothing was erased. Type erase in the box to confirm.");
  await expect(page.locator(".field-error")).toHaveAttribute("role", "alert");
});

test("the live state: shown by console.js, a live region only once connected, offline after three failed attempts", async ({ page }) => {
  await signIn(page, hub.url, team.lea);
  const live = page.locator(".live");
  await expect(live).toHaveText("Live");
  await expect(live).toHaveAttribute("role", "status");
  await page.route("**/console/stream", (route) => route.abort());
  await page.reload();
  // Never connected on this load: the words change, nothing is announced, and it ends with the time it was lost.
  await expect(live).toHaveText(/^Offline since \d\d:\d\d$/, { timeout: 20_000 });
  await expect(live).toHaveAttribute("data-state", "offline");
  await expect(live).not.toHaveAttribute("role", "status");
});

test("times read in the reader's time zone: the clock alone for today, the day and month before it on another day", async ({ browser }) => {
  const zone = "America/Sao_Paulo";
  const context = await browser.newContext({ timezoneId: zone });
  const page = await context.newPage();
  const clock = (iso: string | null, day?: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      ...(day && { day: "numeric", month: "short" }),
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: zone,
    }).format(new Date(iso ?? ""));
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/catalogue`);
  const earlier = page.locator(".timeline time").first();
  await expect(earlier).toHaveText(clock(await earlier.getAttribute("datetime"), true));
  // A time from today, as a live refresh brings it.
  await page.evaluate((iso) => {
    document.querySelector(".timeline")?.insertAdjacentHTML("afterbegin", `<li><time id="now" datetime="${iso}" data-local></time></li>`);
    document.body.dispatchEvent(new Event("htmx:afterSettle"));
  }, new Date().toISOString());
  const now = page.locator("#now");
  await expect(now).toHaveText(clock(await now.getAttribute("datetime")));
  await context.close();
});

test("a live refresh the hub refuses keeps what the page shows and says from when it is", async ({ page }) => {
  await signIn(page, hub.url, team.lea);
  await page.route("**/console", (route) =>
    route.request().headers()["hx-request"] ? route.fulfill({ status: 500, body: "boom" }) : route.continue(),
  );
  await send("second");
  await expect(page.locator("#live + .field-error")).toHaveText(/^Couldn't refresh\. Showing data from \d\d:\d\d\.$/);
  await expect(page.locator("#live + .field-error")).toHaveAttribute("role", "alert");
  await expect(page.locator(".wire-row")).toHaveCount(1);
});

test("a live refresh opens again the disclosures that were open", async ({ page }) => {
  // A disclosure with an id at the top of the live region, in the page and in each refresh of it.
  await page.route("**/console", async (route) => {
    const res = await route.fetch();
    const { "content-length": _, "content-encoding": __, ...headers } = res.headers();
    const fold = '<details id="fold" class="disclosure"><summary>More</summary><p>Inside</p></details>';
    await route.fulfill({ status: res.status(), headers, body: (await res.text()).replace(/(<div id="live"[^>]*>)/, `$1${fold}`) });
  });
  await signIn(page, hub.url, team.lea);
  await page.locator("#fold > summary").click();
  await send("second");
  await expect(page.locator(".wire-row")).toHaveCount(2);
  await expect(page.locator("#fold")).toHaveAttribute("open", "");
});
