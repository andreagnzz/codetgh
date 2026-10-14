import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "./harness.js";

// Sign-in providers come from the environment (auth.ts); the page offers a button for each one configured.
let hub: Hub;
beforeAll(async () => {
  process.env.AUTH_GITHUB_ID = "test-client-id";
  process.env.AUTH_GITHUB_SECRET = "test-client-secret";
  hub = await startHub();
});
afterAll(async () => {
  await hub.stop();
  delete process.env.AUTH_GITHUB_ID;
  delete process.env.AUTH_GITHUB_SECRET;
});

it("offers GitHub sign-in when GitHub is configured, and not Google", async () => {
  const html = await (await fetch(`${hub.url}/login`)).text();
  expect(html).toContain('data-provider="github"');
  expect(html).toContain("Sign in with GitHub");
  expect(html).not.toContain('data-provider="google"');
});

it("the GitHub button leads to github.com with the hub's callback", async () => {
  const res = await fetch(`${hub.url}/api/auth/sign-in/social`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: hub.url },
    body: JSON.stringify({ provider: "github", callbackURL: "/console" }),
  });
  const url = new URL((await res.json()).url);
  expect(url.host).toBe("github.com");
  expect(url.searchParams.get("redirect_uri")).toBe(`${hub.url}/api/auth/callback/github`);
});

it("says it in French too", async () => {
  expect(await (await fetch(`${hub.url}/login`, { headers: { "accept-language": "fr" } })).text()).toContain("Se connecter avec GitHub");
});
