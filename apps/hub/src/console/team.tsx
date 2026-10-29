/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { CLAIM_ENFORCEMENT, ROLES, type Role } from "@codetgh/shared";
import type { Child, FC } from "hono/jsx";
import type { TeamSettings } from "../db/schema.js";
import type { Lang } from "../i18n.js";
import type { Principal } from "../principal.js";
import { Action, Banner, Chip, CodeBlock, Collapsible, EmptyState, Field, fieldAria, Panel, Pill, RowMenu, Table, When } from "./pages.js";

// Members, Tokens, My data and Settings. People read by name, with their email and the handle they are written to; an
// action names the person or the token it acts on and asks first when it cuts something off; what the hub shows only once
// (an invitation link, a token, a webhook secret, a Slack code) comes in a block to copy. Every value is rendered by JSX,
// which escapes text.
type Tr = ((s: string) => string) & { lang: Lang };
const named = (s: string, values: Record<string, string>) => s.replace(/\{(\w+)\}/g, (key, k: string) => values[k] ?? key);
const ROLE: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };

// The page header's form: folded behind its button, open across the header.
const HeadForm: FC<{ summary: string; open?: boolean; children?: Child }> = ({ summary, open, children }) => (
  <div class="head-form">
    <Collapsible summary={summary} open={open}>
      {children}
    </Collapsible>
  </div>
);

// ---- Members ----

export type MemberRow = {
  membership: { id: string; userId: string; role: Role; handle: string; createdAt: Date };
  name: string;
  email: string;
};

// The hub reserves the a2a- and bridge- handles for its system members: an external agent, the GitHub or Slack bridge.
const systemOf = (handle: string) => (handle.startsWith("a2a-") ? "external" : handle.startsWith("bridge-") ? "bridge" : null);

const MAKE: Record<Role, [string, string]> = {
  owner: ["Make {name} an owner?", "Owners can do everything admins do, and also manage the other owners."],
  admin: ["Make {name} an admin?", "Admins manage members, alerts, the audit log and the team's settings."],
  member: [
    "Make {name} a member?",
    "Members work with agents, threads, tasks, claims and team memory, without managing the team. Their pending invitations are revoked.",
  ],
  guest: [
    "Make {name} a guest?",
    "Guests see only the threads they take part in: no projects, tasks, claims or team memory. Their delegate sessions stop taking requests, and their pending invitations are revoked.",
  ],
};

export const InviteForm: FC<{ _: Tr; owner: boolean }> = ({ _, owner }) => (
  <HeadForm summary={_("Invite a member")}>
    <form hx-post="/console/members/invite" hx-target="#invite-result">
      <Field id="invite-email" label={_("Email")} lang={_.lang}>
        <input
          id="invite-email"
          name="email"
          type="email"
          required
          autocomplete="off"
          spellcheck={false}
          placeholder={_("name@example.com…")}
        />
      </Field>
      <Field
        id="invite-role"
        label={_("Role")}
        lang={_.lang}
        help={_("Admins also manage members, alerts and settings. Guests see only their own threads.")}
      >
        <select id="invite-role" name="role" {...fieldAria("invite-role", { help: 1 })}>
          {ROLES.filter((r) => r !== "owner" || owner).map((r) => (
            <option value={r} selected={r === "member"}>
              {_(ROLE[r])}
            </option>
          ))}
        </select>
      </Field>
      <Field id="invite-days" label={_("Valid for")} lang={_.lang} help={_("From 1 to 30\u00a0days.")}>
        <span class="with-unit">
          <input
            id="invite-days"
            name="days"
            type="number"
            min={1}
            max={30}
            value="7"
            required
            {...fieldAria("invite-days", { help: 1 })}
          />
          <span>{_("days")}</span>
        </span>
      </Field>
      <button type="submit" class="primary">
        {_("Invite")}
      </button>
    </form>
    <div id="invite-result" />
  </HeadForm>
);

