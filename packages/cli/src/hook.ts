import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { ClientRequest as ClientRequestType, IncomingMessage, RequestOptions } from "node:http";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL, urlToHttpOptions } from "node:url";
import { promisify } from "node:util";
import { repoFingerprint } from "@codetgh/shared/repo";

// Hooks fail open: any error gives at most one warning per session and exit code 0, so Claude keeps working.
const run = promisify(execFile);
type Input = {
  session_id?: string;
  cwd?: string;
  source?: string;
  tool_name?: string;
  tool_input?: unknown;
  permission_mode?: string;
};
// Per-session state: prompt ETag, one warning, repository root, files touched by editor tools, shell edits already reported.
type State = {
  etag?: string;
  warned?: boolean;
  root?: string;
  touched?: string[];
  reported?: string[];
  waiter?: number;
  waiterAt?: number;
  wakes?: number[];
  // The hub does not know this repository: every hook stays quiet in this session.
  unlinked?: boolean;
  polledAt?: number;
  injections?: number[];
  // The permission mode the hub last heard about.
  mode?: string;
};

const config = () => ({
  url: (process.env.CLAUDE_PLUGIN_OPTION_CODETGH_URL || process.env.CODETGH_URL || "").replace(/\/$/, ""),
  token: process.env.CLAUDE_PLUGIN_OPTION_CODETGH_TOKEN || process.env.CODETGH_TOKEN || "",
});

// Private to the user, never the shared /tmp: on a shared machine another user could plant a session's state there.
function statePath(sessionId: string) {
  const dir = process.env.CODETGH_STATE_DIR || join(process.env.XDG_RUNTIME_DIR || join(homedir(), ".cache"), "codetgh");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return join(dir, `codetgh-${createHash("sha256").update(sessionId).digest("hex").slice(0, 16)}.json`);
}

function loadState(sessionId: string): State {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), "utf8"));
  } catch {
    return {};
  }
}

// Hooks run in parallel: write beside the file, then rename over it, so a reader never sees half a file.
function saveState(sessionId: string, state: State) {
  const file = statePath(sessionId);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, file);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {}
  }
}

function warnOnce(input: Input, message: string) {
  // No session id: warn without state rather than share one path between sessions.
  if (!input.session_id) return { systemMessage: message };
  const sessionId = input.session_id;
  const state = loadState(sessionId);
  if (state.warned) return null;
  saveState(sessionId, { ...state, warned: true });
  return { systemMessage: message };
}

