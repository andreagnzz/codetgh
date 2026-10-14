# Reuse register

Audit run on 2026-10-13 (phase 0). Licenses are read from the LICENSE file of each repository (depth-1 clone), never from a badge or `package.json` alone. "HEAD" is the commit at the tip of the default branch on that date (`git log -1 --format='%h %cs'`). Versions come from the npm registry.

Decisions: **reuse** (published dependency), **adapt** (copy with attribution), **inspire** (read ideas, copy nothing), **write** (CodeTgh-specific), **reject**.

## Related projects

| Project | URL | Version / HEAD | License (from file) | Last commit | Decision | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| mcp_agent_mail and its Rust port | — | — | MIT with a clause excluding OpenAI, Anthropic and their contractors | not read | **reject** | Forbidden license clause. Not cloned, not opened, not analyzed. Only the general idea (agent mailboxes, advisory file reservations) is public knowledge |
| claude-peers-mcp | https://github.com/louislva/claude-peers-mcp | 640183f | MIT | 2026-04-26 | adapt (phase 2–3) | Base for the stdio bridge and channel push; the hub replaces its local broker. Nothing copied in phase 0 |
| claude-code-teams-mcp | https://github.com/cs50victor/claude-code-teams-mcp | bde2088 | MIT (© 2026 victor) | 2026-02-21 | inspire | Inbox formats and tests; single-machine, Python |
| claude-relay | https://github.com/gvorwaller/claude-relay | 1937dc8 | **none** | 2026-10-06 | **reject** | No LICENSE file: all rights reserved |
| chat-mcp | https://github.com/thiagovictorino/chat-mcp | a75f003 | MIT | 2025-07-29 | reject | Inactive since 2025-07, local only |
| A2A protocol | https://github.com/a2aproject/A2A | 7c861a5 | Apache-2.0 | 2026-10-12 | later (phase 3) | Agent Card for interoperability |
| claude-plugins-official (telegram, discord, imessage, fakechat channels) | https://github.com/anthropics/claude-plugins-official | f359d43 | Apache-2.0 (root and each `external_plugins/*/LICENSE`, © 2026 Anthropic, PBC) | 2026-10-10 | adapt (phase 3) | Reference channel code; copy only with header and NOTICE entry |
| claude-flow (now ruflo) | https://github.com/ruvnet/ruflo | 55e2c90 | MIT | 2026-10-12 | inspire | Local swarm orchestration, out of CodeTgh's scope |
| claude-squad | https://github.com/smtg-ai/claude-squad | ce1ffb4 | **AGPL-3.0** | 2026-08-20 | **reject** | Forbidden license |
| vibe-kanban | https://github.com/BloopAI/vibe-kanban | d5cbb53 | Apache-2.0 | 2026-09-19 | inspire | Local agent orchestration board |
| Agent-MCP | https://github.com/rinadelph/Agent-MCP | 13d98b2 | **AGPL-3.0** | 2025-10-09 | **reject** | Forbidden license |
| mem0 | https://github.com/mem0ai/mem0 | d26ba5e | Apache-2.0 | 2026-10-12 | reject | Embedding memory; CodeTgh needs human-validated, versioned items, not vector recall |
| MCP reference servers (`src/memory`) | https://github.com/modelcontextprotocol/servers | bbb701e | MIT → Apache-2.0 transition (root LICENSE; `src/memory` has none of its own) | 2026-10-11 | inspire | Knowledge-graph memory without human approval |
| gitleaks | https://github.com/gitleaks/gitleaks | b58d3f1 | MIT | 2026-07-22 | inspire | Go binary; secretlint covers Node. Its rule set may feed team patterns |
| claude-code (hook examples) | https://github.com/anthropics/claude-code | bf2323b | **Proprietary** ("All rights reserved", Commercial Terms) | 2026-10-13 | **reject** (copy) | Read the docs instead; copy nothing |

## Dependencies

