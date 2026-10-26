import type { Task } from "@a2a-js/sdk";
import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export * from "./auth-schema.js";

export type TeamSettings = {
  retention_days?: number;
  secret_patterns?: string[];
  allowed_fingerprints?: string[];
  // off and block are legacy values, read as warn and ask.
  claims_enforcement?: "off" | "warn" | "ask" | "block";
  memory_accept_by?: "member" | "admin" | "owner";
  memory_accept_via_mcp?: boolean;
  // A member's session in a repository no project has creates that project (on unless false).
  auto_link_projects?: boolean;
  push_allowed_modes?: Array<"hooks" | "rewake">;
  // The team's GitHub webhook: its URL id and the nonce its secret is derived from (the secret itself is never stored).
  github_hook?: { id: string; nonce: string };
  slack_channel?: string;
  // Handle of the member whose agent judges muted agent loops (and may reopen a thread once).
  loop_orchestrator?: string;
};

export const team = pgTable("team", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  settings: jsonb("settings").$type<TeamSettings>().notNull().default({}),
  killSwitchAt: timestamp("kill_switch_at"),
  killSwitchReason: text("kill_switch_reason"),
  killSwitchBy: text("kill_switch_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const membership = pgTable(
  "membership",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member", "guest"] }).notNull(),
    status: text("status", { enum: ["active", "revoked"] })
      .notNull()
      .default("active"),
    handle: text("handle").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    revokedAt: timestamp("revoked_at"),
    revokedBy: text("revoked_by"),
    // codetgh pause: the member's own agents stop sending; the person can still write from the console.
    agentsPausedAt: timestamp("agents_paused_at"),
    // The presence mod's latest Claude plan usage, per person: whole percents and reset times, nothing else.
    usageFiveHour: integer("usage_five_hour"),
    usageFiveHourReset: timestamp("usage_five_hour_reset"),
    usageSevenDay: integer("usage_seven_day"),
    usageSevenDayReset: timestamp("usage_seven_day_reset"),
  },
  (t) => [uniqueIndex("membership_team_user_uq").on(t.teamId, t.userId), uniqueIndex("membership_team_handle_uq").on(t.teamId, t.handle)],
);

export const invitation = pgTable(
  "invitation",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["owner", "admin", "member", "guest"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by"),
    expiresAt: timestamp("expires_at").notNull(),
    acceptedAt: timestamp("accepted_at"),
    acceptedUserId: text("accepted_user_id"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("invitation_email_idx").on(t.email)],
);

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    repoFingerprint: text("repo_fingerprint").notNull(),
    defaultBranch: text("default_branch"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("project_team_fingerprint_uq").on(t.teamId, t.repoFingerprint)],
);

// Remote Control launcher: the owner switches a project's server on or off; the launcher on the owner's machine
// reports what actually runs. The hub stores no path and no command: those live in the launcher's local config.
export const launchTarget = pgTable("launch_target", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => project.id, { onDelete: "cascade" }),
  teamId: text("team_id")
    .notNull()
    .references(() => team.id, { onDelete: "cascade" }),
  desired: boolean("desired").notNull().default(false),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  running: boolean("running").notNull().default(false),
  reportedAt: timestamp("reported_at"),
  reportedError: text("reported_error"),
});

// Runner: the owner switches a project's runner on or off; the runner on the owner's machine reports how many agents run.
// Same rule as the launcher: the hub stores no path and no command.
export const runTarget = pgTable("run_target", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => project.id, { onDelete: "cascade" }),
  teamId: text("team_id")
    .notNull()
    .references(() => team.id, { onDelete: "cascade" }),
  desired: boolean("desired").notNull().default(false),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  running: integer("running").notNull().default(0),
  reportedAt: timestamp("reported_at"),
  reportedError: text("reported_error"),
});

