/** @jsxRuntime automatic @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { Lang } from "../i18n.js";
import { Chip, Pill } from "./pages.js";

// Threads, a thread and alerts (batch 3 of the console redesign). Every value below is rendered by JSX, which escapes text:
// agent-written strings never become HTML.
export type Tr = ((s: string) => string) & { lang: Lang };
export const fill = (s: string, values: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (all, k: string) => (k in values ? String(values[k]) : all));

// What a thread is called: its subject, or its kind and its people. A direct thread names who it is with (the reader left
// out); a team thread, who started it.
export const threadName = (t: { kind: string; subject: string | null }, people: string[] | undefined, me: string | null, _: Tr) => {
  if (t.subject) return t.subject;
  const at = (hs: string[]) => hs.map((h) => `@${h}`).join(", ");
  if (t.kind === "direct") {
    const others = (people ?? []).filter((h) => h !== me);
    return others.length ? fill(_("Direct thread with {people}"), { people: at(others) }) : _("Direct thread");
  }
  return people?.[0] ? fill(_("Team thread from {people}"), { people: at(people.slice(0, 1)) }) : _("Team thread");
};

// A muted thread says by whom, in words; an open thread needs no word.
export const MutedPill: FC<{ t: { mutedAt: Date | null; mutedReason: string | null }; _: Tr }> = ({ t, _ }) =>
  t.mutedAt ? (
    t.mutedReason === "human" ? (
      <Pill>{_("Muted by a person")}</Pill>
    ) : (
      <Pill tone="warn">{_("Muted by the loop guard")}</Pill>
    )
  ) : null;

// The loop guard's count, in words; the ticks only repeat it.
export const Streak: FC<{ n: number; max: number; _: Tr; short?: boolean }> = ({ n, max, _, short }) => (
  <span class="streak">
    <span class="ticks" aria-hidden="true">
      {Array.from({ length: max }, (__, i) => (
        <span class={i < n ? "on" : undefined} />
      ))}
    </span>
    {fill(_(short ? "{n} of {max}" : "Agent streak {n} of {max}"), { n, max })}
  </span>
);

// Handles as terminal tokens; past four, the count of the others.
export const Handles: FC<{ handles: string[]; _: Tr }> = ({ handles, _ }) => (
  <span class="handles">
    {handles.slice(0, 4).map((h) => (
      <Chip>{`@${h}`}</Chip>
    ))}
    {handles.length > 4 && <span class="more">{fill(_("+{n} more"), { n: handles.length - 4 })}</span>}
  </span>
);
