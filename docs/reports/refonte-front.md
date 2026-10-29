# Console front redesign: design plan

Date: 2026-10-28, updated 2026-10-29. Status: passed gate A. The owner delegated every open question ("Fais tout comme tu penses être le mieux"); the decisions are in sections 11 and 12, marked "Decided at gate A", and in `docs/BRAND.md` (« Interface de la console »). The foundations batch (branch `refonte/fondations`) builds sections 2, 3.1, 3.2, 5 and 6; each screen batch then restyles its screens on top of them.

Base: `origin/main` e356d2b, branch `refonte/prototype`. Inputs: the owner's brief, the step 0 inventory (59 views × 8 combinations = 472 full-page captures, plus measurements per page, summarized in appendix A), the research notes (sources in section 13), `docs/BRAND.md` and `assets/brand/`. All captures and examples use the fictitious demo team "Acme web" (`*@acme.test`).

Locked constraints, restated so every section can be checked against them: Hono JSX + htmx 2, no front build, one stylesheet served by the hub, CSP `default-src 'self'` (no inline script or style, no `style=""`, nothing external), brand palette Teal / Mint / Ink / Paper plus success, warning and error only, Inter self-hosted, `ui-monospace` for code, WCAG AA measured, full keyboard use, `prefers-reduced-motion` and `prefers-color-scheme`, no horizontal scroll at 360 px, color never alone, every string in `apps/hub/src/i18n.ts`, one icon family as the only new dependency. Business logic, routes, field names, htmx attributes, schemas, auth and security do not change.

---

## 1. Framing

1. **What it is.** The console of a CodeTgh hub: the relay that links the Claude Code sessions of one team, and where people see who is connected, what the agents say to each other, and what needs a human.
2. **For whom.** Students and developers working on a group project, plus one administrator (often one of them) who runs the hub and answers for its safety.
3. **The main job of each screen** is in the table below: one screen, one job, and the layout puts that job first.
4. **The world it belongs to.** A terminal and its command line, a relay that passes messages along, and a round table where every agent faces the same project (the three carets of the logo).

| Screen | Who | Main job |
| --- | --- | --- |
| Sign in | anyone | Get in with the team's sign-in method |
| Invitation | invitee | Create an account, or join the team the link names |
| OAuth consent | member | Decide whether a client gets access, knowing what it gets |
| Device | member | Approve the terminal that shows this code, or deny it |
| Overview | everyone | See what needs me, then what the agents are saying right now |
| Threads | member | Find the conversation that needs a reply |
| Thread | member | Read the exchange, reply as a person, or mute a loop |
| Alerts | admin | Decide on each flagged message |
| Agents | everyone | See which sessions are connected and act on a risky one |
| Projects | member | See sessions per repository; start Remote Control or the runner |
| Delegations | member | See which sessions act without a human, turn one off |
| Tasks | member | See who does what; create a task |
| Claims | member | See who holds which file; release a stale claim |
| Memory | member, admin | Accept or reject proposed team decisions |
| Members | admin | Invite people and set roles |
| Tokens | member | Create a token for a terminal, revoke old ones |
| My data | everyone | Set my display name, link Slack, erase my data |
| Audit | admin | Check who did what; verify the chain |
| Settings | admin | Set agent rules and bridges |
| Live feed | everyone | No screen of its own: know the console is live; new messages trace on the line |

---

## 2. Tokens

### 2.1 Color

Every value is a brand token or a `color-mix(in srgb, …)` of brand tokens, except the six state colors the brief allows. Components use the semantic names, never `--teal` or `--mint` directly.

**Rules that the numbers below force:**

- **Teal text sits only on Paper and white.** Teal reaches 4.55:1 on Paper, 4.90:1 on white, and drops under 4.5:1 on any darker surface: mixing even 1 % of Ink into Paper breaks it (the script finds the limit at 0.5 %). In light mode, links and the tertiary button label are Teal only on `--surface` (Paper) and `--surface-raised` (white). On every tinted surface, links use `--text` with an underline. The same markup is used in dark mode, where Mint would pass everywhere: one rule, no theme-specific markup.
- **White raises a surface in light mode** (decided at gate A, Q1). Panels, menus, dialogs, toasts and the public column are white with a border; the page stays Paper. The primary button's label is white on Teal (Q2).
- **The accent is scarce.** Teal (light) or Mint (dark) marks: the one primary button of an area, links in running text, the focus ring, the current-page and selected-tab markers, and the wires of the activity line. Everything else is Ink and Paper.
- **States never rely on color alone.** A state is a word; a dot, an icon shape or a rule only reinforces it.

**Tokens** (as `apps/hub/public/console.css` declares them, resolved; `apps/hub/test/contrast.test.ts` reads the same file):

| Token | Light | Dark |
| --- | --- | --- |
| `--surface` | `#F4F7F6` | `#0D1B1A` |
| `--surface-raised` | `#FFFFFF` | `#1D2A29` |
| `--surface-inset` | `#EBEEED` | `#162423` |
| `--border` | `#CFD4D3` | `#374342` |
| `--border-strong` | `#7C8584` | `#757E7D` |
| `--text` | `#0D1B1A` | `#F4F7F6` |
| `--text-muted` | `#4E5958` | `#B3B9B8` |
| `--accent` | `#087F70` | `#3EE6C1` |
| `--accent-hover` | `#096B5F` | `#75EBD1` |
| `--on-accent` | `#FFFFFF` | `#0D1B1A` |
| `--success` | `#4A6800` | `#B8DA6B` |
| `--warning` | `#8A5000` | `#F4B04F` |
| `--error` | `#B42318` | `#FF9C8F` |
| `--error-hover` | `#932118` | `#FCB7AE` |
| `--on-error` | `#FFFFFF` | `#0D1B1A` |
| `--success-soft` | `#E3E9DD` | `#253625` |
| `--warning-soft` | `#E9E6DD` | `#2D3021` |
| `--error-soft` | `#EEE2E0` | `#2F2D2A` |
| `--accent-soft` | `#DCEBE9` | `#143731` |

`--surface-raised`, `--on-accent` and `--on-error` are white in light mode (Q1, Q2); `--accent-hover` and `--error-hover` are the pressed and hovered fills of the primary and destructive confirming buttons. Soft tints are the state color at 10 % (light) or 14 % (dark) in the page.

Notes:

- `--surface-inset` holds the light sidebar, code blocks, hovered and selected rows, and read-only fields. In dark mode it is one step lighter than the page, as Carbon and Atlassian layer dark surfaces.
- The light warning and error values and the dark error value are the ones the console already ships. Success is new in both themes: the shipped greens (`#2E6B2E`, `#8FD694`) sat 28° to 37° of OKLCH hue from Teal and Mint and read as the brand; the new ones sit 47° or more away (hue table below). The dark warning moves from `#F2C14E` (85°) to `#F4B04F` (73°) so it stays apart from the new, yellower success (39° apart before, 51° now).
- `--border` (1.39:1 light, 1.71:1 dark) is decorative. It separates rows where alignment already gives the structure. Wherever a rule is the only thing that says something, it uses `--border-strong` (3.24:1 or more), see section 2.5.

**Contrast of every pair** (WCAG 2.x, truncated to two decimals; `apps/hub/test/contrast.test.ts` computes them from the stylesheet and fails under the minimum; thresholds: 4.5:1 text, 3:1 large text, UI components and graphics):

| Foreground on background | Use | Min | Light | Dark |
| --- | --- | --- | --- | --- |
| `text` on `surface` | body text, titles, table cells | 4.5:1 | 16.38 | 16.38 |
| `text` on `surface-raised` | dialogs, menus, toasts, panels | 4.5:1 | 17.66 | 13.69 |
| `text` on `surface-inset` | code, sidebar, hovered or current row, banner body | 4.5:1 | 15.14 | 14.88 |
| `text-muted` on `surface` | metadata, captions, column headers | 4.5:1 | 6.77 | 8.91 |
| `text-muted` on `surface-raised` | metadata in panels and dialogs | 4.5:1 | 7.30 | 7.44 |
| `text-muted` on `surface-inset` | sidebar links, metadata in a current row | 4.5:1 | 6.25 | 8.09 |
| `accent` on `surface` | links, tertiary buttons | 4.5:1 | 4.55 | 11.18 |
| `accent` on `surface-raised` | links in panels, dialogs and public pages | 4.5:1 | 4.90 | 9.34 |
| `on-accent` on `accent` | primary button label | 4.5:1 | 4.90 | 11.18 |
| `on-accent` on `accent-hover` | primary button label, hovered | 4.5:1 | 6.40 | 12.25 |
| `on-error` on `error` | confirming button of a destructive dialog | 4.5:1 | 6.57 | 8.75 |
| `on-error` on `error-hover` | the same, hovered | 4.5:1 | 8.50 | 10.54 |
| `success` on `surface` | success pill | 4.5:1 | 5.95 | 11.17 |
| `warning` on `surface` | warning pill, reconnecting | 4.5:1 | 6.03 | 9.39 |
| `error` on `surface` | error pill, field error, destructive trigger | 4.5:1 | 6.09 | 8.75 |
| `success` on `surface-inset` | pill in a hovered or current row | 4.5:1 | 5.50 | 10.14 |
| `warning` on `surface-inset` | pill in a hovered or current row | 4.5:1 | 5.57 | 8.53 |
| `error` on `surface-inset` | pill in a hovered or current row | 4.5:1 | 5.63 | 7.95 |
| `success` on `surface-raised` | pill in a panel | 4.5:1 | 6.41 | 9.33 |
| `warning` on `surface-raised` | pill in a panel | 4.5:1 | 6.50 | 7.85 |
| `error` on `surface-raised` | field error and destructive trigger in a panel or dialog | 4.5:1 | 6.57 | 7.31 |
| `text` on `success-soft` | success banner | 4.5:1 | 14.24 | 11.96 |
| `text` on `warning-soft` | warning banner | 4.5:1 | 14.19 | 12.51 |
| `text` on `error-soft` | error banner | 4.5:1 | 13.92 | 12.72 |
| `text` on `accent-soft` | selected filter | 4.5:1 | 14.39 | 11.95 |
| `error` on `error-soft` | error text inside an error banner | 4.5:1 | 5.18 | 6.79 |
| `border-strong` on `surface` | input, secondary button, rule under a table header | 3:1 | 3.52 | 4.23 |
| `border-strong` on `surface-raised` | input in a panel or dialog | 3:1 | 3.80 | 3.54 |
| `border-strong` on `surface-inset` | rule on an inset surface | 3:1 | 3.26 | 3.84 |
| `accent` on `surface-inset` | focus ring and current-page bar in the sidebar | 3:1 | 4.20 | 10.15 |
| `accent` on `success-soft` | focus ring inside a success banner | 3:1 | 3.95 | 8.16 |
| `accent` on `warning-soft` | focus ring inside a warning banner | 3:1 | 3.94 | 8.54 |
| `accent` on `error-soft` | focus ring inside an error banner | 3:1 | 3.86 | 8.68 |
| `success` on `surface` | live dot, success icon | 3:1 | 5.95 | 11.17 |
| `warning` on `warning-soft` | warning banner edge and icon | 3:1 | 5.22 | 7.17 |
| `error` on `error-soft` | error banner edge and icon | 3:1 | 5.18 | 6.79 |
| `success` on `success-soft` | success banner edge and icon | 3:1 | 5.17 | 8.15 |
| `text-muted` on `surface` | hollow dot, timeline rule | 3:1 | 6.77 | 8.91 |
| `border` on `surface` | Row hairline: decorative, never the only carrier | none | 1.39 | 1.71 |

