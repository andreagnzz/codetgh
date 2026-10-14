import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";

// Tests run the same single-file bundle the plugin ships, built once per test process.
let bundle: string | undefined;
function hookBundle() {
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

export type HookRun = { out: Record<string, unknown> | null; raw: string; err: string; ms: number; code: number | null };

// Runs the plugin hook like Claude Code does: event name in argv, hook input JSON on stdin.
export function runHook(event: string, input: Record<string, unknown>, env: Record<string, string>): Promise<HookRun> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookBundle(), event], { env: { PATH: process.env.PATH ?? "", ...env } });
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

// Fake keys are assembled at runtime so no literal credential lands in the repository.
export const fakeGithubToken = () => `ghp_${"Zx9Kq2Lm7Np4Rt8Vw1Yb3Cd6Fg0Hj5Ks2Lp"}`;

// A throwaway git repository whose origin makes every session in it share one project.
export function gitRepo(origin = "git@github.com:acme/webapp.git") {
  const dir = mkdtempSync(join(tmpdir(), "codetgh-repo-"));
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "remote", "add", "origin", origin]);
  return dir;
}
