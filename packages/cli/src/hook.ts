import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import type { ClientRequest as ClientRequestType, IncomingMessage, RequestOptions } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL, urlToHttpOptions } from "node:url";
import { promisify } from "node:util";
import { normalizeOrigin, repoFingerprint } from "@codetgh/shared/repo";

// Hooks fail open: any error gives at most one warning per session and exit code 0, so Claude keeps working.
const run = promisify(execFile);
type Input = { session_id?: string; cwd?: string; source?: string; tool_name?: string; tool_input?: unknown };
// Per-session state: prompt ETag, one warning, repository root, files touched by editor tools, shell edits already reported.
type State = {
  etag?: string;
  warned?: boolean;
  root?: string;
  touched?: string[];
  reported?: string[];
  waiter?: number;
  wakes?: number[];
};

const config = () => ({
  url: (process.env.CLAUDE_PLUGIN_OPTION_CODETGH_URL || process.env.CODETGH_URL || "").replace(/\/$/, ""),
  token: process.env.CLAUDE_PLUGIN_OPTION_CODETGH_TOKEN || process.env.CODETGH_TOKEN || "",
});

const statePath = (sessionId: string) =>
  join(process.env.CODETGH_STATE_DIR || tmpdir(), `codetgh-${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}.json`);

function loadState(sessionId: string): State {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return {};
  }
}

function saveState(sessionId: string, state: State) {
  try {
    writeFileSync(statePath(sessionId), JSON.stringify(state), { mode: 0o600 });
  } catch {}
}

function warnOnce(input: Input, message: string) {
  const sessionId = input.session_id ?? "unknown";
  const state = loadState(sessionId);
  if (state.warned) return null;
  saveState(sessionId, { ...state, warned: true });
  return { systemMessage: message };
}

type Reply = { status: number; ok: boolean; etag: string | undefined; json: () => Promise<unknown> };

// Each hook is a fresh process, so module load time counts. On Node 24, fetch's first call costs ~100 ms and loading
// node:http ~70 ms; its ClientRequest, from the legacy _http_client module, ~7 ms. node:https loads only for an https hub.
const { ClientRequest } = createRequire(import.meta.url)("_http_client") as typeof import("node:http");

async function hub(path: string, init: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs: number }) {
  const { url, token } = config();
  const target = new URL(`${url}${path}`);
  const request: (u: URL, o: RequestOptions, cb: (res: IncomingMessage) => void) => ClientRequestType =
    target.protocol === "https:"
      ? (await import("node:https")).request
      : (u, o, cb) => new ClientRequest({ ...urlToHttpOptions(u), ...o }, cb);
  return new Promise<Reply>((resolve, reject) => {
    const req = request(target, { method: init.method ?? "GET", headers: { ...init.headers, Authorization: `Bearer ${token}` } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const status = res.statusCode ?? 0;
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ status, ok: status >= 200 && status < 300, etag: res.headers.etag, json: async () => JSON.parse(text) });
      });
      res.on("error", reject);
    });
    // A hard deadline for the whole exchange, so a hub that accepts and never answers cannot stall Claude.
    const deadline = setTimeout(() => req.destroy(new Error("timeout")), init.timeoutMs);
    req.on("close", () => clearTimeout(deadline));
    req.on("error", reject);
    req.end(init.body);
  });
}

async function git(cwd: string | undefined, args: string[]) {
  try {
    return (await run("git", args, { cwd, timeout: 500 })).stdout.trim();
  } catch {
    return "";
  }
}

async function sessionStart(input: Input) {
  const { url, token } = config();
  if (!url || !token) return warnOnce(input, "CodeTgh: hub URL or token not configured; working without CodeTgh.");
  const [branch, origin] = await Promise.all([
    git(input.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(input.cwd, ["remote", "get-url", "origin"]),
  ]);
  const repo = origin ? normalizeOrigin(origin) : "";
  try {
    const res = await hub("/v1/agents/session", {
      method: "POST",
      timeoutMs: 3500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: input.session_id ?? "unknown",
        source: input.source,
        branch: branch || undefined,
        repo_fingerprint: origin ? repoFingerprint(origin) : undefined,
        repo_name: repo ? repo.split("/").slice(-2).join("/") : undefined,
      }),
    });
    if (!res.ok) return warnOnce(input, `CodeTgh: hub answered ${res.status}; working without CodeTgh.`);
    const body = (await res.json()) as { context: string; paused: boolean };
    return {
      ...(body.paused && warnOnce(input, "CodeTgh is paused by an admin; working without it.")),
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: body.context },
    };
  } catch {
    return warnOnce(input, "CodeTgh: hub unreachable; working without CodeTgh.");
  }
}

