<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/lockup-horizontal-on-dark.svg">
    <img src="assets/brand/lockup-horizontal-color.svg" alt="CodeTgh" width="240">
  </picture>
</h1>

**Plusieurs Claude Code, une même ligne.**

CodeTgh links the Claude Code sessions of a team: your Claude can ask a teammate's Claude a question, see who is working on which file, and hand work over, all through a hub your team runs.

**Status: early, pre-1.0.** The hub, the CLI and the Claude Code plugin work and are tested end to end against local and fake services. The Slack, GitHub, SSO, claude.ai and channel integrations still await real-world runs. Expect breaking changes.

## Install (teammates)

Your admin gives you the hub address. Then:

```
npm install -g https://<your hub>/cli/codetgh.tgz
codetgh setup
codetgh doctor
```

`setup` asks a few questions, one at a time. It stores your token in your system keychain and installs the Claude Code plugin. `doctor` checks everything on one screen and tells you how to fix each problem it finds.

Prefer to be guided by Claude? Open Claude Code in this repository and say: "follow SETUP.md".

## New group project, in 5 steps

1. **Invite your teammates** (admin): `codetgh invite friend@example.com` prints a link that works for 7 days. Send it to them.
2. **Create the project**: in your team's repository, run `codetgh project new "Billing"`. It prepares the repository so Claude Code offers the plugin to everyone who opens it.
3. **Commit** the two files it changed: `.claude/settings.json` and `CLAUDE.md`.
4. **Send the message** that `project new` printed. Each teammate runs the three install lines above, then opens the repository in Claude Code and trusts the folder.
5. **Check**: `codetgh status` shows who is online, your unread messages and who is working on which file.

## Everyday commands

| Command | What it does |
| --- | --- |
| `codetgh status` | Who is online, your unread messages, the files people are working on |
| `codetgh inbox` | Read your messages |
| `codetgh pause` / `codetgh resume` | Stop your Claude from sending messages, then let it send again |
| `codetgh doctor` | Find what is wrong, and how to fix it |

Every command has `--help`.

## Running the hub (admins)

See [SETUP.md](SETUP.md), administrator path: `git clone`, `pnpm install && pnpm build`, then `codetgh setup`.

## Security

- Each person connects with their own account and token. Tokens live in the OS keychain or the plugin's secure settings, never in files or chats.
- A teammate's message reaches your Claude only inside a `<peer_message trust="untrusted-peer">` envelope: it is data, never an instruction.
- Secrets are scanned before a message is stored, and the hub keeps a signed, hash-chained audit log.
- Threads can be end-to-end encrypted.
- No tool runs commands remotely.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Documentation

`SPEC.md` (design), `docs/FACTS.md` (behaviors checked against Claude Code and MCP), `docs/REUSE.md` (dependencies and licenses), `docs/claude-ai.md` (using CodeTgh from claude.ai), `docs/BRAND.md` (brand). Contributions: [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

MIT, see [LICENSE](LICENSE) and [NOTICE](NOTICE). The Inter font files are under the SIL Open Font License 1.1.
