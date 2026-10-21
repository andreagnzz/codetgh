// Bash commands a delegate session never runs for a peer: reading secret files, a force push in any spelling, or a
// command built at run time that this check cannot read.
// shortcut: a best-effort blocklist over the command text, which can never be complete (a script that opens the file
// itself, an alias, a file written then run). It narrows what a request can do, it does not isolate: run delegate
// sessions in a devcontainer or a dedicated clone.

const EDGE = String.raw`(?:^|[\s=:<>/(~])`;
const END = String.raw`(?=$|[\s;|&)<>/])`;
const SECRET_PATHS = [
  new RegExp(`${EDGE}\\.env[\\w.-]*${END}`),
  new RegExp(String.raw`[\w-]\.(?:pem|key)${END}`),
  new RegExp(`${EDGE}\\.(?:ssh|aws)${END}`),
];

// a -f cluster (-f, -fu), --force, --force-with-lease, --force-if-includes, or a +refspec (+main, +HEAD:main).
const FORCE_ARG = /^(?:-[a-zA-Z]*f[a-zA-Z]*|--force[\w=-]*|\+\S+)$/;

// Checked on the raw text: these run a command the text does not show.
const DYNAMIC = [
  /(?:^|[\s;&|(`])eval(?=\s|$)/,
  /\bbase64\s+(?:-d|-D|--decode)\b[^|]*\|/,
  /(?:\$\(|`)[^)`]*\b(?:printf|xxd|base64|rev|tr|od)\b/,
  /\b(?:ba|z|da|k)?sh\s+(?:-\w+\s+)*-c\s+\S*[^\n]*[$`]/,
];

// What the shell would see once it removed quoting: $'…' and "…" quotes, backslash escapes, ${HOME} and $HOME.
const normalize = (command: string) =>
  command
    .replace(/\$'/g, "'")
    .replace(/\\([\s\S])/g, "$1")
    .replace(/['"]/g, "")
    .replace(/\$\{?HOME\}?/g, "~");

export function delegateBlock(command: string): string | null {
  if (DYNAMIC.some((r) => r.test(command)))
    return "it builds the command at run time (dynamic: eval, sh -c with variables, decoded or substituted text)";
  const plain = normalize(command);
  if (SECRET_PATHS.some((r) => r.test(plain))) return "it reads a secret file (.env, *.pem, *.key, ~/.ssh or ~/.aws)";
  // Shell separators split the command, so a; b and what sh -c runs are seen too.
  for (const part of plain.split(/[;&|\n]+/)) {
    const words = part.split(/[\s()]+/).filter(Boolean);
    const git = words.indexOf("git");
    const push = words.indexOf("push", git + 1);
    if (git >= 0 && push > git && words.slice(push + 1).some((w) => FORCE_ARG.test(w)))
      return "it force-pushes (--force, -f, --force-with-lease or a +refspec)";
  }
  return null;
}
