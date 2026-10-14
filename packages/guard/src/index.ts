import { renderPeerMessage } from "./envelope.js";
import { textFlags } from "./flags.js";

export { escapeAttr, escapeText, type PeerMeta, renderPeerMessage } from "./envelope.js";
export { textFlags } from "./flags.js";
export { type SecretFinding, scanSecrets } from "./secrets.js";

// Peer-written text that is not a message (titles, statuses, names) gets the same envelope, with no sender.
export const renderPeerData = (kind: string, text: string) =>
  renderPeerMessage(
    { id: kind, from: "team", agent: null, kind, priority: "normal", authoredBy: "agent", sentAt: new Date(0), flags: textFlags(text) },
    null,
    text,
  );
