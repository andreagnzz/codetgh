/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { BrandHead, Logo } from "./brand.js";
import { type Lang, t } from "./i18n.js";
import { Icon } from "./icons.js";

// The doctype keeps every browser out of quirks mode. The column is centered, as the stacked logo asks; its text stays
// left-aligned. A page that shows the hub's answer next to what it is about renders its own HubAnswer.
export const Layout = ({
  lang,
  title = "CodeTgh",
  ownError = false,
  children,
}: {
  lang: Lang;
  title?: string;
  ownError?: boolean;
  children?: Child;
}) => (
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
          {!ownError && <HubAnswer lang={lang} />}
        </main>
        {/* The icons /assets/oauth.js draws next to a refusal or a success. */}
        <template id="error-icon">
          <Icon name="circle-alert" />
        </template>
        <template id="done-icon">
          <Icon name="circle-check" />
        </template>
        <script src="/assets/oauth.js" />
      </body>
    </html>
  </>
);

// Where /assets/oauth.js writes the hub's answer, in the page's language: data-words holds the page's sentences, keyed by
// the hub's error code, and the ones every page needs.
const ANSWER_WORDS = {
  said: "The hub said: {reason}",
  generic: "The hub could not handle the request. Try again; if it keeps failing, check the hub logs.",
  offline: "The hub does not answer. Check your connection, then try again.",
};
export const HubAnswer = ({ lang, words = {} }: { lang: Lang; words?: Record<string, string> }) => (
  <p
    id="error"
    class="field-error"
    role="alert"
    data-words={JSON.stringify(Object.fromEntries(Object.entries({ ...ANSWER_WORDS, ...words }).map(([k, v]) => [k, t(lang, v)])))}
  />
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

const PROVIDER_LABEL = { github: "Continue with GitHub", google: "Continue with Google", sso: "Continue with your organization" };
const UNAVAILABLE = "This sign-in method isn't available on this hub. Use another one.";
const SIGN_IN_WORDS = {
  INVALID_EMAIL_OR_PASSWORD: "The email or password is wrong. Check both, then try again.",
  INVALID_EMAIL: "This email address isn't valid. Enter an address like name@example.com.",
  PROVIDER_NOT_FOUND: UNAVAILABLE,
  unavailable: UNAVAILABLE,
  // The same answer whether or not the address has an account: the page never tells who is a member.
  sent: "If this address has an account or an invitation, a sign-in link is on its way. It works for 10\u00a0minutes.",
  unsent: "The link wasn't sent. Check the address, then try again.",
};

// One button per sign-in provider the hub is configured with (auth.ts reads them from the environment). Email and password
// hold the page's one primary button; the providers are secondary, and the emailed link stays folded.
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
    <Layout lang={lang} title={`${_("Sign in")} · CodeTgh`} ownError>
      <h1>{_("Sign in")}</h1>
      <p class="lede">{_("Use the account your team set up on this hub.")}</p>
      {providers.length > 0 && (
        <>
          <div class="providers">
            {providers.map((p) => (
              <button type="button" class="secondary" data-provider={p}>
                {_(PROVIDER_LABEL[p])}
              </button>
            ))}
          </div>
          <p class="or">
            <span>{_("or")}</span>
          </p>
        </>
      )}
      {/* The hub's answer sits under the fields it is about, and each field points at it. */}
      <form id="login">
        <label>
          {_("Email")} <input name="email" type="email" required autocomplete="username" spellcheck={false} aria-describedby="error" />
        </label>
        <label>
          {_("Password")} <input name="password" type="password" required autocomplete="current-password" aria-describedby="error" />
        </label>
        <HubAnswer lang={lang} words={SIGN_IN_WORDS} />
        <button type="submit" class="primary">
          {_("Sign in")}
        </button>
      </form>
      {magicLink && (
        <details class="disclosure">
          <summary>
            {_("Get a sign-in link by email instead")}
            <Icon name="chevron-down" />
          </summary>
          <form id="magic-link">
            <label>
              {_("Email")}{" "}
              <input name="email" type="email" required autocomplete="email" spellcheck={false} aria-describedby="link-result" />
            </label>
            <p id="link-result" role="status" />
            <button type="submit" class="secondary">
              {_("Email me a link")}
            </button>
          </form>
        </details>
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
