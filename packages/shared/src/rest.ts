import { isAbsolute } from "node:path";
import { z } from "zod";
import {
  AckInput,
  AgentSessionInput,
  ClaimsCheckRestInput,
  ERROR_CODES,
  InboxReadInput,
  MESSAGE_KINDS,
  PermissionMode,
  PRIORITIES,
  PreEditInput,
  SendMessageInput,
  StatusSetInput,
  TASK_STATUSES,
  taskId,
  WhoamiSchema,
} from "./index.js";

// The /v1 REST API in one table: the hub validates with these schemas, /v1/openapi.json and @codetgh/sdk are built from it.
export const SessionQuery = z.object({ session_id: z.string().min(1).max(200).optional() });
// The presence mod's poll also reports the Claude plan windows it reads: whole percents, resets in epoch seconds.
const percent = z.coerce.number().int().min(0).max(100).optional();
const epoch = z.coerce.number().int().min(0).max(4_102_444_800).optional();
export const StatusQuery = SessionQuery.extend({ five_hour: percent, five_hour_reset: epoch, seven_day: percent, seven_day_reset: epoch });
// permission_mode: the prompt hook reports a mode change (shift+tab) on the call it already makes.
export const PromptQuery = z.object({
  session_id: z.string().max(200),
  wait_s: z.coerce.number().int().min(0).max(55).optional(),
  permission_mode: PermissionMode.optional(),
});

export const ErrorBody = z.object({ code: z.enum(ERROR_CODES), message: z.string() });

