import { afterAll, beforeAll, expect, it } from "vitest";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

it("Sam asks Léa through ask_peer and gets her answer in an envelope (scenario 1)", async () => {
  // Both in the same repository: a question to a person reaches their sessions on the thread's project.
  await startSession(hub.url, team.sam.token, "sam-session", { repo: ACME_REPO });
  await startSession(hub.url, team.lea.token, "lea-session", { repo: ACME_REPO });
  const sam = await mcpClient(hub.url, team.sam.token);
  const lea = await mcpClient(hub.url, team.lea.token);

  const asking = call(sam, "ask_peer", {
    to: "@lea",
    question: "Le champ createdAt de GET /users est-il en ISO 8601 ou en timestamp ?",
    wait_s: 10,
  });

  // Léa's next prompt: the hook injects the question.
  let injected = "";
  for (let i = 0; i < 20 && !injected; i++) {
    const r = await runHook("user-prompt-submit", { session_id: "lea-session", prompt: "continue" }, hookEnv(hub.url, team.lea.token));
    injected = String((r.out?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext ?? "");
    if (!injected) await new Promise((r) => setTimeout(r, 100));
  }
  const qid = injected.match(/<peer_message id="(msg_[0-9A-Z]{26})" from="Sam"[^>]*kind="question"[^>]*trust="untrusted-peer">/)?.[1];
  expect(qid).toBeDefined();
  expect(injected).toContain("ISO 8601 ou en timestamp");

  const sent = await call(lea, "send_message", { kind: "answer", reply_to: qid, body: "ISO 8601 en UTC, voir contracts/users.md" });
  expect(sent.isError).toBe(false);

  const result = await asking;
  expect(result.isError).toBe(false);
  expect(result.json()).toMatchObject({ status: "answered", question_id: qid });
  expect(result.text.match(/<peer_message /g)).toHaveLength(1);
  expect(result.text).toMatch(
    /<peer_message [^>]*from="Léa"[^>]*kind="answer"[^>]*trust="untrusted-peer">\nISO 8601 en UTC, voir contracts\/users.md\n<\/peer_message>/,
  );
  expect(result.text.split("\n\n")[0]).not.toContain("ISO 8601");

  // The console shows the thread to Sam.
  const thread = JSON.parse(sent.text).thread;
  const page = await fetch(`${hub.url}/console/threads/${thread}`, { headers: { cookie: team.sam.cookie } });
  expect(page.status).toBe(200);
  const html = await page.text();
  expect(html).toContain("ISO 8601 en UTC");
  expect(html).toContain("Le champ createdAt");
  await sam.close();
  await lea.close();
});

it("returns pending when nobody answers in time", async () => {
  const sam = await mcpClient(hub.url, team.sam.token);
  const r = await call(sam, "ask_peer", { to: "@malik", question: "Tu es là ?", wait_s: 1, allow_offline: true });
  expect(r.json()).toMatchObject({ status: "pending" });
  await sam.close();
});

it("inbox_read does not advance the cursor, ack does", async () => {
  await startSession(hub.url, team.malik.token, "malik-session", { repo: ACME_REPO });
  const lea = await mcpClient(hub.url, team.lea.token);
  const malik = await mcpClient(hub.url, team.malik.token);
  await call(lea, "send_message", { to: "@malik", kind: "note", body: "Tests verts sur feat/users" });
  const first = (await call(malik, "inbox_read")).json().messages;
  const again = (await call(malik, "inbox_read")).json().messages;
  expect(first.length).toBeGreaterThan(0);
  expect(again).toEqual(first);
  await call(malik, "ack", { up_to: first.at(-1).id });
  expect((await call(malik, "inbox_read")).json().messages).toEqual([]);
  await lea.close();
  await malik.close();
});
