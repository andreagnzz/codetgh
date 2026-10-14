import { describe, expect, it } from "vitest";
import { newKeyPair, newThreadKey, openBody, sealBody, unwrapKey, wrapKey } from "../src/e2e.js";

describe("end-to-end encryption primitives", () => {
  it("wraps a thread key for each participant and seals bodies with it", () => {
    const lea = newKeyPair();
    const sam = newKeyPair();
    const key = newThreadKey();
    const forLea = wrapKey(key, lea.publicKey);
    const forSam = wrapKey(key, sam.publicKey);
    expect(forLea).not.toBe(forSam);
    const sealed = sealBody("Friday: migrate users", key);
    expect(sealed).not.toContain("migrate");
    expect(openBody(sealed, unwrapKey(forLea, lea.privateKey))).toBe("Friday: migrate users");
    expect(openBody(sealed, unwrapKey(forSam, sam.privateKey))).toBe("Friday: migrate users");
  });

  it("refuses the wrong key and any tampering", () => {
    const lea = newKeyPair();
    const malik = newKeyPair();
    const key = newThreadKey();
    const wrapped = wrapKey(key, lea.publicKey);
    expect(() => unwrapKey(wrapped, malik.privateKey)).toThrow();
    const sealed = sealBody("hello", key);
    const tampered = `${sealed.slice(0, -4)}${sealed.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
    expect(() => openBody(tampered, key)).toThrow();
    expect(() => openBody(sealed, newThreadKey())).toThrow();
  });
});