// One deadline per hook process, counted from its start (performance.now): each call gets what is left, so slow steps
// in a row stay under Claude Code's timeout.
const left = (budgetMs: number) => Math.max(1, Math.round(budgetMs - performance.now()));
const START_BUDGET_MS = 4500;
const BUDGET_MS = 2500;
// SessionEnd hooks share a 1.5 s budget that a plugin hook's own timeout does not raise; keep a margin for the spawn.
const END_BUDGET_MS = 1200;
// UserPromptSubmit has a 3 s timeout; Node starts slowly on Windows, and a hub behind a public relay takes about 1 s.
const PROMPT_BUDGET_MS = 2850;
const SLOW = "CodeTgh: the hub is slow to answer; your teammates' messages will come with your next prompt.";

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
  const [branch, origin, version] = await Promise.all([
    git(input.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(input.cwd, ["remote", "get-url", "origin"]),
    // Hooks get no Claude Code version: ask the CLI (about 30 ms). On Windows npm installs claude.cmd, which only runs
    // through a shell; the arguments are fixed, so nothing can be injected.
    run("claude", ["--version"], { timeout: Math.min(1000, left(START_BUDGET_MS)), shell: process.platform === "win32" }).then(
      (r) => r.stdout.match(/^\d+\.\d+\.\d+/)?.[0],
      () => undefined,
    ),
  ]);
  // An install that kept a mode the plugin no longer offers (channel) runs as hooks.
  const pushMode = process.env.CLAUDE_PLUGIN_OPTION_PUSH_MODE === "rewake" ? "rewake" : "hooks";
  const fingerprint = origin ? repoFingerprint(origin) : undefined;
  // The origin's last path segment: git@host:acme/web-app.git → web-app.
  const repoName = origin
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .split(/[/:]/)
    .pop()
    ?.replace(/[^\w.-]/g, "")
    .slice(0, 100);
  const register = (withBranch: boolean, name?: string) =>
    hub("/v1/agents/session", {
      method: "POST",
      timeoutMs: Math.min(2400, left(START_BUDGET_MS)),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: input.session_id ?? "unknown",
        source: input.source,
        repo_fingerprint: fingerprint,
        branch: withBranch && branch ? branch : undefined,
        repo_name: name,
        push_mode: pushMode,
        permission_mode: input.permission_mode,
        client_version: version,
        // codetgh start --accept-requests-from puts the list in claude's environment, which hooks inherit.
        accept_requests_from: process.env.CODETGH_ACCEPT_REQUESTS_FROM?.split(",").filter(Boolean),
      }),
    });
  try {
    // In a repository, ask with the fingerprint alone first: one nobody linked never sends its branch or file paths.
    let res = await register(!fingerprint);
    if (!res.ok) return warnOnce(input, `CodeTgh: hub answered ${res.status}; working without CodeTgh.`);
    let body = (await res.json()) as { context: string; paused: boolean; linked?: boolean; can_link?: boolean; status_line?: string };
    // A member may link it: only then do the repository's name and branch leave the machine, in one more call.
    const linking = body.linked === false && body.can_link === true && Boolean(repoName);
    if (linking) {
      // The hub may finish creating the project after this hook's budget: say so rather than "unreachable".
      const linked = await register(true, repoName).catch(() => null);
      if (!linked) return warnOnce(input, `CodeTgh: linking ${repoName} as a team project; it is on from your next session.`);
      res = linked;
      if (!res.ok) return warnOnce(input, `CodeTgh: hub answered ${res.status}; working without CodeTgh.`);
      body = (await res.json()) as typeof body;
    }
    if (body.linked === false) {
      if (input.session_id) saveState(input.session_id, { ...loadState(input.session_id), unlinked: true });
      // Said once at start so the person knows CodeTgh is off on purpose, not broken.
      return input.source === "startup" || input.source === "resume"
        ? {
            systemMessage:
              "CodeTgh: this repository is not a team project yet, so CodeTgh stays off here. Ask an admin to link it with: codetgh project new <name> (run in the repository).",
          }
        : null;
    }
    if (input.session_id && input.permission_mode)
      saveState(input.session_id, { ...loadState(input.session_id), mode: input.permission_mode });
    if (fingerprint && branch && !body.paused && !linking) {
      // Out of time for the second answer: the first one still holds.
      res = await register(true).catch(() => res);
      if (res.ok) body = (await res.json()) as typeof body;
    }
    // The person sees one line saying CodeTgh is on, with its push mode and version, when a session starts or resumes.
    const shown =
      body.status_line && (input.source === "startup" || input.source === "resume")
        ? { systemMessage: body.status_line.replace(/\p{Cc}/gu, "") }
        : {};
    return {
      ...shown,
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
  if (state.unlinked) return null;
  // A mode changed with shift+tab rides on this call; it is not sent again while it stays the same.
  const mode = input.permission_mode && input.permission_mode !== state.mode ? input.permission_mode : undefined;
  try {
    const res = await hub(
      `/v1/inbox/prompt?session_id=${encodeURIComponent(input.session_id)}${mode ? `&permission_mode=${encodeURIComponent(mode)}` : ""}`,
      { timeoutMs: left(PROMPT_BUDGET_MS), headers: state.etag ? { "If-None-Match": state.etag } : {} },
    );
    if (mode && res.status < 500) saveState(input.session_id, { ...loadState(input.session_id), mode });
    if (res.status !== 200) return null;
    saveState(input.session_id, { ...loadState(input.session_id), etag: res.etag });
    const { context } = (await res.json()) as { context: string };
    return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context } };
  } catch (e) {
    return warnOnce(input, (e as Error).message === "timeout" ? SLOW : "CodeTgh: hub unreachable; working without CodeTgh.");
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

// PreToolUse on Bash, delegate sessions only (codetgh start --accept-requests-from): no network, never "allow".
// Exit 2 blocks the call and hands the reason to Claude, which replies "blocked: …" to the requester.
async function preBash(input: Input) {
  if (!process.env.CODETGH_ACCEPT_REQUESTS_FROM) return null;
  const command = (input.tool_input as { command?: unknown } | undefined)?.command;
  if (typeof command !== "string") return null;
  const { delegateBlock } = await import("@codetgh/guard");
  const reason = delegateBlock(command);
  if (!reason) return null;
  process.stderr.write(`CodeTgh delegate session: ${reason}. Do not retry another way; reply to the requester with "blocked: ${reason}".`);
  process.exitCode = 2;
  return null;
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
  if (state.unlinked) return null;
  const path = await repoPath(input, state);
  // Other hooks may have saved while git ran: merge the one field this hook owns.
  if (state.root) saveState(input.session_id, { ...loadState(input.session_id), root: state.root });
  if (!path) return null;
  try {
    const res = await hub("/v1/claims/pre-edit", {
      method: "POST",
      timeoutMs: left(BUDGET_MS),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: input.session_id, path }),
    });
    if (res.status !== 200) return null;
    const { decision, reason } = (await res.json()) as { decision: "warn" | "ask" | "deny"; reason: string };
    // Under bypassPermissions nobody answers an ask: Claude Code counts it as a denial (FACTS.md). Warn instead.
    if (decision === "warn" || (decision === "ask" && input.permission_mode === "bypassPermissions"))
      return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: `CodeTgh: ${reason}` } };
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
  if (state.unlinked) return null;
  const path = await repoPath(input, state);
  const latest = loadState(input.session_id);
  const touched = path ? [...new Set([...(latest.touched ?? []), path])].slice(-500) : latest.touched;
  saveState(input.session_id, { ...latest, root: state.root ?? latest.root, touched });
  return null;
}

