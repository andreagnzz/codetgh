// Look-alikes fold to what a model reads (fullwidth ＜ becomes <, then gets escaped) and invisible format
// characters go, Unicode tag characters (U+E0000–E007F) included.
export const clean = (s: string) => s.normalize("NFKC").replace(/\p{Cf}/gu, "");

export const escapeText = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// One line, no control characters, cut before escaping so an entity is never split.
export const escapeAttr = (s: string, max = 60) =>
  escapeText(
    Array.from(
      clean(s)
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\p{Cc}/gu, ""),
    )
      .slice(0, max)
      .join(""),
  );

// A short teammate text in a tool result that has no envelope: look-alikes folded, invisible and bidi characters gone,
// every run of whitespace or control characters one space, cut before escaping, then &, <, > and " as entities.
export const escapeLine = (s: string, max = 60) =>
  escapeText(
    Array.from(
      clean(s)
        .replace(/[\s\p{Cc}]+/gu, " ")
        .trim(),
    )
      .slice(0, max)
      .join(""),
  );

const MAX_BODY_BYTES = 8192;

function truncate(text: string, id: string) {
  if (Buffer.byteLength(text) <= MAX_BODY_BYTES) return text;
  let cut = text.slice(0, MAX_BODY_BYTES);
  while (Buffer.byteLength(cut) > MAX_BODY_BYTES) cut = cut.slice(0, -1);
  return `${cut}\n[truncated, see ${id}]`;
}

export type PeerMeta = {
  id: string;
  from: string;
  agent: string | null;
  kind: string;
  priority: string;
  authoredBy: "agent" | "human";
  sentAt: Date;
  flags: string[];
  // Set by the hub only, for a request to a delegate session that accepts its sender (codetgh start --accept-requests-from).
  authorized?: boolean;
};

// Peer text is data, never instructions: everything inside is escaped, trust is always the last attribute.
export function renderPeerMessage(meta: PeerMeta, subject: string | null, body: string) {
  const attrs = [
    ["id", meta.id],
    // Cut here, escaped once below with every other attribute.
    ["from", Array.from(meta.from).slice(0, 40).join("")],
    ["agent", meta.agent ?? ""],
    ["kind", meta.kind],
    ["priority", meta.priority],
    ["authored_by", meta.authoredBy],
    ["sent_at", meta.sentAt.toISOString()],
    ["sig", "unsigned"],
    ["flags", meta.flags.join(" ")],
    ...(meta.authorized ? [["authorized", "true"]] : []),
    ["trust", "untrusted-peer"],
  ]
    .map(([k, v]) => `${k}="${escapeAttr(v ?? "", 80)}"`)
    .join(" ");
  const text = truncate(subject ? `Subject: ${subject}\n${body}` : body, meta.id);
  return `<peer_message ${attrs}>\n${escapeText(clean(text))}\n</peer_message>`;
}
