# Recent Claude Code changes and CodeTgh (audit, 2026-10-16)

Read-only audit. Sources: the official Claude Code docs (code.claude.com/docs, fetched 2026-10-16), the full changelog from 2.1.160 (Jun 2) to 2.1.301 (Oct 15), and the MCP specification (modelcontextprotocol.io, revision 2026-07-28). Each point gives its version or page; "non vérifié" means not found in those sources. Changelog quotes came through a summarizing fetch: check the exact wording on the page before copying a line into FACTS.md. Pages are abbreviated `cc:<page>` for `https://code.claude.com/docs/en/<page>`.

## 1. Compatibility test (step 3)

Local test hub (PGlite, test harness, throwaway team) on `main` at `ddc0bf4`; client Claude Code 2.1.301, `claude -p` with a `--mcp-config` HTTP server and a personal token in `headers`; tool `whoami`.

| Negotiation | Result | Negotiated protocol (debug log) |
| --- | --- | --- |
| default (unset) | connected, `whoami` returned the handle | `2026-07-28` |
| `MCP_PROTOCOL_NEGOTIATION=legacy` | connected, `whoami` returned the handle | `2025-11-25` |

Not tested: the OAuth path (`claude mcp login`, CIMD, DCR), claude.ai connectors, Windows. The channel bridge was tested for real on 2026-10-16 (FACTS.md P8): delivered in about 0.1 s on 2.1.301.

## 2. What changed, and what it means for CodeTgh

