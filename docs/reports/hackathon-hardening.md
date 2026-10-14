# Report: hardening for autonomous bypass sessions

Date: 2026-10-14.

**Input.** Alexandre's Claude reviewed CodeTgh (build, tests, attack scenarios replayed) for the XRPL hackathon, where two Claude Code sessions run in `bypassPermissions` on a shared VPS. Every point was re-checked in the current code before any change.

**Workflow.** Each fix has its own branch and PR, and its scenario test was committed first and failed. CI was green on Linux and Windows before each merge.

## Findings

| # | Finding | Verdict | What changed | PR |
| --- | --- | --- | --- | --- |
| A1 | Peer text in the SessionStart packet outside the envelope | **Confirmed** (claim scopes, statuses, branches, names, task and decision titles; the claim reason in `ask`) | Claim scopes are path characters only. Every peer-written word of the packet sits in one `<peer_message>`. The `ask` reason is enveloped | #23 |
| A2 | A claim can block an autonomous session | **Confirmed** (`**` and `*` accepted; `""` and `/` were already refused) | Whole-project globs refused. Measured: under bypass a hook's `ask` counts as a denial, so the hook warns instead. Console advises `warn` | #26 |
| A3 | Loop guard bypassed by opening new threads | **Confirmed** | 12 agent messages per pair of people per 10 min, all threads, counted in Postgres. Rewake capped at 6 wakes per 10 min | #25 |
| A4 | Look-alikes pass the envelope | **Confirmed** (Unicode tag characters, fullwidth brackets) | NFKC, then strip every format character before escaping. Tag characters are flagged | #22 |
| A5 | Hook silent behind a symlinked path | **Confirmed** | Real-path comparison, as the CLI already did | #27 |
| A6 | Metadata sent from every repository | **Confirmed** (the hub even created a project per repository) | Plugin off at user scope, on per project (measured). The hub creates no projects and stores nothing for unknown repositories. Hooks send only the fingerprint there, then stay quiet | #28 |
| A7 | `from` attribute escaped twice | **Confirmed** | Escaped once | #24 |
| A8 | Exposure | **Partly** | The hub binds `127.0.0.1` unless `HOST` is set. Tailscale Serve is documented. OAuth client registration stays open: the claude.ai connector needs it, and sign-up already requires an invitation | #24 |
| B1 | Plugin installed without its options; doctor still green | **Confirmed** | setup configures the plugin through stdin. doctor checks the plugin options and `claude mcp list` | #29 |
| C | No delivery to a busy agent | **Built** | PostToolUse `inbox` hook: at most one hub call per 25 s, shared ETag, 10 injections per 10 min. `ask_peer` priority `blocking`. Measured mid-turn delivery | #30 |
| D | Settings for the event | Done | `docs/HACKATHON.md`: checklist, how to stop everything, rehearsal script | this PR |

## Measured (recorded in FACTS.md)

- **A hook's `ask` under bypass.** With `claude -p --dangerously-skip-permissions`, both `ask` and `deny` end up in `permission_denials`, and the hook input carries `permission_mode: "bypassPermissions"`. Interactive bypass was not measured.
- **Plugin enablement.** `enabledPlugins` in a project's `.claude/settings.json` wins over `false` in the user's settings.
- **PostToolUse.** Its `additionalContext` reaches the model in the same turn, after the tool result.

## Kept as is, with the reason

- **Default claims enforcement stays `ask`.** Changing every team's default silently is out of scope. Bypass sessions now get a warning, and the console recommends `warn`.
- **OAuth dynamic client registration stays open.** It is how claude.ai registers. An account still needs an invitation.

## Still to do before the rehearsal (Oct 19)

- Redeploy the hub from main, then run `pnpm test`, `pnpm test:pg` and `pnpm e2e:console` on the VPS.
- Owner:
  - switch the hub from Funnel to Serve;
  - invite Alexandre into the tailnet;
  - set enforcement to `warn` and allow rewake.
- Each person: re-run `codetgh setup`, set push mode to `rewake`, `codetgh doctor` all green, then the rehearsal script.
