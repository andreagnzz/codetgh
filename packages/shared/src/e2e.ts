import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from "node:crypto";

// Per-thread end-to-end encryption, built from node:crypto only.
// A thread has one random AES-256 key; each participant gets it wrapped with X25519 + HKDF-SHA256 + AES-256-GCM.
// Text formats are "v1.<base64url parts>" so a stored value says what produced it.

const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

export function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return {
    publicKey: b64(publicKey.export({ type: "spki", format: "der" })),
    privateKey: b64(privateKey.export({ type: "pkcs8", format: "der" })),
  };
}

export const newThreadKey = () => randomBytes(32);

export const publicKeyOf = (privateKey: string) =>
  b64(createPublicKey(createPrivateKey({ key: unb64(privateKey), format: "der", type: "pkcs8" })).export({ type: "spki", format: "der" }));

export function isPublicKey(value: string) {
  try {
    return createPublicKey({ key: unb64(value), format: "der", type: "spki" }).asymmetricKeyType === "x25519";
  } catch {
    return false;
  }
}

function gcm(key: Buffer, plain: Buffer, aad: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return [iv, ct, c.getAuthTag()];
}

function ungcm(key: Buffer, [iv, ct, tag]: Buffer[], aad: string) {
  if (!iv || !ct || !tag) throw new Error("malformed ciphertext");
  const d = createDecipheriv("aes-256-gcm", key, iv).setAAD(Buffer.from(aad)).setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

const wrapKeyFrom = (shared: Buffer, ephemeral: string) =>
  Buffer.from(hkdfSync("sha256", shared, unb64(ephemeral), "codetgh e2e wrap v1", 32));

export function wrapKey(threadKey: Buffer, recipientPublicKey: string) {
  const eph = generateKeyPairSync("x25519");
  const ephPub = b64(eph.publicKey.export({ type: "spki", format: "der" }));
  const shared = diffieHellman({
    privateKey: eph.privateKey,
    publicKey: createPublicKey({ key: unb64(recipientPublicKey), format: "der", type: "spki" }),
  });
  return ["v1", ephPub, ...gcm(wrapKeyFrom(shared, ephPub), threadKey, "wrap").map(b64)].join(".");
}

export function unwrapKey(wrapped: string, privateKey: string) {
  const [v, ephPub, ...rest] = wrapped.split(".");
  if (v !== "v1" || !ephPub) throw new Error("unknown wrapped key format");
  const shared = diffieHellman({
    privateKey: createPrivateKey({ key: unb64(privateKey), format: "der", type: "pkcs8" }),
    publicKey: createPublicKey({ key: unb64(ephPub), format: "der", type: "spki" }),
  });
  return ungcm(wrapKeyFrom(shared, ephPub), rest.map(unb64), "wrap");
}

export const sealBody = (text: string, threadKey: Buffer) => ["v1", ...gcm(threadKey, Buffer.from(text), "body").map(b64)].join(".");

export function openBody(sealed: string, threadKey: Buffer) {
  const [v, ...rest] = sealed.split(".");
  if (v !== "v1") throw new Error("unknown ciphertext format");
  return ungcm(threadKey, rest.map(unb64), "body").toString("utf8");
}

// Shape checks for the hub, which cannot open either: a 12-byte IV, a 16-byte tag, and for keys a real X25519 ephemeral key.
const B = "[A-Za-z0-9_-]";
export const isSealed = (value: string) => new RegExp(`^v1\\.${B}{16}\\.${B}*\\.${B}{22}$`).test(value);
export function isWrapped(value: string) {
  const [v, ephPub, iv, ct, tag, extra] = value.split(".");
  return (
    v === "v1" &&
    extra === undefined &&
    Boolean(ephPub && isPublicKey(ephPub)) &&
    /^.{16}$/.test(iv ?? "") &&
    /^.{43}$/.test(ct ?? "") &&
    /^.{22}$/.test(tag ?? "")
  );
}
