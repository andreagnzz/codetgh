import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
writeFileSync(${JSON.stringify(join(dir, "env.json"))}, JSON.stringify(process.env.CODETGH_ACCEPT_REQUESTS_FROM ?? null));
process.exitCode = 3;`,
  );
  process.env.PATH = `${dir}${delimiter}${PATH}`;
});
afterEach(() => {
  process.env.PATH = PATH;
  process.exitCode = 0;
});

let errors: string[] = [];
async function start(args: string[]) {
  errors = [];
  const io = { out: () => {}, err: (s: string) => errors.push(s), stdin: Readable.from([""]) };
  const keyring = { get: () => null, set: () => {}, delete: () => {} };
  process.exitCode = 0;
  await program({ keyring: async () => keyring, io }).parseAsync(["node", "codetgh", "start", ...args]);
  const code = process.exitCode;
  process.exitCode = 0;
  return {
    args: JSON.parse(readFileSync(join(dir, "args.json"), "utf8")) as string[],
    accept: JSON.parse(readFileSync(join(dir, "env.json"), "utf8")) as string | null,
    code,
  };
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

describe("--accept-requests-from: a delegate session", () => {
  it("runs claude in auto mode, with deny rules beside the plugin and our system prompt, never bypassing permissions", async () => {
    const { args, accept } = await start(["--accept-requests-from", "@andrea,@x", "--", "--foo"]);
    const settings = JSON.parse(args[args.indexOf("--settings") + 1] ?? "{}");
    expect(settings.enabledPlugins).toEqual({ "codetgh@codetgh": true });
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        "Read(.env*)",
        "Read(*.pem)",
        "Read(*.key)",
        "Read(~/.ssh/**)",
        "Read(~/.aws/**)",
        "Bash(git push --force*)",
        "Bash(git push -f*)",
        "Bash(rm -rf*)",
      ]),
    );
    expect(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2)).toEqual(["--permission-mode", "auto"]);
    const prompt = args[args.indexOf("--append-system-prompt") + 1] ?? "";
    expect(prompt).toContain('<peer_message kind="request" authorized="true">');
    expect(prompt).toContain("blocked: <reason>");
    expect(args.join(" ")).not.toMatch(/bypassPermissions|skip-permissions/);
    expect(args.at(-1)).toBe("--foo");
    // The session-start hook reads the list from claude's environment and registers it on the hub.
    expect(accept).toBe("@andrea,@x");
    // Said plainly at launch: the checks reduce the risk, they do not isolate.
    expect(errors.join("\n")).toMatch(/do not isolate this machine: run it in a devcontainer or a dedicated clone/);
  });

  it("keeps the user's own permission mode", async () => {
    const { args } = await start(["--accept-requests-from", "@andrea", "--permission-mode", "acceptEdits"]);
    expect(args.filter((a) => a === "--permission-mode")).toHaveLength(1);
    expect(args.slice(-2)).toEqual(["--permission-mode", "acceptEdits"]);
    expect((await start(["--accept-requests-from", "@andrea", "--permission-mode=plan"])).args).not.toContain("auto");
  });

  it("refuses a handle that is not one, and stays a plain session without the option", async () => {
    await expect(start(["--accept-requests-from", "andrea;rm"])).rejects.toThrow(/@handle/);
    // A delegate session never skips permission checks: a peer's request would then run unreviewed.
    await expect(start(["--accept-requests-from", "@andrea", "--permission-mode", "bypassPermissions"])).rejects.toThrow(/auto/);
    const { args, accept } = await start([]);
    expect(args).not.toContain("--permission-mode");
    expect(args).not.toContain("--append-system-prompt");
    expect(accept).toBeNull();
  });
});
