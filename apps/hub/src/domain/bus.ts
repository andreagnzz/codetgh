import { EventEmitter } from "node:events";

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