// The link always comes back: emailed or not, it can be sent another way.
export const Invited: FC<{ _: Tr; email: string; link: string; days: number; emailed: boolean }> = ({ _, email, link, days, emailed }) => (
  <>
    <Banner
      tone={emailed ? "success" : "info"}
      title={named(_(emailed ? "Invitation emailed to {email}." : "Send this link to {email}."), { email })}
    >
      {named(_(emailed ? "The link is valid for {days}\u00a0days. You can also send it yourself:" : "It's valid for {days}\u00a0days."), {
        days: String(days),
      })}
    </Banner>
    <CodeBlock code={link} lang={_.lang} copyLabel={_("Copy the invitation link")} />
  </>
);

export type InvitationRow = { id: string; email: string; role: Role; createdAt: Date; expiresAt: Date };
export const Invitations: FC<{ _: Tr; rows: InvitationRow[] }> = ({ _, rows }) => (
  <section aria-labelledby="invitations-h" class="records">
    <h2 id="invitations-h">
      {_("Pending invitations")}
      {rows.length > 0 && (
        <>
          {" "}
          <span class="count">{rows.length}</span>
        </>
      )}
    </h2>
    <Table
      lang={_.lang}
      caption={_("Pending invitations")}
      head={[_("Email"), _("Role"), _("Sent"), _("Expires"), _("Actions")]}
      primary={0}
      actions
      rows={rows.map((i) => [
        <span class="invitation-email">{i.email}</span>,
        _(ROLE[i.role]),
        <When at={i.createdAt} lang={_.lang} />,
        <When at={i.expiresAt} lang={_.lang} />,
        <Action
          post={`/console/invitations/${i.id}/revoke`}
          label={_("Revoke")}
          level="danger"
          name={`${named(_("Revoke the invitation for {email}"), { email: i.email })}…`}
          confirm={{
            title: named(_("Revoke the invitation for {email}?"), { email: i.email }),
            body: _("Its link stops working at once. You can invite them again later."),
          }}
          done={named(_("Invitation for {email} revoked."), { email: i.email })}
        />,
      ])}
      empty={_("No pending invitations. Invite someone with the form above, or run codetgh invite <email>.")}
    />
  </section>
);

// What the reader may do to one person, as the hub allows it: never their own role or access, an owner only as an owner, an
// external agent cut off but not renamed, the bridge left alone.
const MemberMenu: FC<{ r: MemberRow; viewer: Principal; _: Tr }> = ({ r, viewer, _ }) => {
  const m = r.membership;
  const system = systemOf(m.handle);
  const self = m.userId === viewer.user.id;
  if (system === "bridge" || (m.role === "owner" && viewer.role !== "owner")) return null;
  const items = [];
  if (!system)
    items.push(
      <form class="handle-form" hx-post={`/console/members/${m.id}/handle`} hx-swap="none">
        <label for={`handle-${m.id}`}>{_("Handle")}</label>
        <p class="help" id={`handle-${m.id}-help`}>
          {_("Lowercase letters, digits and dashes.")}
        </p>
        <span class="handle-row">
          <span class="with-prefix">
            <span aria-hidden="true">@</span>
            <input
              id={`handle-${m.id}`}
              name="handle"
              value={m.handle}
              maxlength={40}
              pattern="[a-z0-9][a-z0-9\-]{0,39}"
              autocomplete="off"
              spellcheck={false}
              {...fieldAria(`handle-${m.id}`, { help: 1 })}
            />
          </span>
          <button type="submit" class="secondary">
            {_("Rename")}
          </button>
        </span>
      </form>,
    );
  if (!system && !self)
    for (const role of ROLES.filter((role) => role !== m.role && (role !== "owner" || viewer.role === "owner"))) {
      const label = _(`Make ${role}`);
      const [title, body] = MAKE[role];
      items.push(
        <Action
          post={`/console/members/${m.id}/role`}
          vals={{ role }}
          label={label}
          name={`${label} ${r.name}…`}
          confirm={{ title: named(_(title), { name: r.name }), body: _(body) }}
        />,
      );
    }
  if (!self)
    items.push(
      <Action
        post={`/console/members/${m.id}/revoke`}
        label={_("Revoke access")}
        level="danger"
        name={`${_("Revoke access")} ${r.name}…`}
        confirm={{
          title: named(_("Revoke {name}'s access?"), { name: r.name }),
          body: _(
            "They're signed out at once: their tokens stop working, their sessions end and their claims are released. What they wrote stays with the team.",
          ),
        }}
        done={named(_("{name}'s access revoked."), { name: r.name })}
      />,
    );
  return <RowMenu label={named(_("Actions for {name}"), { name: r.name })} items={items} />;
};

