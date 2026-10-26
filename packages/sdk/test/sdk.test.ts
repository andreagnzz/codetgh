import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Hub, startHub, startSession } from "../../../apps/hub/test/harness.js";
import { CodeTghError, createClient } from "../src/index.js";

let hub: Hub;
let team: Awaited<ReturnType<Hub["seed"]>>;
beforeAll(async () => {
  hub = await startHub();
  team = await hub.seed();
});
afterAll(() => hub.stop());

describe("@codetgh/sdk", () => {
  it("knows who it is", async () => {
    const sam = createClient({ url: hub.url, token: team.sam.token });
    expect(await sam.whoami()).toMatchObject({ handle: "sam", team: { name: "Acme web" } });
  });

  it("sends, reads an inbox in envelopes and acks", async () => {
    const sam = createClient({ url: hub.url, token: team.sam.token });
    const lea = createClient({ url: hub.url, token: team.lea.token });
    await startSession(hub.url, team.lea.token, "lea-sdk");
    const sent = await sam.send({ to: "@lea", kind: "question", body: "Is <b>v2</b> frozen?", allow_offline: true });
    expect(sent.id).toMatch(/^msg_/);

    const inbox = await lea.inbox({ limit: 20 });
    expect(inbox.messages.map((m) => m.id)).toContain(sent.id);
    expect(inbox.envelopes.join("\n")).toContain("Is &lt;b&gt;v2&lt;/b&gt; frozen?");
    expect(inbox.envelopes.join("\n")).toContain('trust="untrusted-peer"');

    expect((await lea.ack({ up_to: sent.id })).acked).toBeGreaterThan(0);
    expect((await sam.messageStatus(sent.id)).recipients).toMatchObject([{ handle: "@lea", read_at: expect.any(String) }]);
    expect((await lea.inbox({ limit: 20 })).messages.map((m) => m.id)).not.toContain(sent.id);
  });

  it("streams new message ids", async () => {
    const lea = createClient({ url: hub.url, token: team.lea.token });
    const sam = createClient({ url: hub.url, token: team.sam.token });
    const ctl = new AbortController();
    const events = lea.stream({ signal: ctl.signal });
    const first = events.next();
    await new Promise((r) => setTimeout(r, 200));
    const sent = await sam.send({ to: "@lea", kind: "note", body: "streamed", allow_offline: true });
    const { value } = await first;
    ctl.abort();
    expect(value).toMatchObject({ message_id: sent.id, kind: "note" });
  });

  it("throws typed errors", async () => {
    const sam = createClient({ url: hub.url, token: team.sam.token });
    const err = await sam.send({ to: "@lea", kind: "note", body: `ghp_${"Zx9Kq2Lm7Np4Rt8Vw1Yb3Cd6Fg0Hj5Ks2Lp"}` }).catch((e) => e);
    expect(err).toBeInstanceOf(CodeTghError);
    expect(err).toMatchObject({ code: "E_SECRET_BLOCKED", status: 422 });
    const nobody = await createClient({ url: hub.url, token: "ctgh_nope" })
      .whoami()
      .catch((e) => e);
    expect(nobody).toMatchObject({ code: "E_UNAUTHORIZED", status: 401 });
  });

  it("gives up on a hub that never answers, and says so", async () => {
    const silent = createServer(() => {});
    await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
    const started = Date.now();
    const err = await createClient({ url, token: team.sam.token, timeoutMs: 300 })
      .status()
      .catch((e: Error) => e);
    silent.closeAllConnections();
    silent.close();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("did not answer");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("rejects a 200 answer that is not JSON, instead of returning an empty object", async () => {
    const portal = createServer((_, res) => res.writeHead(200, { "content-type": "text/html" }).end("<html>"));
    await new Promise<void>((r) => portal.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(portal.address() as AddressInfo).port}`;
    const err = await createClient({ url, token: team.sam.token })
      .status()
      .catch((e: Error) => e);
    portal.close();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("not JSON");
  });

  it("rejects a 200 answer whose body never ends, instead of returning an empty object", async () => {
    const stalled = createServer((_, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.flushHeaders();
    });
    await new Promise<void>((r) => stalled.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(stalled.address() as AddressInfo).port}`;
    const err = await createClient({ url, token: team.sam.token, timeoutMs: 300 })
      .status()
      .catch((e: Error) => e);
    stalled.closeAllConnections();
    stalled.close();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("did not answer");
  });
});
