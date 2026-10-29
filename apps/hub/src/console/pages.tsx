/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { raw } from "hono/html";
import type { Child, FC } from "hono/jsx";
import type { JSX } from "hono/jsx/jsx-runtime";
import { BrandHead, Logo } from "../brand.js";
import { type listAgents, presence, statusOf } from "../domain/agents.js";
import { type Lang, t } from "../i18n.js";
import { Icon, type IconName } from "../icons.js";
import { Layout as PublicLayout } from "../pages.js";
import type { Principal } from "../principal.js";

// Three groups, by how often they are used. The third field is the least role that may open the page: no link to a page
// that would answer 403. My data and Tokens are in the account menu.
type NavItem = [string, string, ("member" | "admin")?];
const NAV: NavItem[][] = [
  [
    ["/console", "Overview"],
    ["/console/threads", "Threads"],
    ["/console/alerts", "Alerts", "admin"],
    ["/console/agents", "Agents"],
    ["/console/projects", "Projects", "member"],
  ],
  [
    ["/console/tasks", "Tasks", "member"],
    ["/console/claims", "Claims", "member"],
    ["/console/memory", "Memory", "member"],
    ["/console/delegations", "Delegations", "member"],
  ],
  [
    ["/console/members", "Members", "admin"],
    ["/console/audit", "Audit", "admin"],
    ["/console/settings", "Settings", "admin"],
  ],
];
const ACCOUNT: NavItem[] = [
  ["/console/me", "My data"],
  ["/console/tokens", "Tokens", "member"],
];

// The project filter: ?project=<id>, or none for what is outside a project; no value shows every project.
export type ProjectFilter = { projects: Array<{ id: string; name: string }>; selected: string | undefined };

