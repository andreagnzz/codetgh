import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db/index.js";
import { personalToken } from "./db/schema.js";
import { newId } from "./ids.js";

const PREFIX = "ctgh_";
const TTL_MS = 90 * 24 * 3600 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export const bearerToken = (authorization: string | undefined) => authorization?.match(/^Bearer (ctgh_\S+)$/)?.[1];

export async function createPersonalToken(db: Db, input: { userId: string; teamId: string; label: string; kind?: string }) {
  const token = PREFIX + randomBytes(32).toString("base64url");
  const id = newId("tok");
  await db.insert(personalToken).values({ id, ...input, hash: hashToken(token), expiresAt: new Date(Date.now() + TTL_MS) });
  return { id, token };
}
