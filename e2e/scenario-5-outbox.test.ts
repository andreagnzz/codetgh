import { copyFileSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { message } from "../apps/hub/src/db/schema.js";
import { call, type Hub, mcpClient, startHub } from "../apps/hub/test/harness.js";
import { daemon, program } from "../packages/cli/src/main.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
let config: string;
const DEAD = "http://127.0.0.1:9";
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
  config = mkdtempSync(join(tmpdir(), "codetgh-outbox-"));
  process.env.CODETGH_CONFIG_DIR = config;
});
afterAll(() => hub.stop());

async function cli(args: string[], env: { url: string; token: string }) {
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  process.env.CODETGH_URL = env.url;
  process.env.CODETGH_TOKEN = env.token;
  process.exitCode = 0;
  try {
    await program({ keyring: async () => ({ get: () => null, set() {}, delete() {} }), io }).parseAsync(["node", "codetgh", ...args]);
  } finally {
    delete process.env.CODETGH_URL;
    delete process.env.CODETGH_TOKEN;
  }
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: out.join("\n"), code };
}

// One hub address, unreachable until up(): then a relay to the test hub listens on it, as when the hub comes back.
async function hubDownThenUp() {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const { port } = probe.address() as AddressInfo;
  await new Promise((r) => probe.close(r));
  const relay = createServer((req, res) => {
    const out = request(`${hub.url}${req.url}`, { method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    req.pipe(out);
  });
  return {
    url: `http://127.0.0.1:${port}`,
    up: () => new Promise<void>((r) => relay.listen(port, "127.0.0.1", r)),
    stop: () => {
      relay.closeAllConnections();
      relay.close();
    },
  };
}

const bodies = async (text: string) => (await hub.db.select().from(message).where(eq(message.body, text))).length;

// Reads SSE frames from /v1/stream until `until` returns true.
async function sse(token: string, lastEventId: string | null, until: (events: Array<{ id: string; data: string }>) => boolean) {
  const ctl = new AbortController();
  const res = await fetch(`${hub.url}/v1/stream`, {
    headers: { Authorization: `Bearer ${token}`, ...(lastEventId !== null && { "Last-Event-ID": lastEventId }) },
    signal: ctl.signal,
  });
  expect(res.status).toBe(200);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  const events: Array<{ id: string; data: string }> = [];
  let buf = "";
  const done = (async () => {
    while (!until(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const field = (k: string) => frame.match(new RegExp(`^${k}: ?(.*)$`, "m"))?.[1];
        if (field("event") === "message") events.push({ id: field("id") ?? "", data: field("data") ?? "" });
      }
    }
    ctl.abort();
    return events;
  })();
  return done;
}

describe("REST send", () => {
  it("sends from the CLI agent and replays an idempotency key once", async () => {
    const send = () =>
      fetch(`${hub.url}/v1/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${team.sam.token}`, "content-type": "application/json" },
        body: JSON.stringify({ to: "@lea", kind: "note", body: "rest once", idempotency_key: "k-rest-1" }),
      });
    const a = await (await send()).json();
    const b = await (await send()).json();
    expect(a.id).toMatch(/^msg_/);
    expect(b.id).toBe(a.id);
    expect(await bodies("rest once")).toBe(1);
  });
});

describe("stream", () => {
  it("pushes ids of new messages and resumes from Last-Event-ID without text", async () => {
    const live = sse(team.lea.token, null, (e) => e.length >= 1);
    await new Promise((r) => setTimeout(r, 200));
    const sam = await mcpClient(hub.url, team.sam.token);
    const sent = JSON.parse((await call(sam, "send_message", { to: "@lea", kind: "note", body: "streamed secret-free text" })).text);
    await sam.close();
    const [first] = await live;
    expect(JSON.parse(first?.data ?? "{}")).toMatchObject({ message_id: sent.id, kind: "note" });
    expect(first?.data).not.toContain("streamed");

    const replay = await sse(team.lea.token, "0", (e) => e.some((x) => x.id === first?.id));
    expect(replay.length).toBeGreaterThanOrEqual(2);
    expect(replay.map((e) => Number(e.id))).toEqual([...replay.map((e) => Number(e.id))].sort((x, y) => x - y));
  });
});