export const Layout: FC<{
  p: Principal;
  csrf: string;
  title: string;
  path: string;
  lang: Lang;
  filter?: ProjectFilter;
  keep?: string;
  // On the Archives tab, the filter links stay on it.
  archived?: boolean;
  // A detail page: a way back above the title, a meta line under it, its one action next to it.
  back?: Child;
  head?: Child;
  actions?: Child;
  children?: Child;
}> = ({ p, csrf, title, path, lang, filter, keep, archived, back, head, actions, children }) => {
  const _ = (s: string) => t(lang, s);
  const admin = p.role === "owner" || p.role === "admin";
  const allowed = ([, , least]: NavItem) => (least === "admin" ? admin : least !== "member" || p.role !== "guest");
  const current = (href: string) =>
    href === "/console" ? path === "/console" || path === "/console/" : path === href || path.startsWith(`${href}/`);
  const link = ([href, label]: NavItem) => (
    <li>
      <a href={keep ? `${href}?project=${encodeURIComponent(keep)}` : href} aria-current={current(href) ? "page" : undefined}>
        {_(label)}
      </a>
    </li>
  );
  const groups = NAV.map((g) => g.filter(allowed)).filter((g) => g.length > 0);
  const nav = (
    <nav class="nav" aria-label={_("Console")}>
      {groups.map((g) => (
        <ul>{g.map(link)}</ul>
      ))}
    </nav>
  );
  const account = (
    <ul class="account-items">
      {ACCOUNT.filter(allowed).map(link)}
      <li>
        {lang === "fr" ? (
          <a href={`/lang/en?next=${encodeURIComponent(path)}`} hreflang="en" lang="en">
            English
          </a>
        ) : (
          <a href={`/lang/fr?next=${encodeURIComponent(path)}`} hreflang="fr" lang="fr">
            Français
          </a>
        )}
      </li>
    </ul>
  );
  return (
    <>
      {raw("<!doctype html>")}
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
              {nav}
            </aside>
            <header class="topbar">
              <p class="team" title={p.teamName}>
                {p.teamName}
              </p>
              {/* console.js follows the live connection (htmx sse events) and shows this once it runs; the words come from here. */}
              <p
                class="live"
                hidden
                data-state="connecting"
                data-live={_("Live")}
                data-lost={_("Reconnecting…")}
                data-offline={_("Offline since {time}")}
              >
                {_("Connecting…")}
              </p>
              <details class="account">
                <summary>
                  {p.user.name} · {_(p.role)}
                  <Icon name="chevron-down" />
                </summary>
                <div class="pop">{account}</div>
              </details>
              <details class="menu">
                <summary>
                  <span class="menu-closed">
                    <Icon name="menu" />
                    {_("Menu")}
                  </span>
                  <span class="menu-open">
                    <Icon name="x" />
                    {_("Close")}
                  </span>
                </summary>
                {nav}
                <p class="menu-who">
                  {p.user.name} · {_(p.role)}
                </p>
                {account}
              </details>
            </header>
            {p.paused && (
              <Banner tone="danger" title={_("Agent traffic stopped")}>
                {_("Agents can't send messages or claim files until an admin resumes agent traffic.")}{" "}
                {admin && <a href="/console#agent-traffic">{_("Resume agent traffic")}</a>}
              </Banner>
            )}
            <main id="main">
              <div class="page-head">
                {back && (
                  <p class="back">
                    <Icon name="chevron-left" />
                    {back}
                  </p>
                )}
                <h1>{title}</h1>
                {actions && <div class="page-actions">{actions}</div>}
                {head && <div class="page-meta">{head}</div>}
              </div>
              {filter && <ProjectMenu filter={filter} path={path} archived={archived} lang={lang} />}
              {children}
            </main>
          </div>
          {/* Outside the live-refreshed parts, so a screen reader hears each new message once. */}
          <p id="line-announce" class="sr-only" aria-live="polite" />
          {/* A toast after an action whose result does not show on the page (console.js, data-done on the trigger). */}
          <div class="toasts" role="status" />
          {/* The confirmation of a destructive action (console.js, data-confirm on the trigger). */}
          <dialog id="confirm" aria-labelledby="confirm-title" aria-describedby="confirm-body">
            <h2 id="confirm-title">{_("Confirm")}</h2>
            <p id="confirm-body" />
            <p id="confirm-error" role="alert" />
            <div class="actions">
              <button type="button" class="secondary" value="cancel" autofocus>
                {_("Cancel")}
              </button>
              <button type="button" class="primary" value="confirm" />
            </div>
          </dialog>
          {/* What console.js draws: the icon of an error under a form, a toast. */}
          <template id="error-icon">
            <Icon name="circle-alert" />
          </template>
          <template id="toast">
            <div class="toast">
              <Icon name="circle-check" />
              <p />
              <button type="button" class="icon-button" aria-label={_("Close")}>
                <Icon name="x" />
              </button>
            </div>
          </template>
        </body>
      </html>
    </>
  );
};