async function userPromptSubmit(input: Input) {
  const { url, token } = config();
  if (!url || !token || !input.session_id) return null;
  const state = loadState(input.session_id);
  try {
    const res = await hub(`/v1/inbox/prompt?session_id=${encodeURIComponent(input.session_id)}`, {
      timeoutMs: 2000,
      headers: state.etag ? { "If-None-Match": state.etag } : {},
    });
    if (res.status !== 200) return null;
    saveState(input.session_id, { ...state, etag: res.etag });
    const { context } = (await res.json()) as { context: string };
    return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } };
  } catch {
    return warnOnce(input, "CodeTgh: hub unreachable; working without CodeTgh.");
  }
}

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out);
  return out;
}

// Local check, no network: works even when the hub is down. Never answers "allow".
async function preToolUse(input: Input) {
  // Loaded on demand so the edit hooks do not pay for the secret rules.
  const { scanSecrets } = await import("@codetgh/guard");
  const findings = (await Promise.all(strings(input.tool_input).map((s) => scanSecrets(s)))).flat();
  if (!findings.length) return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `CodeTgh blocked this call: it contains a secret (${findings.map((f) => f.masked).join(", ")}). Remove it and send again without repeating it.`,
    },
  };
}

// Repository-relative path with forward slashes, or null outside the session's repository.
async function repoPath(input: Input, state: State) {
  const toolInput = (input.tool_input ?? {}) as { file_path?: unknown; notebook_path?: unknown };
  const file =
    typeof toolInput.file_path === "string"
      ? toolInput.file_path
      : typeof toolInput.notebook_path === "string"
        ? toolInput.notebook_path
        : "";
  if (!file) return null;
  const absolute = isAbsolute(file) ? file : join(input.cwd ?? process.cwd(), file);
  // A new file's folder may not exist yet: start from the closest existing ancestor.
  let dir = dirname(absolute);
  let rest = absolute.slice(dir.length + 1);
  while (!existsSync(dir) && dirname(dir) !== dir) {
    rest = `${dir.slice(dirname(dir).length + 1)}/${rest}`;
    dir = dirname(dir);
  }
  try {
    dir = realpathSync.native(dir);
  } catch {}
  if (!state.root) {
    const top = await git(dir, ["rev-parse", "--show-toplevel"]);
    if (!top) return null;
    // On Windows git and the file system can spell one folder differently (C:/ vs C:\, RUNNER~1 vs runneradmin).
    try {
      state.root = realpathSync.native(top);
    } catch {
      state.root = top;
    }
  }
  const rel = relative(state.root, join(dir, rest));
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel.split(sep).join("/") : null;
}

// PreToolUse on Edit/Write: the hub decides from the team's claims; no answer leaves the permission flow unchanged.
async function preEdit(input: Input) {
  const { url, token } = config();
  if (!url || !token || !input.session_id) return null;
  const state = loadState(input.session_id);
  const path = await repoPath(input, state);
  saveState(input.session_id, state);
  if (!path) return null;
  try {
    const res = await hub("/v1/claims/pre-edit", {
      method: "POST",
      timeoutMs: 2500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: input.session_id, path }),
    });
    if (res.status !== 200) return null;
    const { decision, reason } = (await res.json()) as { decision: "warn" | "ask" | "deny"; reason: string };
    if (decision === "warn") return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: `CodeTgh: ${reason}` } };
    if (decision === "ask" || decision === "deny")
      return {
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: `CodeTgh: ${reason}` },
      };
  } catch {}
  return null;
}

// PostToolUse: remember files changed with editor tools, so the Stop hook only reports shell changes. No network.
async function postEdit(input: Input) {
  if (!input.session_id) return null;
  const state = loadState(input.session_id);
  const path = await repoPath(input, state);
  if (path) state.touched = [...new Set([...(state.touched ?? []), path])].slice(-500);
  saveState(input.session_id, state);
  return null;
}

