import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { message } from "../../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub, startSession } from "../../apps/hub/test/harness.js";
import { signIn } from "./fixtures.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
test.beforeEach(async () => {
  hub = await startHub();
  team = await hub.seed();
  await startSession(hub.url, team.sam.token, "sam-draft");
});
test.afterEach(() => hub.stop());

const send = async (body: string, replyTo?: string) => {
  const sam = await mcpClient(hub.url, team.sam.token);
  await call(sam, "send_message", { to: "@lea", kind: "question", body, allow_offline: true, reply_to: replyTo });
  await sam.close();
};

test("a live refresh keeps the reply being typed", async ({ page }) => {
  await send("first");
  const [first] = await hub.db.select().from(message).where(eq(message.body, "first"));
  await signIn(page, hub.url, team.lea);
  await page.goto(`${hub.url}/console/threads/${first?.threadId}`);
  await expect(page.locator(".convo-row")).toHaveCount(1);
  await page.getByLabel("Reply to the thread").fill("half-written answer");
  await send("second", first?.id);
  await expect(page.locator(".convo-row")).toHaveCount(2);
  await expect(page.getByLabel("Reply to the thread")).toHaveValue("half-written answer");
});

test("a live refresh keeps the kill switch reason being typed", async ({ page }) => {
  await signIn(page, hub.url, team.lea);
  await page.getByLabel("Reason").fill("agents are looping");
  await send("first");
  await expect(page.locator(".wire-row")).toHaveCount(1);
  await expect(page.getByLabel("Reason")).toHaveValue("agents are looping");
});
