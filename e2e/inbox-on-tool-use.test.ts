import { afterAll, beforeAll, expect, it } from "vitest";
import { ACME_REPO, call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";
import { additionalContext, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

// An agent busy in a long turn: no prompt, only tool calls, each one running the PostToolUse "inbox" hook.
const busy = (token: string, session: string) => {
  const env = { ...hookEnv(hub.url, token), CODETGH_POLL_MS: "300" };
  return async () => {
    const r = await runHook("inbox", { session_id: session, tool_name: "Bash" }, env);
    return additionalContext(r);
  };
};
async function until(step: () => Promise<string>, want: (s: string) => boolean, ms: number) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
    const s = await step();
    if (want(s)) return s;
  }
  return "";
}

it("gets a blocking question to a busy agent and its answer back, with no human prompt", async () => {
  await startSession(hub.url, team.sam.token, "sam-busy", { repo: ACME_REPO });
  await startSession(hub.url, team.lea.token, "lea-busy", { repo: ACME_REPO });
  const sam = await mcpClient(hub.url, team.sam.token);
  const lea = await mcpClient(hub.url, team.lea.token);
  const samTool = busy(team.sam.token, "sam-busy");
  const leaTool = busy(team.lea.token, "lea-busy");
  const started = Date.now();

  const asked = JSON.parse(
    (await call(sam, "ask_peer", { to: "@lea", question: "Which XRPL network do we target?", wait_s: 1, priority: "blocking" })).text,
  );
  expect(asked.status).toBe("pending");

  const seen = await until(leaTool, (s) => s.includes(asked.question_id), 30_000);
  expect(Date.now() - started).toBeLessThan(30_000);
  expect(seen).toContain('priority="blocking"');
  expect(seen).toContain("next stopping point");
  // Delivered once: the next tool call adds nothing.
  expect(await leaTool()).toBe("");

  await call(lea, "send_message", { reply_to: asked.question_id, kind: "answer", body: "Testnet for the demo." });
  const answer = await until(samTool, (s) => s.includes("Testnet for the demo."), 60_000);
  expect(answer).toContain('trust="untrusted-peer"');
  expect(Date.now() - started).toBeLessThan(60_000);
}, 90_000);

it("injects at most 10 times in 10 minutes under a burst, and the rest waits for the next prompt", async () => {
  const agent = (await startSession(hub.url, team.sam.token, "sam-burst", { repo: ACME_REPO })).agent_id;
  await startSession(hub.url, team.malik.token, "malik-burst", { repo: ACME_REPO });
  const samTool = busy(team.sam.token, "sam-burst");
  const sam = await mcpClient(hub.url, team.sam.token);
  const malik = await mcpClient(hub.url, team.malik.token);
  let injected = 0;
  for (let i = 0; i < 11; i++) {
    const sent = JSON.parse((await call(malik, "send_message", { to: "@sam", kind: "note", body: `burst ${i}` })).text);
    if (await until(samTool, (s) => s.includes(`burst ${i}`), 2_000)) injected++;
    await call(sam, "ack", { agent, up_to: sent.id });
  }
  expect(injected).toBe(10);
}, 90_000);

// A subagent's tool calls run the same hook: what it injects lands in the subagent's context, which ends with its task.
// The main conversation must be the one that reads teammates' messages.
it("leaves messages for the main conversation when the tool call comes from a subagent", async () => {
  await startSession(hub.url, team.sam.token, "sam-sub", { repo: ACME_REPO });
  const env = { ...hookEnv(hub.url, team.sam.token), CODETGH_POLL_MS: "0" };
  const malik = await mcpClient(hub.url, team.malik.token);
  await call(malik, "send_message", { to: "@sam", kind: "note", body: "seen by the main thread" });
  const sub = await runHook("inbox", { session_id: "sam-sub", tool_name: "Bash", agent_id: "agent-1", agent_type: "Explore" }, env);
  expect(sub.out).toBeNull();
  const main = await runHook("inbox", { session_id: "sam-sub", tool_name: "Agent" }, env);
  expect(JSON.stringify(main.out)).toContain("seen by the main thread");
});
