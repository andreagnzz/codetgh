export const escapeText = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// One line, no control characters, cut before escaping so an entity is never split.
export const escapeAttr = (s: string, max = 60) =>
  escapeText(
    Array.from(s.replace(/[\r\n\t]+/g, " ").replace(/\p{Cc}/gu, ""))
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
};

// Peer text is data, never instructions: everything inside is escaped, trust is always the last attribute.
export function renderPeerMessage(meta: PeerMeta, subject: string | null, body: string) {
  const attrs = [
    ["id", meta.id],
    ["from", escapeAttr(meta.from, 40)],
    ["agent", meta.agent ?? ""],
    ["kind", meta.kind],
    ["priority", meta.priority],
    ["authored_by", meta.authoredBy],
    ["sent_at", meta.sentAt.toISOString()],
    ["sig", "unsigned"],
    ["flags", meta.flags.join(" ")],
    ["trust", "untrusted-peer"],
  ]
    .map(([k, v]) => `${k}="${escapeAttr(v ?? "", 80)}"`)
    .join(" ");
  const text = truncate(subject ? `Subject: ${subject}\n${body}` : body, meta.id);
  return `<peer_message ${attrs}>\n${escapeText(text)}\n</peer_message>`;
}
