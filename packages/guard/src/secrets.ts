import { lintSource } from "@secretlint/core";
import { creator as recommend } from "@secretlint/secretlint-rule-preset-recommend";

export type SecretFinding = { rule: string; start: number; end: number; masked: string; secret: string };

// Never shows more than a quarter of the secret, at most 4 characters.
const mask = (s: string) => `${s.slice(0, Math.min(4, Math.floor(s.length / 4)))}…****`;

// Random-looking runs: mixed case and digits, ≥24 chars, high entropy. Excludes ULIDs, hex SHAs and UUIDs.
const CANDIDATE = /[A-Za-z0-9+/=_-]{24,}/g;
function entropy(s: string) {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) h -= (n / s.length) * Math.log2(n / s.length);
  return h;
}

function highEntropy(text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const m of text.matchAll(CANDIDATE)) {
    const s = m[0];
    // CodeTgh ids (msg_ + ULID) carry their only lowercase letters in the prefix.
    const core = s.replace(/^[a-z]{2,5}_/, "");
    if (/[a-z]/.test(core) && /[A-Z]/.test(s) && /[0-9]/.test(s) && entropy(core) >= 4.3) {
      out.push({ rule: "codetgh/high-entropy", start: m.index, end: m.index + s.length, masked: mask(s), secret: s });
    }
  }
  return out;
}

function teamPatterns(text: string, patterns: string[]): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const p of patterns) {
    for (const m of text.matchAll(new RegExp(p, "g"))) {
      if (m[0]) out.push({ rule: "codetgh/team-pattern", start: m.index, end: m.index + m[0].length, masked: mask(m[0]), secret: m[0] });
    }
  }
  return out;
}

export async function scanSecrets(text: string, opts: { patterns?: string[] } = {}): Promise<SecretFinding[]> {
  const result = await lintSource({
    source: { content: text, filePath: "message.txt", ext: ".txt", contentType: "text" },
    options: { config: { rules: [{ id: "@secretlint/secretlint-rule-preset-recommend", rule: recommend }] } },
  });
  const found: SecretFinding[] = result.messages.map((m) => {
    const [start, end] = m.range;
    const secret = text.slice(start, end);
    return { rule: m.ruleId, start, end, masked: mask(secret), secret };
  });
  const covered = (f: SecretFinding) => found.some((g) => f.start < g.end && g.start < f.end);
  for (const f of [...highEntropy(text), ...teamPatterns(text, opts.patterns ?? [])]) if (!covered(f)) found.push(f);
  return found;
}
