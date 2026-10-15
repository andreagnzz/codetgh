import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, it } from "vitest";
import { program } from "../src/main.js";

// A hub checkout on a VPS, with git, docker and the deploy scripts replaced by fakes that log their calls.
const PATH = process.env.PATH;
let repo: string;
let log: string;
let ready: Server | undefined;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "codetgh-ops-"));
  log = join(repo, "calls.log");
  mkdirSync(join(repo, "deploy/backups"), { recursive: true });
  mkdirSync(join(repo, "bin"));
  writeFileSync(join(repo, "deploy/compose.yaml"), "name: codetgh\n");
  const fake = (path: string, body: string) => {
    writeFileSync(path, `#!/bin/sh\necho "${path.split("/").pop()} $*" >> "${log}"\n${body}\n`);
    chmodSync(path, 0o755);
  };
  fake(join(repo, "deploy/backup.sh"), `touch "${repo}/deploy/backups/codetgh-x.dump"; echo deploy/backups/codetgh-x.dump`);
  fake(join(repo, "deploy/restore-test.sh"), `[ -z "$FAKE_RESTORE_FAILS" ] || exit 1; echo "restore check: 12 tables match"`);
  fake(
    join(repo, "bin/git"),
    `[ "$1" = rev-parse ] && echo abc1234\n[ "$1" = pull ] && [ -n "$FAKE_GIT_FAILS" ] && { echo "fatal: Not possible to fast-forward" >&2; exit 1; }\nexit 0`,
  );
  fake(join(repo, "bin/docker"), "");
  process.env.PATH = `${join(repo, "bin")}${delimiter}${PATH}`;
});
afterEach(() => {
  process.env.PATH = PATH;
  delete process.env.FAKE_RESTORE_FAILS;
  delete process.env.FAKE_GIT_FAILS;
  ready?.close();
  ready = undefined;
});

async function cli(args: string[]) {
  const out: string[] = [];
  const io = { out: (s: string) => out.push(s), err: (s: string) => out.push(s), stdin: Readable.from([""]) };
  process.exitCode = 0;
  await program({ keyring: async () => ({ get: () => null, set() {}, delete() {} }), io }).parseAsync(["node", "codetgh", ...args]);
  const code = process.exitCode;
  process.exitCode = 0;
  return { out: out.join("\n"), code };
}
const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);

// Any user on the machine could otherwise plant a deploy/ the admin's CLI then runs.
it.skipIf(process.platform === "win32")("refuses to run deploy scripts that others can change", async () => {
  chmodSync(join(repo, "deploy/backup.sh"), 0o777);
  await expect(cli(["backup", "--dir", repo])).rejects.toThrow(/writable by others/);
  expect(calls()).toEqual([]);
});
async function hub(status: number) {
  ready = createServer((req, res) => res.writeHead(req.url === "/readyz" ? status : 404).end());
  await new Promise<void>((r) => ready?.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(ready.address() as AddressInfo).port}`;
}

it("backup dumps the database, then checks that the dump restores", async () => {
  const r = await cli(["backup", "--dir", join(repo, "deploy")]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("deploy/backups/codetgh-x.dump");
  expect(r.out).toContain("restore check: 12 tables match");
  expect(calls()).toEqual(["backup.sh ", "restore-test.sh deploy/backups/codetgh-x.dump"]);
});

it("backup fails loudly when the dump does not restore", async () => {
  process.env.FAKE_RESTORE_FAILS = "1";
  await expect(cli(["backup", "--dir", repo])).rejects.toThrow(/the dump did not restore/);
});

it("backup says where to run it from outside a hub checkout", async () => {
  await expect(cli(["backup", "--dir", tmpdir()])).rejects.toThrow(/no deploy\/compose.yaml/);
});

it("update pulls, backs up, rebuilds, then waits for the hub to be ready", async () => {
  const url = await hub(200);
  const r = await cli(["update", "--dir", repo, "--hub", url]);
  expect(r.code).toBe(0);
  expect(r.out).toContain("hub is up");
  expect(calls()).toEqual([
    "git rev-parse HEAD",
    "git pull --ff-only",
    "backup.sh ",
    "restore-test.sh deploy/backups/codetgh-x.dump",
    "docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build",
  ]);
});

it("update touches no container when the pull fails", async () => {
  process.env.FAKE_GIT_FAILS = "1";
  await expect(cli(["update", "--dir", repo, "--hub", await hub(200)])).rejects.toThrow(/Not possible to fast-forward/);
  expect(calls()).toEqual(["git rev-parse HEAD", "git pull --ff-only"]);
});

it("update says how to roll back when the new hub does not come up", async () => {
  await expect(cli(["update", "--dir", repo, "--hub", await hub(503), "--wait", "1"])).rejects.toThrow(/not ready.*git checkout abc1234/);
});
