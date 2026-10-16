import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { newKeyPair, publicKeyOf } from "@codetgh/shared/e2e";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { message, thread } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { type Keyring, program } from "../packages/cli/src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
const keyrings: Record<string, Keyring & { store: Map<string, string> }> = {};
const PLAIN = "Friday plan: migrate the users table <b>first</b>";
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  process.env.CODETGH_CONFIG_DIR = mkdtempSync(join(tmpdir(), "codetgh-e2e-"));
});
afterAll(() => hub.stop());

function keyring(who: string) {
  if (!keyrings[who]) {
    const store = new Map<string, string>();
    keyrings[who] = { store, get: (k) => store.get(k) ?? null, set: (k, v) => void store.set(k, v), delete: (k) => void store.delete(k) };
  }
  return keyrings[who];
}

async function cli(who: "lea" | "sam" | "malik", args: string[]) {
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  process.env.CODETGH_URL = hub.url;
  process.env.CODETGH_TOKEN = team[who].token;
  process.exitCode = 0;
  try {
    await program({ keyring: async () => keyring(who), io }).parseAsync(["node", "codetgh", ...args]);
  } finally {
    delete process.env.CODETGH_URL;
    delete process.env.CODETGH_TOKEN;
  }
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: out.join("\n"), code };
}

describe("end-to-end encrypted threads (phase 3)", () => {
  let sentId = "";

  it("publishes each member's public key; the private key stays in the keychain", async () => {
    for (const who of ["lea", "sam"] as const) expect((await cli(who, ["keys", "init"])).out).toContain("public key published");
    expect([...keyring("lea").store.keys()].some((k) => k.endsWith("#e2e"))).toBe(true);
  });

  it("stores only ciphertext and lets the recipient decrypt locally", async () => {
    const sent = await cli("sam", ["send", "--encrypt", "--to", "@lea", "--kind", "question", "--body", PLAIN]);
    sentId = sent.out.match(/msg_[0-9A-Z]{26}/)?.[0] ?? "";
    expect(sentId).not.toBe("");

    const [row] = await hub.db.select().from(message).where(eq(message.id, sentId));
    expect(row?.encrypted).toBe(true);
    expect(row?.body.startsWith("v1.")).toBe(true);
    const [t] = await hub.db
      .select()
      .from(thread)
      .where(eq(thread.id, row?.threadId ?? ""));
    expect(t?.encrypted).toBe(true);
    const dump = await hub.db.execute(sql`
      select string_agg(t::text, ' ') as all_text from (
        select row_to_json(m)::text as t from message m
        union all select row_to_json(th)::text from thread th
        union all select row_to_json(a)::text from alert a
        union all select row_to_json(e)::text from audit_event e
      ) x`);
    expect(String((dump as unknown as { rows: Array<{ all_text: string }> }).rows[0]?.all_text)).not.toContain("migrate the users");

    const inbox = await cli("lea", ["inbox"]);
    expect(inbox.out).toContain("Friday plan: migrate the users table &lt;b&gt;first&lt;/b&gt;");
    expect(inbox.out).toContain('trust="untrusted-peer"');
  });

  it("keeps replies encrypted and the thread closed to others", async () => {
    expect((await cli("lea", ["send", "--encrypt", "--reply-to", sentId, "--kind", "answer", "--body", "Agreed, Friday."])).code).toBe(0);
    expect((await cli("sam", ["inbox"])).out).toContain("Agreed, Friday.");

    const plain = await fetch(`${hub.url}/v1/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${team.lea.token}`, "content-type": "application/json" },
      body: JSON.stringify({ reply_to: sentId, kind: "note", body: "plain text in an encrypted thread" }),
    });
    expect(plain.status).toBe(400);
    expect(
      (await fetch(`${hub.url}/v1/messages/${sentId}/thread-key`, { headers: { Authorization: `Bearer ${team.malik.token}` } })).status,
    ).toBe(404);
  });

  it("keeps the subject and refs of an encrypted message out of the hub's clear text", async () => {
    await expect(cli("sam", ["send", "--encrypt", "--to", "@lea", "--subject", "users table migration", "--body", "x"])).rejects.toThrow(
      "no subject",
    );
    const send = (body: Record<string, unknown>) =>
      fetch(`${hub.url}/v1/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${team.lea.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const sealed = (await hub.db.select().from(message).where(eq(message.id, sentId)))[0]?.body;
    expect((await send({ reply_to: sentId, kind: "note", body: sealed, subject: "in clear", encrypted: { flags: [] } })).status).toBe(400);
    const refs = await send({
      reply_to: sentId,
      kind: "note",
      body: sealed,
      refs: [{ type: "file", path: "db/users.sql" }],
      encrypted: { flags: [] },
    });
    expect(refs.status).toBe(400);
    expect(((await refs.json()) as { code: string }).code).toBe("E_INVALID");
  });

  it("checks the shape of what claims to be encrypted, and marks it as unscanned by the hub", async () => {
    const send = (body: Record<string, unknown>) =>
      fetch(`${hub.url}/v1/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${team.sam.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    // Plain text dressed as an encrypted reply.
    expect((await send({ reply_to: sentId, kind: "note", body: "v1.not-really.ciphertext", encrypted: { flags: [] } })).status).toBe(400);
    const [row] = await hub.db.select().from(message).where(eq(message.id, sentId));
    expect(row?.flags).toContain("encrypted");
  });

  it("scans for secrets on the client, before encrypting", async () => {
    const r = await cli("sam", ["send", "--encrypt", "--to", "@lea", "--body", `token ghp_${"Zx9Kq2Lm7Np4Rt8Vw1Yb3Cd6Fg0Hj5Ks2Lp"}`]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("secret");
  });

  it("refuses a recipient without a key, and shows MCP readers a placeholder", async () => {
    expect((await cli("sam", ["send", "--encrypt", "--to", "@malik", "--body", "hi"])).code).toBe(1);
    const lea = await mcpClient(hub.url, team.lea.token);
    const r = await call(lea, "inbox_read", {});
    await lea.close();
    expect(r.text).not.toContain("v1.");
    expect(r.text).toContain("encrypted");
  });

  it("pins each recipient's public key, and refuses to seal for a key the hub swapped", async () => {
    // Someone holding Léa's token (or the hub itself) replaces her public key with one they control.
    const swapped = await fetch(`${hub.url}/v1/keys`, {
      method: "POST",
      headers: { Authorization: `Bearer ${team.lea.token}`, "content-type": "application/json" },
      body: JSON.stringify({ public_key: publicKeyOf(newKeyPair().privateKey) }),
    });
    expect(swapped.status).toBeLessThan(300);
    const refused = await cli("sam", ["send", "--encrypt", "--to", "@lea", "--body", "new plan"]);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("@lea's encryption key changed");
    // After checking with Léa, Sam accepts the new key.
    expect((await cli("sam", ["keys", "trust", "@lea"])).code).toBe(0);
    expect((await cli("sam", ["send", "--encrypt", "--to", "@lea", "--body", "new plan"])).code).toBe(0);
  });
});
