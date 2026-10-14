// Only used by `auth generate` to emit src/db/auth-schema.ts.
import { createAuth } from "../src/auth.js";

export const auth = createAuth({ publicUrl: "http://localhost:8787", secret: "schema-generation-only" });