// The project filter: a menu whose button names the current choice; the choices stay links to the same pages.
const ProjectMenu: FC<{ filter: ProjectFilter; path: string; archived?: boolean; lang: Lang }> = ({ filter, path, archived, lang }) => {
  const _ = (s: string) => t(lang, s);
  const choices = [{ id: undefined, name: _("All projects") }, ...filter.projects, { id: "none", name: _("Outside a project") }];
  const chosen = choices.find((pr) => pr.id === filter.selected) ?? choices[0];
  return (
    <details class="projects-filter">
      <summary>
        {_("Project")}
        {_(": ")}
        <strong>{chosen?.name}</strong>
        <Icon name="chevron-down" />
      </summary>
      <div class="pop">
        <nav aria-label={_("Project")}>
          <ul class="menu-items">
            {choices.map((pr) => (
              <li>
                <a
                  href={`${path}?${archived ? "archived=1&" : ""}project=${pr.id ? encodeURIComponent(pr.id) : ""}`}
                  aria-current={pr.id === filter.selected ? "page" : undefined}
                >
                  {pr.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </details>
  );
};

// Every value below is rendered by JSX, which escapes text: agent-written strings never become HTML.
// A dense table. The caption names it for screen readers when the page title already says it; the column the rows are
// ordered by says so with aria-sort and an arrow; numbers line up on the right; an unread row says so in words too. Under
// 640 px each row is a record: the primary cell on its own line, the other cells with their labels (empty ones dropped),
// then the actions, whose column header is read but not shown. With no rows, the empty state replaces the whole table,
// headers included.
export const Table: FC<{
  head: string[];
  rows: Child[][];
  empty: string | JSX.Element;
  lang: Lang;
  caption?: string;
  sort?: { column: number; dir: "ascending" | "descending" };
  numeric?: number[];
  primary?: number;
  actions?: boolean;
  current?: number;
  unread?: number[];
}> = ({ head, rows, empty, lang, caption, sort, numeric = [], primary, actions, current, unread = [] }) => {
  if (!rows.length) return typeof empty === "string" ? <p class="empty">{empty}</p> : empty;
  const last = head.length - 1;
  const kind = (i: number) =>
    [numeric.includes(i) && "num", i === primary && "primary-cell", actions && i === last && "actions-cell"].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div class="table-wrap">
      <table>
        {caption && <caption class="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th scope="col" class={kind(i)} aria-sort={sort?.column === i ? sort.dir : undefined}>
                {actions && i === last ? <span class="sr-only">{h}</span> : h}
                {sort?.column === i && <Icon name={sort.dir === "ascending" ? "arrow-up" : "arrow-down"} />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => (
            <tr aria-current={current === n ? "true" : undefined} class={unread.includes(n) ? "unread" : undefined}>
              {r.map((cell, i) => (
                <td data-label={head[i]} class={kind(i)}>
                  <div class="cell">
                    {i === (primary ?? 0) && unread.includes(n) && <span class="sr-only">{`${t(lang, "Unread")} `}</span>}
                    {cell}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// "‹ Newer" and "Older ›" around a long list, with how much of it shows.
export const Pager: FC<{ lang: Lang; newer?: string; older?: string; shown?: number; total?: number }> = ({
  lang,
  newer,
  older,
  shown,
  total,
}) => (
  <nav class="pager" aria-label={t(lang, "Pages")}>
    {shown !== undefined && total !== undefined && (
      <p class="meta">{t(lang, "Showing {shown} of {total}").replace("{shown}", String(shown)).replace("{total}", String(total))}</p>
    )}
    <div class="pager-links">
      {newer && (
        <a class="button" href={newer}>
          <Icon name="chevron-left" />
          {t(lang, "Newer")}
        </a>
      )}
      {older && (
        <a class="button" href={older}>
          {t(lang, "Older")}
          <Icon name="chevron-right" />
        </a>
      )}
    </div>
  </nav>
);

// A state always reads as text; the tone only reinforces it.
export type Tone = "ok" | "warn" | "danger" | "neutral";
export const Pill: FC<{ tone?: Tone; children?: Child }> = ({ tone = "neutral", children }) => (
  <span class="pill" data-tone={tone}>
    {children}
  </span>
);

// Tabs that change the URL: the current one by weight and an accent underline, its count when known.
export const Tabs: FC<{ label: string; items: Array<{ href: string; text: Child; current: boolean; count?: number }> }> = ({
  label,
  items,
}) => (
  <nav class="tabs" aria-label={label}>
    {items.map((i) => (
      <a href={i.href} aria-current={i.current ? "page" : undefined}>
        {i.text}
        {i.count !== undefined && <span class="count">{i.count}</span>}
      </a>
    ))}
  </nav>
);

// Current items, or the archives: threads quiet for a day with nothing unread, tasks finished a day ago.
export const ArchiveTabs: FC<{ base: string; archived: boolean; lang: Lang; project?: string }> = ({ base, archived, lang, project }) => (
  <Tabs
    label={t(lang, "Archives")}
    items={[
      { href: project ? `${base}?project=${encodeURIComponent(project)}` : base, text: t(lang, "Current"), current: !archived },
      {
        href: `${base}?archived=1${project ? `&project=${encodeURIComponent(project)}` : ""}`,
        text: t(lang, "Archives"),
        current: archived,
      },
    ]}
  />
);

export const toneOf = (state: string): Tone =>
  (({ online: "ok", trusted: "ok", open: "warn", quarantined: "danger" }) as Record<string, Tone>)[state] ?? "neutral";

// A session in bypassPermissions stands out; other permission modes read as plain text.
export const Bypass: FC<{ lang: Lang }> = ({ lang }) => (
  <span title={t(lang, "Permission prompts are off in this session")}>
    <Pill tone="danger">bypass</Pill>
  </span>
);

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

// One-click actions: an htmx POST answered with HX-Refresh; the CSRF header comes from <body hx-headers>. The level is the
// importance: primary (one per area), secondary (the default), tertiary (a text action), danger (destructive). With confirm,
// console.js asks first in the dialog: the trigger opens it, so its label ends in "…", and the dialog's button runs the action
// under the bare label. With done, it says so in a toast after the reload, for a result the page does not show.
export const Action: FC<{
  post: string;
  label: string;
  vals?: Record<string, string>;
  level?: "primary" | "secondary" | "tertiary" | "danger";
  confirm?: { title: string; body: string };
  done?: string;
}> = ({ post, label, vals, level, confirm, done }) => (
  <button
    type="button"
    class={level}
    hx-post={post}
    hx-vals={vals ? JSON.stringify(vals) : undefined}
    hx-swap="none"
    data-confirm={confirm?.title}
    data-confirm-body={confirm?.body}
    data-confirm-action={confirm && label}
    data-done={done}
  >
    {confirm ? `${label}…` : label}
  </button>
);

// A handle or a session label, as typed in a terminal; never translated. Cut by its width, it keeps its full text on hover.
export const Chip: FC<{ former?: boolean; children?: Child }> = ({ former, children }) => (
  <span class={former ? "chip former" : "chip"} translate="no" title={typeof children === "string" ? children : undefined}>
    {children}
  </span>
);

// A message about a state: its icon's shape is the severity; information and success are polite, an error is an alert.
export type BannerTone = "info" | "success" | "warn" | "danger";
const BANNER_ICON: Record<BannerTone, IconName> = {
  info: "info",
  success: "circle-check",
  warn: "triangle-alert",
  danger: "octagon-alert",
};
export const Banner: FC<{ tone?: BannerTone; title: Child; actions?: Child; dismiss?: string; children?: Child }> = ({
  tone = "info",
  title,
  actions,
  dismiss,
  children,
}) => (
  <div class="banner" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
    <Icon name={BANNER_ICON[tone]} />
    <div class="banner-text">
      <p class="banner-title">{title}</p>
      {children && <p class="banner-body">{children}</p>}
      {actions && <p class="banner-actions">{actions}</p>}
    </div>
    {dismiss && (
      <button type="button" class="icon-button" aria-label={dismiss} data-dismiss>
        <Icon name="x" />
      </button>
    )}
  </div>
);

// A bordered group for a form or settings; the danger variant names its risk.
export const Panel: FC<{ title?: Child; tone?: "danger"; children?: Child }> = ({ title, tone, children }) => (
  <section class="panel" data-tone={tone}>
    {title && (
      <h2>
        {tone === "danger" && <Icon name="octagon-alert" />}
        {title}
      </h2>
    )}
    {children}
  </section>
);

// A create form folded behind the button that opens it.
export const Collapsible: FC<{ summary: Child; open?: boolean; children?: Child }> = ({ summary, open, children }) => (
  <details class="panel" open={open}>
    <summary>{summary}</summary>
    {children}
  </details>
);

// The rarer actions of a table row, behind an ellipsis whose name says which row.
export const RowMenu: FC<{ label: string; items: Child[] }> = ({ label, items }) => (
  <details class="row-menu">
    <summary aria-label={label}>
      <Icon name="ellipsis" />
    </summary>
    <div class="pop">
      <ul class="menu-items">
        {items.map((item) => (
          <li>{item}</li>
        ))}
      </ul>
    </div>
  </details>
);

// A labelled field: the label above, an optional help line, the control (the caller gives it the id and fieldAria), the error
// in words under it.
export const fieldAria = (id: string, { help, error }: { help?: unknown; error?: unknown }) => ({
  "aria-describedby": [help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined,
  "aria-invalid": error ? ("true" as const) : undefined,
});
export const Field: FC<{ id: string; label: Child; lang: Lang; help?: Child; error?: Child; optional?: boolean; children?: Child }> = ({
  id,
  label,
  lang,
  help,
  error,
  optional,
  children,
}) => (
  <div class="field">
    <label for={id}>
      {label}
      {optional && <span class="optional"> {t(lang, "optional")}</span>}
    </label>
    {help && (
      <p class="help" id={`${id}-help`}>
        {help}
      </p>
    )}
    {children}
    {error && (
      <p class="field-error" id={`${id}-error`}>
        <Icon name="circle-alert" />
        {error}
      </p>
    )}
  </div>
);

// Code to copy: wraps instead of scrolling; a command's prompt is drawn, never copied. console.js copies, or selects the text
// and says how when the browser refuses. With several blocks on a page, copyLabel names what each Copy copies ("Copy the
// token"): it starts with the visible word. In a region a live refresh replaces, id keeps Copy's place for the keyboard.
export const CodeBlock: FC<{ code: string; lang: Lang; command?: boolean; copyLabel?: string; id?: string }> = ({
  code,
  lang,
  command,
  copyLabel,
  id,
}) => {
  const _ = (s: string) => t(lang, s);
  return (
    <div class="code" data-kind={command ? "command" : undefined}>
      <pre>
        <code translate="no">{code}</code>
      </pre>
      <button
        type="button"
        id={id}
        class="copy"
        aria-label={copyLabel}
        data-copy
        data-hint={_("Press Ctrl+C to copy")}
        data-hint-mac={_("Press ⌘C to copy")}
      >
        <span class="when-idle">
          <Icon name="copy" />
          {_("Copy")}
        </span>
        <span class="when-copied">
          <Icon name="check" />
          {_("Copied")}
        </span>
      </button>
      <p class="copy-hint" hidden />
      <span class="sr-only" role="status" />
    </div>
  );
};

// A screen with nothing to show says what would fill it and how: a sentence, then the command or the one action.
export const EmptyState: FC<{ title: Child; icon?: IconName; action?: Child; children?: Child }> = ({
  title,
  icon = "info",
  action,
  children,
}) => (
  <div class="empty-state">
    <Icon name={icon} />
    <div>
      <p class="empty-title">{title}</p>
      {children && <p class="empty">{children}</p>}
      {action}
    </div>
  </div>
);

// What happened to one object, oldest first. Times are absolute (console.js puts them in the reader's time zone): the clock
// alone for a time from today, the day and month before it on another day. A filled node is a state change, a hollow one a
// note; the current state reads in bold. Past fold events, the oldest are folded.
export type TimelineEvent = { at: Date; text: Child; actor?: Child; body?: Child; change?: boolean; now?: boolean };
const CLOCK: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
export const Stamp: FC<{ at: Date; lang: Lang }> = ({ at, lang }) => (
  <time datetime={at.toISOString()} data-local>
    {new Intl.DateTimeFormat(
      lang === "fr" ? "fr-FR" : "en-GB",
      at.toDateString() === new Date().toDateString() ? CLOCK : { day: "numeric", month: "short", ...CLOCK },
    ).format(at)}
  </time>
);
export const Timeline: FC<{ events: TimelineEvent[]; lang: Lang; empty: Child; fold?: number }> = ({ events, lang, empty, fold = 10 }) => {
  if (!events.length) return <p class="empty">{empty}</p>;
  const item = (e: TimelineEvent) => (
    <li data-change={e.change ? "" : undefined} class={e.now ? "now" : undefined}>
      <p class="timeline-head">
        <Stamp at={e.at} lang={lang} />
        {e.actor}
        <span class="timeline-text">{e.text}</span>
      </p>
      {e.body && <p class="timeline-body">{e.body}</p>}
    </li>
  );
  const folded = events.length > fold ? events.slice(0, events.length - fold) : [];
  return (
    <>
      {folded.length > 0 && (
        <details class="disclosure">
          <summary>
            {t(lang, "Show {n} earlier events").replace("{n}", String(folded.length))}
            <Icon name="chevron-down" />
          </summary>
          <ol class="timeline">{folded.map(item)}</ol>
        </details>
      )}
      <ol class="timeline">{events.slice(folded.length).map(item)}</ol>
    </>
  );
};

// Presence: who is live first, then a rule, then who is offline (archived, quieter).
type AgentRow = Awaited<ReturnType<typeof listAgents>>[number];
type RowAction = (r: AgentRow) => Child;
const Person: FC<{ r: AgentRow; lang: Lang; action?: RowAction }> = ({ r, lang, action }) => {
  const state = presence(r.agent);
  const status = statusOf(r.agent);
  return (
    <li>
      <span class="who-name">{r.name}</span>{" "}
      <span class="meta">
        {r.agent.label}
        {r.project && ` · ${r.project}`}
      </span>{" "}
      <Pill tone={toneOf(state)}>{t(lang, state)}</Pill>
      {(r.agent.pushMode || r.agent.clientVersion) && (
        <span class="meta">
          {" "}
          {[r.agent.pushMode && `push ${r.agent.pushMode}`, r.agent.clientVersion && `Claude Code ${r.agent.clientVersion}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      )}
      {r.agent.permissionMode === "bypassPermissions" && (
        <>
          {" "}
          <Bypass lang={lang} />
        </>
      )}
      {r.agent.trustLevel === "quarantined" && (
        <>
          {" "}
          <Pill tone="danger">{t(lang, "quarantined")}</Pill>
        </>
      )}
      {status && (
        <span class="status meta">
          {status.text}
          {status.at && (
            <>
              {" · "}
              <When at={status.at} lang={lang} />
            </>
          )}
        </span>
      )}
      {action?.(r)}
    </li>
  );
};
export const People: FC<{ rows: AgentRow[]; lang: Lang; empty: Child; action?: RowAction }> = ({ rows, lang, empty, action }) => {
  const live = rows.filter((r) => presence(r.agent) !== "offline");
  const offline = rows.filter((r) => presence(r.agent) === "offline");
  return (
    <>
      {live.length ? (
        <ul class="people">
          {live.map((r) => (
            <Person r={r} lang={lang} action={action} />
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
              <Person r={r} lang={lang} action={action} />
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
      const to = m.to.map((a) => (a.startsWith("thread:") ? _("the thread") : /^(user|agent):/.test(a) ? _("a teammate") : a)).join(", ");
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

export const InvitePage: FC<{
  team: string;
  role: string;
  email: string;
  name: string;
  valid: boolean;
  join?: { token: string; csrf: string };
  lang: Lang;
}> = ({ team, role, email, name, valid, join, lang }) => {
  const _ = (s: string) => t(lang, s);
  // A replacer function: a $ in the team name is not a replacement pattern.
  const heading = _("Join {team} on CodeTgh").replace("{team}", () => team);
  return (
    <PublicLayout lang={lang} title={heading}>
      {valid ? (
        <>
          <h1>{heading}</h1>
          <p>
            {_("Invited as")} <strong>{_(role)}</strong> {_("with")} {email}.
          </p>
          {join ? (
            <form id="invite-join" method="post" action={`/invite/${join.token}/join`}>
              <input type="hidden" name="csrf" value={join.csrf} />
              <button type="submit">{_("Join {team}").replace("{team}", () => team)}</button>
            </form>
          ) : (
            <>
              {/* A guest has no Tokens page: their terminal signs in through the browser (codetgh login). */}
              <form id="invite-signup" data-next={role === "guest" ? "/console" : "/console/tokens"}>
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
          )}
        </>
      ) : (
        <>
          <h1>{_("This invitation is no longer valid.")}</h1>
          <p>{_("Ask the person who invited you for a new link.")}</p>
        </>
      )}
    </PublicLayout>
  );
};
