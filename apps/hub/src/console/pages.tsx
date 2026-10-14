/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child, FC } from "hono/jsx";
import { BrandHead, Logo } from "../brand.js";
import { type listAgents, presence } from "../domain/agents.js";
import { type Lang, t } from "../i18n.js";
import type { Principal } from "../principal.js";

const NAV: Array<[string, string, boolean?]> = [
  ["/console", "Dashboard"],
  ["/console/threads", "Threads"],
  ["/console/projects", "Projects"],
  ["/console/agents", "Agents"],
  ["/console/claims", "Claims"],
  ["/console/tasks", "Tasks"],
  ["/console/memory", "Memory"],
  ["/console/tokens", "Tokens"],
  ["/console/me", "My data"],
  ["/console/alerts", "Alerts", true],
  ["/console/members", "Members", true],
  ["/console/audit", "Audit", true],
  ["/console/settings", "Settings", true],
];

export const Layout: FC<{ p: Principal; csrf: string; title: string; path: string; lang: Lang; children?: Child }> = ({
  p,
  csrf,
  title,
  path,
  lang,
  children,
}) => {
  const _ = (s: string) => t(lang, s);
  const admin = p.role === "owner" || p.role === "admin";
  const current = (href: string) =>
    href === "/console" ? path === "/console" || path === "/console/" : path === href || path.startsWith(`${href}/`);
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <BrandHead />
        <meta name="htmx-config" content='{"allowEval":false,"allowScriptTags":false,"includeIndicatorStyles":false}' />
        <title>{`${title} · CodeTgh`}</title>
        <script src="/assets/htmx.js" />
        <script src="/assets/sse.js" />
        <script src="/console.js" defer />
      </head>
      <body hx-headers={JSON.stringify({ "X-CSRF-Token": csrf })} hx-ext="sse" sse-connect="/console/stream">
        <a class="skip" href="#main">
          {_("Skip to content")}
        </a>
        <div class="shell">
          <aside class="sidebar">
            <Logo kind="horizontal" />
            <nav aria-label={_("Console")}>
              {NAV.filter(([, , adminOnly]) => admin || !adminOnly).map(([href, label]) => (
                <a href={href} aria-current={current(href) ? "page" : undefined}>
                  {_(label)}
                </a>
              ))}
            </nav>
            <p class="who meta">
              {p.user.name} · {_(p.role)}
              <br />
              {p.teamName}
            </p>
          </aside>
          <main id="main">
            {p.paused && (
              <p class="banner" role="status">
                {_("Agent traffic paused")}
              </p>
            )}
            <h1>{title}</h1>
            {children}
            {/* Outside the live-refreshed parts, so a screen reader hears each new message once. */}
            <p id="line-announce" class="sr-only" aria-live="polite" />
          </main>
        </div>
      </body>
    </html>
  );
};