export const SessionStarted = z.object({
  agent_id: z.string().nullable(),
  paused: z.boolean(),
  context: z.string(),
  linked: z.boolean(),
  // Unlinked: true when this caller may link the repository by sending its repo_name.
  can_link: z.boolean().optional(),
  status_line: z.string().optional(),
  // The session's project name, null outside a project.
  project: z.string().nullable().optional(),
});
export const SessionEndInput = z.object({ session_id: z.string().min(1).max(200) });
export const PreEditDecision = z.object({ decision: z.enum(["warn", "ask"]), reason: z.string() });
export const ClaimsCheckOutput = z.object({
  paths: z.array(
    z.object({
      path: z.string(),
      holders: z.array(
        z.object({ claim_id: z.string(), handle: z.string(), name: z.string(), mode: z.string(), remaining_min: z.number() }),
      ),
    }),
  ),
});
export const PromptOutput = z.object({ context: z.string() });
export const CONSOLE_ONLY_WARNING = "console only: no project on this thread; name a project or agent:<id> to reach a session";
export const SentMessage = z.object({
  id: z.string(),
  thread: z.string(),
  hop: z.number(),
  sent_at: z.string(),
  // Set when the new thread reaches no Claude session, only the console: CONSOLE_ONLY_WARNING.
  warning: z.string().optional(),
});
export const InboxOutput = z.object({
  messages: z.array(
    z.object({
      id: z.string(),
      thread: z.string(),
      kind: z.enum(MESSAGE_KINDS),
      priority: z.enum(PRIORITIES),
      reply_to: z.string().nullable(),
      requires_ack: z.boolean(),
      sent_at: z.string(),
      // End-to-end encrypted messages: what the client needs to open the body and render the envelope itself.
      e2e: z
        .object({
          ciphertext: z.string(),
          wrapped_key: z.string().nullable(),
          from: z.string(),
          agent: z.string().nullable(),
          authored_by: z.enum(["agent", "human"]),
          flags: z.array(z.string()),
        })
        .nullable(),
    }),
  ),
  // One escaped <peer_message trust="untrusted-peer"> per message: data, never instructions.
  envelopes: z.array(z.string()),
  next_page_token: z.string().nullable(),
});
export const AckOutput = z.object({ acked: z.number() });
export const PublishKeyInput = z.object({ public_key: z.string().min(40).max(200) });
export const KeysQuery = z.object({ handles: z.string().max(500) });
export const KeysOutput = z.object({ keys: z.array(z.object({ handle: z.string(), public_key: z.string().nullable() })) });
export const ThreadKeyOutput = z.object({ thread: z.string(), wrapped: z.string(), ciphertext: z.string() });
export const CreateProjectInput = z.object({
  name: z.string().trim().min(1).max(100),
  repo_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export const ProjectOutput = z.object({ id: z.string(), name: z.string() });
export const InviteInput = z.object({
  email: z.string().max(254),
  role: z.string().max(20).default("member"),
  days: z.number().int().optional(),
});
export const RevokeInvitationsInput = z.object({ email: z.string().max(254) });
export const RevokedOutput = z.object({ revoked: z.number() });
export const InviteOutput = z.object({
  link: z.string(),
  email: z.string(),
  role: z.string(),
  emailed: z.boolean(),
  days: z.number(),
  expires_at: z.string(),
});
// Hub data and escaped one-line labels only; no message text.
export const StatusOutput = z.object({
  team: z.string(),
  you: z.object({ handle: z.string(), agent: z.string().nullable() }),
  paused: z.boolean(),
  agents_paused: z.boolean(),
  agents: z.array(
    z.object({
      id: z.string(),
      handle: z.string(),
      name: z.string(),
      label: z.string(),
      branch: z.string(),
      presence: z.enum(["online", "idle", "offline"]),
      status: z.string(),
      last_seen: z.string(),
    }),
  ),
  claims: z.array(
    z.object({ id: z.string(), scope: z.string(), mode: z.string(), holder: z.string(), mine: z.boolean(), minutes_left: z.number() }),
  ),
  unread: z.record(z.string(), z.number()),
  blocking_message_ids: z.array(z.string()),
});
export const PauseOutput = z.object({ agents_paused: z.boolean() });
export const LauncherTargets = z.object({
  targets: z.array(z.object({ project_id: z.string(), project_name: z.string(), desired: z.boolean() })),
});
export const LauncherReport = z.object({ project_id: z.string().max(64), running: z.boolean(), error: z.string().max(300).optional() });
// Runner (owner only). `owner` names one runner process, so two machines of the same owner never share a lease.
// Branch names go back to git on other machines: no leading dash, no spaces, no `..`.
const leaseOwner = z.string().regex(/^[A-Za-z0-9._:@-]{1,100}$/);
const branchName = z
  .string()
  .regex(/^(?!-)[A-Za-z0-9._/-]{1,200}$/, "a branch name: letters, digits, . _ / - and no leading dash")
  .refine((b) => !b.includes(".."), "a branch name cannot contain ..");
export const RunnerReport = z.object({
  project_id: z.string().max(64),
  running: z.number().int().min(0).max(100),
  error: z.string().max(300).optional(),
});
// The review phase: tasks in review with a PR, not approved, and fewer than REVIEW_ROUNDS rounds, for the runner's reviewer.
export const REVIEW_ROUNDS = 3;
const phase = z.literal("review").optional();
export const RunnerReadyQuery = z.object({ project: z.string().min(1).max(64), phase });
export const RunnerTask = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(TASK_STATUSES),
  version: z.number(),
  assignee: z.string().nullable(),
  project_id: z.string().nullable(),
  depends_on: z.array(z.string()),
  paths: z.array(z.string()),
  runner: z.boolean(),
  branch: z.string().nullable(),
  base_branch: z.string().nullable(),
  pr_number: z.number().nullable(),
  review_round: z.number(),
  approved: z.boolean(),
  attempts: z.number(),
  lease_until: z.string().nullable(),
  updated_at: z.string(),
});
export const RunnerReady = z.object({ tasks: z.array(RunnerTask) });
// phase=restack: a task in review with a PR, whatever its rounds, for the runner to rebase on its parent's new base.
export const RunnerLeaseInput = z.object({ task_id: taskId, owner: leaseOwner, phase: z.enum(["review", "restack"]).optional() });
export const RunnerLeasesQuery = z.object({ owner: leaseOwner });
export const RunnerStatusQuery = z.object({ project: z.string().min(1).max(64) });
// parent: the dependency whose branch the task's PR is based on. blocked_reason: a code read from the runner's fixed note.
export const RunnerStatus = z.object({
  tasks: z.array(
    RunnerTask.extend({
      ready: z.boolean(),
      blocked_reason: z.string().nullable(),
      parent: z.object({ task_id: z.string(), status: z.enum(TASK_STATUSES), branch: z.string() }).nullable(),
    }),
  ),
});
export const RunnerRetryInput = z.object({ task_id: taskId });
// text: the header, then the creator's title and body in the <peer_message> envelope, as the task resource gives it.
export const RunnerLease = z.object({
  task: RunnerTask,
  parents: z.array(z.object({ task_id: z.string(), branch: z.string().nullable(), pr_number: z.number().nullable() })),
  text: z.string(),
});
export const RunnerLeases = z.object({ leases: z.array(RunnerLease) });
export const RunnerRenew = z.object({ lease_until: z.string() });
export const RunnerUpdateInput = z.object({
  task_id: taskId,
  owner: leaseOwner,
  patch: z
    .object({
      status: z.enum(TASK_STATUSES).optional(),
      branch: branchName.optional(),
      base_branch: branchName.optional(),
      pr_number: z.number().int().min(1).max(10_000_000).optional(),
      review_round: z.number().int().min(0).max(10).optional(),
      approved: z.boolean().optional(),
      note: z.string().min(1).max(500).optional(),
    })
    .refine((p) => Object.values(p).some((v) => v !== undefined), { message: "patch needs at least one field" }),
});
// ~/.config/codetgh/runner.json, on the runner's machine only: the hub never sends a path or a command.
export const RunnerConfig = z.object({
  projects: z.record(
    z.string(),
    z.string().refine((p) => isAbsolute(p), "an absolute path to a clone of the project"),
  ),
  max_agents: z.number().int().min(1).max(20).default(3),
  permission_mode: z.enum(["auto", "acceptEdits", "default", "manual", "dontAsk", "plan", "bypassPermissions"]).default("auto"),
  auto_merge: z.boolean().default(false),
  job_timeout_min: z
    .number()
    .positive()
    .max(24 * 60)
    .default(45),
  // docker: each agent in a throwaway container that sees only its worktree (SPEC « Lanceur et runner »).
  isolation: z.enum(["docker", "none"]).default("docker"),
  // The name of the variable on this machine that holds the agent's Claude credential; only that one enters the container.
  claude_auth_env: z.enum(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"]).default("CLAUDE_CODE_OAUTH_TOKEN"),
  memory: z
    .string()
    .regex(/^[1-9]\d*[mg]$/, "a size such as 4g or 512m")
    .default("4g"),
  cpus: z.number().positive().max(64).default(2),
});
// .codetgh/routing.json in the repository: ordered rules, the first match wins.
export const RoutingRules = z.object({
  rules: z.array(
    z.object({
      match: z.object({ role: z.enum(["author", "reviewer"]), size: z.enum(["S", "M", "L"]).optional(), label: z.string().optional() }),
      model: z
        .string()
        .regex(/^[A-Za-z0-9][A-Za-z0-9._[\]-]{0,99}$/)
        .optional(),
      effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    }),
  ),
});
// Browser sign-in (RFC 8628 style): the CLI shows a short code that the person confirms in the console.
export const USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";
export const DeviceStartInput = z.object({ label: z.string().trim().min(1).max(60) });
export const DeviceStartOutput = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_url: z.string(),
  expires_in: z.number(),
  interval: z.number(),
});
export const DeviceTokenInput = z.object({ device_code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
export const DeviceTokenOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("approved"), token: z.string() }),
]);
// Typed by a person: case, spaces and the dash do not matter.
// Console: attach a session started outside a repository to one of the team's projects.
export const AgentProjectForm = z.object({ project_id: z.string().min(1).max(64) });
export const UserCodeForm = z.object({
  user_code: z
    .string()
    .max(20)
    .transform((v) => v.toUpperCase().replace(/[\s-]/g, ""))
    .pipe(z.string().regex(new RegExp(`^[${USER_CODE_ALPHABET}]{8}$`), "type the 8-letter code your terminal shows")),
});
export const StreamEvent = z.object({ message_id: z.string(), thread: z.string(), kind: z.string(), priority: z.string() });