| # | Change | Source | Verified | Effect on CodeTgh | Effort | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Claude Code negotiates MCP 2026-07-28 by default with HTTP, stdio and connector servers, with a legacy fallback | changelog 2.1.274, 2.1.292, 2.1.295, 2.1.299; cc:mcp § client runtimes | yes, and tested (§1) | **nothing to fix**: `/mcp` (server SDK 2.3.1) answers both eras | — | low |
| 2 | 2026-07-28 is stateless: no `initialize`, no `Mcp-Session-Id`, POST only, `server/discover`, required `Mcp-Method`/`Mcp-Name` headers | MCP spec 2026-07-28 changelog, streamable-http | yes (spec) | **consolidates**: covered by the SDK; add a regression test that pins both eras | S | low |
| 3 | On the v2 runtime, a **channel server that negotiates 2026-07-28 is not registered as a channel** | cc:mcp § push messages with channels; cc:channels | yes (doc) | **could break**: `packages/channel-bridge` works because it uses SDK 1.32.1 (legacy handshake). Moving it to SDK 2 would silently disable channel push | S | **high if someone upgrades the bridge** |
| 4 | Channels are still a research preview; stdio only; `--channels` / `--dangerously-load-development-channels`; `channelsEnabled` off by default for Team/Enterprise; `server:<name>` only finds `.mcp.json` / `~/.claude.json` servers | cc:channels, cc:channels-reference; P8 run | yes (doc + real run) | **consolidates**: still the documented push into a running session; keep it optional behind `rewake` | S | medium (preview) |
| 5 | plugin.json has a `channels` field | cc:plugins/manifest-reference | yes (doc) | **to check**: our plugin does not declare it; the `plugin:codetgh@…` channel path was never run for real | S | medium |
| 6 | Agent teams: local, one team per session, experimental. Cross-session `SendMessage`: same OS user and account only; other machines via Remote Control; no pluggable transport | cc:agent-teams, cc:cross-session-messaging; changelog 2.1.224, 2.1.225 | yes (doc); "no external transport" non vérifié as an explicit statement | **nothing**: it does not replace CodeTgh (several people, several accounts) | — | — |
| 7 | Hooks and Bash get `CLAUDE_CODE_MESSAGING_SOCKET` + token; a script can post into the session's inbox, which treats it as untrusted peer text (`crossSessionInbound` accept/hold/refuse) | cc:cross-session-messaging, cc:env-vars | yes (doc) | **new option**: a stable (non-preview) local push path next to `asyncRewake`; worth a spike, not a commitment | M | medium |
| 8 | 33 hook events; `onFailure: "block"` | cc:hooks; changelog 2.1.295 | yes (doc; count = 33) | **nothing to change**: our hooks must fail open (CLAUDE.md), so we keep the default `continue`. `block` could later back a team's `claims_enforcement: block` | — | — |
| 9 | SessionEnd hooks share a **1.5 s budget** | cc:hooks § timeouts | yes (doc) | **fragile**: `session-end` is declared at 2 s and calls the hub with 1.2 s plus Node start-up, so it can be cut and leave the agent "online" until it expires | S | medium |
| 10 | `updatedInput` validated like Claude's input (unknown keys dropped); `<system-reminder>` escaped in hook output; UserPromptSubmit runs before skill expansion | changelog 2.1.300, 2.1.292, 2.1.299 | yes (changelog) | **nothing / consolidates**: we never return `updatedInput`; escaping strengthens our envelope | — | — |
| 11 | On Windows, PreToolUse and PermissionRequest hooks without Git for Windows now **fail closed** | changelog 2.1.299 | yes (changelog); effect on a `node` exec-form hook non vérifié | **to check**: our Windows CI has Git; a member's machine without Git could see edits blocked | S | medium |
| 12 | `${user_config.*}` refused in shell-form hooks; plugin options no longer read from project settings | changelog 2.1.207 | yes | **nothing**: our hooks use exec form (`args`) and `.claude/settings.json` only declares the marketplace | — | — |
| 13 | `claude plugin install <p> --marketplace <source>` (2.1.292), `--config key=value` (2.1.285), `claude plugin configure` (2.1.285), `claude plugin eval` (2.1.269), `/skill-doctor` (2.1.261) | changelog; cc:plugins/cli-reference | yes | **simplifies**: `codetgh setup` and HACKATHON.md can install and configure the plugin in one line; `plugin eval` could test our skills | S–M | low |
| 14 | Mods (panes, bands, `$.ui.status`, `$.http.fetch`, `$.clock.every`), on by default since 2.1.287, no sandbox, distributed as plugins | changelog 2.1.287–2.1.301; cc:plugins/mods/* | yes (doc); no "stable" label found | **new feature**: a presence / unread indicator is documented as possible. The API changes every release | M | medium (moving API) |
| 15 | Artifacts and routines call **claude.ai connectors only**; a self-hosted server must be added at claude.ai as a connector | cc:artifacts, cc:routines | yes (doc); requirements for a custom connector (public HTTPS, OAuth) non vérifié on code.claude.com | **waits**: needs a public hub. Today the hub is tailnet-only (Tailscale Serve) | M | medium (exposure) |
| 16 | MCP auth 2026-07-28: OAuth 2.1, RFC 9728 required, RFC 8707 `resource`, RFC 9207 `iss`, credentials keyed by issuer, CIMD SHOULD, **DCR deprecated** (MAY for compatibility) | MCP spec 2026-07-28 authorization + client-registration | yes (spec) | **consolidates / to check**: the hub already has CIMD with the `mcp-2026-07-28` profile (`apps/hub/src/auth.ts`) and allows unauthenticated DCR. `iss` and audience checks not verified in our code; scopes not enforced (audit finding) | M | medium (security) |
| 17 | Auto mode is the default for interactive and `-p` sessions; bypass is "isolated containers and VMs only", refuses root/sudo, is ignored from project `defaultMode`, and is not offered in cloud sessions | changelog 2.1.257, 2.1.284, 2.1.285; cc:permission-modes | yes | **conflicts with our docs**: HACKATHON.md tells the hackathon sessions to start with `--dangerously-skip-permissions` | S | **high (security rule)** |
| 18 | MCP allow rules: `mcp__<server>__*` (glob only after a literal prefix); `mcp__a` matches only that server (2.1.299); plugin tools are `mcp__plugin_<plugin>_<server>__<tool>`; a hook matcher needs `.*` | cc:permissions § MCP, cc:mcp, cc:hooks; changelog 2.1.299 | yes; parsing of `__` inside a name non vérifié | **covered**: our matcher is `mcp__plugin_codetgh_hub__.*`. Avoid `__` in future server or tool names | — | low |
| 19 | PermissionRequest hook: runs where no prompt can show and denies without a decision; cloud sessions read hooks only from the repo; in Cowork cloud auto mode it can no longer approve shell commands | cc:hooks; changelog 2.1.299 | yes; Remote Control specifics non vérifié | **nothing**: we do not use PermissionRequest, and never `allow` | — | — |
| 20 | OpenTelemetry `tool_decision` (decision, source, classifier verdict since 2.1.301), content redacted by default | cc:monitoring-usage; changelog 2.1.301 | yes | **nothing for the hub's audit**: it is client-side, per member, needs a collector, and covers local tool calls, not hub actions | — | — |
| 21 | Hooks: `asyncRewake` behaviour (background, wakes on exit 2) | cc:hooks; FACTS.md P3 | yes (doc + real run 2026-10-13) | **covered** | — | — |
| 22 | Tested Claude Code version in the hub is 2.1.296 | `apps/hub/src/domain/overview.ts`, FACTS.md | — | **stale**: P8 and §1 ran on 2.1.301 | S | low |

## 3. Compatibility risks to handle first

1. **Bypass in our own guide (#17).** HACKATHON.md recommends `--dangerously-skip-permissions`, while auto mode now gives the same flow with a classifier, and bypass is meant for isolated VMs only. On the shared VPS this is a security rule we break ourselves.
2. **Channel bridge pinned by accident (#3).** It only works because it is still on SDK 1.x. Nothing in the repo says so or tests it.
3. **SessionEnd budget (#9).** A 1.5 s shared budget against our 2 s hook: presence can stay wrong after `/exit`.
4. **OAuth on 2026-07-28 (#16).** Not tested for real; DCR is deprecated, scopes are unchecked, and the `iss` check is not verified.
5. **Windows fail-closed hooks (#11).** To check on a machine without Git for Windows.

## 4. Plan (each item: its own branch and PR, test first)

**Current phase: fixes**

1. **Hackathon sessions without bypass.** Branch `docs/hackathon-auto-mode`.
   - Goal: replace `--dangerously-skip-permissions` with auto mode in HACKATHON.md, and check that the pre-edit hook's `ask` still shows as a prompt in auto mode.
   - Tests: one real run, recorded in FACTS.md: two auto-mode sessions on the test hub, one editing a claimed file.
   - Out of scope: changing the classifier settings.
2. **Pin the channel bridge to the legacy handshake.** Branch `fix/channel-bridge-legacy`.
   - Goal: a test asserting the bridge answers `initialize` and does not offer 2026-07-28, a code comment explaining why, the `channels` field in plugin.json if a real `plugin:codetgh@…` run needs it, and the FACTS.md row.
   - Tests: an e2e stdio test with a v2-runtime client, plus a real run with `--dangerously-load-development-channels plugin:codetgh@<marketplace>`.
   - Out of scope: moving the bridge to SDK 2.
3. **Hook budgets.** Branch `fix/session-end-budget`. Merge it with the open hook-deadline fix (audit lot A7) if that lands first.
   - Goal: `session-end` within 1.5 s (hook timeout 1 s, hub call ≤ 0.8 s), and a check on Windows without Git.
   - Tests: a slow-hub test showing session-end returns within budget and the hub marks the agent offline. The Windows check is manual and recorded in FACTS.md.
   - Out of scope: changing presence expiry.
4. **OAuth for MCP 2026-07-28.** Branch `fix/mcp-oauth-2026-07-28`.
   - Goal: check `iss` in the authorization response and audience on tokens, require a hub scope on `/mcp` OAuth tokens, then decide on DCR (see decisions).
   - Tests: an e2e OAuth flow with a CIMD client, then a real `claude mcp login` on default and legacy negotiation.
   - Out of scope: claude.ai connector publication.

**Next phase (waits for your go)**

5. **One-line plugin install.** Branch `feat/setup-plugin-install`.
   - Goal: `codetgh setup` runs `claude plugin install codetgh@codetgh --marketplace <hub>/plugin/marketplace.json --config …` (2.1.292+), and HACKATHON.md loses its manual steps.
   - Tests: the existing setup tests with a fake `claude`, plus a doctor check of the minimum version.
   - Out of scope: `plugin eval` suites.
6. **Presence and unread indicator as a mod.** Branch `feat/mod-presence`.
   - Goal: `$.ui.status` fed by `$.http.fetch` of the hub's `/v1/status` every 30 s.
   - Tests: `claude plugin validate` with its `calls:` lines, plus a real terminal run.
   - Out of scope: panes and commands. It waits because the mods API changes every release.

## 5. Your decisions

| Decision | Options and cost | Recommendation |
| --- | --- | --- |
| Hackathon permission mode | **Auto mode**: a few more prompts or classifier blocks (after 3 in a row it falls back to prompting), but safe on a shared VPS. **Bypass**: fastest, against the docs ("isolated VMs only") and against our own rule | Auto mode |
| DCR on the hub | **Keep it** (spec MAY): compatible with older clients; costs an open registration endpoint. **Turn it off** (CIMD only): smaller attack surface; risks breaking a client that has no CIMD (claude.ai connector behaviour non vérifié) | Keep it until a real CIMD login passes, then turn it off |
| Channel mode | **Keep it as an option** (preview, flag, org switch). **Hide it** from `push_mode`. **Spike the messaging socket** (#7) as a stable replacement | Keep it, and make `rewake` the documented default. Spike the socket after the fixes |
| Mods | **Now**: an unread badge for the hackathon, but tied to a moving API. **Later**: no cost now | Later (next phase) |
| Public hub for connectors, artifacts and routines | **Funnel on 443**: these features become usable from claude.ai, but the hub is exposed to the internet. **Tailnet only**: no exposure, no such features | Tailnet only until the OAuth item (plan 4) is done |

## Non vérifié

- How Claude Code parses `__` inside an MCP server or tool name.
- PermissionRequest behaviour in Remote Control sessions.
- Requirements for a self-hosted custom connector on claude.ai (they are documented outside code.claude.com).
- The effect of the Windows fail-closed change on an exec-form `node` hook.
- Whether a hook's `ask` still prompts in auto mode (the docs say explicit ask rules do; hooks are not named).
- CIMD in the Claude Code changelog (none found from June to October; it is described on cc:mcp).
