import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { expect, it } from "vitest";

// npm installs the CLI on Linux and macOS as bin/codetgh, a symlink to codetgh.js; on Windows it writes a .cmd instead.
it.skipIf(process.platform === "win32")("runs when started through the symlink npm installs", () => {
  const pkg = fileURLToPath(new URL("..", import.meta.url));
  // Inside the package, so the native keychain module still resolves from node_modules.
  mkdirSync(join(pkg, "node_modules/.cache"), { recursive: true });
  const dir = mkdtempSync(join(pkg, "node_modules/.cache/codetgh-entry-"));
  buildSync({
    entryPoints: [join(pkg, "src/main.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    external: ["@napi-rs/keyring"],
    banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" },
    outfile: join(dir, "lib/codetgh.js"),
    logLevel: "error",
  });
  mkdirSync(join(dir, "bin"));
  symlinkSync(join(dir, "lib/codetgh.js"), join(dir, "bin/codetgh"));
  expect(execFileSync(process.execPath, [join(dir, "bin/codetgh"), "--help"], { encoding: "utf8" })).toContain("Usage: codetgh");
});
