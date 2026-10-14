/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";
import { BrandHead, Logo } from "./brand.js";
import { type Lang, t } from "./i18n.js";

const Layout = ({ lang, children }: { lang: Lang; children?: Child }) => (
  <html lang={lang}>
    <head>
      <meta charset="utf-8" />
      <BrandHead />
      <title>CodeTgh</title>
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

export const LoginPage = ({ magicLink, sso, lang = "en" }: { magicLink: boolean; sso: boolean; lang?: Lang }) => {
  const _ = (s: string) => t(lang, s);
  return (
    <Layout lang={lang}>
      <h1>{_("Sign in to CodeTgh")}</h1>
      {sso && (
        <p>
          <button type="button" id="sso" class="primary">
            {_("Sign in with your organization")}
          </button>
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
