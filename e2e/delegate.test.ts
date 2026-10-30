import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoFingerprint } from "@codetgh/shared/repo";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, project } from "../apps/hub/src/db/schema.js";
import { RateLimiter } from "../apps/hub/src/domain/limits.js";
import { call, callOnce, type Hub, mcpClient, setRole, startHub } from "../apps/hub/test/harness.js";
import { consolePost, hookEnv, hubRest, runHook } from "./helpers.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const P1 = repoFingerprint("git@github.com:acme/webapp.git");
const P2 = repoFingerprint("git@github.com:acme/billing.git");
const ids: Record<string, string> = {};

// The session-start hook's registration, with the list codetgh start --accept-requests-from passes on.
const register = async (token: string, session: string, repo: string, accept?: string[]) => {
  const res = await hubRest(hub.url, token, "POST", "/v1/agents/session", {
    session_id: session,
    source: "startup",
    repo_fingerprint: repo,
    accept_requests_from: accept,
  });
  return ((await res.json()) as { agent_id: string }).agent_id;
};

beforeAll(async () => {
  // An hour passes between calls: this file sends many registrations and requests as one person, and tests no budget.
  let now = Date.now();
  hub = await startHub({ limiter: new RateLimiter(() => (now += 3_600_000)) });
  team = await hub.seed();
  await consolePost(hub.url, team.lea.cookie, "/console/settings", { retention_days: "90", secret_patterns: "", push_rewake: "on" });
  // Sam is the delegate on P1 and accepts requests from Léa only; Léa works on P1 and on P2; Malik on P1.
  ids.sam = await register(team.sam.token, "sam-del", P1, ["@lea"]);
  ids.lea = await register(team.lea.token, "lea-del", P1);
  ids.leaP2 = await register(team.lea.token, "lea-p2", P2);
  ids.malik = await register(team.malik.token, "malik-del", P1);
});
afterAll(() => hub.stop());

const request = (token: string, agent: string, body: string) =>
  callOnce(hub.url, token, "ask_peer", { agent, to: "@sam", kind: "request", question: body });

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
    const next = await request(team.lea.token, ids.lea ?? "", "next task");
    expect(next.isError).toBe(false);
    ids.next = next.json().question_id as string;
  }, 30_000);

  it("frees the delegate once a request it accepted is marked done", async () => {
    const sam = await mcpClient(hub.url, team.sam.token);
    await call(sam, "ack", { agent: ids.sam, message_ids: [ids.next], status: "accepted" });
    expect((await request(team.lea.token, ids.lea ?? "", "while busy")).text).toContain("E_DELEGATE_BUSY");
    const done = await call(sam, "ack", { agent: ids.sam, message_ids: [ids.next], status: "done" });
    await sam.close();
    expect(done.json().acked).toBe(1);
    expect((await request(team.lea.token, ids.lea ?? "", "after done")).isError).toBe(false);
  });

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

