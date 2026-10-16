import { createHash, randomBytes, randomInt } from "node:crypto";
import { USER_CODE_ALPHABET } from "@codetgh/shared/rest";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { HubError } from "../errors.js";
import { newId } from "../ids.js";

// Browser sign-in for the CLI, in the style of RFC 8628: the CLI holds a secret device code, the person confirms a
// short user code in the console. Only hashes are kept; both codes are single use and expire.
export const DEVICE_TTL_S = 600;
export const DEVICE_INTERVAL_S = 3;
const MAX_PENDING = 1000;
// Wrong user codes typed in the console, per person and per address, over a 10-minute window.
const MAX_FAILS = { user: 5, ip: 20 };
const FAIL_WINDOW_MS = 10 * 60_000;

type Approver = { userId: string; teamId: string };
type Pending = { id: string; userCodeHash: string; label: string; expiresAt: number; approvedBy?: Approver; denied?: boolean };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// The socket's address; X-Forwarded-For only when the socket is the configured proxy, which appends the address it saw.
export function clientIp(c: Context, trustedProxy?: string) {
  const socket = getConnInfo(c).remote.address ?? "";
  if (!trustedProxy || socket !== trustedProxy) return socket;
  return c.req.header("x-forwarded-for")?.split(",").pop()?.trim() || socket;
}

// shortcut: in memory and single process, like the rate limiter; a restart drops the sign-ins in progress. Move to Postgres with replicas.
export class DeviceAuth {
  private byDevice = new Map<string, Pending>();
  private byUserCode = new Map<string, string>();
  private fails = new Map<string, { n: number; until: number }>();

  start(label: string) {
    this.purge();
    if (this.byDevice.size >= MAX_PENDING)
      throw new HubError("E_RATE_LIMITED", "too many sign-ins in progress: retry in a few minutes", 60);
    const deviceCode = randomBytes(32).toString("base64url");
    let userCode = "";
    do userCode = Array.from({ length: 8 }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]).join("");
    while (this.byUserCode.has(sha256(userCode)));
    const entry = { id: newId("dev"), userCodeHash: sha256(userCode), label, expiresAt: Date.now() + DEVICE_TTL_S * 1000 };
    this.byDevice.set(sha256(deviceCode), entry);
    this.byUserCode.set(entry.userCodeHash, sha256(deviceCode));
    return { deviceCode, userCode: `${userCode.slice(0, 4)}-${userCode.slice(4)}` };
  }

  // userCode is normalized (UserCodeForm); keys are the person and the address typing it.
  find(userCode: string, keys: { user: string; ip: string }) {
    const now = Date.now();
    const counters = [`user:${keys.user}`, `ip:${keys.ip}`] as const;
    const limits = [MAX_FAILS.user, MAX_FAILS.ip];
    counters.forEach((k, i) => {
      const f = this.fails.get(k);
      if (f && f.until > now && f.n >= (limits[i] ?? 0))
        throw new HubError("E_RATE_LIMITED", "too many wrong codes: wait a few minutes", Math.ceil((f.until - now) / 1000));
    });
    const deviceHash = this.byUserCode.get(sha256(userCode));
    const entry = deviceHash ? this.byDevice.get(deviceHash) : undefined;
    if (!entry || entry.expiresAt <= now) {
      for (const k of counters) {
        const f = this.fails.get(k);
        this.fails.set(k, f && f.until > now ? { n: f.n + 1, until: f.until } : { n: 1, until: now + FAIL_WINDOW_MS });
      }
      throw new HubError("E_NOT_FOUND", "unknown or expired code: check your terminal, or run the command again");
    }
    return entry;
  }

  decide(userCode: string, keys: { user: string; ip: string }, decision: { approve: Approver } | { deny: true }) {
    const entry = this.find(userCode, keys);
    this.byUserCode.delete(entry.userCodeHash);
    if ("approve" in decision) entry.approvedBy = decision.approve;
    else entry.denied = true;
    return entry;
  }

  // null while pending; the approval is handed out once, then the device code is gone.
  poll(deviceCode: string) {
    const hash = sha256(deviceCode);
    const entry = this.byDevice.get(hash);
    if (!entry || entry.expiresAt <= Date.now() || entry.denied || entry.approvedBy) this.byDevice.delete(hash);
    if (!entry || entry.expiresAt <= Date.now())
      throw new HubError("E_NOT_FOUND", "this sign-in expired or was already used: run the command again");
    if (entry.denied) throw new HubError("E_FORBIDDEN", "sign-in denied in the browser");
    return entry.approvedBy ? { ...entry.approvedBy, label: entry.label } : null;
  }

  private purge() {
    const now = Date.now();
    for (const [hash, e] of this.byDevice)
      if (e.expiresAt <= now) {
        this.byDevice.delete(hash);
        this.byUserCode.delete(e.userCodeHash);
      }
    for (const [k, f] of this.fails) if (f.until <= now) this.fails.delete(k);
  }
}
