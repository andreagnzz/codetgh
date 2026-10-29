import { HubError } from "../errors.js";

// Token bucket per agent: burst 10, refill 30/min, plus a 600/hour window; `scale` multiplies all three (a team's budget).
// shortcut: in memory, single process; move to Postgres with replicas.
const BURST = 10;
const PER_SECOND = 30 / 60;
const PER_HOUR = 600;

type State = { tokens: number; at: number; hourStart: number; hourCount: number };

export class RateLimiter {
  private state = new Map<string, State>();
  constructor(private now: () => number = Date.now) {}

  // Returns 0 when allowed, otherwise the seconds to wait.
  take(key: string, scale = 1): number {
    const t = this.now();
    const s = this.state.get(key) ?? { tokens: BURST * scale, at: t, hourStart: t, hourCount: 0 };
    s.tokens = Math.min(BURST * scale, s.tokens + ((t - s.at) / 1000) * PER_SECOND * scale);
    s.at = t;
    if (t - s.hourStart >= 3600_000) {
      s.hourStart = t;
      s.hourCount = 0;
    }
    this.state.set(key, s);
    if (s.hourCount >= PER_HOUR * scale) return Math.ceil((s.hourStart + 3600_000 - t) / 1000);
    if (s.tokens < 1) return Math.ceil((1 - s.tokens) / (PER_SECOND * scale));
    s.tokens -= 1;
    s.hourCount += 1;
    return 0;
  }
}

// Statuses, claims, tasks, memory, sessions and projects: one budget per person, apart from messages.
export function takeWrite(limiter: RateLimiter, userId: string) {
  const wait = limiter.take(`write:${userId}`);
  if (wait > 0) throw new HubError("E_RATE_LIMITED", "too many changes in a short time: wait and retry", wait);
}
