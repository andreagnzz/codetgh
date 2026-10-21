// Bash commands a delegate session never runs for a peer: reading secret files, or a force push in any spelling.
// shortcut: textual check on the command as written; a variable, an encoded string or a script that opens the file
// itself gets past it. It narrows what a request can do, it does not isolate: run delegates in a clone or a container.

const EDGE = String.raw`(?:^|[\s'"=:<>/(~])`;
const END = String.raw`(?=$|[\s'";|&)<>/])`;
const SECRET_PATHS = [
  new RegExp(`${EDGE}\\.env[\\w.-]*${END}`),
  new RegExp(String.raw`[\w-]\.(?:pem|key)${END}`),
  new RegExp(`${EDGE}\\.(?:ssh|aws)${END}`),
];

// a -f cluster (-f, -fu), --force, --force-with-lease, --force-if-includes, or a +refspec (+main, +HEAD:main).
const FORCE_ARG = /^(?:-[a-zA-Z]*f[a-zA-Z]*|--force[\w=-]*|\+\S+)$/;

export function delegateBlock(command: string): string | null {
  if (SECRET_PATHS.some((r) => r.test(command))) return "it reads a secret file (.env, *.pem, *.key, ~/.ssh or ~/.aws)";
  // Shell separators and quotes split the command into words, so sh -c '…' and a; b are seen too.
  for (const part of command.split(/[;&|\n]+/)) {
    const words = part.split(/[\s'"()]+/).filter(Boolean);
    const git = words.indexOf("git");
    const push = words.indexOf("push", git + 1);
    if (git >= 0 && push > git && words.slice(push + 1).some((w) => FORCE_ARG.test(w)))
      return "it force-pushes (--force, -f, --force-with-lease or a +refspec)";
  }
  return null;
}
