import { EventEmitter } from "node:events";
import type { Principal } from "../principal.js";

export type BusEvents = {
  message: [{ teamId: string; messageId: string; threadId: string; replyTo: string | null; kind: string; recipientUserIds: string[] }];
  kill: [{ teamId: string }];
  revoked: [{ teamId: string; userId: string }];
  presence: [{ teamId: string }];
  attention: [{ teamId: string }];
};

// shortcut: in-process bus, single hub process; use Postgres LISTEN/NOTIFY when the hub runs replicas.
export class Bus extends EventEmitter<BusEvents> {
  constructor() {
    super();
    this.setMaxListeners(0);
  }
}

// Resolves on the next message match accepts ("message"), on kill switch or revocation ("stop"), or at the deadline.
export const nextEvent = (bus: Bus, p: Principal, ms: number, match: (e: BusEvents["message"][0]) => boolean) =>
  new Promise<"message" | "stop" | "timeout">((resolve) => {
    const done = (r: "message" | "stop" | "timeout") => {
      clearTimeout(timer);
      bus.off("message", onMessage);
      bus.off("kill", onKill);
      bus.off("revoked", onRevoked);
      resolve(r);
    };
    const onMessage = (e: BusEvents["message"][0]) => match(e) && done("message");
    const onKill = (e: { teamId: string }) => e.teamId === p.teamId && done("stop");
    const onRevoked = (e: { userId: string }) => e.userId === p.user.id && done("stop");
    const timer = setTimeout(() => done("timeout"), ms);
    bus.on("message", onMessage);
    bus.on("kill", onKill);
    bus.on("revoked", onRevoked);
  });