// Every value below is rendered by JSX, which escapes text: agent-written strings never become HTML.
export const Table: FC<{ head: string[]; rows: Child[][]; empty?: Child }> = ({ head, rows, empty }) =>
  rows.length ? (
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            {head.map((h) => (
              <th scope="col">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              {r.map((cell, i) => (
                <td data-label={head[i]}>
                  <div class="cell">{cell}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p class="empty">{empty ?? "Nothing yet."}</p>
  );

// A state always reads as text; the tone only reinforces it.
export type Tone = "ok" | "warn" | "danger" | "neutral";
export const Pill: FC<{ tone?: Tone; children?: Child }> = ({ tone = "neutral", children }) => (
  <span class="pill" data-tone={tone}>
    {children}
  </span>
);

export const toneOf = (state: string): Tone =>
  (({ online: "ok", trusted: "ok", open: "warn", quarantined: "danger" }) as Record<string, Tone>)[state] ?? "neutral";

// Relative time for people, the exact instant for machines and on hover.
export const When: FC<{ at: Date; lang?: string }> = ({ at, lang = "en" }) => {
  const s = Math.round((at.getTime() - Date.now()) / 1000);
  const [n, unit]: [number, Intl.RelativeTimeFormatUnit] =
    Math.abs(s) < 60
      ? [s, "second"]
      : Math.abs(s) < 3600
        ? [Math.round(s / 60), "minute"]
        : Math.abs(s) < 86400
          ? [Math.round(s / 3600), "hour"]
          : [Math.round(s / 86400), "day"];
  const iso = at.toISOString();
  return (
    <time datetime={iso} title={iso}>
      {new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(n, unit)}
    </time>
  );
};

// One-click actions: an htmx POST answered with HX-Refresh; the CSRF header comes from <body hx-headers>.
// Three levels: primary (one per area), secondary (the default outline), quiet (a text action).
export const Action: FC<{ post: string; label: string; vals?: Record<string, string>; level?: "primary" | "quiet" }> = ({
  post,
  label,
  vals,
  level,
}) => (
  <button type="button" class={level} hx-post={post} hx-vals={vals ? JSON.stringify(vals) : undefined} hx-swap="none">
    {label}
  </button>
);

// Presence: who is live first, then a rule, then who is offline (archived, quieter).
type AgentRow = Awaited<ReturnType<typeof listAgents>>[number];
const Person: FC<{ r: AgentRow; lang: Lang }> = ({ r, lang }) => {
  const state = presence(r.agent);
  return (
    <li>
      <span class="who-name">{r.name}</span> <span class="meta">{r.agent.label}</span> <Pill tone={toneOf(state)}>{t(lang, state)}</Pill>
      {r.agent.trustLevel === "quarantined" && (
        <>
          {" "}
          <Pill tone="danger">{t(lang, "quarantined")}</Pill>
        </>
      )}
      {r.agent.statusText && <span class="status meta">{r.agent.statusText}</span>}
    </li>
  );
};
export const People: FC<{ rows: AgentRow[]; lang: Lang; empty: Child }> = ({ rows, lang, empty }) => {
  const live = rows.filter((r) => presence(r.agent) !== "offline");
  const offline = rows.filter((r) => presence(r.agent) === "offline");
  return (
    <>
      {live.length ? (
        <ul class="people">
          {live.map((r) => (
            <Person r={r} lang={lang} />
          ))}
        </ul>
      ) : (
        <p class="empty">{empty}</p>
      )}
      {offline.length > 0 && (
        <>
          <h3 class="rule">{t(lang, "Offline")}</h3>
          <ul class="people archived">
            {offline.map((r) => (
              <Person r={r} lang={lang} />
            ))}
          </ul>
        </>
      )}
    </>
  );
};

// The activity line, the console's one memorable element: each message is a short vertical wire between the
// sender's caret and the recipient's caret, in the accent color. A message new on screen traces its wire once (console.js).
type LineRow = {
  message: { id: string; createdAt: Date; kind: string; priority: string; authoredBy: string; to: string[]; threadId: string };
  name: string;
};
export const Line: FC<{ rows: LineRow[]; _: ((s: string) => string) & { lang: Lang }; archived?: boolean }> = ({ rows, _, archived }) => (
  <ol class={archived ? "line archived" : "line"}>
    {rows.map(({ message: m, name }) => {
      const to = m.to.map((a) => (a.startsWith("thread:") ? _("the thread") : a)).join(", ");
      const from = `${name}${m.authoredBy === "agent" ? ` ${_("(agent)")}` : ""}`;
      return (
        <li class="wire-row" data-mid={m.id} data-summary={`${_("New message")}: ${from} → ${to}`}>
          <svg class="wire" viewBox="0 0 20 44" width="20" height="44" aria-hidden="true" focusable="false">
            <path class="caret" d="M5 3 L11 8 L5 13" />
            <path class="link" d="M8 15 V29" pathLength="1" />
            <path class="caret" d="M5 31 L11 36 L5 41" />
          </svg>
          <div>
            <p class="wire-who">
              <strong>{from}</strong> <span aria-hidden="true">→</span>
              <span class="sr-only">{_("to")}</span> {to}
            </p>
            <p class="meta">
              <Pill>{_(m.kind)}</Pill>
              {m.priority !== "normal" && (
                <>
                  {" "}
                  <Pill tone="warn">{m.priority}</Pill>
                </>
              )}{" "}
              <When at={m.createdAt} lang={_.lang} /> · <a href={`/console/threads/${m.threadId}`}>{_("Open thread")}</a>
            </p>
          </div>
        </li>
      );
    })}
  </ol>
);

export const Result: FC<{ children?: Child }> = ({ children }) => (
  <div class="result" role="status">
    {children}
  </div>
);

export const InvitePage: FC<{ team: string; role: string; email: string; name: string; valid: boolean; lang: Lang }> = ({
  team,
  role,
  email,
  name,
  valid,
  lang,
}) => {
  const _ = (s: string) => t(lang, s);
  return (
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <BrandHead />
        <title>{`${_("Join {team} on CodeTgh").replace("{team}", team)}`}</title>
      </head>
      <body>
        <main class="public">
          <Logo kind="stacked" />
          {valid ? (
            <>
              <h1>{_("Join {team} on CodeTgh").replace("{team}", team)}</h1>
              <p>
                {_("Invited as")} <strong>{_(role)}</strong> {_("with")} {email}.
              </p>
              <form id="invite-signup">
                <input type="hidden" name="email" value={email} />
                <label>
                  {_("Your name")} <input name="name" required maxlength={60} value={name.slice(0, 60)} autocomplete="name" />
                </label>
                <label>
                  {_("Password")} <input name="password" type="password" required minlength={12} autocomplete="new-password" />
                </label>
                <button type="submit">{_("Create my account")}</button>
              </form>
              <p>
                {_("Already have an account?")} <a href="/login">{_("Sign in")}</a>.
              </p>
            </>
          ) : (
            <>
              <h1>{_("This invitation is no longer valid.")}</h1>
              <p>{_("Ask the person who invited you for a new link.")}</p>
            </>
          )}
          <p id="error" class="field-error" role="alert" />
        </main>
        <script src="/assets/oauth.js" />
      </body>
    </html>
  );
};
