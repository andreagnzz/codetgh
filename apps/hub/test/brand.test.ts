import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Hub, startHub } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

describe("brand", () => {
  it("serves the favicon files and the web manifest at the hub root", async () => {
    for (const [path, type] of [
      ["/favicon.ico", "image/"],
      ["/favicon.svg", "image/svg+xml"],
      ["/site.webmanifest", ""],
      ["/apple-touch-icon.png", "image/png"],
    ]) {
      const res = await fetch(`${hub.url}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type") ?? "").toContain(type);
    }
    const manifest = await (await fetch(`${hub.url}/site.webmanifest`)).json();
    expect(manifest).toMatchObject({ name: "CodeTgh", short_name: "CodeTgh", description: "Plusieurs Claude Code, une même ligne." });
  });

  it("serves the kit's logos unchanged, and nothing outside the brand folder", async () => {
    const svg = await (await fetch(`${hub.url}/brand/lockup-horizontal-color.svg`)).text();
    expect(svg).toBe(readFileSync(new URL("../../../assets/brand/lockup-horizontal-color.svg", import.meta.url), "utf8"));
    expect((await fetch(`${hub.url}/brand/..%2F..%2Fpackage.json`)).status).toBe(404);
  });

  it("puts the favicon, theme color and stacked logo on the public pages", async () => {
    for (const path of ["/login", "/invite/not-a-token"]) {
      const html = await (await fetch(`${hub.url}${path}`)).text();
      expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml"');
      expect(html).toContain('<meta name="theme-color" content="#087F70"');
      expect(html).toContain('<link rel="stylesheet" href="/console.css"');
      expect(html).toContain('srcset="/brand/lockup-stacked-on-dark.svg"');
      expect(html).toContain('src="/brand/lockup-stacked-color.svg"');
    }
  });

  it("puts the horizontal logo in the console header, with the symbol on small screens", async () => {
    const html = await (await fetch(`${hub.url}/console`, { headers: { cookie: team.lea.cookie } })).text();
    expect(html).toContain('src="/brand/lockup-horizontal-color.svg"');
    expect(html).toContain('srcset="/brand/lockup-horizontal-on-dark.svg"');
    expect(html).toContain('srcset="/brand/symbol-color.svg"');
    expect(html).toContain('srcset="/brand/symbol-mint-thin.svg"');
  });
});