describe("outbox (scenario 5, phase 2)", () => {
  it("queues a CLI send while the hub is down and replays it once", async () => {
    const sam = await hubDownThenUp();
    const down = await cli(["send", "--to", "@lea", "--body", "sent while offline"], { url: sam.url, token: team.sam.token });
    expect(down.out).toContain("queued");
    expect(down.code).toBe(0);
    const file = join(config, "outbox.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain(team.sam.token);

    await sam.up();
    copyFileSync(file, `${file}.bak`);
    expect((await cli(["outbox", "flush"], { url: sam.url, token: team.sam.token })).out).toContain("1 sent");
    // The hub answered but the reply was lost: the same entry is sent again and the hub keeps one copy.
    copyFileSync(`${file}.bak`, file);
    await cli(["outbox", "flush"], { url: sam.url, token: team.sam.token });
    expect(await bodies("sent while offline")).toBe(1);
    expect((await cli(["outbox", "flush"], { url: sam.url, token: team.sam.token })).out).toContain("0 sent");
    sam.stop();
  });

  it("only sends a queued message to the hub and the account it was written for", async () => {
    const old = await hubDownThenUp();
    await cli(["send", "--to", "@lea", "--body", "queued for the old hub"], { url: old.url, token: team.sam.token });
    // After logging in elsewhere, or as someone else, the queue is kept, not sent.
    const elsewhere = await cli(["outbox", "flush"], { url: hub.url, token: team.sam.token });
    expect(elsewhere.out).toContain("0 sent, 1 kept for another hub or account");
    await old.up();
    expect((await cli(["outbox", "flush"], { url: old.url, token: team.malik.token })).out).toContain("0 sent, 1 kept");
    expect(await bodies("queued for the old hub")).toBe(0);
    expect((await cli(["outbox", "flush"], { url: old.url, token: team.sam.token })).out).toContain("1 sent");
    const [m] = await hub.db.select().from(message).where(eq(message.body, "queued for the old hub"));
    expect(m?.fromUserId).toBe(team.sam.userId);
    old.stop();
  });

  it("refuses to queue a secret", async () => {
    const r = await cli(["send", "--to", "@lea", "--body", `key ghp_${"Zx9Kq2Lm7Np4Rt8Vw1Yb3Cd6Fg0Hj5Ks2Lp"}`], {
      url: DEAD,
      token: team.sam.token,
    });
    expect(r.code).toBe(1);
    expect(readFileSync(join(config, "outbox.json"), "utf8")).not.toContain("ghp_");
  });

  it("the daemon flushes the outbox and prints one line per incoming message", async () => {
    const back = await hubDownThenUp();
    await cli(["send", "--to", "@lea", "--body", "flushed by the daemon"], { url: back.url, token: team.sam.token });
    await back.up();
    const lines: string[] = [];
    const ctl = new AbortController();
    const running = daemon({ url: back.url, token: team.sam.token, out: (s) => lines.push(s), signal: ctl.signal });
    for (let i = 0; i < 50 && !(await bodies("flushed by the daemon")); i++) await new Promise((r) => setTimeout(r, 100));
    expect(await bodies("flushed by the daemon")).toBe(1);

    const lea = await mcpClient(hub.url, team.lea.token);
    const sent = JSON.parse((await call(lea, "send_message", { to: "@sam", kind: "question", body: "ping" })).text);
    await lea.close();
    for (let i = 0; i < 50 && !lines.some((l) => l.includes(sent.id)); i++) await new Promise((r) => setTimeout(r, 100));
    ctl.abort();
    await running;
    back.stop();
    expect(lines.find((l) => l.includes(sent.id))).toMatch(/question/);
  });
});
