import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { type Keyring, program, terminalIo } from "../src/main.js";

// A hub whose text carries terminal escapes everywhere, as an old row or a compromised hub would: clear the screen, set
// the window title, forge a line with a carriage return, recolour with an 8-bit CSI.
const ESC = "\u001b[2J\u001b]0;pwned\u0007\r\u009b31m";
const replies: Record<string, unknown> = {
  "/v1/status": {
    team: `Acme${ESC}`,
    you: { handle: "lea", agent: null },
    paused: false,
    agents_paused: false,
    people: [
      {
        handle: "sam",
        name_untrusted: `Sam${ESC}`,
        status_untrusted: "",
        flags: [],
        status_age_s: null,
        last_seen: null,
        sessions: [{ agent: "agt_x", project_untrusted: "", label_untrusted: `sam@x${ESC}`, presence: "online" }],
      },
    ],
    unread: {},
    blocking_message_ids: [],
    claims: [],
    trust: "untrusted-peer",
  },
  "/v1/inbox": {
    messages: [{ id: "msg_1", kind: "note", thread: "thr_1", e2e: null }],
    envelopes: [`<peer_message trust="untrusted-peer">ok${ESC}forged line\nsecond\tline</peer_message>`],
    next_page_token: null,
  },
  "/v1/launcher/targets": { targets: [{ project_id: "prj_1", project_name: `acme${ESC}forged`, desired: true }] },
};
const hub = createServer((req, res) => {
  const path = (req.url ?? "").split("?")[0] ?? "";
  if (req.headers.authorization === "Bearer ctgh_refused")
    return res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ code: "E_INVALID", message: `refused${ESC}` }));
  if (!replies[path]) return res.writeHead(204).end();
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(replies[path]));
});
let url = "";
let bundle = "";
beforeAll(async () => {
  await new Promise<void>((r) => hub.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`;
  // The CLI as npm installs it, so its real terminal io prints: inside the package, where the keychain module resolves.
  const pkg = fileURLToPath(new URL("..", import.meta.url));
  mkdirSync(join(pkg, "node_modules/.cache"), { recursive: true });
  bundle = join(mkdtempSync(join(pkg, "node_modules/.cache/codetgh-terminal-")), "codetgh.js");
  buildSync({
    entryPoints: [join(pkg, "src/main.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["@napi-rs/keyring"],
    banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
    outfile: bundle,
    logLevel: "error",
  });
});
afterAll(() => hub.close());

const codetgh = (args: string[], token = "ctgh_ok") =>
  promisify(execFile)(process.execPath, [bundle, ...args], {
    env: { ...process.env, CODETGH_URL: url, CODETGH_TOKEN: token, CODETGH_CONFIG_DIR: mkdtempSync(join(tmpdir(), "codetgh-terminal-")) },
  }).catch((e: { stdout: string; stderr: string }) => e);
const CONTROL = /[^\P{Cc}\n\t]/u;

it("prints the team, teammates' names and session labels in codetgh status without escape sequences", async () => {
  const { stdout } = await codetgh(["status"]);
  expect(stdout).toContain("Acme0;pwned, you are @lea");
  expect(stdout).toContain("Online: Sam0;pwned @sam (sam@x0;pwned, online)");
  expect(stdout).not.toMatch(CONTROL);
});

// In this process, through the same io: inbox reads the OS keychain, which a test must not touch.
it("prints a teammate's message in codetgh inbox without escape sequences, newlines and tabs kept", async () => {
  const printed: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((s: string) => void printed.push(s));
  const keyring: Keyring = { get: () => null, set: () => {}, delete: () => {} };
  process.env.CODETGH_URL = url;
  process.env.CODETGH_TOKEN = "ctgh_ok";
  try {
    await program({ keyring: async () => keyring, io: terminalIo() }).parseAsync(["node", "codetgh", "inbox"]);
  } finally {
    log.mockRestore();
    delete process.env.CODETGH_URL;
    delete process.env.CODETGH_TOKEN;
  }
  const stdout = printed.join("\n");
  expect(stdout).toContain("forged line\nsecond\tline");
  expect(stdout).not.toMatch(CONTROL);
});

it("prints the hub's project name in the launcher without escape sequences", async () => {
  const config = join(mkdtempSync(join(tmpdir(), "codetgh-terminal-")), "launcher.json");
  writeFileSync(config, JSON.stringify({ projects: {} }));
  const { stdout } = await codetgh(["launcher", "--config", config, "--once"]);
  expect(stdout).toContain("acme0;pwnedforged: not in this machine's launcher list");
  expect(stdout).not.toMatch(CONTROL);
});

it("prints the hub's error message without escape sequences", async () => {
  const { stderr } = await codetgh(["status"], "ctgh_refused");
  expect(stderr).toContain("codetgh: refused0;pwned");
  expect(stderr).not.toMatch(CONTROL);
});
