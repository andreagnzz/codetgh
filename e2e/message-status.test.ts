import { repoFingerprint } from "@codetgh/shared/repo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, type Hub, mcpClient, startHub, startSession } from "../apps/hub/test/harness.js";

// message_status: what the hub knows of a message's delivery, for the people of its thread only.
let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const P1 = repoFingerprint("git@github.com:acme/webapp.git");
const ids: Record<string, string> = {};
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  ids["sam-p1"] = (await startSession(hub.url, team.sam.token, "sam-p1", { repo: P1 })).agent_id ?? "";
  ids["lea-p1"] = (await startSession(hub.url, team.lea.token, "lea-p1", { repo: P1 })).agent_id ?? "";
});
afterAll(() => hub.stop());

const auth = (token: string) => ({ Authorization: `Bearer ${token}`, "content-type": "application/json" });
const tool = async (name: string, args: Record<string, unknown>, token = team.sam.token) => {
  const c = await mcpClient(hub.url, token);
  const r = await call(c, name, args);
  await c.close();
  return { isError: r.isError, out: r.json() };
};
const send = (args: Record<string, unknown>) => tool("send_message", { kind: "note", body: "hello", ...args });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("message_status", () => {
  const status = (id: string, token = team.sam.token) => tool("message_status", { message_id: id }, token);

  it("shows delivery, reading and the ack, to the sender and the thread's participants only", async () => {
    const sent = await send({ agent: ids["sam-p1"], to: "@lea", kind: "request", body: "rotate the staging config" });
    expect((await status(sent.out.id)).out).toEqual({
      message_id: sent.out.id,
      recipients: [{ handle: "@lea", agent: null, delivered_at: null, read_at: null, ack: null }],
    });
    await fetch(`${hub.url}/v1/inbox/prompt?session_id=lea-p1`, { headers: auth(team.lea.token) });
    const delivered = (await status(sent.out.id)).out.recipients[0];
    expect(delivered.delivered_at).toEqual(expect.any(String));
    expect(delivered.read_at).toBeNull();

    await tool(
      "ack",
      { agent: ids["lea-p1"], message_ids: [sent.out.id], status: "done", note: "rotated, see the vault log" },
      team.lea.token,
    );
    const acked = (await status(sent.out.id, team.lea.token)).out.recipients[0];
    expect(acked).toMatchObject({ handle: "@lea", read_at: expect.any(String), ack: { status: "done", note_chars: 26 } });
    expect(JSON.stringify(acked)).not.toContain("vault");

    const outsider = await status(sent.out.id, team.malik.token);
    expect(outsider.isError).toBe(true);
    expect(outsider.out.code).toBe("E_NOT_FOUND");
    const rest = await fetch(`${hub.url}/v1/messages/${sent.out.id}/status`, { headers: auth(team.sam.token) });
    expect(await rest.json()).toMatchObject({ recipients: [{ handle: "@lea", ack: { status: "done" } }] });
    expect((await fetch(`${hub.url}/v1/messages/${sent.out.id}/status`, { headers: auth(team.malik.token) })).status).toBe(404);
  });

  it("counts inbox_read as delivery", async () => {
    const sent = await send({ agent: ids["sam-p1"], to: "@lea", body: "read me" });
    await tool("inbox_read", { agent: ids["lea-p1"] }, team.lea.token);
    expect((await status(sent.out.id)).out.recipients[0].delivered_at).toEqual(expect.any(String));
  });

  it("counts a session's stream push as delivery", async () => {
    const ctl = new AbortController();
    let text = "";
    const done = fetch(`${hub.url}/v1/stream?session_id=lea-p1`, { headers: auth(team.lea.token), signal: ctl.signal })
      .then(async (res) => {
        for await (const chunk of res.body ?? []) text += new TextDecoder().decode(chunk);
      })
      .catch(() => {});
    for (let i = 0; i < 100 && !text.includes("event: ready"); i++) await sleep(20);
    const sent = await send({ agent: ids["sam-p1"], to: "@lea", body: "streamed" });
    let delivered: string | null = null;
    for (let i = 0; i < 100 && !delivered; i++) {
      delivered = (await status(sent.out.id)).out.recipients[0].delivered_at;
      if (!delivered) await sleep(20);
    }
    ctl.abort();
    await done;
    expect(text).toContain(sent.out.id);
    expect(delivered).toEqual(expect.any(String));
  });
});