// Personal tokens are stored as SHA-256 hashes; the clear value is shown once. One token = one team.
export const personalToken = pgTable(
  "personal_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    kind: text("kind").notNull().default("claude-code"),
    hash: text("hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("personal_token_user_idx").on(t.userId)],
);

export const agent = pgTable(
  "agent",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenId: text("token_id"),
    sessionId: text("session_id").notNull(),
    kind: text("kind").notNull(),
    label: text("label").notNull(),
    branch: text("branch"),
    projectId: text("project_id"),
    trustLevel: text("trust_level", { enum: ["trusted", "quarantined"] })
      .notNull()
      .default("trusted"),
    statusText: text("status_text"),
    statusPaths: text("status_paths").array(),
    statusExpiresAt: timestamp("status_expires_at"),
    // When status_set last ran: every view shows the status with its age, past its expiry too.
    statusSetAt: timestamp("status_set_at"),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    endedAt: timestamp("ended_at"),
    // Removed from the console: hidden from every list until the same session starts again.
    removedAt: timestamp("removed_at"),
    // What the session reported at start: the plugin's push mode and the Claude Code version.
    pushMode: text("push_mode"),
    clientVersion: text("client_version"),
    // process.platform of the machine the session runs on.
    platform: text("platform"),
    // Claude Code's permission mode, kept current by the prompt hook.
    permissionMode: text("permission_mode"),
    // codetgh start --accept-requests-from: user ids whose requests this session does; null when it is not a delegate.
    acceptRequestsFrom: text("accept_requests_from").array(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("agent_session_uq").on(t.teamId, t.userId, t.sessionId), index("agent_team_seen_idx").on(t.teamId, t.lastSeenAt)],
);

export const thread = pgTable(
  "thread",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["team", "direct"] }).notNull(),
    projectId: text("project_id"),
    subject: text("subject"),
    createdByUser: text("created_by_user").notNull(),
    agentStreak: integer("agent_streak").notNull().default(0),
    // End-to-end encrypted: message bodies are ciphertext only clients can open (thread_key).
    encrypted: boolean("encrypted").notNull().default(false),
    mutedAt: timestamp("muted_at"),
    mutedReason: text("muted_reason"),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("thread_team_last_idx").on(t.teamId, t.lastMessageAt)],
);

export const message = pgTable(
  "message",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    fromUserId: text("from_user_id").notNull(),
    fromAgentId: text("from_agent_id"),
    authoredBy: text("authored_by", { enum: ["agent", "human"] }).notNull(),
    kind: text("kind").notNull(),
    priority: text("priority").notNull(),
    to: jsonb("to").$type<string[]>().notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    refs: jsonb("refs").$type<unknown[]>().notNull().default([]),
    replyTo: text("reply_to"),
    requiresAck: boolean("requires_ack").notNull().default(false),
    hop: integer("hop").notNull().default(0),
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    idempotencyKey: text("idempotency_key"),
    capsule: jsonb("capsule").$type<Record<string, unknown>>(),
    encrypted: boolean("encrypted").notNull().default(false),
    taskId: text("task_id"),
    // A request the hub addressed to a delegate session that accepts its sender: rendered authorized="true".
    delegated: boolean("delegated").notNull().default(false),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("message_thread_idx").on(t.threadId, t.createdAt),
    index("message_agent_idx").on(t.fromAgentId, t.createdAt),
    index("message_reply_idx").on(t.replyTo),
    uniqueIndex("message_idempotency_uq").on(t.fromAgentId, t.idempotencyKey),
  ],
);

// read_at is the agent's cursor: inbox_read never sets it, ack does.
export const receipt = pgTable(
  "receipt",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    teamId: text("team_id").notNull(),
    recipientUserId: text("recipient_user_id").notNull(),
    recipientAgentId: text("recipient_agent_id"),
    deliveredAt: timestamp("delivered_at"),
    readAt: timestamp("read_at"),
    ackStatus: text("ack_status"),
    ackNote: text("ack_note"),
  },
  (t) => [index("receipt_recipient_idx").on(t.recipientUserId, t.readAt, t.seq)],
);

