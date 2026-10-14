/** @jsxRuntime automatic @jsxImportSource hono/jsx */

// The brand kit's head snippet (web/head-snippet.html) and the one stylesheet of every page.
export const BrandHead = () => (
  <>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="/favicon.ico" sizes="48x48" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <meta name="theme-color" content="#087F70" />
    <link rel="stylesheet" href="/console.css" />
  </>
);

// The kit's files as they are: color on light, on-dark on dark; the symbol alone on small screens (console header).
export const Logo = ({ kind }: { kind: "horizontal" | "stacked" }) => (
  <a class="brand" href={kind === "horizontal" ? "/console" : "/login"}>
    <picture>
      {kind === "horizontal" && (
        <>
          <source media="(max-width: 600px) and (prefers-color-scheme: dark)" srcset="/brand/symbol-mint-thin.svg" />
          <source media="(max-width: 600px)" srcset="/brand/symbol-color.svg" />
        </>
      )}
      <source media="(prefers-color-scheme: dark)" srcset={`/brand/lockup-${kind}-on-dark.svg`} />
      <img src={`/brand/lockup-${kind}-color.svg`} alt="CodeTgh" />
    </picture>
  </a>
);
