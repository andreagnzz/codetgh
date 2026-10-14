// Heuristics only: a flag makes the reader careful, it never blocks.
// JS \b ignores accented letters, so word edges use Unicode lookarounds.
const w = (words: string) => `(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`;
const near = (a: string, b: string, gap = 30) => new RegExp(`${w(a)}[^\\n]{0,${gap}}${w(b)}`, "iu");

const INSTRUCTION_LIKE = [
  near("ignore|disregard|forget", "instructions?|rules|prompt|previous|above"),
  near("ignore|ignores|ignorez|oublie|oublies|oubliez", "consignes?|instructions?|règles|regles"),
  new RegExp(`${w("system prompt|prompt système")}`, "iu"),
  new RegExp(`${w("you are now|tu es maintenant|tu es désormais|vous êtes maintenant|vous êtes désormais")}`, "iu"),
  near("run|execute|exec", "command|script|this|the", 20),
  near("lance|lancez|exécute|exécutez|execute", "commande|script|ceci|cela|ça|la", 20),
  /\|\s*(?:ba|z)?sh\b/i,
  /\bcurl\b[^\n]*\|/i,
  /\brm\s+-[a-z]*r[a-z]*f?\b/i,
  /\bsudo\b/i,
  /\$\(/,
  /<\s*\/?\s*(?:system|peer_message|assistant|user)\b/i,
  /^\s*(?:system|assistant)\s*:/im,
  near("approve|accept|allow", "permission|prompt|requests?"),
  near("approuve|approuvez|accepte|acceptez|autorise|autorisez", "permissions?|invites?|demandes?|requêtes?"),
  near("disable|turn off|désactive|desactive|désactivez", "codetgh|hooks?|security|sécurité|plugin"),
  near("modify|edit|change|modifie|modifiez|change", "claude\\.md|settings\\.json|hooks?|réglages", 20),
];
const SECRET_SUSPECT = /\b(password|passwd|mot de passe|secret|api[_-]?key|token)\s*[:=]/i;
const EXTERNAL_LINK = /\bhttps?:\/\//i;
// Zero-width and bidi controls hide words from the patterns above.
const INVISIBLE = /[​-‏‪-‮⁠-⁤﻿]/g;

export function textFlags(text: string, opts: { secretFound?: boolean } = {}) {
  const visible = text.replace(INVISIBLE, "");
  const flags: string[] = [];
  if (INSTRUCTION_LIKE.some((r) => r.test(visible))) flags.push("instruction-like");
  if (!opts.secretFound && SECRET_SUSPECT.test(visible)) flags.push("secret-suspect");
  if (EXTERNAL_LINK.test(visible)) flags.push("external-link");
  return flags;
}