export const Members: FC<{ _: Tr; rows: MemberRow[]; viewer: Principal }> = ({ _, rows, viewer }) => (
  <section aria-labelledby="members-h" class="records team-members">
    <h2 id="members-h">
      {_("Team members")} <span class="count">{rows.length}</span>
    </h2>
    <Table
      lang={_.lang}
      caption={_("Team members")}
      head={[_("Name"), _("Handle"), _("Role"), _("Joined"), _("Actions")]}
      primary={0}
      actions
      rows={rows.map((r) => {
        const m = r.membership;
        const system = systemOf(m.handle);
        return [
          <div class="person">
            <p class="person-head">
              <span class="person-name">{r.name}</span>
              {m.userId === viewer.user.id && <span class="person-you">{_("You")}</span>}
            </p>
            <p class="meta person-email">
              {system === "external"
                ? _("External agent")
                : system === "bridge"
                  ? _(m.handle === "bridge-slack" ? "Slack bridge" : "GitHub bridge")
                  : r.email}
            </p>
          </div>,
          <Chip>{`@${m.handle}`}</Chip>,
          _(ROLE[m.role]),
          <When at={m.createdAt} lang={_.lang} />,
          <MemberMenu r={r} viewer={viewer} _={_} />,
        ];
      })}
      empty=""
    />
  </section>
);

// ---- Tokens ----

export const TokenForm: FC<{ _: Tr; open: boolean }> = ({ _, open }) => (
  <HeadForm summary={_("Create a token")} open={open}>
    <form hx-post="/console/tokens" hx-target="#new-token">
      <Field id="token-label" label={_("Label")} lang={_.lang} help={_("Name the machine or the use, like laptop or ci.")}>
        <input id="token-label" name="label" required maxlength={60} autocomplete="off" {...fieldAria("token-label", { help: 1 })} />
      </Field>
      <button type="submit" class="primary">
        {_("Create a token")}
      </button>
    </form>
    <div id="new-token" />
  </HeadForm>
);

// Shown once: the token, then the commands that use it on the person's machine.
export const TokenCreated: FC<{ _: Tr; token: string; url: string }> = ({ _, token, url }) => (
  <>
    <Banner tone="warn" title={_("Token created. Copy it now: you won't see it again.")} />
    <CodeBlock code={token} lang={_.lang} copyLabel={_("Copy the token")} />
    <p>{_("On your machine, sign in with it. Paste the token when the terminal asks for it:")}</p>
    <CodeBlock command code={`codetgh login --url ${url} --token-stdin`} lang={_.lang} copyLabel={_("Copy the sign-in command")} />
    <p>{_("Then install the Claude Code plugin. It asks for the hub's address and this token:")}</p>
    <CodeBlock command code="claude plugin install codetgh@<marketplace>" lang={_.lang} copyLabel={_("Copy the plugin command")} />
  </>
);

