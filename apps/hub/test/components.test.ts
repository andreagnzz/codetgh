import { jsx } from "hono/jsx";
import { describe, expect, it } from "vitest";
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
  RowMenu,
  Table,
  Tabs,
  Timeline,
} from "../src/console/pages.js";

// The console's components, rendered alone: the markup the stylesheet, console.js and assistive technology rely on.
const render = async (component: unknown, props: Record<string, unknown>, ...children: unknown[]) =>
  String(await jsx(component as never, props, ...(children as never[])).toString());

describe("components", () => {
  it("banner: the icon's shape and the role follow the severity, the text stays escaped", async () => {
    const error = await render(Banner, { tone: "danger", title: "<script>x</script>" }, "Agents can't send messages.");
    expect(error).toContain('role="alert"');
    expect(error).toContain('data-tone="danger"');
    expect(error).toContain('aria-hidden="true"');
    expect(error).toContain("&lt;script&gt;x&lt;/script&gt;");
    const info = await render(Banner, { title: "Recorded", dismiss: "Close" });
    expect(info).toContain('role="status"');
    expect(info).toMatch(/<button type="button" class="icon-button" aria-label="Close" data-dismiss/);
    expect(info).not.toContain("banner-body");
  });

  it("field: the label names the control, help and error describe it", async () => {
    const html = await render(Field, { id: "email", label: "Email", lang: "fr", help: "Help", error: "Wrong", optional: true });
    expect(html).toContain('<label for="email">Email<span class="optional"> facultatif</span></label>');
    expect(html).toContain('<p class="help" id="email-help">Help</p>');
    expect(html).toMatch(/<p class="field-error" id="email-error"><svg[^>]*aria-hidden="true"/);
    expect(fieldAria("email", { help: 1, error: 1 })).toEqual({ "aria-describedby": "email-help email-error", "aria-invalid": "true" });
    expect(fieldAria("email", {})).toEqual({ "aria-describedby": undefined, "aria-invalid": undefined });
  });

  it("table: a caption, the sorted column, numbers, the current and unread rows; with no rows, only the empty state", async () => {
    const html = await render(Table, {
      head: ["Label", "Uses"],
      rows: [
        ["a", "1"],
        ["b", "2"],
      ],
      empty: "None",
      lang: "fr",
      caption: "Tokens",
      sort: { column: 1, dir: "descending" },
      numeric: [1],
      current: 1,
      unread: [0],
    });
    expect(html).toContain('<caption class="sr-only">Tokens</caption>');
    expect(html).toMatch(/<th scope="col" class="num" aria-sort="descending">Uses<svg/);
    // An unread row says so in words to a screen reader, not only by the weight of its title.
    expect(html).toContain('<tr class="unread"><td data-label="Label"><div class="cell"><span class="sr-only">Non lu </span>a</div></td>');
    expect(html).toContain('<tr aria-current="true"><td data-label="Label"><div class="cell">b</div></td>');
    expect(html).toContain('<td data-label="Uses" class="num">');
    expect(await render(Table, { head: ["Label"], rows: [], empty: "No tokens yet.", lang: "en" })).toBe(
      '<p class="empty">No tokens yet.</p>',
    );
    const empty = await render(Table, { head: ["Label"], rows: [], empty: jsx(EmptyState, { title: "No tokens yet." }), lang: "en" });
    expect(empty).toContain('<div class="empty-state">');
    expect(empty).not.toContain("<table");
  });

  it("table: the primary cell leads a stacked record, the actions column has a hidden header and no label", async () => {
    const html = await render(Table, {
      head: ["Label", "Created", "Actions"],
      rows: [["lea laptop", "28 Oct", "Rename"]],
      empty: "None",
      lang: "en",
      primary: 0,
      actions: true,
    });
    expect(html).toContain('<td data-label="Label" class="primary-cell">');
    expect(html).toContain('<td data-label="Created">');
    expect(html).toContain('<th scope="col" class="actions-cell"><span class="sr-only">Actions</span></th>');
    expect(html).toContain('<td data-label="Actions" class="actions-cell">');
  });

  it("pager and tabs: named navigation, the current tab marked", async () => {
    const pager = await render(Pager, { lang: "fr", newer: "/a", older: "/b", shown: 50, total: 128 });
    expect(pager).toContain('<nav class="pager" aria-label="Pages">');
    expect(pager).toContain("50 affichés sur 128");
    expect(pager).toContain("Plus récents");
    expect(pager).toContain("Plus anciens");
    const tabs = await render(Tabs, {
      label: "Memory",
      items: [
        { href: "/p", text: "Proposed", current: true, count: 3 },
        { href: "/a", text: "Accepted", current: false },
      ],
    });
    expect(tabs).toContain('<nav class="tabs" aria-label="Memory">');
    expect(tabs).toContain('<a href="/p" aria-current="page">Proposed<span class="count">3</span></a>');
    expect(tabs).toContain('<a href="/a">Accepted</a>');
  });

  it("action: the level, the confirmation that repeats the label, the toast text; no confirmation unless asked", async () => {
    const asked = await render(Action, {
      post: "/console/tokens/t1/revoke",
      label: "Revoke token",
      level: "danger",
      confirm: { title: "Revoke the token laptop?", body: "Terminals using it stop." },
      done: "Token revoked.",
    });
    expect(asked).toContain('class="danger"');
    expect(asked).toContain('hx-post="/console/tokens/t1/revoke"');
    expect(asked).toContain('data-confirm="Revoke the token laptop?"');
    expect(asked).toContain('data-confirm-body="Terminals using it stop."');
    // The trigger opens the dialog, so its label ends in "…"; the dialog's button runs the action, so it does not.
    expect(asked).toContain('data-confirm-action="Revoke token"');
    expect(asked).toContain(">Revoke token…</button>");
    expect(asked).toContain('data-done="Token revoked."');
    const now = await render(Action, { post: "/x", label: "Mute" });
    expect(now).not.toContain("data-confirm");
    expect(now).toContain(">Mute</button>");
  });

  it("code block: Copy and Copied in the page's language, the prompt of a command left out of the text", async () => {
    const html = await render(CodeBlock, { code: "codetgh invite <email>", lang: "fr", command: true });
    expect(html).toContain('data-kind="command"');
    expect(html).toContain('<code translate="no">codetgh invite &lt;email&gt;</code>');
    expect(html).not.toContain("$");
    expect(html).toContain("data-copy");
    expect(html).toContain("Copier");
    expect(html).toContain("Copié");
    expect(html).toContain('data-hint="Appuie sur Ctrl+C pour copier"');
    expect(html).toContain('<span class="sr-only" role="status"></span>');
    expect(html).not.toContain("aria-label");
    // Several blocks on one page: each Copy says what it copies.
    const named = await render(CodeBlock, { code: "ctgh_x", lang: "en", copyLabel: "Copy the token" });
    expect(named).toContain('<button type="button" class="copy" aria-label="Copy the token" data-copy');
  });

  it("empty state, chip, panel, collapsible, row menu", async () => {
    const empty = await render(EmptyState, { title: "No agents connected.", icon: "terminal" }, "Copy the invite command.");
    expect(empty).toContain('<p class="empty-title">No agents connected.</p>');
    expect(empty).toContain('<p class="empty">Copy the invite command.</p>');
    // A chip cut by its width keeps its full text on hover.
    expect(await render(Chip, { former: true }, "@yann")).toBe('<span class="chip former" translate="no" title="@yann">@yann</span>');
    const danger = await render(Panel, { title: "Erase my data", tone: "danger" });
    expect(danger).toMatch(/<section class="panel" data-tone="danger"><h2><svg[^>]*>.*<\/svg>Erase my data<\/h2>/);
    expect(await render(Collapsible, { summary: "Create a token", open: true })).toContain(
      '<details class="panel" open=""><summary>Create a token</summary>',
    );
    const menu = await render(RowMenu, { label: "Actions for lea laptop", items: ["Rename"] });
    expect(menu).toContain('<summary aria-label="Actions for lea laptop">');
    expect(menu).toContain('<ul class="menu-items"><li>Rename</li></ul>');
  });

  it("timeline: absolute times, state changes and notes, the current state, the oldest folded", async () => {
    const at = new Date("2026-10-28T20:40:00Z");
    const html = await render(Timeline, {
      lang: "en",
      empty: "No history yet.",
      fold: 2,
      events: [
        { at, text: "Created", change: true },
        { at, text: "Claimed", change: true },
        { at, text: "Note" },
        { at, text: "In progress", change: true, now: true },
      ],
    });
    expect(html).toContain('<time datetime="2026-10-28T20:40:00.000Z" data-local="true">');
    expect(html).toContain("Show 2 earlier events");
    expect(html).toContain('<li data-change="" class="now">');
    expect(html).toMatch(/<li><p class="timeline-head">.*Note/);
    expect(await render(Timeline, { lang: "en", empty: "No history yet.", events: [] })).toBe('<p class="empty">No history yet.</p>');
  });
});
