// After pnpm -r build: pack what the hub serves to members, the plugin (zip) and the CLI (npm tarball), into apps/hub/dist.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "apps/hub/dist");
const plugin = join(root, "packages/plugin");
mkdirSync(out, { recursive: true });

const files = {};
const add = (path) => {
  // Claude Code lays its API types (and the names of your connected MCP tools) there when it loads the mod from disk.
  if (path === join(plugin, ".claude-plugin/types")) return;
  if (statSync(path).isDirectory()) for (const name of readdirSync(path)) add(join(path, name));
  else files[`codetgh/${relative(plugin, path).split(sep).join("/")}`] = readFileSync(path);
};
if (!statSync(join(plugin, "dist/hook.js"), { throwIfNoEntry: false }))
  throw new Error("packages/plugin/dist/hook.js is missing: run pnpm -r build first");
// What the plugin is made of, nothing else: a stray file left in packages/plugin (notes, .env, a dump) never ships.
for (const name of [".claude-plugin", ".mcp.json", "agents", "assets", "dist", "hooks", "skills"]) add(join(plugin, name));
files["codetgh/LICENSE"] = readFileSync(join(root, "LICENSE"));
files["codetgh/NOTICE"] = readFileSync(join(root, "NOTICE"));
// Fixed timestamps: the same sources give the same zip, so the marketplace digest only changes with the plugin.
writeFileSync(join(out, "plugin.zip"), zipSync(files, { mtime: new Date("2026-01-01T00:00:00Z") }));

const { version } = JSON.parse(readFileSync(join(plugin, ".claude-plugin/plugin.json"), "utf8"));
const cli = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
const stage = mkdtempSync(join(tmpdir(), "codetgh-cli-"));
writeFileSync(
  join(stage, "package.json"),
  JSON.stringify({
    name: "codetgh",
    version,
    description: "CodeTgh command line: connect your Claude to your team's hub",
    license: "MIT",
    type: "module",
    bin: { codetgh: "codetgh.js" },
    engines: { node: ">=22" },
    // The bundle carries everything else; the keychain binding is native and comes per platform from npm.
    dependencies: { "@napi-rs/keyring": cli.dependencies["@napi-rs/keyring"] },
  }),
);
copyFileSync(join(root, "packages/cli/dist/codetgh.js"), join(stage, "codetgh.js"));
copyFileSync(join(root, "LICENSE"), join(stage, "LICENSE"));
copyFileSync(join(root, "NOTICE"), join(stage, "NOTICE"));
// On Windows npm is npm.cmd, which only runs through a shell; no argument carries a path, so nothing needs quoting.
execFileSync("npm", ["pack", "--silent"], { cwd: stage, stdio: ["ignore", "ignore", "inherit"], shell: process.platform === "win32" });
// Copy, not rename: the temp folder may sit on another drive (C: vs D: on Windows).
copyFileSync(join(stage, `codetgh-${version}.tgz`), join(out, "codetgh-cli.tgz"));
rmSync(stage, { recursive: true });
console.log(`apps/hub/dist: plugin.zip (${Object.keys(files).length} files), codetgh-cli.tgz (codetgh ${version})`);