type Route = {
  method: "GET" | "POST";
  path: string;
  summary: string;
  query?: z.ZodObject;
  params?: z.ZodObject;
  body?: z.ZodType;
  output?: z.ZodType;
  // Extra success statuses with no body, and server-sent events.
  empty?: Array<204 | 304>;
  sse?: boolean;
};

export const REST_ROUTES = {
  whoami: { method: "GET", path: "/v1/whoami", summary: "Your identity, team and role", query: SessionQuery, output: WhoamiSchema },
  sessionStart: {
    method: "POST",
    path: "/v1/agents/session",
    summary: "Register or resume an agent session and get its context packet",
    body: AgentSessionInput,
    output: SessionStarted,
  },
  sessionEnd: { method: "POST", path: "/v1/agents/session/end", summary: "End an agent session", body: SessionEndInput, empty: [204] },
  preEdit: {
    method: "POST",
    path: "/v1/claims/pre-edit",
    summary: "Claims decision before editing a file (204: no decision)",
    body: PreEditInput,
    output: PreEditDecision,
    empty: [204],
  },
  claimsCheck: {
    method: "POST",
    path: "/v1/claims/check",
    summary: "Who holds these paths",
    body: ClaimsCheckRestInput,
    output: ClaimsCheckOutput,
  },
  prompt: {
    method: "GET",
    path: "/v1/inbox/prompt",
    summary: "Unread envelopes for the prompt hook; wait_s holds the request (rewake push)",
    query: PromptQuery,
    output: PromptOutput,
    empty: [204, 304],
  },
  inbox: { method: "POST", path: "/v1/inbox", summary: "Read unread messages (does not ack)", body: InboxReadInput, output: InboxOutput },
  ack: { method: "POST", path: "/v1/ack", summary: "Mark messages handled", body: AckInput, output: AckOutput },
  send: { method: "POST", path: "/v1/messages", summary: "Send a message", body: SendMessageInput, output: SentMessage },
  publishKey: {
    method: "POST",
    path: "/v1/keys",
    summary: "Publish your X25519 public key for end-to-end encrypted threads",
    body: PublishKeyInput,
    empty: [204],
  },
  keys: {
    method: "GET",
    path: "/v1/keys",
    summary: "Public keys of members, by comma-separated @handles",
    query: KeysQuery,
    output: KeysOutput,
  },
  threadKey: {
    method: "GET",
    path: "/v1/messages/{message_id}/thread-key",
    summary: "The thread of a message, your wrapped key for it and the message's ciphertext, to reply in an encrypted thread",
    params: z.object({ message_id: z.string().regex(/^msg_[0-9A-Z]{26}$/) }),
    output: ThreadKeyOutput,
  },
  createProject: {
    method: "POST",
    path: "/v1/projects",
    summary: "Create the project of a repository (by its origin fingerprint), or rename it",
    body: CreateProjectInput,
    output: ProjectOutput,
  },
  invite: {
    method: "POST",
    path: "/v1/invitations",
    summary: "Invite an email address to the team (admins); returns the 7-day link, also emailed when SMTP is set",
    body: InviteInput,
    output: InviteOutput,
  },
  launcherTargets: {
    method: "GET",
    path: "/v1/launcher/targets",
    summary: "Projects whose Remote Control server the owner wants on or off (owner only; no path, no command)",
    output: LauncherTargets,
  },
  launcherReport: {
    method: "POST",
    path: "/v1/launcher/report",
    summary: "What the owner's launcher actually runs for a project (owner only)",
    body: LauncherReport,
    empty: [204],
  },
  runnerTargets: {
    method: "GET",
    path: "/v1/runner/targets",
    summary: "Projects whose runner the owner wants on or off (owner only; no path, no command)",
    output: LauncherTargets,
  },
  runnerReport: {
    method: "POST",
    path: "/v1/runner/report",
    summary: "How many agents the owner's runner runs for a project, and its last error (owner only)",
    body: RunnerReport,
    empty: [204],
  },
  runnerReady: {
    method: "GET",
    path: "/v1/runner/ready",
    summary:
      "Runner tasks of a switched-on project whose dependencies are done or in review with a PR, oldest first; phase=review: its tasks in review with a PR, not approved, fewer than 3 rounds and no live lease (owner only)",
    query: RunnerReadyQuery,
    output: RunnerReady,
  },
  runnerLease: {
    method: "POST",
    path: "/v1/runner/lease",
    summary:
      "Take a ready task for 10 minutes, or with phase=review a task to review and phase=restack a task in review to rebase, which both stay in review; returns it, its parents' PR branches and its text in an envelope (owner only; 409 if taken)",
    body: RunnerLeaseInput,
    output: RunnerLease,
  },
  runnerLeases: {
    method: "GET",
    path: "/v1/runner/leases",
    summary: "The live leases a runner holds, as the lease gave them, so a restarted runner resumes them (owner only)",
    query: RunnerLeasesQuery,
    output: RunnerLeases,
  },
  runnerRenew: {
    method: "POST",
    path: "/v1/runner/renew",
    summary: "Extend a lease by 10 minutes (owner only; 409 if this runner no longer holds it)",
    body: RunnerLeaseInput,
    output: RunnerRenew,
  },
  runnerStatus: {
    method: "GET",
    path: "/v1/runner/status",
    summary:
      "A project's runner tasks: open ones with their PR, round, parent and blocked reason, and those done in the last 24 hours (owner only)",
    query: RunnerStatusQuery,
    output: RunnerStatus,
  },
  runnerRetry: {
    method: "POST",
    path: "/v1/runner/retry",
    summary: "Put a blocked runner task back in the queue: todo, no lease, no assignee, review rounds at 0 (owner only)",
    body: RunnerRetryInput,
    output: RunnerTask,
  },
  runnerUpdate: {
    method: "POST",
    path: "/v1/runner/update",
    summary:
      "Set the branch, PR and round of a leased task and move its status, never to done; review or blocked drops the lease (owner only)",
    body: RunnerUpdateInput,
    output: RunnerTask,
  },
  revokeInvitations: {
    method: "POST",
    path: "/v1/invitations/revoke",
    summary: "Revoke the pending invitations of an email address (admins); their links stop working",
    body: RevokeInvitationsInput,
    output: RevokedOutput,
  },
  deviceStart: {
    method: "POST",
    path: "/v1/device/start",
    summary: "Start a browser sign-in (no token): a device code for the CLI, a user code to confirm at /console/device",
    body: DeviceStartInput,
    output: DeviceStartOutput,
  },
  deviceToken: {
    method: "POST",
    path: "/v1/device/token",
    summary: "Poll a browser sign-in: pending, or the new personal token once (403 denied, 404 expired or used)",
    body: DeviceTokenInput,
    output: DeviceTokenOutput,
  },
  status: {
    method: "GET",
    path: "/v1/status",
    summary:
      "Who is online, your unread counts and the live claims; session_id keeps that session of yours online and stores the usage it reports",
    query: StatusQuery,
    output: StatusOutput,
  },
  statusSet: {
    method: "POST",
    path: "/v1/status",
    summary: "Publish what your agent is on, as status_set does (agent: one of your sessions' agents, from whoami)",
    body: StatusSetInput,
    empty: [204],
  },
  pause: {
    method: "POST",
    path: "/v1/me/pause",
    summary: "Stop your own agents from sending (you still can, as a human)",
    output: PauseOutput,
  },
  resume: { method: "POST", path: "/v1/me/resume", summary: "Let your agents send again", output: PauseOutput },
  stream: {
    method: "GET",
    path: "/v1/stream",
    summary: "Server-sent events: one `message` event per received message, ids only; resume with Last-Event-ID",
    query: SessionQuery,
    output: StreamEvent,
    sse: true,
  },
} as const satisfies Record<string, Route>;

export type RestRoutes = typeof REST_ROUTES;
