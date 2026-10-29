import { newKeyPair, newThreadKey, sealBody, wrapKey } from "@codetgh/shared/e2e";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, setRole, startHub } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const api = (token: string, path: string, body?: Record<string, unknown>) =>
  fetch(`${hub.url}/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });

it("hands a thread's key and ciphertext only for messages the caller sent or received", async () => {
  const key = newThreadKey();
  const keys: Array<{ handle: string; wrapped: string }> = [];
  for (const who of ["lea", "sam", "malik"] as const) {
    const { publicKey } = newKeyPair();
    expect((await api(team[who].token, "/keys", { public_key: publicKey })).status).toBe(204);
    keys.push({ handle: `@${who}`, wrapped: wrapKey(key, publicKey) });
  }
  const send = async (token: string, body: Record<string, unknown>) => {
    const res = await api(token, "/messages", { kind: "note", allow_offline: true, encrypted: { flags: [] }, ...body });
    expect(res.status).toBe(200);
    return ((await res.json()) as { id: string }).id;
  };
  // Sam opens the thread for the three of them, Léa answers Sam alone, Sam passes that answer on to Malik.
  const opening = await send(team.sam.token, {
    to: ["@lea", "@malik"],
    body: sealBody("hello", key),
    encrypted: { flags: [], keys },
  });
  const privateReply = await send(team.lea.token, { reply_to: opening, body: sealBody("for Sam only", key) });
  const forwarded = await send(team.sam.token, { reply_to: privateReply, to: "@malik", body: sealBody("see above", key) });

  const threadKey = (token: string, id: string) => api(token, `/messages/${id}/thread-key`);
  expect((await threadKey(team.malik.token, privateReply)).status).toBe(404);
  expect((await threadKey(team.malik.token, forwarded)).status).toBe(200);
  expect((await threadKey(team.malik.token, opening)).status).toBe(200);
  expect((await threadKey(team.lea.token, privateReply)).status).toBe(200);
  expect((await threadKey(team.sam.token, privateReply)).status).toBe(200);
});

it("answers a bad keys query with 400, not 500", async () => {
  const tooLong = await api(team.lea.token, `/keys?handles=${"a".repeat(501)}`);
  expect(tooLong.status).toBe(400);
  expect(((await tooLong.json()) as { code: string }).code).toBe("E_INVALID");
  expect((await api(team.lea.token, "/keys?handles=@lea,@sam")).status).toBe(200);
});

it("refuses the keys lookup to a guest, who would learn the members and who has a key", async () => {
  await setRole(hub, team.malik.userId, "guest");
  const res = await api(team.malik.token, "/keys?handles=@lea,@sam");
  await setRole(hub, team.malik.userId, "member");
  expect(res.status).toBe(403);
  expect(((await res.json()) as { code: string }).code).toBe("E_FORBIDDEN");
});
