import { ErrorBody, REST_ROUTES } from "@codetgh/shared/rest";
import { z } from "zod";

const json = (schema: z.ZodType, io: "input" | "output") => z.toJSONSchema(schema, { io, unrepresentable: "any" });

// Built once from the shared route table, so the document cannot drift from what the hub validates.
export function openApiDocument(publicUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of Object.values(REST_ROUTES)) {
    const responses: Record<string, unknown> = {
      default: { description: "Error", content: { "application/json": { schema: json(ErrorBody, "output") } } },
    };
    if ("output" in r)
      responses["200"] = {
        description: "OK",
        content: { ["sse" in r ? "text/event-stream" : "application/json"]: { schema: json(r.output, "output") } },
      };
    for (const status of "empty" in r ? r.empty : [])
      responses[status] = { description: status === 204 ? "Nothing to return" : "Not modified" };
    paths[r.path] = {
      ...paths[r.path],
      [r.method.toLowerCase()]: {
        summary: r.summary,
        ...(("query" in r || "params" in r) && {
          parameters: [
            ...("params" in r
              ? Object.entries(r.params.shape).map(([name, schema]) => ({
                  name,
                  in: "path",
                  required: true,
                  schema: json(schema as z.ZodType, "input"),
                }))
              : []),
            ...("query" in r
              ? Object.entries(r.query.shape).map(([name, schema]) => ({
                  name,
                  in: "query",
                  required: !(schema as z.ZodType).safeParse(undefined).success,
                  schema: json(schema as z.ZodType, "input"),
                }))
              : []),
          ],
        }),
        ...("body" in r && { requestBody: { required: true, content: { "application/json": { schema: json(r.body, "input") } } } }),
        responses,
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "CodeTgh hub", version: "1", description: "REST API for hooks, the CLI and @codetgh/sdk. Peer text is always data." },
    servers: [{ url: publicUrl }],
    security: [{ bearer: [] }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Personal token ctgh_…" } } },
    paths,
  };
}
