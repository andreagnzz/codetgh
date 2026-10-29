/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { BrandHead, Logo } from "./brand.js";
import { type Lang, t } from "./i18n.js";

// The doctype keeps every browser out of quirks mode.
export const Layout = ({ lang, title = "CodeTgh", children }: { lang: Lang; title?: string; children?: Child }) => (
  <>
    {raw("<!doctype html>")}
    <html lang={lang}>
      <head>
        <meta charset="utf-8" />
        <BrandHead />
        <title>{title}</title>
      </head>
      <body>
        <main class="public">
          <Logo kind="stacked" />
          {children}
          <p id="error" class="field-error" role="alert" />
        </main>
        <script src="/assets/oauth.js" />
      </body>
    </html>
  </>
);

// What happened, and what to do about it, by status; a caller that knows more gives its own words.
const ERROR_TEXT: Record<number, [string, string]> = {
  400: ["This request isn't valid.", "Check the link, or go back and try again."],
  403: ["You can't open this page.", "Your role doesn't allow it. Ask an admin of your team if you need it."],
  404: ["This page doesn't exist.", "Check the link, or start again from the overview."],
};

// A page load the hub refuses: what happened, the hub's own reason as a sentence, what to do, and a way back. An htmx
// request keeps the bare reason.
export const ErrorPage = ({
  status,
  reason,
  lang,
  title,
  next,
  back = { href: "/console", label: "Back to the overview" },
}: {
  status: number;
  reason?: string;
  lang: Lang;
  title?: string;
  next?: string;
  back?: { href: string; label: string };
}) => {
  const _ = (s: string) => t(lang, s);
  const [byStatus, nextByStatus] = ERROR_TEXT[status] ?? ["The hub refused this request.", "Go back and try again."];
  const heading = _(title ?? byStatus);
  const why = reason && _(reason);
  return (
    <Layout lang={lang} title={`${heading} · CodeTgh`}>
      <h1>{heading}</h1>
      {why && <p>{_("The hub said: {reason}").replace("{reason}", () => (/[.!?]$/.test(why) ? why : `${why}.`))}</p>}
      <p class="lede">{_(next ?? nextByStatus)}</p>
      <p>
        <a href={back.href}>{_(back.label)}</a>
      </p>
    </Layout>
  );
};

const PROVIDER_LABEL = { github: "Sign in with GitHub", google: "Sign in with Google", sso: "Sign in with your organization" };

// One button per sign-in provider the hub is configured with (auth.ts reads them from the environment).
export const LoginPage = ({
  magicLink,
  providers,
  lang = "en",
}: {
  magicLink: boolean;
  providers: Array<keyof typeof PROVIDER_LABEL>;
  lang?: Lang;
}) => {
  const _ = (s: string) => t(lang, s);
  return (
    <Layout lang={lang}>
      <h1>{_("Sign in to CodeTgh")}</h1>
      {providers.length > 0 && (
        <p class="actions">
          {providers.map((p) => (
            <button type="button" class="primary" data-provider={p}>
              {_(PROVIDER_LABEL[p])}
            </button>
          ))}
        </p>
      )}
      <form id="login">
        <label>
          {_("Email")} <input name="email" type="email" required autocomplete="username" />
        </label>
        <label>
          {_("Password")} <input name="password" type="password" required autocomplete="current-password" />
        </label>
        <button type="submit">{_("Sign in")}</button>
      </form>
      {magicLink && (
        <form id="magic-link">
          <label>
            {_("Or get a sign-in link by email")} <input name="email" type="email" required autocomplete="email" />
          </label>
          <button type="submit">{_("Email me a link")}</button>
        </form>
      )}
    </Layout>
  );
};

export const ConsentPage = ({
  clientId,
  scope,
  redirectHost,
  lang = "en",
}: {
  clientId: string;
  scope: string;
  redirectHost: string;
  lang?: Lang;
}) => {
  const _ = (s: string) => t(lang, s);
  return (
    <Layout lang={lang}>
      <h1>{_("Allow access to CodeTgh?")}</h1>
      <p>
        {_("Client")}: <code>{clientId}</code>
      </p>
      <p>
        {_("Scopes")}: <code>{scope}</code>
      </p>
      <p>
        {_("You will be sent back to")}: <strong>{redirectHost}</strong>
      </p>
      <p class="actions">
        <button type="button" class="primary" data-consent="accept">
          {_("Allow")}
        </button>{" "}
        <button type="button" data-consent="deny">
          {_("Deny")}
        </button>
      </p>
    </Layout>
  );
};