export type TokenRow = { id: string; label: string; createdAt: Date; expiresAt: Date };
export const Tokens: FC<{ _: Tr; rows: TokenRow[] }> = ({ _, rows }) => (
  <div class="records">
    <Table
      lang={_.lang}
      caption={_("Personal tokens")}
      head={[_("Label"), _("Created"), _("Expires"), _("Actions")]}
      primary={0}
      actions
      rows={rows.map((t) => [
        <span class="token-label">{t.label}</span>,
        <When at={t.createdAt} lang={_.lang} />,
        t.expiresAt < new Date() ? (
          <span class="token-expired">
            <Pill>{_("Expired")}</Pill> <When at={t.expiresAt} lang={_.lang} />
          </span>
        ) : (
          <When at={t.expiresAt} lang={_.lang} />
        ),
        <Action
          post={`/console/tokens/${t.id}/revoke`}
          label={_("Revoke")}
          level="danger"
          name={`${named(_("Revoke the token {label}"), { label: t.label })}…`}
          confirm={{
            title: named(_("Revoke the token {label}?"), { label: t.label }),
            body: _("Terminals and scripts that use it are refused from their next request. Invitations made with it are revoked too."),
          }}
          done={named(_("Token {label} revoked."), { label: t.label })}
        />,
      ])}
      empty={
        <EmptyState title={_("No personal tokens yet.")} icon="terminal">
          {_("Create one to sign in a terminal.")}
        </EmptyState>
      }
    />
  </div>
);

// ---- My data ----

export const MyData: FC<{ _: Tr; p: Principal }> = ({ _, p }) => (
  <>
    <Panel title={_("Profile")}>
      <form hx-post="/console/me/profile" hx-swap="none">
        <Field
          id="me-name"
          label={_("Display name")}
          lang={_.lang}
          help={named(_("Your teammates see it next to your handle, {handle}."), { handle: `@${p.handle}` })}
        >
          <input
            id="me-name"
            name="name"
            value={p.user.name}
            maxlength={60}
            required
            autocomplete="name"
            {...fieldAria("me-name", { help: 1 })}
          />
        </Field>
        <button type="submit" class="primary">
          {_("Save")}
        </button>
      </form>
    </Panel>
    <Panel title={_("A copy of your data")}>
      <p>{_("Your profile, sessions, messages, claims, tasks, team memory and audit events, in one JSON file.")}</p>
      <a class="button" href="/console/me/export">
        {_("Download my data")}
      </a>
    </Panel>
    <Panel title="Slack">
      <p>{_("Reply to the team's threads from Slack, as you. A one-time code links your Slack account.")}</p>
      <form hx-post="/console/me/slack" hx-target="#slack-code">
        <button type="submit" class="secondary">
          {_("Link Slack")}
        </button>
      </form>
      <div id="slack-code" />
    </Panel>
    <Panel title={_("Erase my data")} tone="danger">
      <p>
        {_(
          "Your messages, subjects, claim reasons and task notes become [erased], your name becomes Former member, your claims are released, your tasks go back to the team and your access ends. Tasks and team memory you wrote stay with the team; the audit log keeps ids only.",
        )}
      </p>
      <form hx-post="/console/me/erase" hx-swap="none">
        <Field id="me-erase" label={_("Type erase to confirm")} lang={_.lang} help={_("This can't be undone.")}>
          <input id="me-erase" name="confirm" required autocomplete="off" spellcheck={false} {...fieldAria("me-erase", { help: 1 })} />
        </Field>
        <button type="submit" class="danger">
          {_("Erase my data")}
        </button>
      </form>
    </Panel>
  </>
);

export const SlackCode: FC<{ _: Tr; code: string }> = ({ _, code }) => (
  <>
    <Banner title={_("Type this in Slack within 10\u00a0minutes.")}>
      {_("Your replies in CodeTgh threads there then reach the team as you.")}
    </Banner>
    <CodeBlock code={`/codetgh-link ${code}`} lang={_.lang} copyLabel={_("Copy the Slack command")} />
  </>
);

// ---- Settings ----

const CLAIMS: Record<(typeof CLAIM_ENFORCEMENT)[number], [string, string]> = {
  ask: ["Ask the person", "Claude Code asks before the edit goes through. This is the default."],
  warn: [
    "Warn the agent, never block",
    "Autonomous sessions (bypassPermissions) can't answer a question: choose this for teams that run them.",
  ],
};
const ACCEPT_BY = { member: "Members, admins and owners", admin: "Admins and owners", owner: "Owners only" } as const;

