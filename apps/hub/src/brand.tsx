/** @jsxRuntime automatic @jsxImportSource hono/jsx */

// One stylesheet per screen batch of the redesign, after console.css (tokens, base, shell, components): each batch edits
// only its own file.
const BATCHES = ["pages-publiques", "vue-ensemble", "fils-alertes", "agents-projets", "membres-reglages", "audit-memoire"];

// The brand kit's head snippet (web/head-snippet.html) and the stylesheets of every page. The browser bar takes the page's
// color (Paper, or Ink in dark mode); Teal stays the color of the app icon and the manifest.
export const BrandHead = () => (
  <>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F4F7F6" />
    <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0D1B1A" />
    <link rel="stylesheet" href="/console.css" />
    {BATCHES.map((b) => (
      <link rel="stylesheet" href={`/console-${b}.css`} />
    ))}
  </>
);

// The kit's files as they are: color on light, on-dark on dark; the symbol alone in the console's app bar, under 1024 px.
export const Logo = ({ kind }: { kind: "horizontal" | "stacked" }) => (
  <a class="brand" href={kind === "horizontal" ? "/console" : "/login"}>
    <picture>
      {kind === "horizontal" && (
        <>
          <source media="(max-width: 1023px) and (prefers-color-scheme: dark)" srcset="/brand/symbol-mint-thin.svg" />
          <source media="(max-width: 1023px)" srcset="/brand/symbol-color.svg" />
        </>
      )}
      <source media="(prefers-color-scheme: dark)" srcset={`/brand/lockup-${kind}-on-dark.svg`} />
      <img src={`/brand/lockup-${kind}-color.svg`} alt="CodeTgh" />
    </picture>
  </a>
);
