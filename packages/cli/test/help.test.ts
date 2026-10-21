import { Readable } from "node:stream";
import { expect, it } from "vitest";
import { program } from "../src/main.js";

it("groups the commands: what members use every day first, then admin, then advanced; hook stays hidden", () => {
  const io = { out: () => {}, err: () => {}, stdin: Readable.from([""]) };
  const keyring = { get: () => null, set: () => {}, delete: () => {} };
  const help = program({ keyring: async () => keyring, io }).helpInformation();
  const group = (heading: string) =>
    (help.split(`${heading}\n`)[1]?.split("\n\n")[0] ?? "")
      .split("\n")
      .filter((l) => /^ {2}\S/.test(l))
      .map((l) => l.trim().split(/\s/)[0]);
  expect(group("Everyday:")).toEqual(["setup", "doctor", "start", "status", "send", "inbox", "upgrade"]);
  expect(group("Admin:").sort()).toEqual(["audit", "backup", "invite", "launcher", "project", "update"]);
  expect(group("Advanced:").sort()).toEqual(["daemon", "help", "keys", "login", "logout", "outbox", "pause", "resume"]);
  expect(help.indexOf("Everyday:")).toBeLessThan(help.indexOf("Admin:"));
  expect(help.indexOf("Admin:")).toBeLessThan(help.indexOf("Advanced:"));
  expect(help).not.toMatch(/^\s+hook\b/m);
  // update is the hub's, not the member's CLI: upgrade is.
  expect(help).toMatch(/update \[options\]\s+\(admins, on the hub's machine\) update the\s+hub/);
  expect(help).toMatch(/upgrade\s+update this command and the Claude Code\s+plugin/);
});