**Rejected pairs and what replaces them** (all four fail in light mode only; the replacement applies in both themes):

| Rejected | Ratio | Replacement |
| --- | --- | --- |
| Teal link on an inset surface (sidebar, hovered row, code block) | 4.20 | Link in `--text` with an underline (16.38 / 15.12). Table rows link through their primary cell in `--text` anyway (section 5.5). |
| Teal label on a selected chip (`--accent-soft`) | 3.99 | Label in `--text` at 600 (14.38), a 1 px `--accent` edge (4.55 against the page) and a check icon: the selection reads in three ways, none of them a hue. |
| Teal link inside a warning banner | 3.93 | Link in `--text` with an underline (14.15). |
| Teal link inside an error banner | 3.87 | Link in `--text` with an underline (13.95). |

Smallest accepted margins, to watch in every capture: Teal on Paper at 4.55 (links on the page), white on Teal at 4.90 (the primary label), `border-strong` on the light inset surface at 3.26.

**State colors stay apart from the brand** (OKLCH hue; Teal 181°, Mint 174°):

| Theme | State | Hex | Hue | Gap to Teal | Gap to Mint |
| --- | --- | --- | --- | --- | --- |
| light | success | `#4A6800` | 127° | 54° | 47° |
| light | warning | `#8A5000` | 64° | 116° | 110° |
| light | error | `#B42318` | 30° | 151° | 145° |
| dark | success | `#B8DA6B` | 124° | 57° | 51° |
| dark | warning | `#F4B04F` | 73° | 107° | 101° |
| dark | error | `#FF9C8F` | 28° | 152° | 146° |

The theme follows `prefers-color-scheme` only, with `color-scheme: light dark` on the root. A manual switch would need a script that runs before paint, which the CSP forbids inline; it is not part of this redesign.

### 2.2 Type scale

Inter is already self-hosted as a variable font. The two shipped subsets were parsed (their `fvar` table, appendix B): both carry `opsz` 14 to 32 and `wght` 100 to 900. `font-optical-sizing: auto` stays on the body; the two large roles force `font-variation-settings: "opsz" 32`, which is Inter Display. No second font file is needed.

| Role | Size / line height | Weight | Optical size | Tracking | Used for |
| --- | --- | --- | --- | --- | --- |
| `display` | 40/44 (32/36 under 640 px) | 600 | 32, Inter Display | −0.025em | The H1 of public pages only |
| `title` | 28/32 | 600 | 32, Inter Display | −0.02em | Page H1 in the console |
| `heading` | 20/28 | 600 | auto (20) | −0.01em | Section H2 |
| `subheading` | 16/24 | 600 | auto | 0 | H3, panel titles, empty-state titles, dialog titles |
| `body` | 14/20 | 400 | auto (14) | 0 | Interface text, table cells, forms |
| `reading` | 14/22 | 400 | auto | 0 | Message bodies, descriptions, help paragraphs: same size, more leading |
| `label` | 14/20 | 500 | auto | 0 | Buttons, navigation, field labels |
| `caption` | 12/16 | 400; 500 for column headers | auto | 0 | Metadata, help text, column headers, pill text |
| `mono` | 13/20 in body text, 12/16 in captions | 400 | none | 0 | Handles, ids, hashes, commands, code, paths: `ui-monospace, "JetBrains Mono", monospace` |

- **Real jumps.** 12, 14, 16, 20, 28, 40: each step is 1.14 to 1.43 times the one below, and there is no 15/16/17 run. Today's scale renders 40 / 24 / 16 / 15 / 14 / 13.1 / 13 / 11.4 px, the 16 and 11.4 coming from quirks mode and a mono id.
- **Contrasted weights.** 400 for reading, 500 for things you press or name, 600 for titles. Nothing at 650 or 700 (the current H1 is 700, the H2 650). Inter Display at 600 against a 400 body gives the contrast the brief asks for without going heavy.
- **Numbers.** `font-variant-numeric: tabular-nums` on tables, times, counts and the agent streak.
- **Prose is never mono.** Message bodies, alert excerpts and notes move from mono to `reading`, with `white-space: pre-wrap` so the agent's line breaks and lists survive. Mono stays for what a machine reads: handles, ids, hashes, commands, file paths. Trade-off accepted: a diff pasted inside a message loses column alignment; the memory diff, which is a real diff, stays mono.
- **Inputs** use 16 px on coarse pointers so iOS does not zoom the page.
- **Brand note.** The wordmark is drawn in Inter Display Medium and Bold. To keep a typed title from passing for a retyped logo, no display-size title contains the word CodeTgh ("Sign in", not "Sign in to CodeTgh", under the stacked lockup).

### 2.3 Spacing grid

4 px base. Tokens `--sp-1` to `--sp-16`: **4, 8, 12, 16, 24, 32, 48, 64**. No other value in the stylesheet.

| Range | Values | Where |
| --- | --- | --- |
| Inside a row | 4, 8 | Icon to text, pill padding, cell padding, gap between a label and its field |
| Inside a component | 12, 16, 24 | Button padding, panel padding (16 at 360, 24 above), form field to field (16) |
| Between sections | 32, 48, 64 | Section to section (32), page header to content (24 at 360, 32 above), public page blocks (48) |

Page gutters: 16 px under 768, 24 px from 768, 32 px from 1280. Control heights: 32 px in dense rows, 40 px in forms, at least 44 px on `pointer: coarse`. Table rows: 32 px (condensed: audit, claims, tasks), 40 px (regular: members, tokens, agents, delegations), 56 px (two lines: threads, alerts, audit in its two-line form). More space means more importance; the same spacing everywhere would flatten the page (Carbon, Atlassian).

### 2.4 Radius policy

Radius grows with the size of the thing and says what kind of thing it is. A child's radius is its parent's minus the padding between them, never more.

| Token | Value | Where | Why |
| --- | --- | --- | --- |
| `--r-0` | 0 | Table rows, rules, the sidebar, the top bar, the lanes of the line | Structure is lines, not objects |
| `--r-xs` | 4 px | Handle chip, `kbd`, inline code, checkbox, agent-streak ticks | Small tokens look like terminal tokens, not pills |
| `--r-sm` | 6 px | Buttons, inputs, selects, navigation items, menu items, row focus outline | Controls |
| `--r-md` | 8 px | Panels, code blocks, banners, toasts, the "Needs you" list | Containers |
| `--r-lg` | 12 px | Dialogs, menus, the public sign-in panel | Outermost floating or framing layers |
| `--r-full` | 999 px | Status pill, status dot | The pill shape means "state": only states get it |

No pill-shaped button anywhere: a rounded-full shape on a button would read as a state.

### 2.5 Elevation policy

Default: no shadow. Depth comes from spacing, from one tonal step and from 1 px rules.

| Level | Surface | Edge | Shadow | Where |
| --- | --- | --- | --- | --- |
| Flat | `--surface` | none, or a hairline below | none | Page, tables, the line, sidebar in dark mode |
| Inset | `--surface-inset` | none | none | Sidebar in light mode, code blocks, hovered and selected rows, read-only fields |
| Panel | `--surface-raised` | 1 px `--border` | none | Panels on form pages, the "Needs you" list, the sign-in panel from 768 px |
| Overlay | `--surface-raised` | 1 px `--border-strong` | `--shadow-overlay` | Dialog, menu, toast: the only shadows in the console |

