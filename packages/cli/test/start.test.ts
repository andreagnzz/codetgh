import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, expect, it } from "vitest";
import { fakeCommand } from "../../../e2e/helpers.js";
import { program } from "../src/main.js";

// A fake claude: writes its arguments as JSON and exits with 3, so the test sees both pass through.
const PATH = process.env.PATH;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codetgh-start-"));
  fakeCommand(
    dir,
    "claude",
    `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(dir, "args.json"))}, JSON.stringify(process.argv.slice(2)));
process.exitCode = 3;`,
  );
  process.env.PATH = `${dir}${delimiter}${PATH}`;
});
afterEach(() => {
  process.env.PATH = PATH;
  process.exitCode = 0;
});

async function start(args: string[]) {
  const io = { out: () => {}, err: () => {}, stdin: Readable.from([""]) };
  const keyring = { get: () => null, set: () => {}, delete: () => {} };
  process.exitCode = 0;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", "start", ...args]);
  const code = process.exitCode;
  process.exitCode = 0;
  return { args: JSON.parse(readFileSync(join(dir, "args.json"), "utf8")) as string[], code };
}

it("runs claude with the plugin on for this session only, a session name, and the user's arguments", async () => {
  const { args, code } = await start(["--", "--foo"]);
  expect(args).toEqual([
    "--settings",
    '{"enabledPlugins":{"codetgh@codetgh":true}}',
    "-n",
    `codetgh · ${basename(process.cwd())}`,
    "--foo",
  ]);
  expect(code).toBe(3);
});

it("keeps the user's own session name", async () => {
  expect((await start(["-n", "mine"])).args).toEqual(["--settings", '{"enabledPlugins":{"codetgh@codetgh":true}}', "-n", "mine"]);
  expect((await start(["--name=mine", "-c"])).args).toEqual([
    "--settings",
    '{"enabledPlugins":{"codetgh@codetgh":true}}',
    "--name=mine",
    "-c",
  ]);
});
