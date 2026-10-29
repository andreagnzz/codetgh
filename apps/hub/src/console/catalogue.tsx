/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import { type Lang, t } from "../i18n.js";
import { Icon } from "../icons.js";
import {
  Action,
  Banner,
  Chip,
  CodeBlock,
  Collapsible,
  EmptyState,
  Field,
  fieldAria,
  Pager,
  Panel,
  Pill,
  RowMenu,
  Table,
  Tabs,
  Timeline,
} from "./pages.js";

// Development and tests only (never mounted when NODE_ENV is production): every component of the console in every state it
// can show without an action, with fictitious data. Its own headings are not translated; the components' words are.
const HOUR = 3_600_000;

export const Catalogue: FC<{ lang: Lang }> = ({ lang }) => {
  const _ = (s: string) => t(lang, s);
  const at = (hoursAgo: number) => new Date(Date.UTC(2026, 9, 28, 21, 40) - hoursAgo * HOUR);
  return (
    <>
      <p class="lede">
        Every component, in every state it can show without an action. Fictitious data. Not served in production. Hover, focus, the dialog
        and the toast need a pointer or a key.
      </p>

      <h2>Type</h2>
      <p class="meta">Title 28/32 and display 40/44 are Inter Display (optical size 32); the rest is Inter.</p>
      <h3>Subheading, 16/24 at 600</h3>
      <p>Body, 14/20 at 400: the interface text of tables, forms and lists.</p>
      <p class="timeline-body">Reading, 14/22: message bodies and help paragraphs keep their line breaks.{"\n"}A second line.</p>
      <p class="meta">Caption, 12/16: metadata, column headers, help.</p>
      <p>
        Mono, 13: <code>codetgh start</code>, <code>lea@main</code>, <kbd>Ctrl</kbd> <kbd>C</kbd>.
      </p>

      <h2>Buttons</h2>
      <p class="actions">
        <button type="button" class="primary">
          Save settings
        </button>
        <button type="button">Export JSON</button>
        <button type="button" class="tertiary">
          Get a sign-in link by email instead
        </button>
        <button type="button" class="danger">
          Revoke token…
        </button>
      </p>
      <p class="actions">
        <button type="button" class="primary" aria-busy="true">
          Saving
        </button>
        <button type="button" aria-busy="true">
          Verifying
        </button>
        <button type="button" class="primary" aria-disabled="true">
          Disabled
        </button>
        <button type="button" aria-disabled="true">
          Disabled
        </button>
        <button type="button" class="icon-button" aria-label={_("Close")}>
          <Icon name="x" />
        </button>
      </p>
      <p class="actions">
        <span id="demo-confirm-host">
          <Action
            post="/console/catalogue/done"
            label="Revoke token"
            level="danger"
            confirm={{
              title: "Revoke the token laptop-cli?",
              body: "Terminals using it stop at their next request. Sessions already open are not closed.",
            }}
            done="Token laptop-cli revoked."
          />
        </span>
        <Action
          post="/console/catalogue/done"
          label="Resend invitation"
          confirm={{ title: "Resend the invitation to ines@acme.test?", body: "The old link stops working." }}
          done="Invitation emailed to ines@acme.test."
        />
        <Action post="/console/catalogue/refused" label="An action the hub refuses" />
        <Action
          post="/console/catalogue/refused"
          label="Remove agent"
          level="danger"
          confirm={{ title: "Remove the agent sam@main?", body: "The hub refuses this one, so the dialog shows why and stays open." }}
        />
      </p>

      <h2>Fields</h2>
      <form>
        <Field id="demo-email" label="Email" lang={lang} help="The address the invitation goes to.">
          <input
            id="demo-email"
            name="email"
            type="email"
            spellcheck={false}
            placeholder="name@example.com…"
            {...fieldAria("demo-email", { help: 1 })}
          />
        </Field>
        <Field id="demo-label" label="Label" lang={lang} optional>
          <input id="demo-label" name="label" value="lea laptop" />
        </Field>
        <Field id="demo-invalid" label="Email" lang={lang} error="This email address isn't valid. Enter an address like name@example.com.">
          <input id="demo-invalid" name="invalid" value="lea@" {...fieldAria("demo-invalid", { error: 1 })} />
        </Field>
        <Field id="demo-days" label="Valid for" lang={lang}>
          <span class="with-unit">
            <input id="demo-days" name="days" type="number" value="7" />
            <span>days</span>
          </span>
        </Field>
        <Field id="demo-role" label="Role" lang={lang}>
          <select id="demo-role" name="role">
            <option>member</option>
            <option>admin</option>
            <option>guest</option>
          </select>
        </Field>
        <Field id="demo-note" label="Note" lang={lang} help="One regular expression per line.">
          <textarea id="demo-note" name="note" rows={3} {...fieldAria("demo-note", { help: 1 })} />
        </Field>
        <Field id="demo-readonly" label="Project id" lang={lang}>
          <input id="demo-readonly" name="readonly" value="prj_01JD8Y6F2Q0M7XW3V5N9T4K2RA" readonly />
        </Field>
        <Field id="demo-disabled" label="Team name" lang={lang}>
          <input id="demo-disabled" name="disabled" value="Acme web" disabled />
        </Field>
        <label>
          <input type="checkbox" name="rewake" checked /> Allow rewake push: an idle session wakes up when a message arrives
        </label>
        <label>
          <input type="radio" name="claims" checked /> Ask the human
        </label>
        <label>
          <input type="radio" name="claims" /> Warn the agent, never block
        </label>
      </form>
      <form class="inline">
        <label>
          Handle <input name="handle" value="lea" size={10} />
        </label>{" "}
        <button type="submit" class="secondary">
          Rename
        </button>
      </form>

      <h2>Pills and handles</h2>
      <p class="actions">
        <Pill tone="ok">Running</Pill>
        <Pill>Idle</Pill>
        <Pill tone="warn">Prompts off</Pill>
        <Pill tone="warn">Proposed</Pill>
        <Pill tone="danger">Quarantined</Pill>
        <Pill tone="danger">Blocked</Pill>
      </p>
      <p class="actions">
        <Chip>@lea</Chip>
        <Chip>lea@main</Chip>
        <span>
          <Chip>@lea</Chip> <span class="meta">you</span>
        </span>
        <span>
          Partner support bot <span class="meta">external</span>
        </span>
        <span>
          <Chip former>@yann</Chip> <span class="meta">former member</span>
        </span>
        <Chip>sam@feature/a-very-long-branch-name-that-keeps-going-for-the-layout-check-2026</Chip>
      </p>

      <h2>Tabs</h2>
      <Tabs
        label="Memory"
        items={[
          { href: "#proposed", text: "Proposed", count: 3, current: true },
          { href: "#accepted", text: "Accepted", count: 12, current: false },
          { href: "#rejected", text: "Rejected", count: 1, current: false },
          { href: "#all", text: "Every status, superseded and rejected included", current: false },
        ]}
      />

      <h2>Table</h2>
      <Banner
        tone="danger"
        title="Couldn't refresh."
        actions={
          <button type="button" class="tertiary">
            Retry
          </button>
        }
      >
        Showing data from 21:40.
      </Banner>
      <Table
        caption="Personal tokens"
        head={["Label", "Created", "Uses", "State", ""]}
        sort={{ column: 1, dir: "descending" }}
        numeric={[2]}
        current={1}
        unread={[0]}
        rows={[
          [
            <a class="row-link" href="#token-1">
              lea laptop
            </a>,
            "28 Oct, 21:36",
            "1 204",
            <Pill tone="ok">Active</Pill>,
            <RowMenu
              label="Actions for lea laptop"
              items={[
                <button type="button">Rename</button>,
                <button type="button" class="danger">
                  Revoke…
                </button>,
              ]}
            />,
          ],
          [
            <a class="row-link" href="#token-2">
              ci (GitHub Actions)
            </a>,
            "27 Oct, 09:12",
            "86",
            <Pill tone="warn">Expires in 2 days</Pill>,
            <RowMenu label="Actions for ci (GitHub Actions)" items={[<button type="button">Rename</button>]} />,
          ],
          [
            <a class="row-link" href="#token-3">
              a-token-label-long-enough-to-wrap-on-a-phone-without-scrolling-the-page
            </a>,
            "3 Oct, 18:02",
            "0",
            <Pill>Revoked</Pill>,
            "",
          ],
        ]}
        empty=""
      />
      <Pager lang={lang} newer="#newer" older="#older" shown={50} total={128} />
      <h3>Loading</h3>
      <div aria-busy="true">
        <Table
          head={["Who", "Branch"]}
          rows={[
            ["Sam", <Chip>sam@feat/login-errors</Chip>],
            ["Malik", <Chip>malik@fix/invoice-rounding</Chip>],
          ]}
          empty=""
        />
        <p class="loading-text">{_("Loading…")}</p>
      </div>
      <h3>Empty</h3>
      <Table
        head={["Label", "Created"]}
        rows={[]}
        empty={
          <EmptyState title="No personal tokens yet." action={<button type="button">Create a token</button>}>
            Create one to sign in a terminal.
          </EmptyState>
        }
      />

      <h2>Banners</h2>
      <Banner title="You're reading a direct thread as an admin." dismiss={_("Close")}>
        This opening is recorded in the audit log.
      </Banner>
      <Banner tone="success" title="Chain verified.">
        128 events, signed checkpoint at 21:40.
      </Banner>
      <Banner
        tone="warn"
        title="The loop guard muted this thread."
        actions={
          <>
            <button type="button">Reopen thread</button>
            <a href="#reply">Reply as a person</a>
          </>
        }
      >
        Agents wrote 5 messages in a row.
      </Banner>
      <Banner tone="danger" title={_("Agent traffic stopped")}>
        {_("Agents can't send messages until an admin resumes it.")} <a href="#traffic">{_("Resume agent traffic")}</a>
      </Banner>
      <Banner tone="danger" title="2 fields need a fix.">
        <a href="#demo-invalid">Email</a>, <a href="#demo-days">Valid for</a>.
      </Banner>

      <h2>Panels</h2>
      <Panel title="Team name">
        <p>Shown in the top bar and in invitations.</p>
        <form class="inline">
          <label>
            Name <input name="team" value="Acme web" />
          </label>{" "}
          <button type="submit" class="secondary">
            Rename the team
          </button>
        </form>
      </Panel>
      <Panel title="Erase my data" tone="danger">
        <p>Your messages, tokens and sessions on this hub. Your teammates keep what they wrote to you.</p>
        <p class="actions">
          <button type="button" class="danger">
            Erase my data…
          </button>
        </p>
      </Panel>
      <Collapsible summary="Invite a member">
        <p class="lede">The link is valid 7 days.</p>
      </Collapsible>
      <Collapsible summary="Create a token" open>
        <Field id="demo-token" label="Label" lang={lang}>
          <input id="demo-token" name="token" />
        </Field>
        <button type="submit">Create a token</button>
      </Collapsible>
      <details class="disclosure">
        <summary>
          Get a sign-in link by email instead
          <Icon name="chevron-down" />
        </summary>
        <p>The disclosure keeps a rare path one step away.</p>
      </details>

      <h2>Code</h2>
      <CodeBlock lang={lang} command code="codetgh invite ines@acme.test" />
      <Banner tone="warn" title="Copy it now.">
        You won't see this token again.
      </Banner>
      <CodeBlock lang={lang} code="ctgh_DEMO-TOKEN-SHOWN-ONCE-DEMO-TOKEN-SHOWN-ONCE" />
      <CodeBlock
        lang={lang}
        code={
          "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAdemoDEMOdemoDEMOdemoDEMOdemoDEMOdemoDEMO0=\n-----END PUBLIC KEY-----\nhttps://ci.acme.test/acme/webapp/actions/runs/1234567890/job/9876543210/attempts/1"
        }
      />

      <h2>Empty states</h2>
      <EmptyState title="No agents connected." icon="terminal">
        Copy the invite command to add one.
      </EmptyState>
      <CodeBlock lang={lang} command code="codetgh invite <email>" />
      <EmptyState title="No threads in acme/api." action={<a href="#all-projects">Show all projects</a>}>
        Threads appear here when an agent of the project writes.
      </EmptyState>
      <p class="empty">No open alerts.</p>
      <EmptyState title="Only admins can see the audit log.">Ask an admin of Acme web.</EmptyState>
      <EmptyState
        title="Couldn't load the claims."
        icon="triangle-alert"
        action={
          <button type="button" class="secondary">
            Retry
          </button>
        }
      >
        The hub didn't answer in time.
      </EmptyState>

      <h2>Timeline</h2>
      <Timeline
        lang={lang}
        empty="No history yet."
        events={[
          { at: at(3), actor: <Chip>@sam</Chip>, text: "Created the task", change: true },
          { at: at(2.5), actor: <Chip>@sam</Chip>, text: "Claimed the task", change: true },
          { at: at(1), actor: <Chip>@sam</Chip>, text: "Added a note", body: "Email and password done,\nthe code field is next." },
          { at: at(0.2), actor: <Chip>@sam</Chip>, text: "Moved to In progress", change: true, now: true },
        ]}
      />
      <h3>Long</h3>
      <Timeline
        lang={lang}
        empty="No history yet."
        fold={2}
        events={Array.from({ length: 14 }, (_, i) => ({ at: at(14 - i), actor: <Chip>@nora</Chip>, text: `Note ${i + 1}` }))}
      />
      <h3>Empty</h3>
      <Timeline lang={lang} empty="No history yet." events={[]} />

      <h2>Toast</h2>
      <div class="toast">
        <Icon name="circle-check" />
        <p>Invitation emailed to ines@acme.test.</p>
        <button type="button" class="icon-button" aria-label={_("Close")}>
          <Icon name="x" />
        </button>
      </div>
    </>
  );
};
