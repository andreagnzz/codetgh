import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { message } from "../apps/hub/src/db/schema.js";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("stops delivering a message once it expires, even long after the hub started", async () => {
  await startSession(hub.url, team.lea.token, "lea-exp", { repo: ACME_REPO });
  await startSession(hub.url, team.sam.token, "sam-exp", { repo: ACME_REPO });
  const lea = await mcpClient(hub.url, team.lea.token);
  const sam = await mcpClient(hub.url, team.sam.token);
  await call(lea, "send_message", { to: "@sam", kind: "status", body: "deploy in progress" });
  // It expires in a moment: well after the hub started.
  await hub.db
    .update(message)
    .set({ expiresAt: new Date(Date.now() + 500) })
    .where(eq(message.body, "deploy in progress"));
  expect((await call(sam, "inbox_read")).text).toContain("deploy in progress");
  await new Promise((r) => setTimeout(r, 700));
  expect((await call(sam, "inbox_read")).text).not.toContain("deploy in progress");
});
