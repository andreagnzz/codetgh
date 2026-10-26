/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import { BrandHead, Logo } from "./brand.js";
import { type Lang, t } from "./i18n.js";

export const Layout = ({ lang, title = "CodeTgh", children }: { lang: Lang; title?: string; children?: Child }) => (
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
);

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