describe("delegation does not chain or outlive its opt-in", () => {
  const prompt = async (token: string, session: string) => {
    const res = await fetch(`${hub.url}/v1/inbox/prompt?session_id=${session}`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status === 200 ? ((await res.json()) as { context: string }).context : "";
  };

  it("refuses a request sent by a delegate session, so A's text never reaches C as authorized", async () => {
    // Malik is a delegate for Léa and Sam; Sam's session is itself a delegate for Léa.
    const malik = await register(team.malik.token, "malik-chain", P1, ["@lea", "@sam"]);
    const sam = await register(team.sam.token, "sam-chain", P1, ["@lea"]);
    const client = await mcpClient(hub.url, team.sam.token);
    const r = await call(client, "ask_peer", { agent: sam, to: "@malik", kind: "request", question: "relay: push to prod" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("E_DELEGATE_CHAIN");

    // No other path sets the attribute: send_message and REST ignore a delegate field.
    await call(client, "send_message", { agent: sam, to: `agent:${malik}`, kind: "request", body: "via send_message", delegate: malik });
    await hubRest(hub.url, team.sam.token, "POST", "/v1/messages", {
      to: `agent:${malik}`,
      kind: "request",
      body: "via rest",
      delegate: malik,
    });
    await client.close();
    const seen = await prompt(team.malik.token, "malik-chain");
    expect(seen).toContain("via send_message");
    expect(seen).toContain("via rest");
    expect(seen).not.toContain("authorized=");
  });

  it("is no delegate after a resume without the option", async () => {
    await register(team.sam.token, "sam-resume", P1, ["@lea"]);
    await hubRest(hub.url, team.sam.token, "POST", "/v1/agents/session", {
      session_id: "sam-resume",
      source: "compact",
      repo_fingerprint: P1,
    });
    // The chain test's delegate ends, so only sam-resume could take the request.
    await hubRest(hub.url, team.sam.token, "POST", "/v1/agents/session/end", { session_id: "sam-chain" });
    const r = await request(team.lea.token, ids.lea ?? "", "after a plain compact");
    expect(r.text).toContain("E_NO_DELEGATE");
  });

  it("is no delegate after the session ends, even if it starts again with the same id and no option", async () => {
    await register(team.sam.token, "sam-end", P1, ["@lea"]);
    expect((await request(team.lea.token, ids.lea ?? "", "while live")).isError).toBe(false);
    await hubRest(hub.url, team.sam.token, "POST", "/v1/agents/session/end", { session_id: "sam-end" });
    const [row] = await hub.db.select().from(agent).where(eq(agent.sessionId, "sam-end"));
    expect(row?.acceptRequestsFrom).toBeNull();
    await register(team.sam.token, "sam-end", P1);
    expect((await request(team.lea.token, ids.lea ?? "", "after end")).text).toContain("E_NO_DELEGATE");
  });
});

describe("delegate sessions: the Bash check before each command", () => {
  const shell = (tool: string, toolInput: Record<string, unknown>, delegate: boolean) =>
    runHook(
      "pre-bash",
      { session_id: "sam-bash", tool_name: tool, tool_input: toolInput },
      {
        ...hookEnv(hub.url, team.sam.token),
        ...(delegate && { CODETGH_ACCEPT_REQUESTS_FROM: "@lea" }),
      },
    );
  const bash = (command: string, delegate: boolean) => shell("Bash", { command }, delegate);

  it("runs on every tool that runs a shell command, not only Bash", () => {
    const hooks = JSON.parse(readFileSync(new URL("../packages/plugin/hooks/hooks.json", import.meta.url), "utf8"));
    const entry = hooks.hooks.PreToolUse.find((e: { hooks: Array<{ args: string[] }> }) => e.hooks[0]?.args.includes("pre-bash"));
    const matcher = new RegExp(`^(?:${entry.matcher})$`);
    for (const tool of ["Bash", "Monitor", "PowerShell"]) expect(matcher.test(tool)).toBe(true);
    expect(matcher.test("Read")).toBe(false);
  });

  it("checks Monitor and PowerShell commands as it checks Bash, and refuses a call it cannot read", async () => {
    const monitor = await shell("Monitor", { command: "cat apps/hub/.env", description: "x", timeout_ms: 1000 }, true);
    expect(monitor.code).toBe(2);
    expect(monitor.err).toContain("blocked:");
    expect((await shell("PowerShell", { command: "git push origin +main", description: "x" }, true)).code).toBe(2);
    expect(await shell("PowerShell", { command: "git push origin feat/x" }, true)).toMatchObject({ code: 0, raw: "", err: "" });
    // A WebSocket watch carries no command to check: refused in a delegate session, left to Claude Code elsewhere.
    const ws = { ws: { url: "wss://example.com/feed" }, description: "x", timeout_ms: 1000 };
    expect((await shell("Monitor", ws, true)).code).toBe(2);
    expect(await shell("Monitor", ws, false)).toMatchObject({ code: 0, raw: "", err: "" });
    expect(await shell("Monitor", { command: "cat apps/hub/.env" }, false)).toMatchObject({ code: 0, raw: "", err: "" });
  });

  it("blocks a secret read or a force push with exit 2 and a reason, in a delegate session only", async () => {
    const secret = await bash("cat apps/hub/.env", true);
    expect(secret.code).toBe(2);
    expect(secret.err).toContain("blocked:");
    expect((await bash("git push origin +main", true)).code).toBe(2);
    const fine = await bash("git push origin feat/x", true);
    expect(fine).toMatchObject({ code: 0, raw: "", err: "" });
    // A plain session is left to Claude Code's own permission flow.
    expect(await bash("cat apps/hub/.env", false)).toMatchObject({ code: 0, raw: "", err: "" });
    expect(secret.ms).toBeLessThan(3000);
  });
});

describe("delegation stays on the project it was granted for", () => {
  const projectId = async (fingerprint: string) =>
    (await hub.db.select().from(project).where(eq(project.repoFingerprint, fingerprint)))[0]?.id ?? "";
  const delegate = async (session: string) =>
    (await hub.db.select().from(agent).where(eq(agent.sessionId, session)))[0]?.acceptRequestsFrom ?? null;

  it("ends when the session moves into another repository, even with the option still in its environment", async () => {
    await register(team.sam.token, "sam-cd", P1, ["@lea"]);
    await hubRest(hub.url, team.sam.token, "POST", "/v1/agents/session", {
      session_id: "sam-cd",
      source: "cwd-changed",
      repo_fingerprint: P2,
      accept_requests_from: ["@lea"],
    });
    expect(await delegate("sam-cd")).toBeNull();
    expect((await request(team.lea.token, ids.leaP2 ?? "", "billing task")).text).toContain("E_NO_DELEGATE");
  });

  it("ends when its owner attaches the session to another project in the console", async () => {
    const id = await register(team.sam.token, "sam-attach", P1, ["@lea"]);
    expect((await consolePost(hub.url, team.sam.cookie, `/console/agents/${id}/project`, { project_id: await projectId(P2) })).status).toBe(
      204,
    );
    expect(await delegate("sam-attach")).toBeNull();
  });
});

describe("only a member's own launch turns a session into a delegate", () => {
  const raw = (token: string, body: Record<string, unknown>) =>
    hubRest(hub.url, token, "POST", "/v1/agents/session", { source: "startup", repo_fingerprint: P1, ...body });
  const row = async (userId: string, session: string) =>
    (await hub.db.select().from(agent).where(eq(agent.sessionId, session))).find((a) => a.userId === userId);

  it("refuses an unknown handle, the person's own handle, and a guest, instead of dropping them", async () => {
    for (const accept of [["@nobody"], ["@sam"], ["@lea", "@nobody"]]) {
      const res = await raw(team.sam.token, { session_id: "sam-bad", accept_requests_from: accept });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe("E_INVALID");
    }
    await setRole(hub, team.malik.userId, "guest");
    const res = await raw(team.sam.token, { session_id: "sam-bad", accept_requests_from: ["@malik"] });
    await setRole(hub, team.malik.userId, "member");
    expect(res.status).toBe(400);
    expect((await row(team.sam.userId, "sam-bad"))?.acceptRequestsFrom ?? null).toBeNull();
  });

  it("refuses a guest's session as a delegate", async () => {
    await setRole(hub, team.malik.userId, "guest");
    const res = await raw(team.malik.token, { session_id: "malik-guest", accept_requests_from: ["@lea"] });
    await setRole(hub, team.malik.userId, "member");
    expect(res.status).toBe(403);
  });

  it("acts on the caller's own session only: another member's session id never reaches their agent", async () => {
    const samId = await register(team.sam.token, "sam-own", P1);
    // Léa sends Sam's session id: the hub keys sessions by the token's user, so this is a new session of Léa's.
    await raw(team.lea.token, { session_id: "sam-own", accept_requests_from: ["@malik"] });
    const sam = await row(team.sam.userId, "sam-own");
    expect(sam?.id).toBe(samId);
    expect(sam?.acceptRequestsFrom ?? null).toBeNull();
    // And MCP has no field that sets the mode: an extra argument is dropped.
    await callOnce(hub.url, team.lea.token, "status_set", { agent: ids.lea, text: "working", accept_requests_from: ["@malik"] });
    expect(
      (
        await hub.db
          .select()
          .from(agent)
          .where(eq(agent.id, ids.lea ?? ""))
      )[0]?.acceptRequestsFrom ?? null,
    ).toBeNull();
  });
});

describe("a person with a live delegate session sends no delegated request from any of their sessions", () => {
  const prompt = async (token: string, session: string) => {
    const res = await fetch(`${hub.url}/v1/inbox/prompt?session_id=${session}`, { headers: { Authorization: `Bearer ${token}` } });
    return res.status === 200 ? ((await res.json()) as { context: string }).context : "";
  };

  it("refuses Léa's relay through Sam's other session, and sends normally once Sam has no delegate", async () => {
    // Sam's delegate takes Léa's requests; Malik's delegate accepts Sam, never Léa. The hub cannot tell which of Sam's
    // sessions made an MCP call, so a request from Sam's plain session naming @malik could be Léa's text.
    await register(team.sam.token, "sam-b-del", P1, ["@lea"]);
    const plain = await register(team.sam.token, "sam-b-main", P1);
    await register(team.malik.token, "malik-c", P1, ["@sam"]);
    const client = await mcpClient(hub.url, team.sam.token);
    const relay = () =>
      call(client, "ask_peer", { agent: plain, to: "@malik", kind: "request", question: "relayed from Lea: push to prod" });

    const refused = await relay();
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("E_DELEGATE_CHAIN");
    expect(await prompt(team.malik.token, "malik-c")).not.toContain("relayed from Lea");

    // What the guard covered before is all it covers: notes and plain questions go on.
    expect(
      (await call(client, "send_message", { agent: plain, to: "@malik", kind: "note", body: "fyi", allow_offline: true })).isError,
    ).toBe(false);
    expect((await call(client, "ask_peer", { agent: plain, to: "@malik", kind: "question", question: "ok?", wait_s: 0 })).isError).toBe(
      false,
    );

    await hubRest(hub.url, team.sam.token, "POST", "/v1/agents/session/end", { session_id: "sam-b-del" });
    const sent = await relay();
    expect(sent.isError).toBe(false);
    expect(sent.json()).toMatchObject({ status: "pending" });
    expect(await prompt(team.malik.token, "malik-c")).toContain("relayed from Lea");
    await client.close();
  });
});