`--shadow-overlay` is `0 8px 24px` of Ink at 16 % in light mode and Ink at 60 % in dark mode, where the border does most of the work (Tailscale's dark-mode lesson). The dialog backdrop is Ink at 40 % (light) or 70 % (dark), with no blur.

**Rules that carry information** use `--border-strong` or the accent, never the decorative hairline:

- the rule under a table header separates labels from data;
- the "Earlier" rule on the line: everything below it is more than 24 hours old;
- the lanes of the line are people; the wires across them are messages (section 4);
- the current page: a 2 px accent bar left of the navigation item, plus weight 600;
- the selected tab or filter: a 2 px accent underline, plus weight 600;
- the current or selected table row: a 2 px accent rule on its left edge;
- the danger panel: a straight 2 px `--error` rule on its left edge (a top border on a rounded box tapers at the corners), plus an error icon and a title that names the risk, shown only while the risk is real (agent traffic takes it only when stopped);
- an invalid field: an `--error` border, plus an icon and a sentence.

### 2.6 Motion

- **One expressive motion:** a new message traces its wire on the line, from the sender's caret to the recipient's caret (or its gray bus, for a message to the whole thread), once, 300 ms, ease-out (section 4). It keeps today's `trace` keyframes and duration, which `e2e/console/line.spec.ts` checks.
- **Functional motion only otherwise:** the loading bar of a region and the busy icon of a button, both shown only after a delay (section 5.13).
- **Hover** changes `color` or `background-color` only, in 100 ms at most; never `transform`, never `transition: all`.
- **No motion** on toasts, dialogs, menus or page loads: they appear.
- **`prefers-reduced-motion: reduce`** sets every animation to `none`; the loading bar becomes a still bar with the visible text "Loading…".

---

## 3. Layout

### 3.1 App shell

From 1024 px: a side navigation, a top bar over the content, then the content.

- **Side navigation, 232 px**, full height, sticky. The horizontal lockup at the top (44 px tall, 128 px wide: above the 120 px minimum, with the "C" height of clear space around it). Light mode puts it on `--surface-inset` so the work area wins (Linear's 2026 refresh); dark mode keeps Ink with a right hairline, since the palette has nothing darker than Ink. Links in `--text-muted` at 500; the current page in `--text` at 600 on a `--surface` lift with a 2 px accent bar. No icons in front of the labels (section 8). Three groups, split by space and a hairline, without group titles, ordered by how often they are used:
  - Overview, Threads, Alerts (admin), Agents, Projects;
  - Tasks, Claims, Memory, Delegations;
  - Members, Audit, Settings (admin).

  The existing role filter stays: no link to a page that would answer 403.
- **Top bar, 56 px**, over the content column, with a bottom hairline, not sticky (it would take height from 360 px screens). Left: the team name. Right: the live state ("Live", "Reconnecting…", "Offline since 21:40"), then the account menu (`Léa · owner ▾`: My data, Tokens, the language switch). The block "name · role · team" and the language link leave the bottom of the sidebar. When agent traffic is stopped, a page banner sits right under the top bar on every page (section 5.8).
- **Content.** Page header first: H1 in `title`, an optional one-line description in `--text-muted`, and at most one page-level action on the right (secondary unless it is the page's main job). Then the page. Tables use the full content width up to 1200 px; text does not (section 3.3). Detail pages (thread, task, memory item) add a 320 px properties column on the right from 1280 px; under that it folds into a meta line below the title.

### 3.2 Mobile and narrow screens

- **Under 1024 px** the sidebar goes away. The top bar becomes an app bar: the symbol (32 px; `symbol-color.svg`, `symbol-mint-thin.svg` in dark), the team name (truncated with the full name in `title` and readable by screen readers), the live dot with its word, and a **Menu** button (44 × 44). This fixes 768 px, today's worst width (216 px of sidebar left 488 px for tables).
- **The menu** is a native `<details>`/`<summary>`: no script, keyboard and screen-reader friendly. Open, it pushes the content down with the three groups as full-width 44 px rows, then the account items. A small handler in `console.js` closes it on Escape. It replaces today's single row of 14 links (1175 px wide in 328 px in English, 1301 px in French).
- **Under 640 px** tables become stacked records (section 5.5): a primary line, a meta line, the status pill, then the actions. Empty cells are dropped. Records are separated by `--border-strong` (today's 1.46:1 hairline was the only structure and nearly invisible).
- **No horizontal page scroll at 360 px**, in English and French: long ids, handles, branch names and URLs wrap with `overflow-wrap: anywhere`; filter rows wrap; the project filter becomes a menu; code blocks wrap.
- **The order of the overview** under 1280 px is a single column: Needs you, the line, Presence, Agent traffic.

### 3.3 Reading width and alignment

- Paragraphs, help text, empty-state text and message bodies: at most **56 ch** (Inter at 14 px: 78 characters at most on the demo thread, under the 80-character limit; 72 ch measured 86 characters in the first prototype, 60 ch still 81). Form fields: at most 32 rem.
- Everything is left-aligned. Numbers in table columns are right-aligned. Nothing in the console is centered or justified. On public pages the column is centered on the screen, as BRAND.md asks for the stacked lockup, but its text stays left-aligned.
- Today's mix (lists capped at 80 ch, tables full width, "Offline" rules full width) becomes one rule: rules span the block they belong to, never more.

### 3.4 Wireframes

Glyphs in the sketches: `▌` current marker, `●` sender end of a wire for an agent, `◆` for a person, `>` and `<` the recipient caret, `┿` a tick on a lane for a message to the whole thread, `▸` a closed disclosure, `▲` warning icon, `■` error icon, `○` neutral dot, `✓` success icon, `▮▯` agent-streak ticks, `[ … ]` a button.

**Sign in, 1280 px and 360 px** (gate A prototype)

```
1280: a 400 px column, centered; framed by a panel (radius 12, 1 px border) from 768 px.
360: full width minus 16 px gutters, no frame.

          ┌──────────────────────────────────────────┐
          │           [stacked lockup, 120 px]       │  centered, clear space 1 × "C"
          │                                          │
          │ Sign in                                  │  display 40/44 (32/36 at 360)
          │ Use the account your team set up on      │  body, muted, one line of context
          │ this hub.                                │
          │                                          │
          │ [          Continue with GitHub        ] │  primary, full width, 44 px
          │ [          Continue with Google        ] │  secondary
          │ ──────────────────── or ──────────────── │  hairline + muted "or"
          │ Email                                    │
          │ [                                      ] │
          │ Password                                 │
          │ [                                      ] │
          │ ■ The email or password is wrong.        │  inline, under the fields, aria-describedby
          │   Check both, then try again.            │
          │ [ Sign in ]                              │  secondary while a provider exists
          │                                          │
          │ ▸ Get a sign-in link by email instead    │  <details> holding the magic-link form
          └──────────────────────────────────────────┘
```

One primary action per page: the first configured provider. With no provider, "Sign in" becomes primary. The magic-link form keeps its id and its own field, but it is folded, so the page no longer shows two email fields.

**Overview, 1280 px, admin** (gate A prototype)

```
┌──────────────────────┬────────────────────────────────────────────────────────────────────────────────────┐
│ [lockup 128 × 44]    │ Acme web                                           ● Live        Léa · owner ▾      │ top bar 56
│                      ├────────────────────────────────────────────────────────────────────────────────────┤
│ ▌Overview            │ Overview                                                                           │ title 28/32
│  Threads             │                                                                                    │
│  Alerts              │ Needs you                                                                          │ heading 20/28
│  Agents              │ ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  Projects            │ │ ▲ 4 open alerts. Newest: secret blocked, 2 min ago.          Review alerts  ›  │ │ row 48, whole row links
│ ──────────────────── │ ├────────────────────────────────────────────────────────────────────────────────┤ │
│  Tasks               │ │ ○ 3 memory proposals wait for a decision.                    Review memory  ›  │ │
│  Claims              │ ├────────────────────────────────────────────────────────────────────────────────┤ │
│  Memory              │ │ ○ 3 invitations not accepted yet.                            Open members   ›  │ │
│  Delegations         │ └────────────────────────────────────────────────────────────────────────────────┘ │
│ ──────────────────── │                                                                                    │
│  Members             │ On the line                            Last 24 h │ Presence             5 online   │
│  Audit               │  lea   sam   malik  nora  theo                   │ Léa      lea@main      ● Online │
│  Settings            │   >     >     >      >     >                     │          acme/webapp ·          │
│                      │   │     ●━━━━━━>     │     │  Sam → @malik  21:36 │          Reviewing PR #42       │
│                      │   │     │     │      │     │  question · Release… │ Malik    malik@fix/…   ● Online │
│                      │   <━━━━━━━━━━━●      │     │  Malik → @lea  21:35 │ Sam      sam@feat/…    ● Online │
│                      │   │     │     │      │     │  answer · Invoice…   │          ▲ Permission prompts off│
│                      │   ●━━━━━┿━━━━━┿━━━━━━┿━━━━━┿  Léa → thread  21:10 │ Nora     nora@main     ○ Idle   │
│                      │   │     │     │      │     │  status · Release…   │ Partner bot  External           │
│                      │   ◆━━━━━━>    │      │     │  Léa → @sam    20:51 │          ■ Quarantined          │
│                      │   …                                              │ ▸ Offline (2)                   │
│                      │ ──────────────────── Earlier ─────────────────── │                                 │
│                      │   (same rows, wires in muted gray)               │ Agent traffic                   │
│                      │                                                  │ Flowing. Stopping it holds      │
│                      │                                                  │ every agent message at once.    │
│                      │                                                  │ Reason                          │
│                      │                                                  │ [                             ] │
│                      │                                                  │ [ Stop agent traffic… ]         │
└──────────────────────┴──────────────────────────────────────────────────┴─────────────────────────────────┘
```

- "Needs you" lists only what exists: open alerts (admin), memory proposals (people who can decide), pending invitations (admin), threads muted by the loop guard. Nothing to do: one line, "Nothing needs you right now." No three-tile row of counts.
- Each line row is one link to its thread; its accessible name is the row's sentence ("Sam's agent to @malik, question, Release 0.9 checklist, 21:36"). The 30 "Open thread" links disappear. The row shows the thread subject when it has one, which tells one thread from another.
- Presence shows exceptions as pills on their own line (permission prompts off, quarantined, paused) and nothing for the normal state: "trusted" is never displayed.
- Agent traffic is a short section with a stated consequence, not a plain form at the bottom of a list. The "Reason" field stays in the section (tests use its label); the button asks for confirmation in a dialog before the request leaves. While traffic is stopped, the section holds the typed-"yes" resume form instead.

**Overview, 360 px**

```
┌────────────────────────────────────┐
│ [sym 32]  Acme web   ● Live  [≡]   │ app bar 56; [≡] = <details> Menu, 44 × 44
├────────────────────────────────────┤
│ Overview                           │ title 28/32
│                                    │
│ Needs you                          │
│ ▲ 4 open alerts                 ›  │ 48 px rows, whole row links
│ ○ 3 memory proposals            ›  │
│ ○ 3 invitations pending         ›  │
│                                    │
│ On the line            Last 24 h   │
│ Lanes: lea, sam, malik, nora, theo │ caption: names the lanes left to right
│  > > > > >                         │ lane heads, 14 px pitch
│  │ ●━> │ │  Sam → @malik    21:36  │
│  │ │ │ │ │  question · Release…    │
│  <━━━● │ │  Malik → @lea    21:35  │
│  │ │ │ │ │  answer · Invoice…      │
│  …                                 │
│ ───────────── Earlier ──────────── │
│                                    │
│ Presence               5 online    │
│ Léa   lea@main          ● Online   │
│ …                                  │
│ ▸ Offline (2)                      │
│                                    │
│ Agent traffic                      │
│ Flowing.                           │
│ Reason                             │
│ [                                ] │
│ [ Stop agent traffic… ]            │
└────────────────────────────────────┘
```

Today "Needs you" starts about 2 300 px down a 3 306 px page at 360 px; here it starts under the title.

**Thread, 1280 px** (gate A prototype)

```
┌──────────────────────┬────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar (▌Threads)   │ Acme web                                           ● Live        Léa · owner ▾      │
│                      ├────────────────────────────────────────────────────────────────────────────────────┤
│                      │ ‹ Threads                                                                          │
│                      │ Release 0.9 checklist                                              [ Mute thread ]  │ title + one action
│                      │ Team thread · acme/webapp · ○ Open · Agent streak 1 of 5  ▮▯▯▯▯                   │
│                      │                                                       │ Participants               │
│                      │  lea   sam   malik  nora                              │ @lea @sam @malik @nora     │
│                      │   >     >     >      >                                │                            │
│                      │   ●━━━━━┿━━━━━┿━━━━━━┿  Léa · agent  lea@main  18:36  │ Started  28 Oct, 18:36     │
│                      │   │     │     │      │  Release 0.9 checklist         │ Last     21:10             │
│                      │   │     │     │      │  Freeze on Thursday 18:00.     │ Messages 14                │
│                      │   │     │     │      │  Before that:                  │                            │
│                      │   │     │     │      │  - login errors under each…    │                            │
│                      │   │     ●━━━━━┿━━━━━━┿  Sam · agent  sam@feat/… 18:41 │                            │
│                      │   │     │     │      │  status                        │                            │
│                      │   │     │     │      │  Login form is in review…      │                            │
│                      │   ●━━━━━┿━━━━━┿━━━━━━┿  Léa · agent  lea@main  19:02  │                            │
│                      │   │     │     │      │  ┌ ▲ Looks like an instruction ┐│                            │
│                      │   │     │     │      │  │ The hub flagged this text.  ││                            │
│                      │   │     │     │      │  │ It is shown, never run.     ││                            │
│                      │   │     │     │      │  └─────────────────────────────┘│                            │
│                      │   │     │     │      │  Ship it in 0.10. Three…       │                            │
│                      │   ◆━━━━━┿━━━━━┿━━━━━━┿  Léa · person          20:51   │                            │
│                      │   │     │     │      │  Looks good. Tagging Friday.   │                            │
│                      │ ───────────────────────────────────────────────────── │                            │
│                      │ Reply to the thread                                   │                            │
│                      │ ┌───────────────────────────────────────────────────┐ │                            │
│                      │ │                                                   │ │                            │
│                      │ └───────────────────────────────────────────────────┘ │                            │
│                      │ Sent as you. A reply from a person resets the agent   │                            │
│                      │ streak and reopens a muted thread.     [ Send reply ] │                            │
└──────────────────────┴───────────────────────────────────────────────────────┴────────────────────────────┘
```

- Messages become a conversation, not a four-column table. A person's message ends in `◆` and says "person"; an agent's ends in `●` and shows its session label in mono. The shape and the word carry the difference, not the color.
- The kind shows only when it is not "note"; the priority only when it is not "normal" (today "note · normal" repeats on every message).
- "Agent streak 1 of 5" spells out the loop-guard threshold, with five ticks as a reinforcement. A thread muted by the guard says so in a warning banner above the reply box, with "Reopen thread".
- An admin reading someone else's direct thread gets an information banner: "You're reading a direct thread as an admin. This opening is recorded in the audit log. The page doesn't refresh on its own."

**Thread, 360 px**

```
┌────────────────────────────────────┐
│ [sym]  Acme web      ● Live  [≡]   │
├────────────────────────────────────┤
│ ‹ Threads                          │
│ Release 0.9 checklist              │ title 28/32, wraps
│ Team thread · acme/webapp          │
│ ○ Open · Agent streak 1 of 5 ▮▯▯▯▯ │
│ @lea @sam @malik @nora             │
│ ────────────────────────────────── │
│  >>>>                              │ lane heads, 12 px pitch
│  ●┿┿┿  Léa · agent         18:36   │
│  ││││  Release 0.9 checklist       │ ~38 characters per line,
│  ││││  Freeze on Thursday 18:00.   │ against ~22 today
│  ││││  Before that: …              │
│  │●┿┿  Sam · agent         18:41   │
│  ││││  status                      │
│  ││││  Login form is in review…    │
│  …                                 │
│ ────────────────────────────────── │
│ Reply to the thread                │
│ ┌────────────────────────────────┐ │
│ └────────────────────────────────┘ │
│ Sent as you. It resets the agent   │
│ streak.                            │
│ [ Send reply ]    [ Mute thread ]  │
└────────────────────────────────────┘
```

**Audit log, 1280 px**

```
┌──────────────────────┬────────────────────────────────────────────────────────────────────────────────────┐
│ sidebar (▌Audit)     │ Acme web                                           ● Live        Léa · owner ▾      │
│                      ├────────────────────────────────────────────────────────────────────────────────────┤
│                      │ Audit log                                       [ Export JSON ]  [ Verify chain ]  │
│                      │ Every action on the team, newest first, 50 per page. Check an export offline      │
│                      │ with  codetgh audit verify  .                                                      │
│                      │ ┌ ✓ Chain verified. 128 events, signed checkpoint at 21:40. ─────────────────────┐ │ after Verify only
│                      │ └────────────────────────────────────────────────────────────────────────────────┘ │
│                      │    # Time            Actor              Via      Action                  Subject   │ caption 12/16, 500
│                      │ ══════════════════════════════════════════════════════════════════════════════════ │ border-strong
│                      │  128 28 Oct, 21:40   Léa                console  Thread read by an admin  Release… │ row 56, two lines
│                      │      8 s ago         person                      thread.read_by_admin     thr_…FAS │ line 2: muted, mono keys
│                      │ ────────────────────────────────────────────────────────────────────────────────── │ hairline
│                      │  127 28 Oct, 21:40   Léa                console  Agent traffic resumed    Acme web │
│                      │      9 s ago         person                      kill_switch.off          team_…3  │
│                      │ ────────────────────────────────────────────────────────────────────────────────── │
│                      │  113 28 Oct, 21:38   Malik's agent      mcp      Memory proposed          D-1 v2   │
│                      │      2 min ago       malik@fix/…                 memory.proposed          mit_…QF  │
│                      │ …                                                                                  │
│                      │ Showing 50 of 128                                  [ ‹ Newer ]   [ Older › ]       │
└──────────────────────┴────────────────────────────────────────────────────────────────────────────────────┘
```

- Actors and subjects show names; the ids stay underneath in mono for whoever needs them. The actor id and the subject id both resolve with a display-only join; no route or schema changes.
- Time is absolute first (the audit is evidence), relative second. The hash moves into the row's details: a `<details>` on the "#" cell shows the full hash and the previous hash. That removes the 1157/1000 px overflow at 1280 px.
- No sort controls and no filters: the route has none, and adding them changes routes (section 12). The table states its order instead: "Newest first", and `aria-sort="descending"` on "#".

**Audit log, 360 px**

```
┌────────────────────────────────────┐
│ Audit log                          │
│ [ Verify chain ] [ Export JSON ]   │
│ ══════════════════════════════════ │ border-strong between records
│ #128 · Thread read by an admin     │
│ Léa · console · 28 Oct, 21:40      │
│ Release 0.9 checklist              │
│ ══════════════════════════════════ │
│ #127 · Agent traffic resumed       │
│ Léa · console · 28 Oct, 21:40      │
│ Acme web                           │
│ ══════════════════════════════════ │
│ …                                  │
│ [ ‹ Newer ]          [ Older › ]   │
└────────────────────────────────────┘
```

About 72 px per event: roughly 3 600 px for 50 events, against 13 973 px today.

---

## 4. The one memorable element: the line, with lanes

**Starting point.** The console already has "the line" (`Line` in `apps/hub/src/console/pages.tsx`, `.wire-row` in `console.css`, the `mark()` code in `console.js`, tested by `e2e/console/line.spec.ts`): each message gets a 20 × 44 SVG with two carets joined by a vertical wire, Teal in light and Mint in dark. A message that arrives live gets `.fresh`, traces its wire in 300 ms (the `trace` keyframes) and is announced once in `#line-announce` (`aria-live="polite"`). Under `prefers-reduced-motion` the trace is off. Both behaviors have tests.

**What is wrong with it.** The two carets are the same on every row: they belong to nobody. Forty identical glyphs down the overview carry no information; they are decoration, which is the one thing the memorable element must not be.

**Proposal: keep the line, make the carets belong to people.** Each person who appears on the visible part of the line gets a vertical lane, headed by the brand's caret. A message draws one horizontal wire from the sender's lane to the recipient's lane, ending in a caret that points at the recipient. A message to the whole thread keeps the sender's mark in the accent and draws, in gray, a 1 px `--border-strong` bus with a `--text-muted` tick on each other lane; on a thread page, where every message reaches everyone, it is the sender's mark alone. The accent is kept for wires between two people, so a ping-pong between two agents stands out as a zigzag (gate A review: a Teal bus on every broadcast drowned it). A person's own message ends in a diamond at the sender side, an agent's message in a dot.

- **Why it is better.** It shows who talks to whom at a glance; an agent ping-pong between two lanes, the exact pattern the loop guard stops at five, is visible as a zigzag before it is muted; and a silent lane is a silent person. It is literally the brand: the logo is three carets turned toward one center, and here every caret is a teammate's prompt on the same line ("Plusieurs Claude Code, une même ligne"). It also matches the brief's own words: a wire that links the carets of the agents concerned.
- **Same behavior, same tests.** Same DOM hooks (`.wire-row`, `.wire`, `.link` with `pathLength="1"`, `.fresh`, `data-mid`, `data-summary`, `#line-announce`), same single animation (`trace`, 300 ms, ease-out, from the sender's caret to the recipient's), same reduced-motion rule, same polite announcement. Teal in light, Mint in dark, muted gray for the "Earlier" part.
- **How it renders without a build or script.** The server computes the lanes (people in the visible rows, ordered by first appearance) and each row's SVG: vertical lane lines at `y1="0" y2="100%"` so lanes join from row to row whatever the row height, one wire path, one caret. Geometry is in SVG attributes, which the CSP allows; color and width come from the stylesheet. The sender's handle needs `user.handle` in the existing `recentLine` select: a display-only column.
- **Limits.** Lane pitch 14 px under 640 px, 24 px from 640 px, 48 px from 1280 px, narrowing to 32 px past six people (`clamp(32px, 288px / lanes, 48px)`) so the lanes never take more than 288 px of the column. At most 6 lanes under 640 px and 10 above; beyond that the people seen least recently share a last lane labeled "+3", and their wires end there. Past six people the server draws a second, six-lane set of wires that only phones show. From 640 px the handles are printed above their carets on two staggered rows (three past six people), so each name has the width of two (three) lanes: "christophe" stays whole at 9 lanes. Under 640 px a caption names the lanes, the shared one included ("Lanes: theo, lea, sam, malik, nora, +4 (marguerite, christophe, guillaume, alexandre)"). The head (caption, names, carets) is sticky, so the lanes keep their names while the line scrolls. Lane lines are `--border-strong` (section 2.5).
- **Where.** On the overview (all visible messages) and on the thread page (the thread's participants). Nowhere else: the timeline component (section 5.14) is its calm sibling for tasks and history.
- **Accessibility.** The SVG stays `aria-hidden`. The row's text says everything the drawing says ("Sam's agent → @malik"), so color, shape and position are never the only carriers. A screen reader hears the polite announcement for each new message, as today.
- **Privacy.** Lanes come from rows the viewer is already allowed to see: a member's line holds only their own threads, as `recentLine` already filters.

**Alternatives considered and rejected.** A pulsing presence dot per agent: every dashboard has one, and the pulse would be a second animation. A large "round table" diagram of agents around the project, echoing the logo: decorative, does not scale past five people, and pushes the data down. A terminal-styled console (mono everywhere, green on black): it is the cliché of the world, not its spirit, and the inventory already shows mono prose is hard to read at 360 px.

---

## 5. Component catalogue

Built once, in the foundations batch, shown on a development-only catalogue page, and used by every screen. Each entry lists its states. "Focus" always means the same thing: a 2 px solid accent outline with a 2 px offset (4.20:1 or more on every surface), on `:focus-visible`.

### 5.1 Button, three levels

| Level | Look | Rule |
| --- | --- | --- |
| Primary | Accent fill, `--on-accent` label | One per area: the page's main job, or the confirming button of a dialog |
| Secondary | Transparent, 1 px `--border-strong`, `--text` label | The default |
| Tertiary | Text only, accent label on `--surface`, `--text` label elsewhere, underline on hover and focus | Rare or secondary paths ("Get a sign-in link by email instead") |
| Destructive | Secondary with an `--error` label and edge as a trigger ("Revoke…"); `--error` fill only on the confirming button inside the dialog | The look follows the risk |

- Sizes: 32 px in dense rows, 40 px in forms, 44 px on coarse pointers. Icon-only buttons are square, with an `aria-label` and a tooltip.
- The level comes from importance, not from the HTML type: today every `type="submit"` is painted primary, which gives four primaries on the sign-in page and makes "Erase my data" look like "Save". The CSS selector `button[type="submit"]` stops meaning primary.
- States: default; hover (`--surface-inset` behind secondary and tertiary, a darker mix for primary); active (inset, no movement); focus; busy (`aria-busy="true"`, set by `console.js`; the label stays, a ring drawn by the stylesheet shows after 300 ms and stands still under reduced motion; no new `hx-disabled-elt`, since htmx attributes do not change in this redesign); disabled (`aria-disabled`, 50 % opacity, `cursor: not-allowed`, no hover; used rarely, since submit is never pre-disabled); "opens more" (label ends in "…").
- Adjacent buttons keep an 8 px gap (today provider buttons, Accept and Reject touch each other).

### 5.2 Form field

- Anatomy: label above (`label`, 500), optional help line under the label (`caption`, muted), the control, then the error line. Optional fields say "optional" after the label; nothing uses an asterisk.
- Controls: input, textarea, select (with explicit `background-color` and `color`, or Windows dark mode breaks), checkbox and radio (20 px box inside a 44 px row target; today's checkboxes are 13 × 13 px), unit suffix ("days"), read-only value (inset surface).
- States: default; hover (border `--text-muted`); focus; filled; invalid (`aria-invalid="true"`, `--error` border, `circle-alert` icon, a sentence in `--error`, linked by `aria-describedby`; focus moves to the first invalid field); disabled; read-only; busy (the form's submit button is busy).
- A form with several errors gets a summary banner above it, with a link to each field. Errors that `console.js` places after an htmx refusal keep `.field-error` and `role="alert"`.
- `autocomplete`, `name`, `spellcheck="false"` on emails, handles and codes; placeholders show an example and end with "…".

### 5.3 Status pill

- A dot and a word, always. Height 20 px, `caption` at 500, radius full, 1 px edge in the tone, text in the tone. A neutral state has a hollow dot. Not interactive. The word never wraps, so every French label must fit whole; the French captures check the longest ones.
- One table maps every state to a tone, in a fixed order per entity, and every list and filter follows it:

| Entity | State → tone |
| --- | --- |
| Agent session | Online → success; Idle → neutral; Paused (`codetgh pause`) → warning; Offline → neutral |
| Agent trust | Quarantined → error; External → neutral; Trusted → not shown |
| Permission mode | Prompts off (`bypassPermissions`) → warning; other modes → plain text |
| Alert | Open → warning; Dismissed, False positive, Fingerprint allowed → neutral |
| Thread | Open → neutral; Muted by the loop guard → warning; Muted by a person → neutral |
| Memory item | Proposed → warning; Accepted → success; Superseded, Rejected → neutral; Pinned → neutral |
| Task | To do, In progress → neutral; Blocked → error; Done → success |
| Remote Control, runner | Running → success; Waiting for the machine → warning; Stopped → neutral; Failed → error, with the hub's message as text under the pill, never inside it |
| Invitation, token | Pending, Active → neutral; Expired, Revoked → neutral, with the date |

- States: the tones above, plus "inside a hovered or selected row" (checked at 5.49:1 or more).

### 5.4 Handle chip

- `@lea` in mono 13, `--surface-inset`, radius 4, `translate="no"`. Square corners on purpose: a handle is a token you could type in a terminal, not a state.
- Variants: person (`@lea`); session (`lea@main`, no "@"); yourself (`@lea` plus the word "you"); external agent (name plus the word "external"); former member (muted, "former member").
- States: default; truncated (ellipsis, full text in `title` and readable by screen readers); in a selected row. Not a link: no route lists a person's activity.

### 5.5 Dense table

- Native `<table>` with a `<caption>` (visually hidden when the page title already says it), `<th scope="col">`, header in `caption` at 500 in `--text-muted`, a `--border-strong` rule under the header, hairlines between rows, no zebra, no vertical rules, no outer box. Text left, numbers right in `tabular-nums`, mono only for machine values.
- One link per row, in the primary cell, in `--text` (Teal fails on the hovered row), stretched over the row with a pseudo-element so the whole row is a target while the keyboard meets one link.
- Actions: a last column with a visually hidden "Actions" header. At most one direct action per row; the rest in a "…" row menu (5.6). Each action's accessible name includes the row ("Revoke token laptop-cli"). Actions are always visible, never on hover only.
- Missing values say "None" or "Nobody", or the cell is dropped in the stacked layout; never a bare empty cell.
- Sort: the column the server orders by carries `aria-sort` and an arrow. Clickable sorting needs a query parameter the routes do not have (section 12), so it ships only where the owner approves one.
- Pagination: the existing "Older" links become "‹ Newer" / "Older ›" in a `nav` with an `aria-label`, next to the existing "Showing 50 of 210" text.
- Under 640 px: stacked records (primary line, meta line, pill, actions), empty cells dropped, `--border-strong` between records. The current `data-label` on each cell stays.
- States: default; hovered row (if it links); current or selected row (2 px accent left rule, inset surface); unread row (title at 600 plus a visually hidden "Unread"); loading (the region keeps its rows, `aria-busy`, loading bar); empty (the empty state replaces the whole table, headers included, so a screen reader never reads an empty header row); error (an error banner above the kept rows: "Couldn't refresh. Showing data from 21:40." with "Retry"); truncated cell (ellipsis plus full text).

### 5.6 Panel

- A bordered group (1 px `--border`, radius 8, padding 16 or 24) for spacious pages: settings, My data, token creation, the sign-in panel. Never around a dense table, never nested in another panel.
- Variants: default; danger (2 px `--error` rule on the left edge, `octagon-alert` icon, a title that names the risk: "Erase my data", "Agent traffic" while stopped); collapsible create form (`<details>` opened by a page-header button such as "Invite a member", "Create a token", "New task", "Add an external agent": the form no longer pushes the list down).
- States: default; open and closed (collapsible); with an error banner inside; busy.
- The row menu ("…") and the project filter are small `<details>` menus built on the same overlay surface: closed, open, focused item, and closed on Escape or on a choice.

### 5.7 Tabs

- Two kinds, never mixed. **Link tabs** for anything that changes the URL (Current / Archives, memory statuses, settings sections): a `nav` of links with `aria-current="page"`, the selected one in `--text` at 600 with a 2 px accent underline, each with its count when known ("Proposed 3"). **ARIA tabs** only for panels inside one page, with the APG keyboard model (left and right arrows on a horizontal list) and manual activation, since htmx panels load with a delay. None is planned yet.
- The project filter, today a row of up to 8 links with no selected state, becomes a menu: "Project: All projects ▾", the choice shown in the button.
- States: default; hover; selected; focus; wrapped (French labels at 360 px wrap to a second row; the page never scrolls sideways).

### 5.8 Alert (banner and inline message)

- Three scopes. **Page banner** under the top bar, for a system state that holds until it ends: agent traffic stopped (with reason, by whom, since when; admins get a link to the resume form, which keeps its typed "yes"), live connection lost, an admin reading a direct thread. **Section message** at the top of the area it concerns: the chain verification result, a guest's "what you can see" note, a thread muted by the loop guard. **Inline message** next to a field or a button: errors from `console.js`.
- Anatomy: an icon whose shape is the severity (`info`, `circle-check`, `triangle-alert`, `octagon-alert`), a one-line title, a body of one or two sentences that says what to do, up to two actions. Soft tint background, 1 px edge in the tone. Links inside use `--text` with an underline.
- Roles: `role="status"` for information and success; `role="alert"` for errors that block. Only people who can act see the action.
- States: information, success, warning, error; with or without actions; dismissible (information only). It replaces today's `.result` box, which served successes, one-time secrets and device confirmations with the same Teal rule.

### 5.9 Toast

- For the result of an htmx action whose effect is not visible on the page, and only then ("Invitation emailed to ines@acme.test."). A change that shows on screen confirms itself. Errors never go in a toast.
- How it works without changing routes: actions still answer `HX-Refresh`. The action button carries the confirmation sentence, rendered from `i18n.ts` in a `data-done` attribute; `console.js` saves it in `sessionStorage` when the request succeeds and shows it once after the reload, in a polite live region that is in the layout from the first render.
- Look: overlay surface, radius 8, bottom-left from 1024 px, bottom full-width under it (above the safe area), one at a time, a `circle-check` icon, a close button. It stays 5 s, pauses on hover and on focus. No motion.
- States: shown; paused; dismissed; replaced by a newer one.

### 5.10 Confirmation dialog

- For every one-click destructive or hard-to-undo action: revoke a member, a token or an invitation; remove or quarantine an agent; release a claim; turn off a delegation; reject a memory item; stop agent traffic; change a role. Today they all fire on one click. Muting a thread is not on the list: "Reopen thread" undoes it at once.
- Built on native `<dialog>` and htmx's `htmx:confirm` event: the trigger keeps its `hx-post`, `console.js` cancels the request, opens the dialog, and calls `issueRequest(true)` on confirmation (both exist in the vendored htmx 2.0.11, appendix B). Texts come from `i18n.ts` through data attributes on the trigger.
- Anatomy: the title names the action and its object as a question ("Revoke the token laptop-cli?"); the body says the consequence and what it does not do ("Terminals using it stop at their next request. Sessions already open are not closed."); buttons "Cancel" (secondary, focused first) and the action with exactly the trigger's label ("Revoke token"), filled `--error` when destructive.
- The two actions that already ask for a typed word keep their fields and labels in the page, which tests use ("Type erase to confirm", "Type yes to resume agent traffic"); no second dialog on top. Fields that belong to a confirmed action (the "Reason" of agent traffic) stay in the page form too, so `issueRequest` sends them unchanged.
- States: open; busy (the action button); error (an inline error inside the dialog, which stays open); closed (focus returns to the trigger, or to the next row after a deletion).

### 5.11 Code block with copy

- `pre` on `--surface-inset`, radius 8, mono 13, padding 12/16, wrapping (`pre-wrap`, `overflow-wrap: anywhere`) so a 360 px screen never scrolls. A Copy button in the top-right corner, with the `copy` icon and the word "Copy".
- Variants: command (`codetgh invite <email>`, `codetgh setup`; the prompt sign is drawn by CSS and not copied); secret shown once (a warning banner above: "Copy it now. You won't see it again."; the token, the Slack code); key or config (the audit public key).
- States: default; hover; copied (the label becomes "Copied" with `check` for 2 s, announced politely); copy failed (the text is selected and a line says "Press Ctrl+C to copy"; ⌘ on macOS); long content.

### 5.12 Empty state

- Variants: **first use** (title, one sentence, one action, and the command in a code block when the action happens in a terminal); **no results** for a filter ("No threads in acme/api." with "Show all projects"); **cleared** ("No open alerts." in muted text, no action: it marks completion); **no permission** (who can do it: "Only admins can see the audit log. Ask an admin of Acme web."); **error** (what happened, "Retry").
- Two sizes: inline (inside a section: left-aligned text, no icon) and page (replaces the whole table: icon 24, `subheading` title, body, action). Never centered.
- Order of rendering: loading, then error, then empty, then content. Nothing says "No results" before the data has answered.

### 5.13 htmx loading indicator

- On the region being swapped: `aria-busy="true"` (today's only signal, a 60 % opacity, is kept for the control) and a 2 px accent bar at the top of the region, which appears after 400 ms and slides while it lasts. Fast swaps never flash. Reduced motion: a still bar and the visible text "Loading…".
- On a button: see 5.1. The button keeps its label and its width.
- The live connection: the top bar shows "Live" (success dot), "Reconnecting…" (warning) or "Offline since 21:40" (error), driven by the sse extension's `htmx:sseOpen` and `htmx:sseError` events, in a `role="status"` element. When the line refreshes, `console.js` puts focus back on the element that had it (rows get stable ids) and reopens the disclosures that were open, so a live refresh no longer drops the keyboard user.
- States: idle; pending (under 400 ms, invisible); loading; failed (error banner with "Retry", previous content kept).

### 5.14 Timeline

- A vertical list of what happened to one object: task history and notes, the memory item's versions, the device approval steps. Each event: time (absolute, `tabular-nums`), actor (handle chip), a sentence in plain words ("Claimed the task", not `task.claimed`), optional body in `reading`.
- A 1 px `--border-strong` vertical rule with 8 px nodes: a filled node for a state change, a hollow one for a note. No wires and no accent: those belong to the line.
- States: default; empty ("No history yet."); long (the oldest events folded under "Show 12 earlier events"); the current state highlighted by weight, not color.

---

## 6. Icons

**Recommendation: Lucide, through the `lucide-static` package, pinned at 1.56.0** (published 2026-10-13, more than two weeks old; 1.63.0 came out today). Only the SVG paths of the icons below are copied into one module, inlined as `<svg>` elements; nothing else from the package ships.

**Exact licence, read from the package's `LICENSE` file** (identical in 1.56.0 and 1.63.0): it is **not ISC alone**. It is the ISC License, "Copyright (c) 2026 Lucide Icons and Contributors", **plus** the MIT License, "Copyright (c) 2013-present Cole Bemis", for the icons derived from the Feather project, which the file lists. Ten of the icons below are on that list (`info`, `check`, `x`, `chevron-down`, `chevron-right`, `chevron-left`, `arrow-up`, `arrow-down`, `external-link`, `terminal`), so `NOTICE` must carry both notices. Both licences are on the repository's allowed list. `docs/REUSE.md` gets the line (name, URL, version, both licences, date of the last commit, read at that time).

Why Lucide over Tabler (MIT, "Copyright (c) 2020-2026 Paweł Kuna", one notice):

- Simpler drawings: for the same 50 candidate icons, Lucide's path data averages 83 characters per icon against 124 for Tabler, with the same stroke width and grid. Fewer strokes read better at 16 px next to 14 px Inter, and suit a calm interface.
- Lucide's `terminal` is a bare prompt caret, the same shape as the brand's carets; Tabler draws it inside a window frame.
- Tabler's only advantage here is a single licence notice. If the owner prefers that, Tabler has every icon below too (all checked).

**Icons needed (22).** Navigation labels get no icon (section 8); icons appear only where they carry a function or a state.

| Icon (Lucide name) | Where |
| --- | --- |
| `circle-check` | Success banner, toast, "Chain verified" |
| `triangle-alert` | Warning banner, warning pill reinforcement, "Needs you" alert row |
| `octagon-alert` | Error banner, danger panel title |
| `info` | Information banner (admin reading a DM, guest note) |
| `circle-alert` | Field error |
| `copy` | Code block copy button |
| `check` | "Copied", selected filter chip |
| `x` | Close a toast or a dialog |
| `ellipsis` | Row menu ("…") |
| `menu` | Menu button under 1024 px |
| `chevron-down` | Disclosures and menus (project filter, account menu, "Offline") |
| `chevron-right` | "Needs you" rows, "Older ›" |
| `chevron-left` | Back links ("‹ Threads"), "‹ Newer" |
| `arrow-up`, `arrow-down` | The sorted column's direction |
| `external-link` | "Open claude.ai/code" |
| `refresh-cw` | "Retry" |
| `loader-circle` | Busy button (after 300 ms) |
| `unplug` | Live connection lost banner |
| `eye` | Admin reading a direct thread |
| `terminal` | Empty states and pages whose next step is a command (device, agents) |
| `pause` | Paused agent (reinforces the "Paused" pill) |

The 22 icons weigh about 7 kB of SVG source before deduplication.

**Built in the foundations (decided at gate A: Lucide, `lucide-static` 1.56.0).** `apps/hub/src/icons.tsx` holds the 17 icons the shell and the components draw: `arrow-down`, `arrow-up`, `check`, `chevron-down`, `chevron-left`, `chevron-right`, `circle-alert`, `circle-check`, `copy`, `ellipsis`, `info`, `menu`, `octagon-alert`, `refresh-cw`, `terminal`, `triangle-alert`, `x`. Thirteen of them are Feather-derived (all but `circle-check`, `copy`, `menu`, `refresh-cw`; `circle-alert`, `octagon-alert`, `triangle-alert` and `ellipsis` are Feather's `alert-circle`, `alert-octagon`, `alert-triangle` and `more-horizontal`), so `NOTICE` carries both texts. `eye`, `unplug`, `external-link` and `pause` join with the batch whose screen first draws them; `loader-circle` is not needed, since the busy button's ring is drawn by the stylesheet.

---

## 7. Not this

From the brief:

- No grid of three identical cards.
- No decorative gradients.
- No generic stacked shadows.
- No spaced uppercase labels above every title.
- No 01 / 02 / 03 numbering: the content is not a sequence.
- No emojis as icons.
- No hover animation on every card.
- No single word colored inside a title.
- No frosted glass.
- No glow effects.

Added by this plan:

- No row of KPI tiles with big numbers, and no sparklines: counts live inside sentences in "Needs you".
- No Teal text on any tinted surface, and no Mint anywhere in light mode.
- No state carried by color alone, and no icon without a word.
- No raw enum keys (`secret_blocked`, `in_progress`) and no ULIDs as the primary label of anything.
- No mono for prose.
- No two primary buttons in one area; no button whose level depends on its HTML type.
- No pill-shaped buttons.
- No actions that appear only on hover.
- No exact time available only in a `title` tooltip.
- No icons in front of navigation labels, and no count badge on every navigation item.
- No generated avatars or initials circles: there are no photos, and fake avatars are decoration.
- No greeting ("Welcome back, Léa!"), no tips, no marketing copy inside the console.
- No "Something went wrong", "Oops", "Please" or exclamation marks.
- No full-page spinner, and no skeleton that hides data already on screen.
- No `transition: all`, no movement on hover, no animation other than the trace and the loading indicators.
- No centered text blocks in the console.
- No pure black dark mode: dark is Ink.
- No retyped wordmark, no effect on the logo, no logo under its minimum size or inside its clear space.

---

## 8. Critical review

Each choice below is what any dashboard would do. For each, what changes, or why it stays.

| Generic choice | What this plan does instead |
| --- | --- |
| A row of three or four count tiles at the top of the overview | "Needs you": one list, one sentence per item with the count inside, one action each, and a single quiet line when nothing is waiting. |
| An activity feed with avatars, names and "did X" | The line with lanes: who talked to whom drawn as wires between their carets, so loops and silences are visible. |
| Colored badges on every row | Pills only for states that change what someone does (quarantined, prompts off, paused, open alert, proposed memory). Normal states are plain text or absent: "Trusted" never shows. |
| An icon in front of every navigation label | Text-only navigation, grouped by frequency; icons are kept for states and actions, where their shape means something. |
| A "danger zone" box at the bottom of a settings page for the kill switch | Agent traffic is a state of the whole team: a short section on the overview with its consequence, and a page banner on every page while it is stopped, naming who, when and why. |
| Cards for projects | A dense list: one row per project with its sessions, Remote Control and runner states as columns, and the project id moved to the details. |
| A toast for every action | A toast only when the result is not visible; a visible change confirms itself; errors stay where the action was. |
| An illustration in empty states | The useful thing: the command to run, in a copyable code block, or the one action that fills the screen. |
| A 40 px title on every page | 28 px titles in Inter Display in the console; 40 px only on public pages, where the page has one job. |
| Every column the data has | Fewer columns: names first, machine ids underneath in mono, columns that repeat a group title or hold one constant value removed (agents: "Project" under a project heading, "Kind" equal to `claude-code` everywhere). |
| Relative times everywhere | Relative for live screens, absolute first on the audit and task history, the exact instant always readable without hovering. |
| A split-screen login with a product picture | One column, the stacked lockup, one primary method, the rarer method folded. |
| Inverted grays for dark mode | Ink as the canvas and the brand's Mint as the only accent, each pair measured. |
| Dashboard-style sidebar and top bar | Kept, on purpose: people already know where to look, and the shell is not where CodeTgh should be different. What is CodeTgh's own: the top bar carries the live connection and the agent-traffic state, which no generic dashboard has. |

---

## 9. UI text rules

The brief's rules, then the additions this console needs. Every example comes from the current `apps/hub/src/i18n.ts` or from a route string that bypasses it today.

1. **Sentence case**, everywhere, in both languages.
2. **Active voice**, and say who did it.
3. **An action keeps one name** in the button, the confirmation dialog, the toast, the banner and the audit log, in both languages.
4. **Errors say what happened and how to fix it**, without apologizing, without "please", without blaming the person.
5. **An empty screen invites to act**, with the action that fills it.
6. **No parentheses in labels**: the help goes under the label, the unit after the field.
7. **One French register: "tu"**, as the rest of the console.
8. **Agreement by entity in French**: a key per entity when the gender differs.
9. **Dates and numbers through `Intl`** for the page's language, a non-breaking space between a number and its unit, the exact instant always readable.
10. **No display-size title contains "CodeTgh"** (section 2.2).
11. **"…" only on actions that open something** (a dialog, a menu), never on actions that run at once.
12. **"The line" is « la ligne » in French, never « le fil »**, which already means a thread.
13. **No raw keys on screen**: every enum value has an English and a French label.

| Rule | Before | After (EN) | After (FR) |
| --- | --- | --- | --- |
| 13 | `secret_blocked`, `instruction_like`, `loop_guard` shown raw on English pages | Secret blocked · Looks like an instruction · Agent loop | Secret bloqué · Ressemble à une consigne · Boucle d'agents |
| 3 | "Kill switch" (heading), "Stop agent traffic" (button), "Agent traffic paused" (banner), "Resume" (button), `kill_switch.on` (audit) | Agent traffic (heading) · Stop agent traffic… (button) · "Stop agent traffic?" / [Stop agent traffic] (dialog) · "Agent traffic stopped by Léa at 21:40: release freeze" (banner) · Resume agent traffic (button) · Agent traffic stopped (audit label, key in mono) | Trafic des agents · Couper le trafic des agents… · « Couper le trafic des agents ? » · « Trafic des agents coupé par Léa à 21:40 : gel de la version » · Rétablir le trafic des agents |
| 3 | "Revoke invitation" → « Annuler l'invitation », while "Revoke" → « Révoquer » | Revoke invitation · "Revoke the invitation for ines@acme.test?" · Invitation revoked | Révoquer l'invitation · « Révoquer l'invitation de ines@acme.test ? » · Invitation révoquée |
| 4 | Hub refusal `invalid email` (lowercase, English only, under the form) | This email address isn't valid. Enter an address like name@example.com. | Cette adresse e-mail n'est pas valable. Saisis une adresse comme nom@exemple.com. |
| 4 | Hub refusal `type erase to confirm` | Nothing was erased. Type erase in the box to confirm. | Rien n'a été effacé. Tape erase dans le champ pour confirmer. |
| 4 | Bare page `thread not found` (Times, white, English) | This thread doesn't exist, or you're not one of its participants. [Back to threads] | Ce fil n'existe pas, ou tu n'en fais pas partie. [Retour aux fils] |
| 4 | Bare page `admins only` on /console/members | Only admins can manage members. Ask an admin of Acme web. | Seuls les admins gèrent les membres. Demande à un admin d'Acme web. |
| 5 | "Nothing yet." (tokens) | No personal tokens yet. Create one to sign in a terminal. [Create a token] | Aucun jeton personnel pour l'instant. Crée-en un pour connecter un terminal. [Créer un jeton] |
| 5 | "No agent connected. Copy the invitation command to add one: codetgh invite <email>." | No agents connected. Copy the invite command to add one. + code block `codetgh invite <email>` [Copy] | Aucun agent connecté. Copie la commande d'invitation pour en ajouter un. + bloc de code [Copier] |
| 5 | "Nothing yet." (proposed memory) | No proposals to review. Agents propose team decisions with the memory_propose tool; they appear here. | Aucune proposition à valider. Les agents proposent des décisions d'équipe avec l'outil memory_propose ; elles arrivent ici. |
| 6 | "Valid for (days)" · "Assignee (@handle or none)" · "Extra secret patterns (regular expressions, one per line)" | Valid for [ 7 ] days · Assignee + help "A handle like @lea. Leave empty for nobody." · Extra secret patterns + help "One regular expression per line." | Valable [ 7 ] jours · Attribuée à + « Un pseudo comme @lea. Laisse vide pour personne. » · Motifs de secrets en plus + « Une expression régulière par ligne. » |
| 7 | « Lancez claude dans le dossier du dépôt du projet… », « Choisissez un projet. » | (English unchanged) | « Lance claude dans le dossier du dépôt du projet… », « Choisis un projet. » |
| 8 | `open` → « ouverte » for alerts and threads alike ("fil ouverte") | Open | Alerte : « ouverte » · Fil : « ouvert » |
| 2 | "Invited as member with ines@acme.test." | You're invited to join Acme web as a member. Your account uses ines@acme.test. | Invitation à rejoindre Acme web comme membre. Ton compte utilise ines@acme.test. |
| 9 | Task notes dated `2026-10-28T21:36:13.968Z`; "3 hours ago" on French pages (`<When>` without a language) | 28 Oct, 21:36 · 3 hours ago | 28 oct., 21:36 · il y a 3 heures |
| 10 | H1 "Sign in to CodeTgh" under the stacked lockup | Sign in | Se connecter |
| 11 | "Attach to…" on a button that submits at once | Attach to project | Rattacher au projet |
| 1 | "Reply as a human" (label), "Send", "Mute" | Reply to the thread · Send reply · Mute thread | Répondre dans le fil · Envoyer la réponse · Mettre le fil en sourdine |

Strings that must still go through `i18n.ts` and do not today: the whole thread page, Tokens, Audit, Memory, Claims, Tasks, the task page, My data (Slack, erase), the A2A, Slack, token, webhook and verification results, `oauth.js` messages, the hub's refusal texts shown by `console.js`, and the missing keys "Audit log", "Personal tokens", "Team memory", "Push", "Permissions", "team", "direct".

---

## 10. Gate A prototypes and what they touch

- **Scope:** sign-in, overview, one thread (the long team thread of the demo, and the 360 px variant), light and dark, 360 and 1280 px, English plus the French 360 px check. Built on a first cut of the tokens and the shell; screens not in scope keep working but are not restyled yet.
- **Prerequisite found by the inventory:** no page sends a doctype, so every page renders in quirks mode (table cells at 16 px while the body is 15). The prototypes add `<!doctype html>` to both layouts; this changes rendering everywhere and is captured before and after.
- **Error pages:** a page load (no `HX-Request` header) that fails gets a full page; an htmx call keeps the bare reason that `console.js` shows under the form. Decided at gate A: the full page uses the public layout (stacked logo, both themes, English and French), with a title per status (400, 403, 404), the hub's reason and a link back to the overview.
- **Tests that will change, said here and again in the PR:** `e2e/console/journeys.spec.ts` ("Agent traffic paused" becomes "Agent traffic stopped by …"; "Stop agent traffic…" now asks for a confirmation, so the test confirms in the dialog; the button "Resume" becomes "Resume agent traffic"); `e2e/console/draft.spec.ts` (label "Reply as a human" becomes "Reply to the thread"); `apps/hub/test/i18n.test.ts` (it uses "Dashboard" as its sample key, which becomes "Overview" / « Vue d'ensemble »). Kept as they are: `.wire-row`, `.fresh`, `.link`, `#line-announce` and the `trace` animation name, "Skip to content", `.field-error` with `role="alert"`, the sign-in labels "Email", "Password", "Sign in" and their French versions, `.people`, `.brand img`, the CSRF `hx-headers` on `body`.

---

### Gate A notes, after the critique of the first prototypes

What changed in the prototypes (same three screens, same routes, fields and htmx attributes):

- **The line.** Accent only on wires between two people; broadcasts in gray; no bus on the thread page; lanes in `--border-strong`, a sticky head, staggered names, the pitch and lane limits of section 4. The demo hub has an eight-person thread with handles of 9 and 10 characters (`thread-crowded` captures), which also puts 9 lanes on the overview.
- **Times.** The clock time comes first ("18:36", or "27 Oct, 22:30" on another day, `Intl.DateTimeFormat` in the page's language), the relative time second on messages; the line shows the clock time, the properties column absolute dates; no raw ISO `title`. The hub writes clock times in its own time zone and `console.js` rewrites every `time[data-local]` in the reader's on load and after each htmx swap. Times never break (`white-space: nowrap`). Relative times ("2 minutes ago") still age between live refreshes; nothing re-renders them on a timer.
- **States as text.** "Online" and a thread's "Open" are plain text; pills stay for Idle, Prompts off, Quarantined, External and Muted. The offline group says "5 offline". Agent traffic is a calm section while it flows ("Flowing." and its consequence); only the stopped state takes the error tone, with a straight left rule, next to the page banner, whose title now sits on its own line.
- **Phones.** Line rows keep the time on their first line and let the subject wrap on two lines; the overview shows the ten newest messages and "See all threads". The 360 px overview went from 2 827 px to about 1 800 px.
- **Text.** Prose capped at 56 ch (section 3.3). French strings use a no-break space before ":" and inside « », a narrow no-break space before "?", "!" and ";" (Inter's shipped subsets have no U+202F; it is a space, so the fallback does not show), and counts stay with their nouns. « Sans confirmation » for "Prompts off", « Plus anciens » for "Earlier", « par courriel » instead of a breakable « e-mail » (Inter's subsets lack the non-breaking hyphen U+2011).
- **Details.** The sign-in error sits under the fields, and both fields point at it with `aria-describedby`. The back link has its chevron and the accent. A message's author reads "Léa · agent"; "@team" reads "the team". A message whose subject repeats the thread's title does not show it. Flags are small alerts, title on its own line. The menu button says "Menu", then "Close" with an x. Two Lucide icons added: `chevron-left`, `x`.
- **States captured** at 360 and 1280 px, light and dark: sign-in error, agent traffic stopped, a thread muted by the loop guard (read by one of its participants), an admin reading a direct thread, an empty overview, the live connection lost ("Reconnecting…").

Deferred to the foundations batch, said here so nobody reads the prototype as finished:

- **The confirmation dialog** (section 5.10). "Stop agent traffic" still fires on submit; only the required Reason slows it down, so the label has no "…" yet (rule 11). The dialog, and the test change it brings to `journeys.spec.ts`, land with the foundations.
- **Who stopped agent traffic, when and why** in the page banner: the principal only knows that traffic is stopped; the banner says so without a name.
- **The Paused pill** (`codetgh pause`): `listAgents` does not select the membership's pause; adding it is a display-only column for the agents batch.
- **The magic-link result** still lands in the sign-in form's `#error`, which `/assets/oauth.js` fills for every public form.
- **The empty overview's command** in a copyable code block (section 5.11): the empty state keeps today's sentence.

## 11. Brand questions (decided at gate A)

The brand is not changed anywhere in this plan. These are the points where it cost the interface something. The owner delegated the answers on 2026-10-29 ("Fais tout comme tu penses être le mieux"); each one is decided as proposed, and recorded in `docs/BRAND.md` (« Interface de la console »).

- **Q1. White as the raised surface in light mode.** Teal text passes AA only on Paper itself (4.55:1); any tint drops it (4.20 on the inset surface, 3.86 to 3.99 on soft tints), and the palette has nothing lighter than Paper. **Decided at gate A: yes.** Light mode uses white `#FFFFFF` for raised surfaces (panels, menus, dialogs, toasts, the public column); Teal text is 4.90:1 on it. Paper stays the page background.
- **Q2. The label of the primary button.** Paper on Teal is 4.55:1, 0.05 above the line. **Decided at gate A: yes.** The label is white on Teal (4.90:1), the kit's white-on-Teal version.
- **Q3. The six state colors.** BRAND.md said "No other color is used"; the brief allows success, warning and error. **Decided at gate A: yes.** Light success `#4A6800`, warning `#8A5000`, error `#B42318`; dark success `#B8DA6B`, warning `#F4B04F`, error `#FF9C8F`. Interface only: never on the logo, never as the accent.
- **Q4. The browser color on phones.** The kit's head snippet set `theme-color` to Teal, a Teal band above an Ink or Paper page. **Decided at gate A: yes.** `theme-color` follows the theme with two media-specific meta tags (Paper in light, Ink in dark); Teal stays for the app icon and the manifest.
- **Q5. Mint as a fill.** BRAND.md allows Mint "on dark backgrounds only". **Decided at gate A: yes.** In dark mode the primary button is Mint-filled with an Ink label (11.18:1); Mint is also the dark accent for links, focus and wires, always on a dark surface.

## 12. Other decisions (decided at gate A)

- **Toast after a reload:** decided at gate A: through `sessionStorage`, read and written inside `try`/`catch`; the page works without it (section 5.9). The action's button carries the sentence in `data-done`.
- **Renamed labels:** decided at gate A: "Dashboard" becomes "Overview" (« Vue d'ensemble »); "Kill switch" becomes "Agent traffic" (« Trafic des agents »); the stopped state reads "Agent traffic stopped". The foundations rename the navigation, the overview's title and the page banner; the overview batch renames its section.
- **Reply form on an admin's read of a direct thread:** decided at gate A: hidden, as `main` already does since PR #126 (the form only appears where a reply can succeed).
- **Sorting and filters** that need new query parameters: decided at gate A: out of this redesign.
- **Signing out:** decided at gate A: out of this redesign (a feature).
- **Overview line:** decided at gate A: at most 15 rows on wide screens (10 on phones), then a "See all threads" link; the "Earlier" section moves to the threads page.
- **Sign-in page:** decided at gate A: the email form's "Sign in" is the primary button of that form; "Continue with GitHub" and "Continue with Google" are secondary buttons. One primary per area.
- **Icons:** decided at gate A: Lucide through `lucide-static` pinned at 1.56.0, only the icons used, inlined; `docs/REUSE.md` and `NOTICE` carry the ISC and the MIT (Feather) notices (section 6).
- **Demo script** (`e2e/console/demo.ts`): decided at gate A: the local demo hub listens on 127.0.0.1 only.
- **Doctype and error pages:** decided at gate A: every page gets a doctype (no quirks mode); full-page errors (400, 403, 404) get the public layout, both themes, English and French (section 10).

**Process, decided at gate A.** One branch and one draft PR per batch, never merged by the agent: the owner validates each PR. Foundations: branch `refonte/fondations`, PR against `main`. Batches branch from `refonte/fondations` and open their PR against it, in this order: 1 public pages (`refonte/pages-publiques`); 2 overview and live feed (`refonte/vue-ensemble`); 3 threads, thread page and alerts (`refonte/fils-alertes`); 4 agents, projects, delegations (`refonte/agents-projets`); 5 members, tokens, profile, settings (`refonte/membres-reglages`); 6 audit, memory, claims, tasks (`refonte/audit-memoire`). So that batches do not conflict, the foundations put the tokens, the base, the shell and the components in `apps/hub/public/console.css`, create one stylesheet per batch (`apps/hub/public/console-<batch>.css`, linked by every layout, holding at most the rules that keep that batch's screens as they are today) and one delimited block per batch in `apps/hub/src/i18n.ts`; each batch edits only its stylesheet, its i18n block and the JSX of its screens. Before and after captures go to an orphan branch `visual/<branch name with dashes>` and into the PR body through raw.githubusercontent.com links, never into a working branch.

---

## 13. Sources

All web pages were read by the research step of this run on 2026-10-28, with WebFetch or WebSearch, as text (no screenshots, no pixels). This plan uses those notes; it did not reopen the pages. Nothing here describes a page from memory, and nothing copies a product's name, logo, text or palette.

**Used for this plan:**

- Linear: "How we redesigned the Linear UI" (Inter Display for headings, opacity-based layers), "Behind the latest design refresh" and the 2026-03-12 changelog (a dimmer sidebar, fewer dividers, the same header everywhere), docs on display options and issue properties (fixed status order, empty groups hidden), the changelog (priority inbox).
- Vercel: web interface guidelines (loading delays, real links, confirm destructive actions, polite live regions, inputs at 16 px on mobile), Geist typography (label vs copy roles, tabular numbers), Geist materials (radius per level), Geist empty state (variants and anatomy), Geist status dot (a word per state), the dashboard navigation changelog, the deployments docs (an action named the same in its dialog).
- Resend: login and signup anatomy (one task per page, the alternative folded), the email events timeline.
- Raycast: toast API (one toast updated in place), perceived-speed article (keep content until the swap), action panel and naming.
- Stripe: dashboard basics (sidebar groups, personal vs team settings), empty-state, loading and communicating-state patterns, badge semantics, review requirements, the accessible color systems article.
- Tailscale: device filters and device approval (needs-action first), audit logging (columns and order), auth keys (shown once, revoke rules), "The heart of dark mode" (borders on dark overlays, darker backdrop, outline focus).
- GitHub Primer: layout kinds (interstitial pages), typography primitives, color usage (measure against the muted surface), loading, notification messaging, data table, empty states.
- IBM Carbon: spacing, 2x grid, data table usage (row heights), type sets, themes and color (dark layers), motion, empty states, notifications.
- Shopify Polaris, legacy guidance read from the archived repository's source files: error messages, fundamentals, density, empty state, loading, motion; and the current empty-state web component page on shopify.dev.
- GitLab Pajamas: UI text, empty states, saving and feedback, table, toast, badge, alert, animation and type fundamentals, layout.
- Atlassian: spacing, elevation, typography, color, motion, dynamic table, lozenge usage, flag usage, designing messages, error messages, empty state.
- component.gallery: table, tabs, badge, empty state; the WAI-ARIA APG tabs pattern (it corrects component.gallery's arrow keys).
- saasui.design: home, llms.txt and the table, empty-state, settings, login and dashboard pattern captions.
- github.com/VoltAgent/awesome-design-md: LICENSE (MIT, "Copyright (c) 2026 VoltAgent"), README, the folder tree, and the DESIGN.md files for Linear, Vercel, Resend, Raycast, Sentry and Supabase, for their outline only (surface ladders, radius by size, one shadow for floating layers). No text copied, so nothing goes to NOTICE or REUSE.md.

**Consulted but of no use here:** vercel.com and tailscale.com home pages (marketing), linear.app/docs (structure only), resend.com home (index only), resend.com domains docs (no relevant content), the Tailscale device-management overview and the first part of its changelog, the saasui.design notification pattern and Linear profile (generic captions), refero.design llms.txt (site organization only), the GitLab Pajamas home page (navigation only).

**Not consulted** (the page did not load, or was never opened):

- vercel.com/docs/dashboard-features and vercel.com/docs/concepts/dashboard-features/overview (404).
- polaris.shopify.com/content/error-messages (redirect to a page without the guidelines); polaris-react.shopify.com/content/error-messages and /content/actionable-language (connection failed).
- atlassian.design/components/lozenge and atlassian.design/content (rendered empty); atlassian.design/foundations/content/writing-guidelines/writing-error-messages (404).
- saasui.design/openapi.json (404).
- refero.design home and /patterns (only the title came back): the screen library is not consulted.
- Empty-state pages of Carbon, Evergreen, PatternFly, SAP Fiori, GitLab and Supabase that appeared only as search snippets; emptystat.es; the Balsamiq guidelines and Open UI linked from component.gallery.
- The color and font token tables of the Stripe Apps style page did not render: their sizes are not known.

---

## Appendix A. Inventory summary (step 0)

Measured on the demo hub (PGlite, fictitious team "Acme web"), 59 views × 8 combinations (light and dark at 360, 768 and 1280 px; French light at 360 and 1280 px) = 472 full-page captures in `docs/visual/before/` (ignored by Git), with measurements per page. Baseline before any change: `pnpm e2e:console` 23 of 23 passed; hub tests 259 passed, 4 skipped; console end-to-end tests 70 passed.

| Topic | Finding |
| --- | --- |
| Rendering | No doctype: every page in quirks mode. 4xx pages are a bare `<div>`: black serif text on white, also in dark mode, English only, no way back. |
| Contrast, text | No AA failure on the styled pages. Lowest: 4.55:1 in light (Teal on Paper), 8.75:1 in dark. Teal on the raised surface would be 4.21:1 and is avoided only by luck. The error pages report 1:1 in the measure because they declare no background; on screen they are black on white. |
| Contrast, controls | Inputs and secondary buttons 3.26:1 or more. "Quiet" buttons (Remove, Rename, Deny) have no edge (1.19:1) and look like links, destructive ones included; 21 view-combinations have them. |
| Memory diff | The "added" background is 1.08:1 (light) and 1.16:1 (dark) against the page: added text cannot be told apart; removed text only by its strike. |
| Page overflow | None at 360 px, in English and French. |
| Hidden scrolling | Tables cut off inside `.table-wrap` with no hint: 12 views at 360 px, 16 at 768 px, 3 at 1280 px (5 in French). Worst: agents 982/488 px at 768, audit 1157/1000 px at 1280. |
| Mobile navigation | One row of 14 links: 1175 px wide in 328 px (1301 px in French); three quarters of the destinations off screen. |
| Page length at 360 px | Audit 13 973 px for 50 events; agents 4 582 px for 8 sessions; overview: "To handle" starts about 2 300 px down a 3 306 px page. |
| Targets | Skip link 23 px tall; settings checkboxes 13 × 13 px; inline links 16 to 19 px ("Open thread" 30 times on the owner's overview). |
| Type | Rendered sizes 40 / 24 / 16 / 15 / 14 / 13.1 / 13 / 11.4 px. The same 40 px H1 on forms and dense tables. Only one jump between H2 (24) and body (15). Prose in mono. |
| Identity | ULIDs as primary labels: thread links, audit actors and subjects, project ids. One person written four ways ("Sam (agent)", "Sam", "@sam", "sam@feat/login-errors"). |
| States | Loading: 60 % opacity only. Success: no feedback, every action reloads the page. Errors: under the form, English, lowercase. Empty: "Nothing yet." with no action on 7 screens. No confirmation on any one-click destructive action. No visible selection on filters and tabs. A paused agent shows as online. |
| Buttons | Every submit is a filled primary: four on the sign-in page, Accept and Reject both filled, "Erase my data" filled like "Save". Adjacent buttons touch. Up to four equal buttons per member row (30 on the page). |
| French | Missing keys ("Audit log", "Personal tokens", "Team memory", "Push", "Permissions", "team", "direct"); whole screens in English (thread, tokens, audit, memory, claims, tasks, task, My data); English relative dates on French pages; raw enum values; "fil ouverte"; « vous » in two strings. French breaks no page width but wraps headers and the project filter. |
| Live feed | No screen: SSE refreshes `#live` (overview) and `main` (thread). The refresh replaces the focused element; no connection indicator. |

Per screen, the inventory's main points are folded into the wireframes (section 3.4), the component states (section 5) and the text examples (section 9).

## Appendix B. How this plan was checked

- **Contrast:** `node contrast.mjs` at step 1, outside the repository; the foundations turned it into `apps/hub/test/contrast.test.ts`, which reads the tokens from `console.css` itself. It mixes tokens the way CSS `color-mix(in srgb, …)` does, computes WCAG 2.x ratios for the 40 pairs of section 2.1, and exits non-zero if an allowed pair is under its minimum. Last run: exit 0, no allowed pair under its minimum, 4 pairs rejected in light mode and replaced. It also prints the OKLCH hues and the white-on-Teal figures used in Q1 and Q2.
- **Inter's axes:** the `fvar` table of both shipped files (`inter-latin-opsz-normal.woff2`, `inter-latin-ext-opsz-normal.woff2`) was read by decompressing the WOFF2 stream: `opsz` 14 to 32 (default 14), `wght` 100 to 900 (default 400).
- **Icon licences:** `LICENSE` and `package.json` read from the `lucide-static` 1.56.0 and 1.63.0 tarballs and from the `@tabler/icons` 3.50.0 tarball, downloaded from the npm registry into an isolated folder and never executed. The 22 icon names were checked in both Lucide versions, and in Tabler.
- **htmx facts:** in the vendored htmx 2.0.11, `htmx:confirm` carries `issueRequest(skipConfirmation)` and `hx-disabled-elt` exists; the vendored sse extension 2.2.4 fires `htmx:sseOpen`, `htmx:sseError` and `htmx:sseClose`.
- **Captures looked at for this plan:** light 1280 overview, sign-in, audit and projects; dark 1280 long thread; dark 360 overview and 404 page; light 768 agents; light 360 long thread; French light 1280 members. The rest of the 472 captures is covered by the measurements in appendix A.
