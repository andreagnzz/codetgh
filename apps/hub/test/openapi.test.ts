import { afterAll, beforeAll, expect, it } from "vitest";
import { type Hub, startHub } from "./harness.js";

let hub: Hub;
beforeAll(async () => {
  hub = await startHub();
});
afterAll(() => hub.stop());

type Doc = {
  openapi: string;
  paths: Record<
    string,
    Record<string, { requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> } }>
  >;
  components: { securitySchemes: Record<string, { type: string; scheme?: string }> };
};

it("serves an OpenAPI 3.1 document without a token", async () => {
  const res = await fetch(`${hub.url}/v1/openapi.json`);
  expect(res.status).toBe(200);
  const doc = (await res.json()) as Doc;
  expect(doc.openapi).toBe("3.1.0");
  expect(doc.components.securitySchemes.bearer).toMatchObject({ type: "http", scheme: "bearer" });
  const send = doc.paths["/v1/messages"]?.post?.requestBody?.content["application/json"]?.schema.properties ?? {};
  expect(Object.keys(send)).toEqual(expect.arrayContaining(["to", "kind", "body", "idempotency_key"]));
});

it("documents every /v1 route the hub serves, and nothing else", async () => {
  const doc = (await (await fetch(`${hub.url}/v1/openapi.json`)).json()) as Doc;
  const documented = Object.entries(doc.paths).flatMap(([path, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${path}`));
  const served = [
    ...new Set(
      hub.app.routes
        .filter((r) => r.path.startsWith("/v1/") && r.path !== "/v1/openapi.json" && r.method !== "ALL")
        .map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, "{$1}")}`),
    ),
  ];
  expect(documented.sort()).toEqual(served.sort());
});
