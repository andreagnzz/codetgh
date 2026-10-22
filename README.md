<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-horizontal-on-dark.svg">
    <img src="assets/brand/lockup-horizontal-color.svg" alt="CodeTgh" width="240">
  </picture>
</h1>

**Many Claude Codes, one shared line.**

CodeTgh connects the Claude Code sessions of a team. Each teammate keeps their own Claude, account and machine. Through a hub your team hosts, their agents can:
- ask each other questions and hand tasks over, while each keeps working;
- see who is on which project and which file;
- pass work on without losing context.

> **Status: early, pre-1.0.** The hub, the CLI and the Claude Code plugin are tested end to end. The Slack, GitHub, SSO, claude.ai and channel integrations are built and tested against local fakes, and are waiting for real-world runs. Expect breaking changes.

## Quickstart

**Member.** Your admin gives you the hub's address and an invitation. Then:

```bash
npm install -g https://<your-hub>/cli/codetgh.tgz
codetgh setup            # pick "member"; it prints a link and a code: confirm them in the browser, then it runs codetgh doctor
cd <your-repo> && codetgh start   # Claude Code with CodeTgh on, for this session only
```

CodeTgh only touches sessions you launch with `codetgh start`. A plain `claude` session in another folder never sees it.

Update later with `codetgh upgrade` (the CLI and the plugin, from your hub). Prefer being guided by Claude? Open Claude Code in this repository and say *"follow SETUP.md"*.

**Admin.** To host the hub, follow [SETUP.md](SETUP.md) or [docs/DEPLOY.md](docs/DEPLOY.md).

## What it does

- **Messages between agents, per project.** Agents send questions, answers, notes and requests to a teammate, a thread or the team. A session only receives what belongs to its own project, or what is addressed to it by id; a direct message with no project stays in the web console.
- **Always reachable.** New messages reach a busy agent between two tool calls (every 10 s), and wake an idle session in rewake mode, whether it has run a turn yet or not.
- **Tasks and handoffs.** Assign a task to a teammate, or hand a topic over with what is done, what is left, the branch and the decisions. The teammate's agent picks it up without rereading your context.
- **Delegation (opt-in).** A teammate can let their session carry out your requests without anyone at the keyboard, then answer *done*, *blocked* or the result. See [Delegate sessions](#delegate-sessions).
- **File claims.** Before Claude edits a file someone else is working on, it warns you or asks you first, as your team chose.
- **Usage limits.** When your Claude plan nears its limit, your agent writes a handoff; at the limit, your teammates on the project are told when you will be back, and again when you are.
- **Spec splitting.** `/codetgh:split <spec>` turns a spec into tasks and proposes who takes each one, from who is online, on which OS, how much of their Claude plan is left, and who runs a delegate session. Nothing is created before you approve; `--yes` approves it all at once, and `--dispatch` also sends delegate sessions their first task.
- **Team memory.** Keep decisions that every new session reads.
- **A web console, by project.** Presence, threads, tasks and agents, filtered or grouped by project, with archives for threads quiet for a day and tasks done for a day. Alerts, invitations, and one switch that stops all agent traffic.
- **Reach.** A claude.ai connector, a typed SDK, GitHub and Slack bridges, A2A, per-thread end-to-end encryption and SSO.

## How it works

```
 Teammate A                         Your hub (one VPS)                    Teammate B
 Claude Code ─ plugin ─ CLI  ──HTTPS──▶  MCP · REST · console  ◀──HTTPS──  Claude Code ─ plugin ─ CLI
   (own account,                         Postgres, audit log                (own account,
    code stays local)                                                         code stays local)
```

Code and Anthropic credentials never leave each machine. The hub only relays messages, claims and tasks. A session belongs to the project of the repository it runs in, identified by the repository's git `origin`, not by its folder path.

## Start a group project

1. **Invite your teammates.** Run `codetgh invite friend@example.com` to get a sign-up link valid for 7 days.
2. **Open the repository with CodeTgh.** A member's first `codetgh start` in a repository creates its team project, named after the repository. A session started elsewhere links itself when it enters the repository. Run `codetgh project new "Billing"` there if you want to choose the name.
3. **Commit** the files that command writes: `.claude/settings.json` (the hub's plugin marketplace) and `CLAUDE.md`.
4. **Share the message** it prints. Teammates follow the [Quickstart](#quickstart), then run `codetgh start` in the repository.
5. **Check.** `codetgh status` shows who is online, your unread messages and the files being worked on.

## Delegate sessions

A delegate session carries out the requests of the teammates it names, on its own project only:

```bash
codetgh start --accept-requests-from @andrea          # Claude Code's auto mode
codetgh start --accept-requests-from @andrea --dangerously-skip-permissions   # no permission prompts
```

The sender's agent asks for it in plain words ("delegate to @alex: run the tests and tell me the result"). It keeps working, and the answer comes back on its own.

- **Who decides.** Only the receiving teammate turns it on, at launch, for named teammates of the same team. The hub never turns it on, and a request can never ask for it.
- **Kept in every mode.** Deny rules and a CodeTgh command check refuse reading secret files (`.env*`, keys, `~/.ssh`, `~/.aws`), force pushes in any spelling, and commands built at run time. A delegate session cannot pass a request on to a third agent. One request runs at a time and expires after 30 minutes.
- **Not a sandbox.** These checks reduce the risk; they do not isolate the machine. Run a delegate session, and above all one without permission prompts, in a devcontainer or a dedicated clone without secrets.
- **Turn it off** from the console, page *Delegations*.

Without a delegate session, a teammate's message stays data: their agent shows it to them and they decide.

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
| `codetgh start` | Launch Claude Code here with CodeTgh on, for this session only; `--accept-requests-from` makes it a delegate session |
| `codetgh doctor` | Health check: hub, token, plugin, hooks, Claude Code version |
| `codetgh status` | Who is online, your unread messages, current file claims |
| `codetgh send` / `inbox` | Send a message, read yours |
| `codetgh upgrade` | Update the CLI and the Claude Code plugin from your hub |
| `codetgh invite <email>` | Create a 7-day invitation link (admins) |
| `codetgh project new <name>` | Optional: name a repository's team project |
| `codetgh launcher` | Owner's machine: run Remote Control for the projects switched on in the console |
| `codetgh runner` | Owner's machine: do the runner tasks of the projects switched on in the console, one `claude -p` per task in a git worktree, one PR each |
| `codetgh pause` / `resume` | Stop or restart your own agents' outgoing messages |
| `codetgh backup` / `update` | (admins, on the hub's machine) Back up the hub with a restore check, or update the hub safely |

Every command has `--help`, and every error says what to do next.

## Security model

- **One identity per person.** Everyone signs in with their own account. Tokens live in the OS keychain or the plugin's secure settings, never in files or chats.
- **Peer text is data.** A teammate's message reaches your Claude only inside a `<peer_message trust="untrusted-peer">` envelope, escaped, and never counts as an instruction. The one exception is a [delegate session](#delegate-sessions) its owner opted into, for the teammates they named, on that project.
- **Project boundaries.** A session sees only its own project's traffic, so an unrelated repository on the same machine never receives team messages.
- **Guards on every message.** Secrets are scanned before storage. A loop guard and rate limits stop runaway agents, and an admin kill switch stops all agent traffic.
- **Verifiable history.** The audit log is hash-chained and signed with a key kept outside the database.
- **Private by design.** Threads can be end-to-end encrypted. No tool runs commands remotely, apart from the two opt-ins above: delegate sessions, and the owner's own launcher (`codetgh launcher`), which can start or stop `claude remote-control` in folders listed on that machine.

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
