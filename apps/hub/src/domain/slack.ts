import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Logger } from "pino";
import type { Config } from "../config.js";
import { alert, bridgeLink, membership, message, slackLink, team, thread, user } from "../db/schema.js";
import { HubError } from "../errors.js";
import { type Principal, principalForUser } from "../principal.js";
import { byUser } from "./admin.js";
import { appendAudit } from "./audit.js";
import { type MessagingDeps, sendMessage } from "./messages.js";

// Slack's request signing: HMAC-SHA256 over "v0:<timestamp>:<raw body>", refused when older than 5 minutes.
export function validSlackSignature(secret: string, timestamp: string | undefined, body: string, signature: string | undefined) {
  const ts = Number(timestamp);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const expected = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`);
  const given = Buffer.from(signature ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Slack reads &, < and > as markup: escape them so peer text stays text.
const escapeSlack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

function slackApi(config: Config) {
  const base = (config.slackApiUrl ?? "https://slack.com/api").replace(/\/$/, "");
  return async (method: string, body: Record<string, unknown>) => {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.slackBotToken}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
    if (!data.ok) throw new Error(`slack ${method}: ${data.error ?? res.status}`);
    return data;
  };
}

// Hub → Slack: blocking requests and new alerts reach the team's channel. Direct threads keep their text: only who and a link.
export function startSlackRelay(deps: MessagingDeps, config: Config, log: Logger) {
  if (!config.slackBotToken) return () => {};
  const { db, bus } = deps;
  const call = slackApi(config);
  const channelOf = async (teamId: string) => {
    const [t] = await db.select({ settings: team.settings }).from(team).where(eq(team.id, teamId));
    return t?.settings.slack_channel ?? null;
  };
  // One relay at a time per team, so two attention events cannot post the same alert twice.
  const queues = new Map<string, Promise<void>>();
  const serial = (teamId: string, job: () => Promise<void>) => {
    const next = (queues.get(teamId) ?? Promise.resolve())
      .then(job)
      .catch((e: Error) => log.warn({ err: e.message }, "slack relay failed"));
    queues.set(teamId, next);
  };

  const onMessage = (e: { teamId: string; messageId: string }) =>
    serial(e.teamId, async () => {
      const [row] = await db
        .select({ message, name: user.name, kind: thread.kind })
        .from(message)
        .innerJoin(user, eq(user.id, message.fromUserId))
        .innerJoin(thread, eq(thread.id, message.threadId))
        .where(eq(message.id, e.messageId));
      if (row?.message.priority !== "blocking") return;
      const channel = await channelOf(e.teamId);
      if (!channel) return;
      const m = row.message;
      // A reply addressed to one person stays theirs, as in the console and over MCP, even inside a team thread.
      const what =
        row.kind === "team" && m.to.includes("@team") && !m.encrypted
          ? escapeSlack(m.body.slice(0, 1500))
          : "(direct message: open it in the console)";
      const sent = await call("chat.postMessage", {
        channel,
        text: `*Blocking request* from ${escapeSlack(row.name)} to ${escapeSlack(m.to.join(", "))}: ${what}\n${config.publicUrl}/console/threads/${m.threadId}\nReply in this Slack thread to answer (link your account first: /codetgh-link).`,
      });
      if (sent.ts) await db.insert(bridgeLink).values({ slackChannel: channel, slackTs: sent.ts, teamId: e.teamId, messageId: m.id });
    });

  const onAttention = (e: { teamId: string }) =>
    serial(e.teamId, async () => {
      const channel = await channelOf(e.teamId);
      if (!channel) return;
      const fresh = await db
        .select({ id: alert.id, kind: alert.kind })
        .from(alert)
        .leftJoin(bridgeLink, eq(bridgeLink.alertId, alert.id))
        .where(
          and(
            eq(alert.teamId, e.teamId),
            eq(alert.status, "open"),
            gt(alert.createdAt, new Date(Date.now() - 10 * 60_000)),
            isNull(bridgeLink.slackTs),
          ),
        )
        .orderBy(desc(alert.createdAt))
        .limit(10);
      for (const a of fresh) {
        // The alert's excerpt is a peer's text, kept out of Slack: the console shows it, escaped, to admins.
        const sent = await call("chat.postMessage", {
          channel,
          text: `*CodeTgh alert*: ${a.kind}. Review it: ${config.publicUrl}/console/alerts`,
        });
        if (sent.ts) await db.insert(bridgeLink).values({ slackChannel: channel, slackTs: sent.ts, teamId: e.teamId, alertId: a.id });
      }
    });

  bus.on("message", onMessage);
  bus.on("attention", onAttention);
  return () => {
    bus.off("message", onMessage);
    bus.off("attention", onAttention);
  };
}

// Slack → hub: a linked member's reply in a thread the hub posted becomes their human answer to that message.
export async function handleSlackEvent(
  deps: MessagingDeps,
  config: Config,
  e: { type?: string; subtype?: string; bot_id?: string; user?: string; text?: string; channel?: string; thread_ts?: string },
) {
  if (e.type !== "message" || e.subtype || e.bot_id || !e.user || !e.text || !e.channel || !e.thread_ts) return;
  const { db } = deps;
  const [link] = await db
    .select()
    .from(bridgeLink)
    .where(and(eq(bridgeLink.slackChannel, e.channel), eq(bridgeLink.slackTs, e.thread_ts)));
  if (!link?.messageId) return;
  const [member] = await db
    .select({ userId: slackLink.userId })
    .from(slackLink)
    .where(and(eq(slackLink.teamId, link.teamId), eq(slackLink.slackUserId, e.user)));
  const call = slackApi(config);
  const tell = (text: string) => call("chat.postEphemeral", { channel: e.channel, user: e.user, text });
  if (!member)
    return tell(
      "Link your Slack account first: in the CodeTgh console, My data → Link Slack, then type the /codetgh-link command it shows.",
    );
  const p = await principalForUser(db, member.userId, "console");
  const [parent] = await db.select({ kind: message.kind }).from(message).where(eq(message.id, link.messageId));
  if (!p || p.teamId !== link.teamId || !parent) return;
  try {
    await sendMessage(
      deps,
      { p, agent: null, via: "rest" },
      {
        reply_to: link.messageId,
        kind: ["question", "request"].includes(parent.kind) ? "answer" : "note",
        priority: "normal",
        refs: [],
        body: e.text,
      },
    );
  } catch (err) {
    if (!(err instanceof HubError)) throw err;
    await tell(`Not sent to CodeTgh: ${err.message}`);
  }
}

// Console → Slack: a one-time code the member types in Slack to bind their Slack account.
export async function createSlackCode(deps: MessagingDeps, p: Principal) {
  const code = Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[randomInt(32)]).join("");
  await deps.db.transaction(async (tx) => {
    const set = { codeHash: hashCode(code), codeExpiresAt: new Date(Date.now() + 10 * 60_000) };
    await tx
      .insert(slackLink)
      .values({ teamId: p.teamId, userId: p.user.id, ...set })
      .onConflictDoUpdate({ target: [slackLink.teamId, slackLink.userId], set });
    await appendAudit(tx, { ...byUser(p), action: "slack.link_code_created", subjectId: p.membershipId });
  });
  return code;
}

export async function handleSlackCommand(deps: MessagingDeps, form: Record<string, string>) {
  if (form.command !== "/codetgh-link") return "Unknown command.";
  const { db } = deps;
  const code = (form.text ?? "").trim().toUpperCase();
  const [row] = await db
    .select({ teamId: slackLink.teamId, userId: slackLink.userId, name: user.name, teamName: team.name, membershipId: membership.id })
    .from(slackLink)
    .innerJoin(user, eq(user.id, slackLink.userId))
    .innerJoin(team, eq(team.id, slackLink.teamId))
    .innerJoin(membership, and(eq(membership.teamId, slackLink.teamId), eq(membership.userId, slackLink.userId)))
    .where(and(eq(slackLink.codeHash, hashCode(code)), gt(slackLink.codeExpiresAt, new Date())));
  if (!row || !form.user_id) return "This code is invalid or expired: create a new one in the CodeTgh console (My data → Link Slack).";
  await db.transaction(async (tx) => {
    // One Slack account per member: it moves off any other member it was linked to.
    await tx
      .update(slackLink)
      .set({ slackUserId: null })
      .where(and(eq(slackLink.teamId, row.teamId), eq(slackLink.slackUserId, form.user_id as string)));
    await tx
      .update(slackLink)
      .set({ slackUserId: form.user_id, codeHash: null, codeExpiresAt: null })
      .where(and(eq(slackLink.teamId, row.teamId), eq(slackLink.userId, row.userId)));
    // Replies from that Slack account now reach the team as the member: their action, without the Slack account's id.
    await appendAudit(tx, {
      teamId: row.teamId,
      actorType: "user",
      actorUserId: row.userId,
      via: "rest",
      action: "slack.linked",
      subjectId: row.membershipId,
    });
  });
  return `Linked to ${row.name} in ${row.teamName}. Your replies in CodeTgh threads here now reach the team as you.`;
}
