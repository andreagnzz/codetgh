import { z } from "zod";

export const ERROR_CODES = [
  "E_UNAUTHORIZED",
  "E_FORBIDDEN",
  "E_INVALID",
  "E_NOT_FOUND",
  "E_TOO_LARGE",
  "E_SECRET_BLOCKED",
  "E_RATE_LIMITED",
  "E_LOOP_GUARD",
  "E_KILL_SWITCH",
  "E_CLAIM_CONFLICT",
  "E_VERSION_CONFLICT",
  "E_NO_DELEGATE",
  "E_DELEGATE_BUSY",
  "E_DELEGATE_CHAIN",
  "E_UNREACHABLE",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ROLES = ["owner", "admin", "member", "guest"] as const;
export type Role = (typeof ROLES)[number];

export const MESSAGE_KINDS = ["note", "question", "answer", "request", "status", "alert", "handoff"] as const;
// A handoff only goes through the handoff tool, which validates the capsule.
export const SEND_KINDS = ["note", "question", "answer", "request", "status", "alert"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const PRIORITIES = ["low", "normal", "high", "blocking"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ACK_STATUSES = ["accepted", "declined", "done"] as const;

const agentId = z.string().regex(/^agt_[0-9A-Z]{26}$/);
const messageId = z.string().regex(/^msg_[0-9A-Z]{26}$/);
const address = z.string().min(1).max(100);
// Hard caps against abuse; the domain answers E_TOO_LARGE on the documented limits (8 KB, 20 refs).
const body = z.string().max(65536);
const ref = z.object({
  type: z.enum(["file", "commit", "url", "message"]),
  path: z.string().max(500).optional(),
  rev: z.string().max(100).optional(),
});

export const WhoamiInput = z.object({ agent: agentId.optional() });

const handle = z.string().regex(/^@[a-z0-9-]{1,40}$/);
// A project id, "current" (the project of the caller's session) or "all".
const projectFilter = z.union([z.enum(["current", "all"]), z.string().regex(/^prj_[0-9A-Z]{26}$/)]);

export const TeamOverviewInput = z.object({
  agent: agentId.optional(),
  scope: z.enum(["project", "team"]).default("team"),
  // Live sessions listed, at most.
  limit: z.number().int().min(1).max(50).default(20),
  // false: also the people with no live session, once each, with when they were last seen.
  online_only: z.boolean().default(true),
  handle: handle.optional(),
  project: projectFilter.optional(),
  // People and their live sessions only: no usage, no claims.
  compact: z.boolean().default(false),
});

export const StatusSetInput = z.object({
  agent: agentId.optional(),
  text: z.string().min(1).max(200),
  paths: z.array(z.string().max(300)).max(20).default([]),
  ttl_s: z.number().int().min(60).max(86400).default(3600),
});

export const SendMessageInput = z
  .object({
    agent: agentId.optional(),
    to: z.union([address, z.array(address).min(1).max(10)]).optional(),
    kind: z.enum(SEND_KINDS),
    subject: z.string().max(1000).optional(),
    body,
    priority: z.enum(PRIORITIES).default("normal"),
    refs: z.array(ref).max(100).default([]),
    reply_to: messageId.optional(),
    requires_ack: z.boolean().optional(),
    idempotency_key: z.string().max(64).optional(),
    // A message to people or sessions must reach a live session of theirs (E_UNREACHABLE); true leaves it in their console inbox.
    allow_offline: z.boolean().optional(),
    // Only the team's loop orchestrator, replying in a thread the loop guard muted.
    loop_verdict: z.object({ reopen: z.boolean() }).optional(),
    // End-to-end encrypted: body is ciphertext from the client, which also scanned and flagged the plain text.
    // keys: the new thread's key wrapped for every participant, sender included; omitted on replies.
    encrypted: z
      .object({
        keys: z
          .array(z.object({ handle: z.string().regex(/^@[a-z0-9-]{1,40}$/), wrapped: z.string().max(400) }))
          .max(11)
          .optional(),
        flags: z
          .array(z.enum(["instruction-like", "secret-suspect", "external-link"]))
          .max(3)
          .default([]),
      })
      .optional(),
  })
  .refine((m) => !m.encrypted || !m.subject, { message: "an encrypted message has no subject: put it in the body", path: ["subject"] })
  .refine((m) => m.kind !== "answer" || m.reply_to, { message: "an answer needs reply_to", path: ["reply_to"] })
  .refine((m) => m.to || m.reply_to, { message: "to or reply_to is required", path: ["to"] });
export type SendMessage = z.infer<typeof SendMessageInput>;

export const InboxReadInput = z.object({
  agent: agentId.optional(),
  thread: z
    .string()
    .regex(/^thr_[0-9A-Z]{26}$/)
    .optional(),
  page_token: z.string().max(40).optional(),
  kinds: z.array(z.enum(MESSAGE_KINDS)).optional(),
  limit: z.number().int().min(1).max(20).default(20),
});

export const AckInput = z
  .object({
    agent: agentId.optional(),
    message_ids: z.array(messageId).min(1).max(100).optional(),
    up_to: messageId.optional(),
    status: z.enum(ACK_STATUSES).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((a) => a.message_ids || a.up_to, { message: "message_ids or up_to is required" });

export const AskPeerInput = z.object({
  agent: agentId.optional(),
  to: address,
  question: body,
  refs: z.array(ref).max(100).default([]),
  // request: a task for the teammate's delegate session (codetgh start --accept-requests-from), sent without waiting.
  kind: z.enum(["question", "request"]).default("question"),
  // 45 s for a question, 0 for a request.
  wait_s: z.number().int().min(0).max(60).optional(),
  // blocking: you cannot go on without the answer; the teammate's agent is told to answer at its next stopping point.
  priority: z.enum(["normal", "blocking"]).default("normal"),
  allow_offline: z.boolean().optional(),
});

export const MessageStatusInput = z.object({ agent: agentId.optional(), message_id: messageId });

export const PUSH_MODES = ["hooks", "rewake", "channel"] as const;
// Claude Code's permission mode as hooks report it (default, acceptEdits, bypassPermissions…): letters only, so a mode
// added later still registers.
export const PermissionMode = z.string().regex(/^[A-Za-z]{1,40}$/);

// What the hooks report of a turn: a state (UserPromptSubmit, Stop) and the name of the tool just used (PostToolUse), never its input.
// The hub reduces the name to a closed vocabulary before it stores it.
export const ACTIVITY_REPORTS = ["in_turn", "idle"] as const;
export const ToolName = z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/);

export const AgentSessionInput = z.object({
  session_id: z.string().min(1).max(200),
  source: z.string().max(40).optional(),
  kind: z.enum(["claude-code", "claude-ai", "agent-sdk", "other"]).default("claude-code"),
  label: z.string().max(60).optional(),
  branch: z.string().max(200).optional(),
  push_mode: z.enum(PUSH_MODES).optional(),
  permission_mode: PermissionMode.optional(),
  client_version: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  // process.platform: win32, darwin, linux, or another Node platform name.
  platform: z
    .string()
    .regex(/^[a-z0-9]{1,20}$/)
    .optional(),
  repo_fingerprint: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  repo_name: z.string().max(100).optional(),
  // codetgh start --accept-requests-from: the teammates whose requests this session does.
  accept_requests_from: z
    .array(z.string().regex(/^@[a-z0-9-]{1,40}$/))
    .max(20)
    .optional(),
});

export const CLAIM_MODES = ["exclusive", "intent", "shared"] as const;
export type ClaimMode = (typeof CLAIM_MODES)[number];
export const CLAIM_ENFORCEMENT = ["warn", "ask"] as const;

// Repository-relative, forward slashes, no way out of the repository.
export const repoPath = z
  .string()
  .min(1)
  .max(300)
  .refine((s) => !s.startsWith("/") && !s.includes("\\") && !s.split("/").includes(".."), {
    message: "use a path relative to the repository root",
  });

// Paths and globs a peer writes for others to read (claims, task paths): path characters only, so they can never
// carry a sentence or markup into another session.
// No ( ) or |: picomatch runs extglobs in exponential time. Revisit globTooComplex (apps/hub/src/domain/claims.ts) before adding them.
const PATH_CHARS = /^[\p{L}\p{N}._\-/*?[\]{},!@+~#%=]+$/u;
const PATH_CHARS_HELP = "letters, digits and . _ - / * ? [ ] { } , ! @ + ~ # % =, no spaces";
const peerPath = repoPath.refine((s) => PATH_CHARS.test(s), { message: `a path or glob: ${PATH_CHARS_HELP}` });

// A scope is a path, a glob, task:<id> or resource:<name>.
const claimScope = repoPath.refine((s) => /^task:tsk_[0-9A-Z]{26}$/.test(s) || /^resource:[\w.-]{1,60}$/.test(s) || PATH_CHARS.test(s), {
  message: `a claim scope is a path or glob (${PATH_CHARS_HELP}), task:<id> or resource:<name>`,
});

export const ClaimInput = z.object({
  agent: agentId.optional(),
  scope: z.array(claimScope).min(1).max(20),
  mode: z.enum(["exclusive", "shared"]).default("exclusive"),
  ttl_s: z.number().int().min(60).max(14400).default(1800),
  reason: z.string().max(200).optional(),
});

export const ClaimCheckInput = z.object({ agent: agentId.optional(), paths: z.array(repoPath).min(1).max(200) });

export const ClaimReleaseInput = z
  .object({
    agent: agentId.optional(),
    claim_ids: z
      .array(z.string().regex(/^clm_[0-9A-Z]{26}$/))
      .min(1)
      .max(100)
      .optional(),
    all_mine: z.boolean().optional(),
  })
  .refine((r) => r.claim_ids || r.all_mine, { message: "claim_ids or all_mine is required" });

export const PreEditInput = z.object({ session_id: z.string().min(1).max(200), path: repoPath });
// A session, or a repository by its fingerprint (the pre-push hook has no session).
export const ClaimsCheckRestInput = z
  .object({
    session_id: z.string().min(1).max(200).optional(),
    repo_fingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    paths: z.array(repoPath).max(200),
  })
  .refine((i) => i.session_id || i.repo_fingerprint, { message: "session_id or repo_fingerprint is required" });

export const TASK_STATUSES = ["todo", "claimed", "in_progress", "blocked", "review", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const taskId = z.string().regex(/^tsk_[0-9A-Z]{26}$/);

export const TaskListInput = z.object({
  agent: agentId.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assignee: z.union([z.literal("me"), handle]).optional(),
  include_archived: z.boolean().optional(),
  // Tasks without a project (created in the console) are listed with every project.
  project: projectFilter.default("current"),
  limit: z.number().int().min(1).max(50).default(20),
});

export const TaskGetInput = z.object({ agent: agentId.optional(), task_id: taskId });

// The tag that finishes a task when it is created on GitHub: a git tag name, in the characters a tag is written with.
const tagName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._/+-]+$/, "a tag name: letters, digits and . _ / + -")
  .refine(
    (t) => !t.includes("..") && !t.includes("//") && !/^[-/]|[/.]$|\.lock$|\/\./.test(t) && !t.startsWith("."),
    "not a git tag name: no .., no leading - or /, no trailing / or ., no .lock, no component starting with .",
  );
const taskVerify = z.union([z.object({ tag: tagName }), z.literal("none")]);

export const TaskCreateInput = z.object({
  agent: agentId.optional(),
  title: z.string().min(1).max(200),
  body: z.string().max(8000).default(""),
  paths: z.array(peerPath).max(50).default([]),
  depends_on: z.array(taskId).max(20).default([]),
  assignee: handle.optional(),
  verify: taskVerify.optional(),
  // For the owner's runner (codetgh runner); only an owner or an admin sets it.
  runner: z.boolean().default(false),
});

export const TaskClaimInput = z.object({ agent: agentId.optional(), task_id: taskId, expected_version: z.number().int().min(1) });

export const TaskUpdateInput = z.object({
  agent: agentId.optional(),
  task_id: taskId,
  expected_version: z.number().int().min(1),
  patch: z
    .object({
      status: z.enum(TASK_STATUSES).optional(),
      assignee: z.union([handle, z.literal("none")]).optional(),
      note: z.string().min(1).max(500).optional(),
      verify: taskVerify.optional(),
      // Required with status blocked.
      reason: z.string().min(1).max(200).optional(),
      // With assignee @me on a teammate's task; required when they have a live session.
      takeover_note: z.string().min(1).max(500).optional(),
      // An owner or an admin moves a task past dependencies that are not done.
      override_deps: z.boolean().optional(),
    })
    .refine((p) => p.status || p.assignee || p.note || p.verify, { message: "patch needs status, assignee, note or verify" }),
});

export const MEMORY_KINDS = ["decision", "contract", "convention", "note"] as const;
const memoryId = z.string().regex(/^mit_[0-9A-Z]{26}$/);

export const MemoryProposeInput = z.object({
  agent: agentId.optional(),
  kind: z.enum(MEMORY_KINDS),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(8000),
  refs: z.array(ref).max(20).default([]),
  supersedes: memoryId.optional(),
});

export const MemorySearchInput = z.object({
  agent: agentId.optional(),
  query: z.string().max(200).default(""),
  kinds: z.array(z.enum(MEMORY_KINDS)).optional(),
  include_proposed: z.boolean().default(false),
  limit: z.number().int().min(1).max(20).default(10),
});

export const MemoryAcceptInput = z.object({
  agent: agentId.optional(),
  item_id: memoryId,
  decision: z.enum(["accept", "reject"]),
  note: z.string().max(500).optional(),
});

const line = z.string().min(1).max(200);
export const HandoffInput = z.object({
  agent: agentId.optional(),
  to: handle,
  task_id: taskId.optional(),
  summary: z.string().min(1).max(1200),
  done: z.array(line).max(20).default([]),
  todo: z.array(line).max(20).default([]),
  files_touched: z
    .array(z.object({ path: repoPath, change: z.enum(["added", "modified", "deleted"]), note: z.string().max(200).optional() }))
    .max(50)
    .default([]),
  decisions: z.array(memoryId).max(20).default([]),
  open_questions: z
    .array(z.object({ text: z.string().min(1).max(300), to: handle.optional() }))
    .max(10)
    .default([]),
  commands: z.array(line).max(10).default([]),
  warnings: z.array(line).max(10).default([]),
  branch: z.string().max(200).optional(),
  last_commit: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .optional(),
});
export type Handoff = z.infer<typeof HandoffInput>;

export const WhoamiSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string() }),
  auth: z.enum(["personal_token", "oauth"]),
  team: z.object({ id: z.string(), name: z.string() }),
  role: z.enum(ROLES),
  handle: z.string(),
  agent: z.object({ id: z.string(), label: z.string(), permission_mode: z.string().nullable() }).nullable(),
  paused: z.boolean(),
  push_allowed_modes: z.array(z.enum(PUSH_MODES)),
});
export type Whoami = z.infer<typeof WhoamiSchema>;

// agt_01M5…ABCD: the ends of an agent id, to match a startup line with team_overview.
export const shortAgentId = (id: string) => `${id.slice(0, 8)}…${id.slice(-4)}`;
