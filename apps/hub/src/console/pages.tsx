/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Role } from "@codetgh/shared";
import { raw } from "hono/html";
import type { Child, FC } from "hono/jsx";
import type { JSX } from "hono/jsx/jsx-runtime";
import { BrandHead, Logo } from "../brand.js";
import { type listAgents, presence, statusOf } from "../domain/agents.js";
import { type Lang, t } from "../i18n.js";
import { Icon, type IconName } from "../icons.js";
import { HubAnswer, Layout as PublicLayout } from "../pages.js";
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

// "‹ Newer" and "Older ›" around a long list, with how much of it shows. A list whose way back goes to its first page, not
// to the page before, says "‹ Newest".
export const Pager: FC<{ lang: Lang; newer?: string; newest?: string; older?: string; shown?: number; total?: number }> = ({
  lang,
  newer,
  newest,
  older,
  shown,
  total,
}) => (
  <nav class="pager" aria-label={t(lang, "Pages")}>
    {shown !== undefined && total !== undefined && (
      <p class="meta">{t(lang, "Showing {shown} of {total}").replace("{shown}", String(shown)).replace("{total}", String(total))}</p>
    )}
    <div class="pager-links">
      {(newer ?? newest) && (
        <a class="button" href={newer ?? newest}>
          <Icon name="chevron-left" />
          {t(lang, newer ? "Newer" : "Newest")}
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
// under the bare label. With done, it says so in a toast after the reload, for a result the page does not show. In a table,
// name is the accessible name that says which row it acts on ("Revoke token laptop-cli…"); it starts with the label.
export const Action: FC<{
  post: string;
  label: string;
  vals?: Record<string, string>;
  level?: "primary" | "secondary" | "tertiary" | "danger";
  confirm?: { title: string; body: string };
  done?: string;
  name?: string;
}> = ({ post, label, vals, level, confirm, done, name }) => (
  <button
    type="button"
    class={level}
    aria-label={name}
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

// A count inside a sentence, kept with its noun: "1 open alert.", "3 open alerts.".
export const counted = (lang: Lang, n: number, one: string, many: string) => t(lang, n === 1 ? one : many).replace("{n}", String(n));

// Presence: who is connected, then the offline sessions under their count. Only exceptions get a pill (idle, prompts off,
// quarantined, external); online is plain text, and the offline group says so once, in its heading.
type AgentRow = Awaited<ReturnType<typeof listAgents>>[number];
type RowAction = (r: AgentRow) => Child;
const Person: FC<{ r: AgentRow; lang: Lang; action?: RowAction }> = ({ r, lang, action }) => {
  const _ = (s: string) => t(lang, s);
  const state = presence(r.agent);
  const status = statusOf(r.agent);
  // An external agent is quarantined by design: it says external, not quarantined.
  const external = r.agent.kind === "a2a";
  const bypass = r.agent.permissionMode === "bypassPermissions";
  const quarantined = r.agent.trustLevel === "quarantined" && !external;
  const meta: Child[] = [
    r.project,
    status &&
      (status.at ? (
        <>
          {status.text} · <When at={status.at} lang={lang} />
        </>
      ) : (
        status.text
      )),
    state === "offline" && (
      <>
        {_("Last seen")} <When at={r.agent.lastSeenAt} lang={lang} />
      </>
    ),
  ].filter(Boolean);
  return (
    <li class="person">
      <p class="person-head">
        <span class="person-name">{r.name}</span>
        {!external && <Chip>{r.agent.label}</Chip>}
        {state === "online" && <span class="person-state">{_("Online")}</span>}
        {state === "idle" && <Pill>{_("Idle")}</Pill>}
      </p>
      {meta.length > 0 && (
        <p class="person-meta">
          {meta.map((m, i) => (
            <>
              {i > 0 && " · "}
              {m}
            </>
          ))}
        </p>
      )}
      {(external || bypass || quarantined) && (
        <p class="person-flags">
          {external && <Pill>{_("External")}</Pill>}
          {bypass && <Pill tone="warn">{_("Prompts off")}</Pill>}
          {quarantined && <Pill tone="danger">{_("Quarantined")}</Pill>}
        </p>
      )}
      {action?.(r)}
    </li>
  );
};
// With cap, at most that many sessions, the live ones first, then more: the way to the whole list. With fold, the offline
// sessions wait in a disclosure of that id (its summary takes the id plus "-toggle"), so a live refresh keeps it open and
// keeps the keyboard on it.
export const People: FC<{
  rows: AgentRow[];
  lang: Lang;
  empty: Child;
  action?: RowAction;
  cap?: number;
  more?: Child;
  fold?: string;
}> = ({ rows, lang, empty, action, cap = rows.length, more, fold }) => {
  const live = rows.filter((r) => presence(r.agent) !== "offline");
  const offline = rows.filter((r) => presence(r.agent) === "offline");
  const shownOffline = offline.slice(0, Math.max(0, cap - live.length));
  const heading = counted(lang, offline.length, "1\u00a0offline", "{n}\u00a0offline");
  const archived = (
    <ul class="people archived">
      {shownOffline.map((r) => (
        <Person r={r} lang={lang} action={action} />
      ))}
    </ul>
  );
  return (
    <>
      {live.length ? (
        <ul class="people">
          {live.slice(0, cap).map((r) => (
            <Person r={r} lang={lang} action={action} />
          ))}
        </ul>
      ) : typeof empty === "string" ? (
        <p class="empty">{empty}</p>
      ) : (
        empty
      )}
      {offline.length > 0 &&
        (fold && shownOffline.length > 0 ? (
          <details id={fold} class="disclosure">
            <summary id={`${fold}-toggle`}>
              {heading}
              <Icon name="chevron-down" />
            </summary>
            {archived}
          </details>
        ) : (
          <>
            <h3 class="rule">{heading}</h3>
            {shownOffline.length > 0 && archived}
          </>
        ))}
      {rows.length > cap && <p class="people-more">{more}</p>}
    </>
  );
};

// The activity line, the console's one memorable element. Each person on the line gets a lane headed by the brand's caret;
// a message is an accent wire from the sender's lane (a dot for an agent, a diamond for a person) to the recipient's caret.
// The accent is kept for those wires: a message to the whole thread or team is the sender's mark on a gray bus, with a tick
// on every other lane. The text of each row says all the drawing says, so the drawing is hidden from assistive technology. A
// message new on screen traces its wire once (console.js marks it, the stylesheet draws it).
type Tr = ((s: string) => string) & { lang: Lang };
type Wire = { from: string; human: boolean; to: string[] | "all" };
type Msg = { id: string; createdAt: Date; kind: string; priority: string; authoredBy: string; to: string[]; threadId: string };
// At most ten lanes from 640 px and six under it; past that the people seen least recently share the last lane, "+n".
const MAX_LANES = 10;
const MAX_NARROW = 6;
export const LINE_CAP = 15;
export const LINE_PHONE = 10;
const WIRE_Y = 18; // the middle of the row's first line of text

const wireOf = (m: Pick<Msg, "authoredBy" | "to">, from: string): Wire => ({
  from,
  human: m.authoredBy !== "agent",
  to: m.to.some((a) => a.startsWith("thread:") || a === "@team") ? "all" : m.to.filter((a) => a.startsWith("@")).map((a) => a.slice(1)),
});
// One lane per person, in order of first appearance. Phones show the first rows only: when the people of those rows are not
// the wide set (past six, or someone only in the older rows), a second set is drawn for phones from those rows.
type LaneSet = { keys: string[]; wide: string[]; phoneKeys: string[]; narrow?: string[] };
const cap = (keys: string[], max: number) => (keys.length <= max ? keys : [...keys.slice(0, max - 1), `+${keys.length - max + 1}`]);
const keysOf = (wires: Wire[]) => [...new Set(wires.flatMap((w) => [w.from, ...(w.to === "all" ? [] : w.to)]))];
const lanesOf = (wires: Wire[]): LaneSet => {
  const keys = keysOf(wires);
  const phoneKeys = keysOf(wires.slice(0, LINE_PHONE));
  const wide = cap(keys, MAX_LANES);
  const narrow = cap(phoneKeys, MAX_NARROW);
  return { keys, wide, phoneKeys, narrow: narrow.join() === wide.join() ? undefined : narrow };
};
const laneOf = (lanes: string[], key: string) => {
  const i = lanes.indexOf(key);
  return i >= 0 || !lanes.at(-1)?.startsWith("+") ? i : lanes.length - 1;
};
// Geometry in SVG attributes (the CSP allows them), in percent of the lanes' width, which the stylesheet sets per screen.
const x = (i: number, n: number) => `${Math.round(((i + 0.5) / n) * 10000) / 100}%`;

const WireSvg: FC<{ lanes: string[]; wire: Wire; set?: "wide" | "narrow" }> = ({ lanes, wire, set }) => {
  const n = lanes.length;
  const s = laneOf(lanes, wire.from);
  const all = wire.to === "all";
  const to =
    wire.to === "all"
      ? lanes.map((_, i) => i).filter((i) => i !== s)
      : [...new Set(wire.to.map((k) => laneOf(lanes, k)))].filter((i) => i >= 0 && i !== s);
  const lo = Math.min(s, ...to);
  const hi = Math.max(s, ...to);
  return (
    <svg class={set ? `wire ${set}` : "wire"} aria-hidden="true" focusable="false">
      {lanes.map((_, i) => (
        <line class="lane" x1={x(i, n)} x2={x(i, n)} y1="0" y2="100%" />
      ))}
      {to.length > 0 && (
        <line
          class={all ? "bus" : "link"}
          x1={x(lo, n)}
          x2={x(hi, n)}
          y1={WIRE_Y}
          y2={WIRE_Y}
          transform-origin={`${Math.round(((s - lo) / (hi - lo)) * 100)}% 0`}
        />
      )}
      {to.map((i) =>
        all ? (
          <line class="tick" x1={x(i, n)} x2={x(i, n)} y1={WIRE_Y - 4} y2={WIRE_Y + 4} />
        ) : (
          <svg x={x(i, n)} y={WIRE_Y} overflow="visible" aria-hidden="true">
            <path class="caret" d={i > s ? "M-5 -5 0 0-5 5" : "M5 -5 0 0 5 5"} />
          </svg>
        ),
      )}
      {wire.human ? (
        <svg x={x(s, n)} y={WIRE_Y} overflow="visible" aria-hidden="true">
          <path class="end" d="M0 -5 5 0 0 5-5 0z" />
        </svg>
      ) : (
        <circle class="end" cx={x(s, n)} cy={WIRE_Y} r="4" />
      )}
    </svg>
  );
};

const Carets: FC<{ lanes: string[]; set?: "wide" | "narrow" }> = ({ lanes, set }) => (
  <svg class={set ? `wire heads ${set}` : "wire heads"} aria-hidden="true" focusable="false">
    {lanes.map((__, i) => (
      <>
        <svg x={x(i, lanes.length)} y="8" overflow="visible" aria-hidden="true">
          <path class="caret" d="M-3 -5 2 0-3 5" />
        </svg>
        <line class="lane" x1={x(i, lanes.length)} x2={x(i, lanes.length)} y1="18" y2="100%" />
      </>
    ))}
  </svg>
);

// Who a message went to, in words: a handle, the thread, the team, or a teammate the line cannot name.
const recipients = (to: string[], _: Tr) =>
  to
    .map((a) =>
      a.startsWith("thread:") ? _("the thread") : a === "@team" ? _("the team") : /^(user|agent):/.test(a) ? _("a teammate") : a,
    )
    .join(", ");
const PRIORITY: Record<string, string> = { low: "low priority", high: "high priority", blocking: "blocking" };

// The overview's line: the newest messages, each row one link to its thread. Wide screens show LINE_CAP rows, phones the
// first LINE_PHONE; the rest wait on the threads page. The head of the lanes stays in view while the line scrolls: a caret
// per person, the handles printed above them from 640 px (on two staggered rows, three past six people, so each name has
// the width of as many lanes), a caption naming them on phones.
type LineRow = { message: Msg; name: string; handle: string | null; subject: string | null };
export const Line: FC<{ rows: LineRow[]; _: Tr }> = ({ rows, _ }) => {
  const lanes = lanesOf(rows.map((r) => wireOf(r.message, r.handle ?? r.name)));
  const phone = lanes.narrow ?? lanes.wide;
  const named = phone.map((l, i) => (l.startsWith("+") ? `${l} (${lanes.phoneKeys.slice(i).join(", ")})` : l));
  // Names that fit one lane at its narrowest (28.8 px for ten lanes, 32 px under ten: four mono letters) stand on one row;
  // longer ones take turns on two, three past six people.
  const longest = Math.max(...lanes.wide.map((l) => l.length));
  const nameRows = longest <= (lanes.wide.length < MAX_LANES ? 4 : 3) ? 1 : lanes.wide.length > MAX_NARROW ? 3 : 2;
  // Each lane set its drawing: the wide one, and the phone's when it differs.
  const perSet = (draw: (lanes: string[], set?: "wide" | "narrow") => Child, onPhones = true) =>
    lanes.narrow ? [draw(lanes.wide, "wide"), onPhones && draw(lanes.narrow, "narrow")] : draw(lanes.wide);
  return (
    <div class="lanes" data-lanes={lanes.wide.length} data-narrow={lanes.narrow?.length}>
      <div class="lane-heads" aria-hidden="true">
        <p class="lane-caption">{_("Lanes: {names}").replace("{names}", () => named.join(", "))}</p>
        <p class="lane-names" data-rows={nameRows}>
          {Array.from({ length: nameRows }, (__, k) => (
            <span class="lane-row">
              {lanes.wide
                .filter((___, i) => i % nameRows === k)
                .map((l) => (
                  <span class="lane-name" translate="no">
                    {l}
                  </span>
                ))}
            </span>
          ))}
        </p>
        {perSet((l, s) => (
          <Carets lanes={l} set={s} />
        ))}
      </div>
      <ol class="line">
        {rows.map(({ message: m, name, handle, subject }, i) => {
          const wire = wireOf(m, handle ?? name);
          const to = recipients(m.to, _);
          const what = [m.kind !== "note" && _(m.kind), PRIORITY[m.priority] && _(PRIORITY[m.priority] ?? ""), subject].filter(Boolean);
          const who = m.authoredBy === "agent" ? _("{name}'s agent").replace("{name}", () => name) : name;
          return (
            <li class={i < LINE_PHONE ? "wire-row" : "wire-row later"} data-mid={m.id} data-summary={`${_("New message")}: ${who} → ${to}`}>
              {/* A row past the phone's first ones is hidden there: it needs no phone wire. */}
              {perSet(
                (l, s) => (
                  <WireSvg lanes={l} wire={wire} set={s} />
                ),
                i < LINE_PHONE,
              )}
              <a id={`line-${m.id}`} class="wire-text" href={`/console/threads/${m.threadId}`}>
                {/* The arrow keeps to the recipient: a narrow column breaks the line before it. */}
                <span class="wire-who">
                  <strong>{who}</strong> <span aria-hidden="true">→</span>
                  <span class="sr-only">{_("to")}</span>
                  {`\u00a0${to}`}
                </span>
                <Stamp at={m.createdAt} lang={_.lang} />
                {what.length > 0 && <span class="wire-what">{what.join(" · ")}</span>}
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export const Result: FC<{ children?: Child }> = ({ children }) => (
  <div class="result" role="status">
    {children}
  </div>
);

// The invited role, said in a sentence under the title that names the team; a guest also learns what a guest sees.
const INVITED_AS: Record<Role, string> = {
  owner: "You're invited as an owner.",
  admin: "You're invited as an admin.",
  member: "You're invited as a member.",
  guest: "You're invited as a guest. A guest sees only the threads they take part in.",
};
// The hub's refusals of a sign-up, in words.
const SIGN_UP_WORDS = {
  USER_ALREADY_EXISTS: "An account already uses this address. Sign in, then open this invitation again.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "An account already uses this address. Sign in, then open this invitation again.",
  FAILED_TO_CREATE_USER: "This invitation can't create an account any more. Ask the person who invited you for a new link.",
};

// Signed out, an account for the invited address, which shows as the account's sign-in; signed in with that address, Join
// and the account it uses; signed in with another, why not and the way to another account.
export const InvitePage: FC<{
  team: string;
  // Known whenever the invitation is valid.
  role?: Role;
  email: string;
  name: string;
  valid: boolean;
  join?: { token: string; csrf: string; user: string };
  lang: Lang;
}> = ({ team, role, email, name, valid, join, lang }) => {
  const _ = (s: string) => t(lang, s);
  // A replacer function: a $ in the team name is not a replacement pattern.
  const named = (s: string) => _(s).replace("{team}", () => team);
  const heading = named("Join {team}");
  return (
    <PublicLayout lang={lang} title={`${valid ? heading : _("This invitation is no longer valid.")} · CodeTgh`} ownError={valid && !join}>
      {valid ? (
        <>
          <h1>{heading}</h1>
          {role && <p class="lede">{_(INVITED_AS[role])}</p>}
          {join && email.toLowerCase() === join.user.toLowerCase() ? (
            <>
              <dl class="facts">
                <div>
                  <dt>{_("Signed in as")}</dt>
                  <dd>{join.user}</dd>
                </div>
              </dl>
              <form id="invite-join" method="post" action={`/invite/${join.token}/join`}>
                <input type="hidden" name="csrf" value={join.csrf} />
                <button type="submit" class="primary">
                  {heading}
                </button>
              </form>
            </>
          ) : join ? (
            // Another address: the hub refuses a Join (it compares the two, ignoring case), so the page offers none and says
            // why first. Display only; the hub keeps the rule.
            <>
              <Banner tone="warn" title={_("This invitation is for another email address.")}>
                {_("It was sent to {email}. You're signed in as {user}.").replace(/\{(email|user)\}/g, (_m, k) =>
                  k === "email" ? email : join.user,
                )}
              </Banner>
              <p>
                <a class="button primary" href="/login">
                  {_("Sign in with another account")}
                </a>
              </p>
            </>
          ) : (
            <>
              {/* A guest has no Tokens page: their terminal signs in through the browser (codetgh login). */}
              <form id="invite-signup" data-next={role === "guest" ? "/console" : "/console/tokens"}>
                {/* The address is not typed: it shows whole, as text that wraps. The sign-up script and password managers
                    read it from a field out of sight and out of the tab order, as Chromium documents for a known username. */}
                <div class="field">
                  <p class="label">{_("Email")}</p>
                  <p class="help">{_("Your account uses the address the invitation was sent to.")}</p>
                  <p class="value" translate="no">
                    {email}
                  </p>
                </div>
                <input name="email" type="email" value={email} autocomplete="username" hidden />
                <Field id="invite-name" label={_("Your name")} lang={lang}>
                  <input id="invite-name" name="name" required maxlength={60} value={name.slice(0, 60)} autocomplete="name" />
                </Field>
                <Field id="invite-password" label={_("Password")} lang={lang} help={_("At least 12 characters.")}>
                  <input
                    id="invite-password"
                    name="password"
                    type="password"
                    required
                    minlength={12}
                    autocomplete="new-password"
                    {...fieldAria("invite-password", { help: 1 })}
                  />
                </Field>
                <HubAnswer lang={lang} words={SIGN_UP_WORDS} />
                <button type="submit" class="primary">
                  {_("Create my account")}
                </button>
              </form>
              <p class="aside">
                {_("Already have an account?")} <a href="/login">{_("Sign in")}</a>
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <h1>{_("This invitation is no longer valid.")}</h1>
          <p class="lede">{_("Ask the person who invited you for a new link.")}</p>
          <p class="aside">
            {_("Already have an account?")} <a href="/login">{_("Sign in")}</a>
          </p>
        </>
      )}
    </PublicLayout>
  );
};
