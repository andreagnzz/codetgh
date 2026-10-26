import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

// Tests run the same single-file bundle the plugin ships, built once per test process.
let bundle: string | undefined;
export function hookBundle() {
  if (!bundle) {
    // A space in the path, like "C:\Users\Jane Doe\": the hook must still recognise it was run directly.
    const outdir = mkdtempSync(join(tmpdir(), "codetgh bundle-"));
    bundle = join(outdir, "hook.js");
    buildSync({
      entryPoints: [fileURLToPath(new URL("../packages/cli/src/hook.ts", import.meta.url))],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node22",
      banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
      // Same as the plugin build: the secret scanner sits in its own chunk, loaded only by the hooks that scan.
      splitting: true,
      chunkNames: "chunks/[name]-[hash]",
      outdir,
      logLevel: "error",
    });
  }
  return bundle;
}

// A fake command on PATH: a Node script behind the launcher each OS runs, an sh script or, on Windows, a .cmd file
// like the one npm installs for claude.
export function fakeCommand(dir: string, name: string, js: string) {
  writeFileSync(join(dir, `${name}.mjs`), js);
  if (process.platform === "win32") {
    writeFileSync(join(dir, `${name}.cmd`), `@"${process.execPath}" "%~dp0${name}.mjs" %*\r\n`);
    return;
  }
  writeFileSync(join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/${name}.mjs" "$@"\n`);
  chmodSync(join(dir, name), 0o755);
}

export type HookRun = { out: Record<string, unknown> | null; raw: string; err: string; ms: number; code: number | null };

// Runs the plugin hook like Claude Code does: event name in argv, hook input JSON on stdin.
export function runHook(
  event: string,
  input: Record<string, unknown>,
  env: Record<string, string>,
  entry = hookBundle(),
): Promise<HookRun> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, event], { env: { PATH: process.env.PATH ?? "", ...env } });
    let raw = "";
    let err = "";
    child.stdout.on("data", (d) => {
      raw += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ out: raw.trim() ? JSON.parse(raw) : null, raw, err, ms: Date.now() - started, code }));
    child.stdin.end(JSON.stringify({ hook_event_name: event, cwd: process.cwd(), ...input }));
  });
}

export const systemMessage = (r: Pick<HookRun, "out">) => String((r.out as { systemMessage?: string } | null)?.systemMessage ?? "");

export const additionalContext = (r: Pick<HookRun, "out">) =>
  String((r.out?.hookSpecificOutput as { additionalContext?: string } | undefined)?.additionalContext ?? "");

export const hookEnv = (url: string, token: string) => ({
  CLAUDE_PLUGIN_OPTION_CODETGH_URL: url,
  CLAUDE_PLUGIN_OPTION_CODETGH_TOKEN: token,
  CODETGH_STATE_DIR: mkdtempSync(join(tmpdir(), "codetgh-hook-")),
});

export async function csrfToken(url: string, cookie: string) {
  const html = await (await fetch(`${url}/console`, { headers: { cookie } })).text();
  const m = html.match(/X-CSRF-Token&quot;:&quot;([^&]+)&quot;|"X-CSRF-Token":"([^"]+)"/);
  const token = m?.[1] ?? m?.[2];
  if (!token) throw new Error("no CSRF token on the console page");
  return token;
}

export async function consolePost(url: string, cookie: string, path: string, form: Record<string, string> = {}) {
  return fetch(`${url}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { cookie, "X-CSRF-Token": await csrfToken(url, cookie), "content-type": "application/x-www-form-urlencoded", origin: url },
    body: new URLSearchParams(form).toString(),
  });
}

// Plays the person in the browser: waits for the code the CLI prints, then approves it in the console.
export async function approveDevice(url: string, cookie: string, out: string[]) {
  for (;;) {
    const code = out.join("\n").match(/\b[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}\b/)?.[0];
    if (code) return consolePost(url, cookie, "/console/device/approve", { user_code: code });
    await new Promise((r) => setTimeout(r, 50));
  }
}

// Fake keys are assembled at runtime so no literal credential lands in the repository.
export const fakeGithubToken = () => `ghp_${"Zx9Kq2Lm7Np4Rt8Vw1Yb3Cd6Fg0Hj5Ks2Lp"}`;

// A throwaway git repository whose origin makes every session in it share one project.
export function gitRepo(origin = "git@github.com:acme/webapp.git") {
  const dir = mkdtempSync(join(tmpdir(), "codetgh-repo-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", origin]);
  return dir;
}

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Opens a session's SSE stream; ready() waits for the ready event, waitFor(s) for a string, close() aborts and returns everything that arrived.
export function stream(url: string, token: string, session: string) {
  const ctl = new AbortController();
  let text = "";
  const done = fetch(`${url}/v1/stream?session_id=${session}`, { headers: { Authorization: `Bearer ${token}` }, signal: ctl.signal })
    .then(async (res) => {
      for await (const chunk of res.body ?? []) text += new TextDecoder().decode(chunk);
    })
    .catch(() => {});
  return {
    ready: async () => {
      for (let i = 0; i < 100 && !text.includes("event: ready"); i++) await new Promise((r) => setTimeout(r, 20));
    },
    waitFor: async (s: string) => {
      for (let i = 0; i < 100 && !text.includes(s); i++) await new Promise((r) => setTimeout(r, 20));
      return text;
    },
    close: async () => {
      ctl.abort();
      await done;
      return text;
    },
  };
}