// Stop: files changed outside the editor tools (shell) that someone else claimed, reported once per file.
async function stop(input: Input) {
  const { url, token } = config();
  if (!url || !token || !input.session_id) return null;
  const state = loadState(input.session_id);
  if (state.unlinked) return null;
  // Raw output: porcelain lines start with a status column that may be a space.
  const status = await run("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: input.cwd,
    timeout: Math.min(1000, left(BUDGET_MS)),
  })
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
      timeoutMs: Math.min(2000, left(BUDGET_MS)),
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
    const latest = loadState(input.session_id);
    saveState(input.session_id, {
      ...latest,
      reported: [...(latest.reported ?? []), ...fresh.map((h) => `${h.path}:${h.claim_id}`)].slice(-500),
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

// PostToolUse on every tool: a busy agent sees new messages between tool calls, mid-turn, instead of after a turn
// that can last half an hour. At most one hub call per POLL_MS, sharing the prompt hook's ETag so nothing shows twice.
const POLL_MS = Number(process.env.CODETGH_POLL_MS ?? 10_000);
const MAX_INJECTIONS = 10;
const INJECTION_WINDOW_MS = 10 * 60_000;

async function inbox(input: Input) {
  const { url, token } = config();
  if (!url || !token || !input.session_id) return null;
  const state = loadState(input.session_id);
  if (state.unlinked || Date.now() - (state.polledAt ?? 0) < POLL_MS) return null;
  saveState(input.session_id, { ...state, polledAt: Date.now() });
  try {
    const res = await hub(`/v1/inbox/prompt?session_id=${encodeURIComponent(input.session_id)}`, {
      timeoutMs: 2000,
      headers: state.etag ? { "If-None-Match": state.etag } : {},
    });
    if (res.status !== 200) return null;
    const latest = loadState(input.session_id);
    const injections = (latest.injections ?? []).filter((t) => Date.now() - t < INJECTION_WINDOW_MS);
    // Past the cap the ETag stays unsaved, so the next prompt still delivers these messages.
    if (latest.etag === res.etag || injections.length >= MAX_INJECTIONS) return null;
    saveState(input.session_id, { ...latest, etag: res.etag, injections: [...injections, Date.now()] });
    const { context } = (await res.json()) as { context: string };
    return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: context } };
  } catch {
    return null;
  }
}

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
  if (state.unlinked) return null;
  // Every Stop starts a hook process: one waiter per session is enough.
  // A waiter killed at its timeout never clears itself: past the budget its pid no longer counts.
  const waiting = state.waiter && Date.now() - (state.waiterAt ?? 0) < REWAKE_BUDGET_MS + 60_000;
  if (waiting && state.waiter !== process.pid && alive(state.waiter ?? 0)) return null;
  saveState(sessionId, { ...state, waiter: process.pid, waiterAt: Date.now() });
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
      timeoutMs: left(END_BUDGET_MS),
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
  "pre-bash": preBash,
  "post-edit": postEdit,
  inbox,
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

// Node runs the real file behind a symlinked plugin path: compare real paths, as the CLI does.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await runHook(process.argv[2] ?? "");
