import { newKeyPair, newThreadKey, publicKeyOf, sealBody, wrapKey } from "@codetgh/shared/e2e";
import { repoFingerprint } from "@codetgh/shared/repo";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth, callOnce, type Hub, startHub, startSession } from "../apps/hub/test/harness.js";
import { stream } from "./helpers.js";

// message_status: what the hub knows of a message's delivery, for its sender and its recipients only.
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

const tool = async (name: string, args: Record<string, unknown>, token = team.sam.token) => {
  const r = await callOnce(hub.url, token, name, args);
  return { isError: r.isError, out: r.json() };
};
const send = (args: Record<string, unknown>) => tool("send_message", { kind: "note", body: "hello", ...args });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("message_status", () => {
  const status = (id: string, token = team.sam.token) => tool("message_status", { message_id: id }, token);

  it("shows delivery, reading and the ack, to the sender and the recipient only", async () => {
    const sent = await send({ agent: ids["sam-p1"], to: "@lea", kind: "request", body: "rotate the staging config" });
    expect((await status(sent.out.id)).out).toEqual({
      message_id: sent.out.id,
      recipients: [{ handle: "@lea", agent: null, delivered_at: null, read_at: null, ack: null }],
      others: null,
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
    const s = stream(hub.url, team.lea.token, "lea-p1");
    await s.ready();
    const sent = await send({ agent: ids["sam-p1"], to: "@lea", body: "streamed" });
    let delivered: string | null = null;
    for (let i = 0; i < 100 && !delivered; i++) {
      delivered = (await status(sent.out.id)).out.recipients[0].delivered_at;
      if (!delivered) await sleep(20);
    }
    const text = await s.close();
    expect(text).toContain(sent.out.id);
    expect(delivered).toEqual(expect.any(String));
  });

  const ISO = /\d{4}-\d{2}-\d{2}T/;

  it("shows a recipient of a team message their own row and counts for the others, never their timestamps", async () => {
    const sent = await send({ agent: ids["sam-p1"], to: "@team" });
    await tool("ack", { agent: ids["lea-p1"], message_ids: [sent.out.id] }, team.lea.token);
    const lea = await status(sent.out.id, team.lea.token);
    expect(lea.out.recipients).toHaveLength(1);
    expect(lea.out.recipients[0]).toMatchObject({ handle: "@lea", read_at: expect.any(String) });
    expect(lea.out.others).toEqual({ count: 1, delivered: 0, read: 0 });

    // Malik never opened it: he sees his own empty row, and that one other person has read it, not when.
    const malik = await status(sent.out.id, team.malik.token);
    expect(malik.out.recipients).toEqual([{ handle: "@malik", agent: null, delivered_at: null, read_at: null, ack: null }]);
    expect(malik.out.others).toEqual({ count: 1, delivered: 1, read: 1 });
    expect(JSON.stringify(malik.out)).not.toMatch(ISO);
  });

  it("gives the sender of a message to several people counts, not a row each", async () => {
    const sent = await send({ agent: ids["sam-p1"], to: "@team" });
    await tool("ack", { agent: ids["lea-p1"], message_ids: [sent.out.id] }, team.lea.token);
    const sam = await status(sent.out.id);
    expect(sam.out).toEqual({ message_id: sent.out.id, recipients: [], others: { count: 2, delivered: 1, read: 1 } });
  });

  it("refuses a thread participant who neither sent nor received the message", async () => {
    const team1 = await send({ agent: ids["sam-p1"], to: "@team" });
    const reply = await send({ agent: ids["sam-p1"], to: "@lea", reply_to: team1.out.id });
    expect((await status(reply.out.id)).isError).toBe(false);
    const malik = await status(reply.out.id, team.malik.token);
    expect(malik.isError).toBe(true);
    expect(malik.out.code).toBe("E_NOT_FOUND");
  });

  it("shows an encrypted message's recipients only their own row", async () => {
    const keys = Object.fromEntries(["sam", "lea", "malik"].map((h) => [h, newKeyPair()]));
    const thread = newThreadKey();
    const res = await fetch(`${hub.url}/v1/messages`, {
      method: "POST",
      headers: auth(team.sam.token),
      body: JSON.stringify({
        to: ["@lea", "@malik"],
        kind: "note",
        body: sealBody("plan", thread),
        allow_offline: true,
        encrypted: {
          flags: [],
          keys: Object.entries(keys).map(([h, k]) => ({ handle: `@${h}`, wrapped: wrapKey(thread, publicKeyOf(k.privateKey)) })),
        },
      }),
    });
    const sent = (await res.json()) as { id: string };
    expect(res.status).toBe(200);
    await fetch(`${hub.url}/v1/ack`, { method: "POST", headers: auth(team.lea.token), body: JSON.stringify({ message_ids: [sent.id] }) });
    const malik = await status(sent.id, team.malik.token);
    expect(malik.out.recipients).toHaveLength(1);
    expect(malik.out.recipients[0].handle).toBe("@malik");
    expect(malik.out.others).toBeNull();
    expect((await status(sent.id, team.lea.token)).out.others).toBeNull();
    // The sender chose both recipients: counts, as for any message to several people.
    expect((await status(sent.id)).out.others).toEqual({ count: 2, delivered: 1, read: 1 });
  });
});
