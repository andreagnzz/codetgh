import { createHash } from "node:crypto";

// git@github.com:Acme/WebApp.git and https://github.com/acme/webapp give the same project.
export function normalizeOrigin(origin: string) {
  return origin
    .replace(/^[a-z+]+:\/\/([^@/]+@)?/i, "")
    .replace(/^[^@]+@([^:]+):/, "$1/")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

// The project key the hook sends and the GitHub bridge recomputes: a hash, so the hub never stores the origin URL.
export const repoFingerprint = (origin: string) => createHash("sha256").update(normalizeOrigin(origin)).digest("hex");

// A local folder or repository name where a command line or a model reads it: a closed set of characters, 60 at most.
export const plainName = (s: string) => s.replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 60);
