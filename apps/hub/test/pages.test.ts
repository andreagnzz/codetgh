import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Hub, startHub } from "./harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${hub.url}${path}`, { headers, redirect: "manual" });

describe("pages", () => {
  it("starts every page with a doctype, so no browser renders it in quirks mode", async () => {
    for (const [path, cookie] of [
      ["/login", ""],
      ["/consent?client_id=c&scope=openid", ""],
      ["/invite/not-a-token", ""],
      ["/console", team.lea.cookie],
      ["/console/agents", team.lea.cookie],
    ]) {
      const html = await (await get(path ?? "", { cookie: cookie ?? "" })).text();
      expect(html.startsWith("<!doctype html>"), path).toBe(true);
    }
  });

  it("shows a full-page error in the public layout, with its status, the hub's reason and a way back", async () => {
    for (const [path, cookie, status, title] of [
      ["/console/threads/thr_unknown", team.lea.cookie, 404, "This page doesn't exist."],
      ["/console/tasks/tsk_unknown", team.lea.cookie, 404, "This page doesn't exist."],
      ["/console/members", team.sam.cookie, 403, "You can't open this page."],
      ["/console/memory?status=bogus", team.lea.cookie, 400, "This request isn't valid."],
    ] as const) {
      const res = await get(path, { cookie });
      expect(res.status, path).toBe(status);
      const html = await res.text();
      expect(html.startsWith("<!doctype html>"), path).toBe(true);
      expect(html, path).toContain('<main class="public">');
      expect(html, path).toContain('src="/brand/lockup-stacked-color.svg"');
      expect(html, path).toContain(`<h1>${title.replace("'", "&#39;")}</h1>`);
      expect(html, path).toContain('href="/console"');
    }
    expect(await (await get("/console/threads/thr_unknown", { cookie: team.lea.cookie })).text()).toContain("thread not found");
  });

  it("writes the error page in French for a French reader", async () => {
    const html = await (await get("/console/members", { cookie: team.sam.cookie, "accept-language": "fr-FR" })).text();
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("Tu ne peux pas ouvrir cette page.");
    expect(html).toContain("Retour à la vue d&#39;ensemble");
  });

  it("keeps the bare reason for an htmx request, which console.js shows under the form", async () => {
    const res = await get("/console/threads/thr_unknown", { cookie: team.lea.cookie, "HX-Request": "true" });
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).not.toContain("<!doctype html>");
    expect(html).toContain("thread not found");
  });
});
