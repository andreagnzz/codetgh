import { z } from "zod";
import {
  AckInput,
  AgentSessionInput,
  ClaimsCheckRestInput,
  ERROR_CODES,
  InboxReadInput,
  MESSAGE_KINDS,
  PRIORITIES,
  PreEditInput,
  SendMessageInput,
  WhoamiSchema,
} from "./index.js";

// The /v1 REST API in one table: the hub validates with these schemas, /v1/openapi.json and @codetgh/sdk are built from it.
const SessionQuery = z.object({ session_id: z.string().min(1).max(200).optional() });

export const ErrorBody = z.object({ code: z.enum(ERROR_CODES), message: z.string() });

export const SessionStarted = z.object({
  agent_id: z.string().nullable(),
  paused: z.boolean(),
  context: z.string(),
  linked: z.boolean(),
  status_line: z.string().optional(),
});
export const SessionEndInput = z.object({ session_id: z.string().min(1).max(200) });
export const PreEditDecision = z.object({ decision: z.enum(["warn", "ask", "deny"]), reason: z.string() });
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
export const SentMessage = z.object({ id: z.string(), thread: z.string(), hop: z.number(), sent_at: z.string() });
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
export const ThreadKeyOutput = z.object({ thread: z.string(), wrapped: z.string() });
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
  you: z.object({ handle: z.string(), agent: z.string() }),
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
    query: z.object({ session_id: z.string().max(200), wait_s: z.coerce.number().int().min(0).max(55).optional() }),
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
    summary: "The thread of a message and your wrapped key for it, to reply in an encrypted thread",
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
  revokeInvitations: {
    method: "POST",
    path: "/v1/invitations/revoke",
    summary: "Revoke the pending invitations of an email address (admins); their links stop working",
    body: RevokeInvitationsInput,
    output: RevokedOutput,
  },
  status: { method: "GET", path: "/v1/status", summary: "Who is online, your unread counts and the live claims", output: StatusOutput },
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
    output: StreamEvent,
    sse: true,
  },
} as const satisfies Record<string, Route>;

export type RestRoutes = typeof REST_ROUTES;
