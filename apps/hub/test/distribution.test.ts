import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Hub, startHub } from "./harness.js";

const zip = zipSync({ "codetgh/.claude-plugin/plugin.json": strToU8('{"name":"codetgh"}') });
const tgz = Buffer.from("not really a tarball");
let hub: Hub;
let empty: Hub;
beforeAll(async () => {
  const distDir = mkdtempSync(join(tmpdir(), "codetgh-dist-"));
  writeFileSync(join(distDir, "plugin.zip"), zip);
  writeFileSync(join(distDir, "codetgh-cli.tgz"), tgz);
  hub = await startHub({ config: { distDir } });
  empty = await startHub({ config: { distDir: mkdtempSync(join(tmpdir(), "codetgh-nodist-")) } });
});
afterAll(async () => {
  await hub.stop();
  await empty.stop();
});

describe("the hub distributes its plugin and CLI", () => {
  it("serves a marketplace whose plugin is the hub's own zip, pinned by digest", async () => {
    const res = await fetch(`${hub.url}/plugin/marketplace.json`);
    expect(res.status).toBe(200);
    const m = await res.json();
    expect(m).toMatchObject({
      name: "codetgh",
      owner: { name: expect.any(String) },
      plugins: [
        {
          name: "codetgh",
          source: { source: "archive", url: `${hub.url}/plugin/codetgh.zip`, sha256: createHash("sha256").update(zip).digest("hex") },
        },
      ],
    });
    const file = await fetch(`${hub.url}/plugin/codetgh.zip`);
    expect(file.headers.get("content-type")).toBe("application/zip");
    expect(Buffer.from(await file.arrayBuffer()).equals(Buffer.from(zip))).toBe(true);
  });

  it("serves the CLI as an npm tarball", async () => {
    const res = await fetch(`${hub.url}/cli/codetgh.tgz`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(tgz)).toBe(true);
  });

  it("says how to build the bundles when they are missing", async () => {
    for (const path of ["/plugin/marketplace.json", "/plugin/codetgh.zip", "/cli/codetgh.tgz"]) {
      const res = await fetch(`${empty.url}${path}`);
      expect(res.status).toBe(404);
      expect((await res.json()).message).toContain("pnpm build");
    }
  });
});
