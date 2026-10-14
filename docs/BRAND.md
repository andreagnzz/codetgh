# CodeTgh brand

**Plusieurs Claude Code, une même ligne.**

The source of truth is `assets/brand/`: the files and `brand-guidelines.md` exactly as the brand kit delivered them. Never edit an SVG or PNG there. Copy it instead.

## Palette (the only colors)

| Token | Hex | Use |
| --- | --- | --- |
| `--teal` Link Teal | `#087F70` | Main color: buttons, links and accents on light backgrounds (4.55:1 on Paper, 4.91:1 on white) |
| `--mint` Link Mint | `#3EE6C1` | Accents on dark backgrounds **only** (11.2:1 on Ink). Never on white or on Paper |
| `--ink` Ink | `#0D1B1A` | Main text, and the dark background |
| `--paper` Paper | `#F4F7F6` | Light background of the console |

Borders and highlights in `apps/hub/public/console.css` are `color-mix` tints of these four tokens. No other color is used.

## Type

- **Interface**: Inter, self-hosted in `apps/hub/public/fonts` (variable font: weight, and an optical size axis that gives Inter Display for large titles). Fallback: `system-ui, sans-serif`. License: SIL OFL 1.1, see `Inter-LICENSE.txt` and `NOTICE`.
- **Code**: `ui-monospace, "JetBrains Mono", monospace`.

## Logo versions and where they are used

| File (`assets/brand/`) | Where |
| --- | --- |
| `lockup-horizontal-color.svg` / `-on-dark.svg` | Console header (light / dark), README header |
| `symbol-color.svg` / `symbol-mint-thin.svg` | Console header on screens 600 px wide or less (light / dark) |
| `lockup-stacked-color.svg` / `-on-dark.svg` | Sign-in, OAuth consent and invitation pages, centered |
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

## Trademark

La marque n'a pas fait l'objet d'une recherche d'antériorité. Nothing in this repository registers or claims it as a trademark.