| Package | Role | Version | License (from file) | Repo HEAD | Decision | Phase |
| --- | --- | --- | --- | --- | --- | --- |
| @modelcontextprotocol/server, /hono, /client | Hub MCP endpoint (2026-07-28 + stateless 2025 fallback), tests | 2.3.1, 2.0.2, 2.3.1 | MIT → Apache-2.0 transition; new code Apache-2.0 (npm: Apache-2.0) | 9bc40e9 · 2026-10-13 | reuse | 0 |
| @modelcontextprotocol/sdk (v1) | v1 client in compatibility tests; stdio server of the channel bridge (`packages/channel-bridge`, bundled into the plugin) | 1.32.1 | same LICENSE as above (npm: MIT) | 9bc40e9 · 2026-10-13 | reuse | 0 (tests), 3 (shipped) |
| hono, @hono/node-server | HTTP server | 4.13.13, 2.1.5 | MIT | 588ec13 · 2026-10-13; 4b47a0d · 2026-10-13 | reuse | 0 |
| @hono/zod-openapi | Typed REST + OpenAPI | 1.6.3 | MIT | 6496416 · 2026-10-04 | not used (phase 3): `/v1/openapi.json` is built from the shared route table with zod 4 `z.toJSONSchema`, no route rewrite | 1 |
| zod | Shared schemas | 4.6.7 | MIT | b500a2e · 2026-10-12 | reuse | 0 |
| drizzle-orm, drizzle-kit | ORM, migrations | 0.45.4, 0.31.11 | Apache-2.0 | eab8bed · 2026-10-08 | reuse | 0 |
| pg | Postgres driver | 8.23.1 | MIT | 0980cef · 2026-09-30 | reuse | 1 |
| @electric-sql/pglite | Embedded Postgres (light mode, tests) | 0.5.9 | Apache-2.0 | 9c7555a · 2026-10-13 | reuse | 0 |
| better-auth | Sessions, email sign-in | 1.7.7 | MIT | 1d95ebf · 2026-10-13 | reuse | 0 |
| @better-auth/mcp | OAuth 2.1 provider for MCP, token audience binding, `requireMcpAuth` | 1.7.7 | MIT (monorepo LICENSE) | 1d95ebf · 2026-10-13 | reuse | 0 — **not in SPEC's list**, required by better-auth for MCP |
| @better-auth/oauth-provider | Underlying OAuth provider used by `mcp()` | 1.7.7 | MIT (monorepo LICENSE) | 1d95ebf · 2026-10-13 | reuse | 0 — **not in SPEC's list** |
| @better-auth/cimd | Client ID Metadata Documents (MCP profile) | 1.7.7 | MIT | 1d95ebf · 2026-10-13 | reuse | 0 |
| auth (Better Auth CLI, via npx) | Generates `src/db/auth-schema.ts` | 1.7.7 | MIT (monorepo LICENSE) | 1d95ebf · 2026-10-13 | reuse (dev tool, not installed) | 0 |
| oidc-provider | OAuth plan B | 9.12.2 | MIT | f72e14e · 2026-10-12 | plan B | — |
| jose | JWT, JWKS | 6.2.12 | MIT | b112a5e · 2026-10-13 | reuse | 1 (transitive in 0) |
| oauth4webapi | OAuth flow replay in tests; CLI PKCE | 3.8.8 | MIT | 8ba8319 · 2026-10-13 | reuse | 0 (tests) |
| nodemailer | Magic links and invitation emails, behind `SMTP_URL` (any provider); `jsonTransport` in dev and tests | 10.1.0 | **MIT-0** (LICENSE read 2026-10-13: the MIT text without the notice-retention condition); no dependencies | c8671c4 · 2026-10-13 | reuse | 1 — MIT-0 added to the allowlist by the human |
| @types/nodemailer | Typings | 8.0.2 | MIT (DefinitelyTyped) | — | reuse (dev) | 1 |
| @secretlint/core, preset recommend | Secret detection | 13.0.7 | MIT | fd51611 · 2026-10-13 | reuse | 1 |
| @napi-rs/keyring | OS keychain | 2.1.1 | MIT | 97aa4e0 · 2026-10-10 | reuse | 1 |
| commander | CLI | 15.0.0 | MIT | ba6d13d · 2026-05-29 | reuse | 1 |
| pino | Logs | 10.4.0 | MIT | b29dbe9 · 2026-10-02 | reuse | 1 |
| ulid | Prefixed IDs | 3.0.2 | MIT | 11c2067 · 2025-11-30 | reuse | 0 |
| picomatch | Glob claims, excluded paths | 4.0.7 | MIT | 9fab7bf · 2026-08-27 | reuse (hub dependency since phase 2) | 2 |
| diff (jsdiff) | Console: compare a proposed memory item with the version it replaces (`diffLines`) | 9.0.0 | BSD-3-Clause (LICENSE read 2026-10-13); no dependencies | 5947609 · 2026-10-07 | reuse | 2 |
| htmx.org | Console | 2.0.11 | 0BSD | fa978b2 · 2026-09-22 | reuse | 1 |
| htmx-ext-sse | Console SSE | 2.2.4 | 0BSD (`src/sse/LICENSE`; no `license` field in package.json) | 1358232 · 2025-07-18 | reuse | 1 |
| esbuild | Single-file `hook.js` / CLI | 0.28.2 | MIT | f6058f8 · 2026-08-09 | reuse | 0 |
| vitest | Tests | 5.0.4 | MIT | f15bdac · 2026-10-12 | reuse | 0 |
| @playwright/test | Console tests | 1.64.0 | Apache-2.0 | — | reuse | 2 |
| @biomejs/biome | Format, lint | 2.5.15 | MIT OR Apache-2.0 (two files) | c6b7d55 · 2026-10-13 | reuse | 0 |
| typescript | Language | 7.0.2 | Apache-2.0 | — | reuse | 0 |
| @types/pg | pg typings | 8.x | MIT (DefinitelyTyped) | — | reuse (dev) | 1 |
| @electric-sql/pglite-socket | PGlite over the Postgres wire protocol: local runs of the `pg` driver path without Docker | 0.2.12 | Apache-2.0 (pglite monorepo LICENSE) | 9c7555a · 2026-10-13 | reuse (dev) | 1 |
| @types/node | Node typings | 26.6.5 | MIT (DefinitelyTyped) | — | reuse | 0 |
| tsx | Dev runner | 4.23.15 | MIT | 4473971 · 2026-09-24 | reuse | 0 |
| prom-client | Metrics | 15.1.3 | Apache-2.0 | 21a3b86 · 2026-10-10 | reuse | 1 |
| @opentelemetry/api | Traces | 1.9.1 | Apache-2.0 | d24e8c5 · 2026-10-13 | reuse | 1 |
| license-checker-rseidelsohn | CI license gate | 5.0.1 | BSD-3-Clause | 0638c62 · 2026-10-08 | **replaced** (phase 1) | Under pnpm it counts better-auth's optional `vitest` peer as production and fails on `lightningcss` (MPL-2.0), which never ships. `scripts/licenses.mjs` checks what ships instead: every package in the esbuild bundles (metafiles) plus the 3 packages copied into the image |
| @cyclonedx/cyclonedx-npm | SBOM | 6.0.1 | Apache-2.0 (+ NOTICE) | d1bf57a · 2026-08-24 | reuse (CI) | 1 — needs `--ignore-npm-errors` under pnpm (`npm ls` does not understand the layout) |
| @a2a-js/sdk | A2A server (`JsonRpcTransportHandler`, `DefaultRequestHandler`, a hub-backed `TaskStore`) and the A2A client in e2e | 1.3.0 | Apache-2.0 (LICENSE read 2026-10-13); implements A2A 1.0; only runtime dependency `jose` | 2c81b86 · 2026-10-09 | reuse | 3 |
| @inquirer/prompts | Questions of `codetgh setup` (select, input, confirm), bundled into the CLI | 8.7.3 | MIT (LICENSE read 2026-10-14) | eb92022 · 2026-10-12 | reuse | install — loaded only in interactive setup |
| fflate | Zip of the plugin the hub serves (`scripts/bundles.mjs`, build time only) | 0.8.3 | MIT (LICENSE read 2026-10-14) | dcb3714 · 2026-05-16 | reuse (dev) | install — Node has no zip writer; not shipped |
| Inter (font files) | Console and public pages typeface, self-hosted in `apps/hub/public/fonts` (latin, latin-ext; variable opsz and wght, so large titles get Inter Display) | 4.x via @fontsource-variable/inter 5.3.0 | **SIL OFL 1.1** (LICENSE read 2026-10-14, copied as `Inter-LICENSE.txt`; NOTICE entry) | rsms/inter 353b61b · 2024-11-19 | reuse (files copied, no npm dependency) | brand — OFL asked by the human on 2026-10-14 |
| Docker Engine and Compose (Ubuntu packages `docker.io`, `docker-compose-v2`) | Runs the hub and Postgres on the VPS (`deploy/compose.yaml`) | 29.1.3, 2.40.3 | Apache-2.0 (moby LICENSE read 2026-10-14) | moby 5834c86 · 2026-10-14 | reuse (host tool, not shipped) | deploy |
| PostgreSQL (image `postgres:17.11-bookworm`) | Hub database in the Docker deployment, as SPEC « Stack » decided | 17.11 | **PostgreSQL License** (COPYRIGHT read 2026-10-14; permissive, not in CLAUDE.md's list); image build files MIT (docker-library) | postgres 857340b · 2026-10-14 | reuse (separate service, not linked) | deploy — **to confirm by the human** |
| Node.js image `node:24.21.0-bookworm-slim` | Hub runtime image (`deploy/Dockerfile`) | 24.21.0 | MIT (Node.js LICENSE) | — | reuse (base image) | deploy |
| @cloudflare/workers-oauth-provider, agents | OAuth/MCP on Workers | 1.2.3, 0.28.1 | MIT | 602610c · 2026-10-06 | inspire | — |
| fastmcp | MCP wrapper | 4.22.4 | MIT | 3077844 · 2026-10-03 | reject | Official SDK tracks the spec |
| @anthropic-ai/claude-agent-sdk | Headless agents | 0.3.296 | **Proprietary** (Commercial Terms) | 85d8f8e · 2026-10-09 | real run only (phase 3) | Not open source (LICENSE.md: « All rights reserved », Commercial Terms; read 2026-10-13). Human decision 2026-10-13 allowed it as a test dependency; it is not even in the lockfile: installed once in a scratch directory for the SDK real run (`docs/FACTS.md`) |

## Points for the human

- `@better-auth/mcp` and `@better-auth/oauth-provider` are required for better-auth to act as an MCP authorization server; SPEC.md did not list them.
- The MCP SDK LICENSE is in an MIT → Apache-2.0 transition; both are allowed.
- `@anthropic-ai/claude-agent-sdk` is proprietary: accepted on 2026-10-13 as an optional phase 3 test dependency only.
- CodeTgh itself is MIT (decided 2026-10-13).
- MIT-0 is allowed (decided 2026-10-13, for nodemailer).
