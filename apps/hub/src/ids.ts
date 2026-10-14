import { ulid } from "ulid";

export const newId = (prefix: string) => `${prefix}_${ulid()}`;