// Stop: files changed outside the editor tools (shell) that someone else claimed, reported once per file.
async function stop(input: Input) {
  const { url, token } = config();
  if (!url || !token || !input.session_id) return null;
  const state = loadState(input.session_id);
  // Raw output: porcelain lines start with a status column that may be a space.
  const status = await run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: input.cwd, timeout: 1000 })
    .then((r) => r.stdout)
    .catch(() => "");
  const changed = status
    .split("\0")
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3))
    .filter((p) => !(state.touched ?? []).includes(p))
    .slice(0, 200);
  if (!changed.length) return null;
  try {
    const res = await hub("/v1/claims/check", {
      method: "POST",
      timeoutMs: 2000,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: input.session_id, paths: changed }),
    });
    if (!res.ok) return null;
    const { paths } = (await res.json()) as {
      paths: Array<{ path: string; holders: Array<{ claim_id: string; name: string; mode: string }> }>;
    };
    const fresh = paths
      .flatMap((p) => p.holders.map((h) => ({ ...h, path: p.path })))
      .filter((h) => !(state.reported ?? []).includes(`${h.path}:${h.claim_id}`));
    if (!fresh.length) return null;
    saveState(input.session_id, {
      ...state,
      reported: [...(state.reported ?? []), ...fresh.map((h) => `${h.path}:${h.claim_id}`)].slice(-500),
    });
    return {
      systemMessage: `CodeTgh: changed outside the editor tools, but claimed by someone else: ${fresh.map((h) => `${h.path} (${h.name}, ${h.mode})`).join("; ")}.`,
    };
  } catch {
    return null;
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === "EPERM";
  }
};

// Claude Code enforces the asyncRewake hook's timeout (600 s in hooks.json): the waiter gives up a little before.
const REWAKE_BUDGET_MS = 570_000;
// A burst of messages must not keep an autonomous session busy waking: past this, delivery waits for the next prompt.
const MAX_WAKES = 6;
const WAKE_WINDOW_MS = 10 * 60_000;

// Stop, asyncRewake (opt-in): wait in the background for the next message; exit 2 with the envelopes on stderr wakes Claude.
async function rewake(input: Input) {
  const { url, token } = config();
  const sessionId = input.session_id;
  if (process.env.CLAUDE_PLUGIN_OPTION_PUSH_MODE !== "rewake" || !url || !token || !sessionId) return null;
  const state = loadState(sessionId);
  // Every Stop starts a hook process: one waiter per session is enough.
  if (state.waiter && state.waiter !== process.pid && alive(state.waiter)) return null;
  saveState(sessionId, { ...state, waiter: process.pid });
  const deadline = Date.now() + REWAKE_BUDGET_MS;
  try {
    for (let waitS = 55; waitS >= 1; waitS = Math.min(55, Math.floor((deadline - Date.now()) / 1000))) {
      const etag = loadState(sessionId).etag;
      const started = Date.now();
      const res = await hub(`/v1/inbox/prompt?session_id=${encodeURIComponent(sessionId)}&wait_s=${waitS}`, {
        timeoutMs: (waitS + 5) * 1000,
        headers: etag ? { "If-None-Match": etag } : {},
      }).catch(() => null);
      if (!res) {
        await sleep(5000);
        continue;
      }
      if (res.status === 200) {
        const latest = loadState(sessionId);
        // The prompt hook already showed these while we waited.
        if (latest.etag === res.etag) continue;
        const wakes = (latest.wakes ?? []).filter((t) => Date.now() - t < WAKE_WINDOW_MS);
        // The ETag stays unsaved, so the next prompt still delivers these messages.
        if (wakes.length >= MAX_WAKES) return null;
        saveState(sessionId, { ...latest, etag: res.etag, wakes: [...wakes, Date.now()] });
        const { context } = (await res.json()) as { context: string };
        process.stderr.write(context);
        process.exitCode = 2;
        return null;
      }
      // 403 (mode turned off), 401, or an answer long before the wait ended (session over, kill switch): stop quietly.
      if ((res.status !== 204 && res.status !== 304) || Date.now() - started < (waitS * 1000) / 2) return null;
    }
  } finally {
    const latest = loadState(sessionId);
    if (latest.waiter === process.pid) saveState(sessionId, { ...latest, waiter: undefined });
  }
  return null;
}

async function sessionEnd(input: Input) {
  if (!config().url || !config().token || !input.session_id) return null;
  try {
    await hub("/v1/agents/session/end", {
      method: "POST",
      timeoutMs: 1200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: input.session_id }),
    });
  } catch {}
  return null;
}

async function readStdin(): Promise<Input> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

const handlers: Record<string, (input: Input) => Promise<unknown>> = {
  "session-start": sessionStart,
  "user-prompt-submit": userPromptSubmit,
  "pre-tool-use": preToolUse,
  "pre-edit": preEdit,
  "post-edit": postEdit,
  stop,
  rewake,
  "session-end": sessionEnd,
};

export async function runHook(event: string) {
  const handler = handlers[event];
  if (!handler) return;
  try {
    const out = await handler(await readStdin());
    if (out) process.stdout.write(JSON.stringify(out));
  } catch {}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runHook(process.argv[2] ?? "");
