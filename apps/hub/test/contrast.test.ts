import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// WCAG 2.x contrast of every token pair the console uses for text or for components, read from console.css itself, light and
// dark: a token change that breaks AA fails here. color-mix(in srgb, A p%, B) is mixed per channel, as browsers do.
const css = readFileSync(new URL("../public/console.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const declarations = (block: string) =>
  Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]));
const light = declarations(css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "");
const dark = { ...light, ...declarations(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)?.[1] ?? "") };

type Rgb = [number, number, number];
const resolve = (tokens: Record<string, string>, value: string): Rgb => {
  const v = value.trim();
  const ref = v.match(/^var\(--([\w-]+)\)$/);
  if (ref) return resolve(tokens, tokens[ref[1] ?? ""] ?? "");
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => Number.parseInt(hex[1]?.slice(i, i + 2) ?? "", 16)) as Rgb;
  const mix = v.match(/^color-mix\(in srgb, (var\(--[\w-]+\)) ([\d.]+)%, (var\(--[\w-]+\))\)$/);
  if (mix) {
    const [a, p, b] = [resolve(tokens, mix[1] ?? ""), Number(mix[2]) / 100, resolve(tokens, mix[3] ?? "")];
    return a.map((c, i) => c * p + (b[i] ?? 0) * (1 - p)) as Rgb;
  }
  throw new Error(`cannot resolve ${value}`);
};
const luminance = (c: Rgb) =>
  c
    .map((v) => v / 255)
    .map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4))
    .reduce((sum, s, i) => sum + s * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
const ratio = (tokens: Record<string, string>, fg: string, bg: string) => {
  const [a, b] = [luminance(resolve(tokens, `var(--${fg})`)), luminance(resolve(tokens, `var(--${bg})`))];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

const TEXT = 4.5;
const UI = 3;
// [foreground, background, minimum, where]. Text 4.5:1; components and the rules that carry information 3:1.
const PAIRS: Array<[string, string, number, string]> = [
  ["text", "surface", TEXT, "body text, titles, table cells"],
  ["text", "surface-raised", TEXT, "dialogs, menus, toasts, panels"],
  ["text", "surface-inset", TEXT, "code, sidebar, hovered or current row, banner body"],
  ["text-muted", "surface", TEXT, "metadata, captions, column headers, placeholders"],
  ["text-muted", "surface-raised", TEXT, "metadata and placeholders in panels and dialogs"],
  ["text-muted", "surface-inset", TEXT, "sidebar links, metadata in a current row"],
  ["accent", "surface", TEXT, "links, tertiary buttons"],
  ["accent", "surface-raised", TEXT, "links in panels, dialogs and public pages"],
  ["on-accent", "accent", TEXT, "primary button label"],
  ["on-accent", "accent-hover", TEXT, "primary button label, hovered"],
  ["on-error", "error", TEXT, "confirming button of a destructive dialog"],
  ["on-error", "error-hover", TEXT, "the same, hovered"],
  ["success", "surface", TEXT, "success pill"],
  ["warning", "surface", TEXT, "warning pill, reconnecting"],
  ["error", "surface", TEXT, "error pill, field error, destructive trigger"],
  ["success", "surface-inset", TEXT, "pill in a hovered or current row"],
  ["warning", "surface-inset", TEXT, "pill in a hovered or current row"],
  ["error", "surface-inset", TEXT, "pill in a hovered or current row"],
  ["success", "surface-raised", TEXT, "pill in a panel"],
  ["warning", "surface-raised", TEXT, "pill in a panel"],
  ["error", "surface-raised", TEXT, "field error and destructive trigger in a panel or dialog"],
  ["text", "success-soft", TEXT, "success banner"],
  ["text", "warning-soft", TEXT, "warning banner"],
  ["text", "error-soft", TEXT, "error banner"],
  ["text", "accent-soft", TEXT, "selected filter"],
  ["error", "error-soft", TEXT, "error text inside an error banner"],
  ["border-strong", "surface", UI, "input, secondary button, rule under a table header"],
  ["border-strong", "surface-raised", UI, "input in a panel or dialog"],
  ["border-strong", "surface-inset", UI, "rule on an inset surface"],
  ["accent", "surface-inset", UI, "focus ring and current-page bar in the sidebar"],
  ["accent", "success-soft", UI, "focus ring inside a success banner"],
  ["accent", "warning-soft", UI, "focus ring inside a warning banner"],
  ["accent", "error-soft", UI, "focus ring inside an error banner"],
  ["success", "surface", UI, "live dot, success icon"],
  ["warning", "warning-soft", UI, "warning banner edge and icon"],
  ["error", "error-soft", UI, "error banner edge and icon"],
  ["success", "success-soft", UI, "success banner edge and icon"],
  ["text-muted", "surface", UI, "hollow dot, timeline rule"],
];

describe("console contrast", () => {
  for (const [theme, tokens] of [
    ["light", light],
    ["dark", dark],
  ] as const)
    it(`keeps every token pair at AA, ${theme}`, () => {
      const failures = PAIRS.map(([fg, bg, min, use]) => ({ pair: `${fg} on ${bg} (${use})`, ratio: ratio(tokens, fg, bg), min })).filter(
        (r) => r.ratio < r.min,
      );
      expect(failures).toEqual([]);
    });

  it("reads the brand and the owner's decisions from the stylesheet", () => {
    expect(resolve(light, "var(--accent)")).toEqual([0x08, 0x7f, 0x70]);
    expect(resolve(dark, "var(--accent)")).toEqual([0x3e, 0xe6, 0xc1]);
    expect(resolve(light, "var(--surface-raised)")).toEqual([255, 255, 255]);
    expect(resolve(light, "var(--on-accent)")).toEqual([255, 255, 255]);
    expect(resolve(dark, "var(--on-accent)")).toEqual(resolve(dark, "var(--ink)"));
  });
});