// A checkbox and, under its label, what it changes.
const Check: FC<{ name: string; checked: boolean; label: string; help: string }> = ({ name, checked, label, help }) => (
  <div class="check">
    <label>
      <input type="checkbox" name={name} value="on" checked={checked} aria-describedby={`${name}-help`} /> {label}
    </label>
    <p class="help" id={`${name}-help`}>
      {help}
    </p>
  </div>
);

export const Settings: FC<{ _: Tr; p: Principal; s: TeamSettings; auditKey: { keyId: string; publicKey: string } }> = ({
  _,
  p,
  s,
  auditKey,
}) => {
  const claims = ["warn", "off"].includes(s.claims_enforcement ?? "") ? "warn" : "ask";
  const [before, after] = _("To check an audit export offline, pass this key to {command}.").split("{command}");
  return (
    <>
      <form hx-post="/console/settings" hx-swap="none" class="settings" data-done={_("Settings saved.")}>
        <Panel title={_("Agent rules")}>
          <fieldset class="choices">
            <legend>{_("When an agent edits a file someone else claimed")}</legend>
            {(["ask", "warn"] as const)
              .filter((level) => CLAIM_ENFORCEMENT.includes(level))
              .map((level) => (
                <div class="check">
                  <label>
                    <input
                      type="radio"
                      name="claims_enforcement"
                      value={level}
                      checked={claims === level}
                      aria-describedby={`claims-${level}-help`}
                    />{" "}
                    {_(CLAIMS[level][0])}
                  </label>
                  <p class="help" id={`claims-${level}-help`}>
                    {_(CLAIMS[level][1])}
                  </p>
                </div>
              ))}
          </fieldset>
          <Check
            name="push_rewake"
            checked={(s.push_allowed_modes ?? []).includes("rewake")}
            label={_("Allow rewake push")}
            help={_("An idle Claude Code session wakes up when a message arrives. Each member also turns it on in the plugin.")}
          />
          <Check
            name="auto_link_projects"
            checked={s.auto_link_projects !== false}
            label={_("Link a new repository when a member starts a session in it")}
            help={_("Otherwise an admin runs codetgh project new.")}
          />
          <Field
            id="loop-orchestrator"
            label={_("Loop orchestrator")}
            lang={_.lang}
            optional
            help={_("The member whose agent judges the agent loops the hub muted. Left empty, a person reopens them.")}
          >
            <span class="with-prefix">
              <span aria-hidden="true">@</span>
              <input
                id="loop-orchestrator"
                name="loop_orchestrator"
                maxlength={40}
                pattern="[a-z0-9-]+"
                value={s.loop_orchestrator ?? ""}
                autocomplete="off"
                spellcheck={false}
                {...fieldAria("loop-orchestrator", { help: 1 })}
              />
            </span>
          </Field>
        </Panel>
        <Panel title={_("Memory")}>
          <Field id="memory-accept-by" label={_("Who accepts team memory")} lang={_.lang}>
            <select id="memory-accept-by" name="memory_accept_by">
              {(["member", "admin", "owner"] as const).map((r) => (
                <option value={r} selected={(s.memory_accept_by ?? "member") === r}>
                  {_(ACCEPT_BY[r])}
                </option>
              ))}
            </select>
          </Field>
          <Check
            name="memory_accept_via_mcp"
            checked={Boolean(s.memory_accept_via_mcp)}
            label={_("Accept team memory from Claude Code too")}
            help={_("Claude Code then asks the person each time. claude.ai and the Agent SDK can't guarantee that.")}
          />
        </Panel>
        <Panel title={_("Messages")}>
          <Field
            id="retention-days"
            label={_("Keep messages for")}
            lang={_.lang}
            help={_("Older messages are deleted. Threads, team memory and the audit log stay.")}
          >
            <span class="with-unit">
              <input
                id="retention-days"
                name="retention_days"
                type="number"
                min={1}
                max={3650}
                value={String(s.retention_days ?? 90)}
                {...fieldAria("retention-days", { help: 1 })}
              />
              <span>{_("days")}</span>
            </span>
          </Field>
          <Field
            id="secret-patterns"
            label={_("Extra secret patterns")}
            lang={_.lang}
            optional
            help={_("One regular expression per line. A message that matches one is blocked, as a known secret is.")}
          >
            <textarea
              id="secret-patterns"
              name="secret_patterns"
              rows={4}
              spellcheck={false}
              {...fieldAria("secret-patterns", { help: 1 })}
            >
              {(s.secret_patterns ?? []).join("\n")}
            </textarea>
          </Field>
        </Panel>
        <Panel title={_("Slack bridge")}>
          <Field
            id="slack-channel"
            label={_("Slack channel")}
            lang={_.lang}
            optional
            help={_("The channel that gets alerts and blocking requests. Its id looks like C0123ABC.")}
          >
            <input
              id="slack-channel"
              name="slack_channel"
              maxlength={40}
              pattern="[A-Z0-9]+"
              value={s.slack_channel ?? ""}
              autocomplete="off"
              spellcheck={false}
              {...fieldAria("slack-channel", { help: 1 })}
            />
          </Field>
        </Panel>
        <p class="actions settings-save">
          <button type="submit" class="primary">
            {_("Save settings")}
          </button>
        </p>
      </form>
      <Panel title={_("GitHub bridge")}>
        <p class="bridge-state">{s.github_hook ? <Pill tone="ok">{_("Webhook configured")}</Pill> : <Pill>{_("Not configured")}</Pill>}</p>
        <p>{_("GitHub tells the team about pull requests, check suites and new tags: titles, links and branches, never code.")}</p>
        <p class="actions">
          {/* Replacing the secret refuses GitHub's deliveries until the new one is in the GitHub App: it asks first. */}
          <button
            type="button"
            hx-post="/console/settings/github"
            hx-target="#github-hook"
            data-confirm={s.github_hook ? _("Replace the webhook secret?") : undefined}
            data-confirm-body={
              s.github_hook
                ? _("GitHub deliveries signed with the old secret are refused until you paste the new one in your GitHub App.")
                : undefined
            }
            data-confirm-action={s.github_hook ? _("Replace the webhook secret") : undefined}
          >
            {s.github_hook ? `${_("Replace the webhook secret")}…` : _("Create the webhook")}
          </button>
        </p>
        <div id="github-hook" />
      </Panel>
      <Panel title={_("Team")}>
        <form hx-post="/console/settings/team" hx-swap="none">
          <Field id="team-name" label={_("Team name")} lang={_.lang} help={_("Shown in the top bar and in invitations.")}>
            <input id="team-name" name="name" value={p.teamName} maxlength={80} required {...fieldAria("team-name", { help: 1 })} />
          </Field>
          <button type="submit" class="secondary">
            {_("Rename the team")}
          </button>
        </form>
      </Panel>
      <Panel title={_("Audit public key")}>
        <p>
          {before}
          <code>{"codetgh audit verify <file> --public-key"}</code>
          {after}
        </p>
        <p class="meta">
          {_("Key id")} <code translate="no">{auditKey.keyId}</code>
        </p>
        <CodeBlock code={auditKey.publicKey} lang={_.lang} copyLabel={_("Copy the public key")} />
      </Panel>
    </>
  );
};

// Shown once: where GitHub sends its events, and the secret it signs them with.
export const GithubHook: FC<{ _: Tr; url: string; secret: string }> = ({ _, url, secret }) => (
  <>
    <Banner tone="warn" title={_("Copy the secret now: you won't see it again.")}>
      {_(
        "In your GitHub App, under Settings → Webhook, set these two values. Then subscribe to the Pull request, Check suite and Create events.",
      )}
    </Banner>
    <CodeBlock code={`Webhook URL: ${url}\nSecret: ${secret}`} lang={_.lang} copyLabel={_("Copy the URL and the secret")} />
  </>
);
