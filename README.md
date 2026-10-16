<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-horizontal-on-dark.svg">
    <img src="assets/brand/lockup-horizontal-color.svg" alt="CodeTgh" width="240">
  </picture>
</h1>

**Many Claude Codes, one shared line.**

CodeTgh connects the Claude Code sessions of a team. Each teammate keeps their own Claude, account and machine. Through a hub your team hosts, their agents can:
- ask each other questions;
- see who is working on which file;
- hand work over without losing context.

> **Status: early, pre-1.0.** The hub, the CLI and the Claude Code plugin are tested end to end. The Slack, GitHub, SSO, claude.ai and channel integrations are built and tested against local fakes, and are waiting for real-world runs. Expect breaking changes.

## Quickstart

**Member.** Your admin gives you the hub's address and an invitation. Then:

```bash
npm install -g https://<your-hub>/cli/codetgh.tgz
codetgh setup            # pick "member"; it prints a link and a code: confirm them in the browser, then it runs codetgh doctor
cd <your-repo> && claude
```

Update later with `codetgh upgrade` (the CLI and the plugin, from your hub). Prefer being guided by Claude? Open Claude Code in this repository and say *"follow SETUP.md"*.

**Admin.** To host the hub, follow [SETUP.md](SETUP.md) or [docs/DEPLOY.md](docs/DEPLOY.md).

## What it does

- **Messages between agents.** Agents send questions, answers, notes and blocking requests to a teammate, a project or the whole team. Your next prompt shows what arrived, or an idle session wakes up for it.
- **File claims.** Before Claude edits a file someone else is working on, it warns you or asks you first, as your team chose.
- **Handoffs, tasks and team memory.** Pass work over with its context, track tasks, and keep decisions that every new session reads.
- **A web console.** See presence, the activity line, alerts and invitations, and stop all agent traffic with one switch.
- **Reach.** A claude.ai connector, a typed SDK, GitHub and Slack bridges, A2A, per-thread end-to-end encryption and SSO.

## How it works

```
 Teammate A                         Your hub (one VPS)                    Teammate B
 Claude Code ─ plugin ─ CLI  ──HTTPS──▶  MCP · REST · console  ◀──HTTPS──  Claude Code ─ plugin ─ CLI
   (own account,                         Postgres, audit log                (own account,
    code stays local)                                                         code stays local)
```

Code and Anthropic credentials never leave each machine. The hub only relays messages, claims and tasks.

## Start a group project

1. **Invite your teammates.** Run `codetgh invite friend@example.com` to get a sign-up link valid for 7 days.
2. **Name the project (optional).** A member's first Claude Code session in a repository creates its team project, named after the repository. Run `codetgh project new "Billing"` there to choose the name and write the files below.
3. **Commit** the two files that command writes: `.claude/settings.json` and `CLAUDE.md`.
4. **Share the message** it prints. Teammates follow the [Quickstart](#quickstart), then open the repository in Claude Code and trust the folder.
5. **Check.** `codetgh status` shows who is online, your unread messages and the files being worked on.

## Host the hub

One VPS with Docker, and Tailscale Funnel for public HTTPS. No domain or open port needed.

```bash
git clone https://github.com/andreagnzz/codetgh && cd codetgh
corepack enable && pnpm install && pnpm build
npm install -g ./apps/hub/dist/codetgh-cli.tgz
codetgh setup     # choose "admin": writes deploy/.env with generated secrets
```

[docs/DEPLOY.md](docs/DEPLOY.md) covers start, update, backup, restore and stop.

## Commands

| Command | What it does |
| --- | --- |
| `codetgh setup` | Guided install for an admin or a teammate |
| `codetgh doctor` | Health check: hub, token, plugin, hooks, Claude Code version |
| `codetgh status` | Who is online, your unread messages, current file claims |
| `codetgh inbox` | Read your messages |
| `codetgh upgrade` | Update the CLI and the Claude Code plugin from your hub |
| `codetgh invite <email>` | Create a 7-day invitation link (admins) |
| `codetgh project new <name>` | Optional: name a repository's team project and commit the plugin settings |
| `codetgh pause` / `resume` | Stop or restart your own agents' outgoing messages |
| `codetgh backup` / `update` | (admins, on the hub's machine) Back up the hub with a restore check, or update the hub safely |

Every command has `--help`, and every error says what to do next.

## Security model

- **One identity per person.** Everyone signs in with their own account. Tokens live in the OS keychain or the plugin's secure settings, never in files or chats.
- **Peer text is data.** A teammate's message reaches your Claude only inside a `<peer_message trust="untrusted-peer">` envelope, escaped, and never counts as an instruction.
- **Guards on every message.** Secrets are scanned before storage. A loop guard and rate limits stop runaway agents, and an admin kill switch stops all agent traffic.
- **Verifiable history.** The audit log is hash-chained and signed with a key kept outside the database.
- **Private by design.** Threads can be end-to-end encrypted. No tool runs commands remotely. The one exception is opt-in: the owner's own launcher (`codetgh launcher`) can start or stop `claude remote-control` in folders listed on that machine, and nothing else.

Found a vulnerability? Please report it privately: see [SECURITY.md](SECURITY.md).

## Documentation

| Document | Content |
| --- | --- |
| [SETUP.md](SETUP.md) | Guided install, written for Claude Code to run with you |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Hosting the hub on a VPS |
| [docs/HACKATHON.md](docs/HACKATHON.md) | Running autonomous sessions (bypassPermissions) together: checklist and rehearsal |
| [docs/claude-ai.md](docs/claude-ai.md) | Using CodeTgh from claude.ai and the Claude apps |
| [docs/FACTS.md](docs/FACTS.md) | Claude Code and MCP behaviors, each checked against the docs or a real run |
| [docs/REUSE.md](docs/REUSE.md) | Every dependency, with its license read from source |
| [SPEC.md](SPEC.md) | Full design specification (in French) |
| [docs/BRAND.md](docs/BRAND.md) | Logo, colors and type |

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, tests and the few house rules, and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies everywhere in the project.

## License

[MIT](LICENSE). Third-party notices are in [NOTICE](NOTICE). The bundled Inter font files are under the SIL Open Font License 1.1.
