# CodeTgh brand

**Plusieurs Claude Code, une même ligne.**

The source of truth is `assets/brand/`: the files and `brand-guidelines.md` exactly as the brand kit delivered them. Never edit an SVG or PNG there. Copy it instead.

## Palette (the brand's only colors)

| Token | Hex | Use |
| --- | --- | --- |
| `--teal` Link Teal | `#087F70` | Main color: buttons, links and accents on light backgrounds (4.55:1 on Paper, 4.91:1 on white) |
| `--mint` Link Mint | `#3EE6C1` | Accents on dark backgrounds **only** (11.2:1 on Ink). Never on white or on Paper |
| `--ink` Ink | `#0D1B1A` | Main text, and the dark background |
| `--paper` Paper | `#F4F7F6` | Light background of the console |

Borders and highlights in `apps/hub/public/console.css` are `color-mix` tints of these four tokens. The console adds only white for raised surfaces and the primary label in light mode, and six state colors, all listed in « Interface de la console » below; none of them ever touches the logo.

## Type

- **Interface**: Inter, self-hosted in `apps/hub/public/fonts` (variable font: weight, and an optical size axis that gives Inter Display for large titles). Fallback: `system-ui, sans-serif`. License: SIL OFL 1.1, see `Inter-LICENSE.txt` and `NOTICE`.
- **Code**: `ui-monospace, "JetBrains Mono", monospace`.

## Logo versions and where they are used

