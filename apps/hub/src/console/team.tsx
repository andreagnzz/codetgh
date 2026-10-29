/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { ROLES, type Role } from "@codetgh/shared";
import type { Child, FC } from "hono/jsx";
import type { Lang } from "../i18n.js";
import type { Principal } from "../principal.js";
import { Action, Banner, Chip, CodeBlock, Collapsible, Field, fieldAria, RowMenu, Table, When } from "./pages.js";

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
    <Banner tone="success" title={named(_(emailed ? "Invitation emailed to {email}." : "Invitation ready for {email}."), { email })}>
      {named(
        _(
          emailed
            ? "The link is valid for {days}\u00a0days. You can also send it yourself:"
            : "Send them this link. It's valid for {days}\u00a0days.",
        ),
        {
          days: String(days),
        },
      )}
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