export const alert = pgTable(
  "alert",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["instruction_like", "secret_blocked", "loop_guard", "loop_needs_human", "audit_tamper"] }).notNull(),
    status: text("status", { enum: ["open", "dismissed", "false_positive", "fingerprint_allowed"] })
      .notNull()
      .default("open"),
    messageId: text("message_id"),
    threadId: text("thread_id"),
    agentId: text("agent_id"),
    userId: text("user_id"),
    recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
    excerpt: text("excerpt").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    resolvedBy: text("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("alert_team_status_idx").on(t.teamId, t.status, t.createdAt)],
);

// Chained log of every write: hash = sha256(prev_hash + canonical JSON). Ids only, never message text.
export const auditEvent = pgTable(
  "audit_event",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    teamId: text("team_id").notNull(),
    actorType: text("actor_type", { enum: ["user", "agent", "hub"] }).notNull(),
    actorUserId: text("actor_user_id"),
    actorAgentId: text("actor_agent_id"),
    via: text("via", { enum: ["mcp", "rest", "console", "hook", "system"] }).notNull(),
    action: text("action").notNull(),
    subjectId: text("subject_id"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { precision: 3 }).notNull(),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
  },
  (t) => [index("audit_team_seq_idx").on(t.teamId, t.seq)],
);

// A claim announces work on a path, a glob, a task or a named resource. Advisory: hooks and tools read it.
export const claim = pgTable(
  "claim",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    holderUserId: text("holder_user_id").notNull(),
    holderAgentId: text("holder_agent_id").notNull(),
    scopeType: text("scope_type", { enum: ["path", "glob", "task", "resource"] }).notNull(),
    scope: text("scope").notNull(),
    mode: text("mode", { enum: ["exclusive", "intent", "shared"] }).notNull(),
    reason: text("reason"),
    ttlS: integer("ttl_s").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    releasedAt: timestamp("released_at"),
    releasedBy: text("released_by"),
    releaseReason: text("release_reason", { enum: ["released", "session_end", "revoked", "admin", "erased"] }),
    notifiedAgents: text("notified_agents").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("claim_active_project_idx").on(t.teamId, t.projectId, t.expiresAt).where(sql`${t.releasedAt} is null`),
    index("claim_holder_idx").on(t.holderAgentId).where(sql`${t.releasedAt} is null`),
    // Released and expired rows stay: claim_check and pre-edit read the last 30 minutes of them.
    index("claim_recent_idx").on(t.teamId, t.expiresAt),
  ],
);

// Work items. `version` guards every change: an update names the version it read.
export const task = pgTable(
  "task",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    projectId: text("project_id"),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    status: text("status", { enum: ["todo", "claimed", "in_progress", "blocked", "review", "done", "cancelled"] })
      .notNull()
      .default("todo"),
    assigneeUserId: text("assignee_user_id"),
    assigneeAgentId: text("assignee_agent_id"),
    dependsOn: text("depends_on").array().notNull().default(sql`'{}'::text[]`),
    paths: text("paths").array().notNull().default(sql`'{}'::text[]`),
    version: integer("version").notNull().default(1),
    notes: jsonb("notes").$type<Array<{ at: string; user_id: string; agent_id: string | null; text: string }>>().notNull().default([]),
    createdByUser: text("created_by_user").notNull(),
    createdByAgent: text("created_by_agent"),
    // Runner queue: only a member or the owner sets `runner`; the lease is held by one runner at a time.
    runner: boolean("runner").notNull().default(false),
    branch: text("branch"),
    baseBranch: text("base_branch"),
    prNumber: integer("pr_number"),
    reviewRound: integer("review_round").notNull().default(0),
    // The runner's reviewer approved the PR as it is now; a restack that changes the code clears it.
    approved: boolean("approved").notNull().default(false),
    // When the last GitHub event about its PR happened, as GitHub dates it: an event not newer is ignored.
    prEventAt: timestamp("pr_event_at"),
    // The git tag whose creation on GitHub finishes the task, and why a blocked task is blocked (a teammate's words, or a hub code).
    verifyTag: text("verify_tag"),
    // Who set the tag: when it arrives, the task is finished only if they could still update the task.
    verifySetBy: text("verify_set_by"),
    blockedReason: text("blocked_reason"),
    attempts: integer("attempts").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("task_team_status_idx").on(t.teamId, t.status, t.updatedAt)],
);