| File (`assets/brand/`) | Where |
| --- | --- |
| `lockup-horizontal-color.svg` / `-on-dark.svg` | Console header (light / dark), README header |
| `symbol-color.svg` / `symbol-mint-thin.svg` | Console app bar on screens under 1024 px (light / dark) |
| `lockup-stacked-color.svg` / `-on-dark.svg` | Sign-in, OAuth consent, invitation and full-page error pages, centered |
| `symbol-color.svg` | `packages/plugin/assets/symbol.svg` (plugin `icon`, read only by Anthropic's plugin directory) |
| kit `web/` files (`assets/brand/web/` keeps the SVGs) | `apps/hub/public/`: favicons, `apple-touch-icon.png`, app icons, `site.webmanifest`, served at the hub root |
| `lockup-*-black.svg`, `-white.svg`, `symbol/` | Not used on screen yet: one-color print, and white on Teal |

The CLI prints a one-line banner in Teal only. A terminal's background color is unknown, so Mint is never used there.

## Rules

- Minimum sizes: horizontal lockup 120 px wide, stacked 80 px, symbol 24 px. Below 24 px, use `symbol-small.svg` or `favicon.svg`.
- Clear space: keep 1 × the height of the « C » empty all around the logo. For the symbol alone, use the height of the right caret.
- Never retype the wordmark: it is drawn as paths.
- Never stretch, rotate or recolor the logo, never move its parts, and never add a shadow, outline, gradient or any other effect.
- Mint only on Ink, or on another dark background.
- Never put the logo on a busy background without a plain container.

## Interface de la console

Decided at gate A of the console redesign (2026-10-29); the plan and its reasons are in `docs/reports/refonte-front.md`.

### Colors

Components use the semantic tokens of `apps/hub/public/console.css`, never `--teal` or `--mint` directly. The theme follows `prefers-color-scheme`.

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

- **White** (`#FFFFFF`) raises a surface in light mode (panels, menus, dialogs, toasts, the public column) and is the label of the Teal primary button (4.90:1). Paper stays the page.
- **Mint** fills the primary button in dark mode, with an Ink label (11.18:1). Mint never sits on a light surface.
- **State colors**, interface only, never on the logo and never as the accent: success `#4A6800` / `#B8DA6B`, warning `#8A5000` / `#F4B04F`, error `#B42318` / `#FF9C8F` (light / dark). They sit at least 47° of OKLCH hue from Teal and Mint, and a state is always a word as well.
- **Teal text** only on Paper (4.55:1) and white (4.90:1). On a tint (sidebar, hovered row, banner) a link is Ink with an underline.
- **Contrast**: `apps/hub/test/contrast.test.ts` reads these tokens from the stylesheet and fails if any pair used for text (4.5:1) or for a component or a rule that carries information (3:1) falls under AA, in either theme.
- **Browser bar**: `theme-color` is Paper in light and Ink in dark (two `media` meta tags); Teal stays the color of the app icon and the manifest.

### Type, space, shape, depth, motion

- **Type**: 12/16 caption, 14/20 body (14/22 for reading), 16/24 subheading, 20/28 heading, 28/32 page title, 40/44 public title (32/36 under 640 px). Weights 400, 500, 600. The two large roles are Inter Display through the variable font's optical size axis (`"opsz" 32`); no second font file. Mono only for what a machine reads.
- **Space**: a 4 px grid: 4, 8, 12, 16, 24, 32, 48, 64. Prose is at most 31.5 rem wide (56 ch of Inter at 14 px).
- **Radius**: 4 px for tokens (handle chip, `kbd`), 6 px for controls, 8 px for containers, 12 px for floating layers and the public column, full round for a state pill only. No pill-shaped button.
- **Depth**: no shadow by default; a tonal step and 1 px rules. Only dialogs, menus and toasts have a shadow. Rules that carry information use `--border-strong` or the accent.
- **Motion**: hover changes color in 100 ms; the busy ring and the loading bar show only after 300 and 400 ms; the activity line traces a new message once. `prefers-reduced-motion` stops every movement.
- **Focus**: a 2 px accent outline, 2 px away, on every focusable element.

### Stylesheets and texts per batch

`console.css` holds the tokens, the base, the shell and the components. Each screen batch of the redesign has its own stylesheet, linked by every layout after `console.css`, and its own delimited block in `apps/hub/src/i18n.ts`: `console-pages-publiques.css`, `console-vue-ensemble.css`, `console-fils-alertes.css`, `console-agents-projets.css`, `console-membres-reglages.css`, `console-audit-memoire.css`. Until a batch restyles its screens, its file keeps the few rules today's markup still needs.

### Components

Built once in `apps/hub/src/console/pages.tsx` (and plain classes for buttons), shown in every state on `/console/catalogue`, a page that only the test harness and the demo hub built on it mount; the hub's own configuration never turns it on. Its own texts are English only, as a development page.

| Component | Markup | States |
| --- | --- | --- |
| Shell | `Layout`: side navigation in three groups, top bar (team, live state, account menu), Menu under 1024 px, page banner, project filter menu | current page, live / reconnecting / offline since a time, menus open and closed (Escape, a click outside or the keyboard leaving them closes them, focus returns) |
| Button | `<button>` with `primary`, `secondary` (default), `tertiary`, `danger`, `danger-fill`; `icon-button` | hover, active, focus, busy (`aria-busy`), disabled (`aria-disabled`); one primary per area |
| Field | `Field` + `fieldAria` | help, optional, placeholder (muted text), invalid (`aria-invalid`, icon and sentence), read-only (dashed edge), disabled; checkbox and radio in a 44 px row; a unit after the field |
| Status pill | `Pill` | success, warning, error, neutral (hollow dot); always a word |
| Handle chip | `Chip` | person, session, you, external, former member, truncated |
| Table | `Table` (+ `Pager`) | caption, sorted column (`aria-sort`), numbers, row link over the whole row, current and unread rows ("Unread" for screen readers), actions under a hidden header and a row menu that floats over the frame, loading, error banner, empty state instead of the table; a frame that scrolls shows its edge and takes the keyboard; stacked records under 640 px, led by the primary cell, empty cells dropped |
| Tabs | `Tabs`, `ArchiveTabs` | current (`aria-current`), counts, wrapped |
| Banner | `Banner` | information (dismissible), success, warning, error; with actions |
| Panel | `Panel`, `Collapsible`, `RowMenu` | default, danger, folded create form, menu open |
| Toast | layout region + `data-done` on the action | shown, paused on hover or focus, closed |
| Confirmation dialog | layout `<dialog>` + `Action` with `confirm` (the trigger ends in "…"), or a `form` with the same `data-confirm` texts | open with Cancel focused, busy, refused (the reason in the dialog), closed (focus back on the trigger) |
| Code block | `CodeBlock` | command (prompt not copied), secret, long content, copied, copy refused (selected, with the shortcut); `copyLabel` when a page has several |
| Empty state | `EmptyState`, or `.empty` inline | first use, no results, cleared, no permission, error with Retry |
| Loading | `aria-busy` on the control and the region | busy ring, loading bar, "Loading…" in words under reduced motion |
| Timeline | `Timeline` | state change, note, current state, long (oldest folded), empty |

Icons: Lucide (`lucide-static` 1.56.0), only those drawn, in `apps/hub/src/icons.tsx`; always next to a word, hidden from assistive technology.

## Trademark

La marque n'a pas fait l'objet d'une recherche d'antériorité. Nothing in this repository registers or claims it as a trademark.
