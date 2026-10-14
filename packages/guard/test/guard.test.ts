import { describe, expect, it } from "vitest";
import { escapeAttr, renderPeerMessage, scanSecrets, textFlags } from "../src/index.js";

// Built at runtime so no literal credential sits in the repository.
const fakeGithub = () => `ghp_${"A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"}`;

describe("scanSecrets", () => {
  it("finds a provider token and masks it", async () => {
    const key = fakeGithub();
    const [f] = await scanSecrets(`use ${key} please`);
    expect(f?.secret).toBe(key);
    expect(f?.masked).toBe("ghp_…****");
  });

  it("finds a random high-entropy string", async () => {
    expect(await scanSecrets("key Zq8vT2mLp9XwR4kN7bY1cF6hJ3sD0aGe end")).toHaveLength(1);
  });

  it("ignores ids, commit shas and uuids", async () => {
    const text = "msg_01JC4Z8Q2M7K3N4P5Q6R7S8T9V a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2 123e4567-e89b-12d3-a456-426614174000";
    expect(await scanSecrets(text)).toEqual([]);
  });

  it("never shows more than a quarter of a short secret", async () => {
    expect((await scanSecrets("pin 4821-7733", { patterns: ["[0-9]{4}-[0-9]{4}"] }))[0]?.masked).toBe("48…****");
  });

  it("applies team patterns", async () => {
    expect((await scanSecrets("ref ACME-123456", { patterns: ["ACME-[0-9]{6}"] }))[0]?.rule).toBe("codetgh/team-pattern");
  });
});

describe("envelope", () => {
  it("cuts attributes before escaping and keeps one line", () => {
    expect(escapeAttr('a\r\nb"c', 40)).toBe("a b&quot;c");
    expect(escapeAttr("<".repeat(100), 3)).toBe("&lt;&lt;&lt;");
  });

  it("truncates bodies over 8 KB with a pointer", () => {
    const out = renderPeerMessage(
      { id: "msg_1", from: "L", agent: null, kind: "note", priority: "low", authoredBy: "human", sentAt: new Date(0), flags: [] },
      null,
      "é".repeat(6000),
    );
    expect(out).toContain("[truncated, see msg_1]");
  });
});

describe("textFlags", () => {
  it("marks links and secret-looking assignments", () => {
    expect(textFlags("see https://x.example and password: hunter2")).toEqual(["secret-suspect", "external-link"]);
    expect(textFlags("password: x", { secretFound: true })).toEqual([]);
  });
});
