import { describe, expect, it } from "vitest";
import { dockerRunArgs } from "../src/main.js";

const base = {
  name: "codetgh-job-tsk_01",
  owner: "vps:runner-0123456789abcdef",
  image: "codetgh-runner-agent:0.4.16",
  worktree: "/home/r/.config/codetgh/worktrees/prj/tsk_01",
  readOnly: false,
  authEnv: "CLAUDE_CODE_OAUTH_TOKEN",
  memory: "4g",
  cpus: 2,
  gid: 1001,
  command: ["claude", "-p", "the prompt"],
};

describe("docker run argv for a runner agent", () => {
  it("carries every hardening flag, then the image and the command", () => {
    const argv = dockerRunArgs(base);
    expect(argv.slice(0, 3)).toEqual(["run", "--rm", "-i"]);
    expect(argv).toEqual(
      expect.arrayContaining([
        "--name=codetgh-job-tsk_01",
        "--label=codetgh.job=codetgh-job-tsk_01",
        "--label=codetgh.runner=vps:runner-0123456789abcdef",
        "--network=bridge",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--pids-limit=512",
        "--memory=4g",
        "--cpus=2",
        "--user=10001:1001",
        "--workdir=/work",
      ]),
    );
    expect(argv.some((a) => a.startsWith("--tmpfs=/tmp:"))).toBe(true);
    expect(argv.slice(-4)).toEqual(["codetgh-runner-agent:0.4.16", "claude", "-p", "the prompt"]);
    expect(argv.join(" ")).not.toMatch(/--privileged|--cap-add|--network=host|--pid=|--ipc=|seccomp=unconfined/);
  });

  it("mounts the worktree alone, its .git pointer hidden, and read-only for the reviewer", () => {
    const mounts = (argv: string[]) => argv.filter((a) => a.startsWith("--mount=") || a.startsWith("-v") || a.startsWith("--volume"));
    expect(mounts(dockerRunArgs(base))).toEqual([
      `--mount=type=bind,src=${base.worktree},dst=/work`,
      "--mount=type=bind,src=/dev/null,dst=/work/.git,readonly",
    ]);
    expect(mounts(dockerRunArgs({ ...base, readOnly: true }))).toEqual([
      `--mount=type=bind,src=${base.worktree},dst=/work,readonly`,
      "--mount=type=bind,src=/dev/null,dst=/work/.git,readonly",
    ]);
  });

  it("passes the auth variable by name only, and nothing of the owner's environment", () => {
    const argv = dockerRunArgs({ ...base, authEnv: "ANTHROPIC_API_KEY" });
    const env = argv.filter((a) => a.startsWith("--env") || a === "-e");
    expect(env).toEqual(["--env=ANTHROPIC_API_KEY"]);
    expect(argv.join(" ")).not.toMatch(/CODETGH_TOKEN|HOME|SSH|GH_TOKEN|GITHUB_TOKEN|\.ssh|\.claude|\.config\/gh/);
  });

  it("refuses a worktree path that would break the mount syntax", () => {
    expect(() => dockerRunArgs({ ...base, worktree: "/a,b" })).toThrow(/worktree path/);
  });
});
