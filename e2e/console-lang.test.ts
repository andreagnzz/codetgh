import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "../apps/hub/test/harness.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${hub.url}${path}`, { headers, redirect: "manual" });

it("switches the console to English and back, whatever the browser asks", async () => {
  const french = await (await get("/console/projects", { cookie: team.lea.cookie, "accept-language": "fr" })).text();
  expect(french).toContain("Projets");
  expect(french).toContain('href="/lang/en?next=%2Fconsole%2Fprojects"');

  const res = await get("/lang/en?next=%2Fconsole%2Fprojects");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/console/projects");
  expect(res.headers.get("set-cookie")).toMatch(/^lang=en;.*Path=\//);

  const english = await (await get("/console/projects", { cookie: `${team.lea.cookie}; lang=en`, "accept-language": "fr" })).text();
  expect(english).toContain("Projects");
  expect(english).not.toContain("Projets");
  expect(english).toContain('href="/lang/fr?next=%2Fconsole%2Fprojects"');
  // Public pages follow the choice too.
  expect(await (await get("/login", { cookie: "lang=fr", "accept-language": "en" })).text()).toContain('lang="fr"');
});

it("only sends you back to a page of this hub", async () => {
  // Browsers drop tabs and newlines from URLs: "/\t/evil" would become "//evil".
  for (const next of [
    "//evil.example",
    "https://evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/.//evil.example",
    "/a/..//evil.example",
    "",
  ]) {
    expect((await get(`/lang/fr?next=${encodeURIComponent(next)}`)).headers.get("location")).toBe("/console");
  }
  expect((await get("/lang/de")).status).toBe(404);
});
