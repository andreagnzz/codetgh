// License gate on what ships: every package esbuild put in a bundle, plus the packages the image copies.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

// MIT-0 added by the human on 2026-10-13 (nodemailer).
const ALLOWED = new Set([
  "MIT",
  "MIT-0",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "0BSD",
  "Unlicense",
  "CC0-1.0",
  "MIT OR Apache-2.0",
  "Apache-2.0 OR MIT",
]);
// Read in the LICENSE file during the reuse audit (docs/REUSE.md) because package.json has no license field.
const VERIFIED = { "htmx-ext-sse": "0BSD" };
const METAFILES = [
  "apps/hub/dist/meta.json",
  "packages/cli/dist/hook-meta.json",
  "packages/cli/dist/cli-meta.json",
  "packages/channel-bridge/dist/meta.json",
];
const RUNTIME = ["apps/hub/node_modules/@electric-sql/pglite", "apps/hub/node_modules/htmx.org", "apps/hub/node_modules/htmx-ext-sse"];

const dirs = new Set(RUNTIME);
for (const file of METAFILES) {
  if (!existsSync(file)) throw new Error(`${file} missing: run pnpm build first`);
  const base = dirname(file);
  for (const input of Object.keys(JSON.parse(readFileSync(file, "utf8")).inputs)) {
    const m = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (m) dirs.add(join(base, "..", m[1]).replace(/^(\.\.\/)+/, ""));
  }
}

let failed = false;
const seen = new Map();
for (const dir of dirs) {
  const path = existsSync(join(dir, "package.json")) ? dir : join("apps/hub", dir);
  const pkg = JSON.parse(readFileSync(join(existsSync(join(dir, "package.json")) ? dir : path, "package.json"), "utf8"));
  const license = VERIFIED[pkg.name] ?? (typeof pkg.license === "string" ? pkg.license : pkg.license?.type);
  seen.set(`${pkg.name}@${pkg.version}`, license);
  if (!ALLOWED.has(license)) {
    console.error(`NOT ALLOWED ${pkg.name}@${pkg.version}: ${license ?? "no license"}`);
    failed = true;
  }
}
console.log(`${seen.size} shipped packages checked`);
process.exit(failed ? 1 : 0);
