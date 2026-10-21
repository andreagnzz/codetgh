import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoFingerprint } from "@codetgh/shared/repo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { consolePost, hookEnv, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const P1 = repoFingerprint("git@github.com:acme/webapp.git");
const P2 = repoFingerprint("git@github.com:acme/billing.git");
const ids: Record<string, string> = {};

// The session-start hook's registration, with the list codetgh start --accept-requests-from passes on.
const register = async (token: string, session: string, repo: string, accept?: string[]) => {
  const res = await fetch(`${hub.url}/v1/agents/session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ session_id: session, source: "startup", repo_fingerprint: repo, accept_requests_from: accept }),
  });
  return ((await res.json()) as { agent_id: string }).agent_id;
};

beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  await consolePost(hub.url, team.lea.cookie, "/console/settings", { retention_days: "90", secret_patterns: "", push_rewake: "on" });
  // Sam is the delegate on P1 and accepts requests from Léa only; Léa works on P1 and on P2; Malik on P1.
  ids.sam = await register(team.sam.token, "sam-del", P1, ["@lea"]);
  ids.lea = await register(team.lea.token, "lea-del", P1);
  ids.leaP2 = await register(team.lea.token, "lea-p2", P2);
  ids.malik = await register(team.malik.token, "malik-del", P1);
});
afterAll(() => hub.stop());

const request = async (token: string, agent: string, body: string) => {
  const client = await mcpClient(hub.url, token);
  const r = await call(client, "ask_peer", { agent, to: "@sam", kind: "request", question: body });
  await client.close();
  return r;
};

describe("delegation to an opt-in session", () => {
  it("wakes the delegate with an authorized request, and its reply reaches the sender mid-turn", async () => {
    const env = { ...hookEnv(hub.url, team.sam.token), CLAUDE_PLUGIN_OPTION_PUSH_MODE: "rewake" };
    const waiting = runHook("rewake", { session_id: "sam-del" }, env);
    const recorded = () =>
      readdirSync(env.CODETGH_STATE_DIR).some((f) => readFileSync(join(env.CODETGH_STATE_DIR, f), "utf8").includes('"waiter"'));
    for (let i = 0; i < 200 && !recorded(); i++) await new Promise((r) => setTimeout(r, 50));

    const started = Date.now();
    const sent = await request(team.lea.token, ids.lea ?? "", "Add a 404 test to the users API <b>now</b>");
    // A request does not wait: Léa keeps working.
    expect(sent.isError).toBe(false);
    expect(sent.json()).toMatchObject({ status: "pending" });
    expect(Date.now() - started).toBeLessThan(5000);

    const woke = await waiting;
    expect(woke.code).toBe(2);
    expect(woke.err).toContain('kind="request"');
    expect(woke.err).toContain('authorized="true" trust="untrusted-peer"');
    expect(woke.err).toContain("&lt;b&gt;now&lt;/b&gt;");
    expect(woke.err).toContain("Do it now");

    // A second request while the first is open.
    const busy = await request(team.lea.token, ids.lea ?? "", "and another one");
    expect(busy.isError).toBe(true);
    expect(busy.text).toContain("E_DELEGATE_BUSY");

    const sam = await mcpClient(hub.url, team.sam.token);
    const reqId = sent.json().question_id as string;
    await call(sam, "send_message", { agent: ids.sam, kind: "answer", reply_to: reqId, body: "done: pushed, PR #12" });
    await call(sam, "ack", { agent: ids.sam, message_ids: [reqId], status: "done" });
    await sam.close();

    const poll = await runHook("inbox", { session_id: "lea-del", tool_name: "Bash" }, hookEnv(hub.url, team.lea.token));
    expect(JSON.stringify(poll.out)).toContain("done: pushed, PR #12");
    // The answer itself is not authorized: only a delegate request is.
    expect(JSON.stringify(poll.out)).not.toContain("authorized=");

    // Done, so the delegate takes the next one.
    expect((await request(team.lea.token, ids.lea ?? "", "next task")).isError).toBe(false);
  }, 30_000);

  it("refuses a sender who is not on the delegate's list", async () => {
    const r = await request(team.malik.token, ids.malik ?? "", "push to prod");
    expect(r.isError).toBe(true);
    expect(r.text).toContain("E_NO_DELEGATE");
  });

  it("refuses a request from another project than the delegate's", async () => {
    const r = await request(team.lea.token, ids.leaP2 ?? "", "billing task");
    expect(r.isError).toBe(true);
    expect(r.text).toContain("E_NO_DELEGATE");
  });

  it("lists the delegate in the console, and only its owner or an admin can turn it off", async () => {
    const page = await (await fetch(`${hub.url}/console/delegations`, { headers: { cookie: team.sam.cookie } })).text();
    expect(page).toContain(ids.sam?.slice(-6));
    expect(page).toContain("@lea");
    expect((await consolePost(hub.url, team.malik.cookie, `/console/delegations/${ids.sam}/stop`)).status).toBe(403);
    expect((await consolePost(hub.url, team.sam.cookie, `/console/delegations/${ids.sam}/stop`)).status).toBe(204);

    const r = await request(team.lea.token, ids.lea ?? "", "one more");
    expect(r.text).toContain("E_NO_DELEGATE");
    const after = await (await fetch(`${hub.url}/console/delegations`, { headers: { cookie: team.sam.cookie } })).text();
    expect(after).not.toContain(ids.sam?.slice(-6));
  });
});