// Team memory: decisions, contracts, conventions, notes. Agents propose; only humans accept. Every version is kept.
export const memoryItem = pgTable(
  "memory_item",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    version: integer("version").notNull().default(1),
    kind: text("kind", { enum: ["decision", "contract", "convention", "note"] }).notNull(),
    status: text("status", { enum: ["proposed", "accepted", "superseded", "rejected"] })
      .notNull()
      .default("proposed"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    refs: jsonb("refs").$type<unknown[]>().notNull().default([]),
    branch: text("branch"),
    supersedesId: text("supersedes_id"),
    pinned: boolean("pinned").notNull().default(false),
    proposedByUser: text("proposed_by_user").notNull(),
    proposedByAgent: text("proposed_by_agent"),
    authoredBy: text("authored_by", { enum: ["agent", "human"] }).notNull(),
    decidedByUser: text("decided_by_user"),
    decidedVia: text("decided_via", { enum: ["console", "mcp"] }),
    decidedAt: timestamp("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("memory_number_version_uq").on(t.teamId, t.number, t.version),
    index("memory_team_status_idx").on(t.teamId, t.status),
  ],
);

// Signed heads of the audit chain. The signing key is outside the database, so whoever can write here
// still cannot recompute the chain or cut its end without breaking a signature.
export const auditCheckpoint = pgTable(
  "audit_checkpoint",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: text("team_id").notNull(),
    seq: integer("seq").notNull(),
    hash: text("hash").notNull(),
    prevCheckpointSeq: integer("prev_checkpoint_seq"),
    at: timestamp("at", { precision: 3 }).notNull(),
    keyId: text("key_id").notNull(),
    sig: text("sig").notNull(),
  },
  (t) => [index("audit_checkpoint_team_idx").on(t.teamId, t.seq)],
);

// A2A tasks: one per question an external agent sent; the A2A Task object as the SDK last saved it.
export const a2aTask = pgTable(
  "a2a_task",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    messageId: text("message_id"),
    task: jsonb("task").$type<Task>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("a2a_task_agent_idx").on(t.agentId)],
);

// A member's X25519 public key for end-to-end encrypted threads; the private key never leaves their machine.
export const memberKey = pgTable(
  "member_key",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

// The thread key, wrapped for one participant's public key.
export const threadKey = pgTable(
  "thread_key",
  {
    threadId: text("thread_id")
      .notNull()
      .references(() => thread.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    wrapped: text("wrapped").notNull(),
  },
  (t) => [primaryKey({ columns: [t.threadId, t.userId] })],
);

// A Slack message the hub posted, and what it stands for: a reply in its Slack thread answers that message.
export const bridgeLink = pgTable(
  "bridge_link",
  {
    slackChannel: text("slack_channel").notNull(),
    slackTs: text("slack_ts").notNull(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    messageId: text("message_id"),
    alertId: text("alert_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.slackChannel, t.slackTs] }), index("bridge_link_alert_idx").on(t.alertId)],
);

// A member's Slack account, bound with a one-time code they typed in Slack (/codetgh-link).
export const slackLink = pgTable(
  "slack_link",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slackUserId: text("slack_user_id"),
    codeHash: text("code_hash"),
    codeExpiresAt: timestamp("code_expires_at"),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] }), uniqueIndex("slack_link_slack_user_uq").on(t.teamId, t.slackUserId)],
);
