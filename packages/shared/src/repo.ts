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
