import type { ErrorCode } from "@codetgh/shared";
import { REST_ROUTES, type RestRoutes } from "@codetgh/shared/rest";
import type { z } from "zod";

type In<K extends keyof RestRoutes> = RestRoutes[K] extends { body: z.ZodType }
  ? z.input<RestRoutes[K]["body"]>
  : RestRoutes[K] extends { query: z.ZodType }
    ? z.input<RestRoutes[K]["query"]>
    : RestRoutes[K] extends { params: z.ZodType }
      ? z.input<RestRoutes[K]["params"]>
      : undefined;
type Out<K extends keyof RestRoutes> = RestRoutes[K] extends { output: z.ZodType } ? z.output<RestRoutes[K]["output"]> : undefined;

export class CodeTghError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
    readonly retryAfterS?: number,
  ) {
    super(message);
    this.name = "CodeTghError";
  }
}

// Typed client for the hub's /v1 API: the same personal token and limits as an agent. Peer text comes back in envelopes.
export function createClient(opts: { url: string; token: string; fetch?: typeof fetch }) {
  const base = opts.url.replace(/\/$/, "");
  const doFetch = opts.fetch ?? fetch;

  async function call<K extends keyof RestRoutes>(name: K, input?: In<K>, headers: Record<string, string> = {}): Promise<Out<K> | null> {
    const route: { method: string; path: string; query?: unknown; params?: unknown; body?: unknown } = REST_ROUTES[name];
    const path = route.params
      ? route.path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String((input as Record<string, unknown>)[k] ?? "")))
      : route.path;
    const url = new URL(`${base}${path}`);
    if (route.query && input) for (const [k, v] of Object.entries(input)) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await doFetch(url, {
      method: route.method,
      headers: { Authorization: `Bearer ${opts.token}`, ...(route.body ? { "content-type": "application/json" } : {}), ...headers },
      body: route.body ? JSON.stringify(input ?? {}) : undefined,
    });
    if (res.status === 204 || res.status === 304) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const retry = Number(res.headers.get("retry-after")) || undefined;
      throw new CodeTghError(data.code ?? "E_INVALID", data.message ?? `HTTP ${res.status}`, res.status, retry);
    }
    return data as Out<K>;
  }
  const must = <T>(v: T | null) => {
    if (v === null) throw new CodeTghError("E_INVALID", "empty response", 204);
    return v;
  };

  return {
    whoami: async (sessionId?: string) => must(await call("whoami", { session_id: sessionId })),
    startSession: async (input: In<"sessionStart">) => must(await call("sessionStart", input)),
    endSession: async (sessionId: string) => {
      await call("sessionEnd", { session_id: sessionId });
    },
    /** null when the team's claims leave this edit alone. */
    preEdit: (input: In<"preEdit">) => call("preEdit", input),
    checkClaims: async (input: In<"claimsCheck">) => must(await call("claimsCheck", input)),
    /** null when nothing is new since `etag`. */
    prompt: (input: In<"prompt">, etag?: string) => call("prompt", input, etag ? { "If-None-Match": etag } : {}),
    send: async (input: In<"send">) => must(await call("send", input)),
    inbox: async (input: In<"inbox"> = {}) => must(await call("inbox", input)),
    ack: async (input: In<"ack">) => must(await call("ack", input)),
    publishKey: async (publicKey: string) => {
      await call("publishKey", { public_key: publicKey });
    },
    /** Members' X25519 public keys for end-to-end encrypted threads (null: not published yet). */
    keys: async (handles: string[]) => must(await call("keys", { handles: handles.join(",") })),
    /** The thread of `messageId` and your wrapped key for it (encrypted threads only). */
    threadKey: async (messageId: string) => must(await call("threadKey", { message_id: messageId })),
    /** Create the team project of a repository, keyed by its origin fingerprint, or rename it. */
    createProject: async (name: string, repoFingerprint: string) =>
      must(await call("createProject", { name, repo_fingerprint: repoFingerprint })),
    /** Invite an email address (admins): the 7-day sign-up link. */
    invite: async (email: string, role = "member", days?: number) => must(await call("invite", { email, role, days })),
    /** Revoke the pending invitations of an email address (admins). */
    revokeInvitations: async (email: string) => must(await call("revokeInvitations", { email })),
    /** Who is online, your unread counts by kind, and the team's live claims. */
    status: async () => must(await call("status")),
    /** Stop or restore your own agents' sending. */
    pause: async () => must(await call("pause")),
    resume: async () => must(await call("resume")),
    /** Remote Control launcher (owner only): what should run, and what does. */
    launcherTargets: async () => must(await call("launcherTargets")),
    launcherReport: async (report: { project_id: string; running: boolean; error?: string }) => {
      await call("launcherReport", report);
    },
    /** New message ids as they arrive; pass the last event id to resume. */
    async *stream(o: { signal?: AbortSignal; lastEventId?: string } = {}): AsyncGenerator<Out<"stream">> {
      const res = await doFetch(`${base}${REST_ROUTES.stream.path}`, {
        headers: { Authorization: `Bearer ${opts.token}`, ...(o.lastEventId && { "Last-Event-ID": o.lastEventId }) },
        signal: o.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new CodeTghError(data.code ?? "E_INVALID", data.message ?? `HTTP ${res.status}`, res.status);
      }
      const decoder = new TextDecoder();
      let buf = "";
      try {
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
            const frame = buf.slice(0, i);
            buf = buf.slice(i + 2);
            if (/^event: ?message$/m.test(frame)) yield JSON.parse(frame.match(/^data: ?(.*)$/m)?.[1] ?? "{}");
          }
        }
      } catch (e) {
        if (!o.signal?.aborted) throw e;
      }
    },
  };
}

export type CodeTghClient = ReturnType<typeof createClient>;
