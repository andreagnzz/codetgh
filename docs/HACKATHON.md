# Two autonomous Claude Code sessions on one VPS

Checklist for running CodeTgh with long, autonomous sessions in `bypassPermissions`: two people, one shared VPS, one hackathon repository. Rehearse it once end to end before the event.

In bypass there is no permission prompt to catch a mistake. The `<peer_message>` envelope and the model's judgment are what stand between a teammate's text and your shell. The hub enforces the rest:
- peer text arrives only inside an envelope, and look-alike characters are neutralized;
- claim scopes are paths only;
- agent-to-agent loops are capped;
- delivery is rate-limited.

## Bypass sessions

A session started with `claude --dangerously-skip-permissions` shows `bypass` on its first line, with a ⚠ note, and in Console → Agents and Projects. `team_overview` and `whoami` give its `permission_mode`; a change with shift+tab reaches the hub with the next prompt.

What CodeTgh still guarantees in bypass:
- a secret in a tool call is denied by the `pre-tool-use` hook, and the hub refuses it in a message whatever the session's mode;
- a claim conflict is denied when Settings say **block**; with **ask** it becomes a warning, since nobody can answer a prompt;
- the hub-side limits above: envelopes, path-only claim scopes, loop caps, rate limits, the kill switch.

What it cannot do: stop a command the model decides to run, or a prompt injection the model follows. Claude Code's docs say bypass is meant for isolated containers or VMs ([Permission modes](https://code.claude.com/docs/en/permission-modes)): run these sessions under your own Unix user on the VPS, never as root, with no secrets the task does not need.

## 1. The hub (once, by its owner)

- **Hub on main.** Update it with `cd ~/code/codetgh-public && sudo $(which codetgh) update`. It must answer `/readyz`.
- **Tailnet only, not the internet.** Funnel makes the hub public; `serve` keeps it on your tailnet. Port 8443 stays on Funnel only if the Discord bot runs, since Discord must reach it.
  ```
  sudo tailscale funnel --https=443 off
  sudo tailscale serve --bg --https=443 http://127.0.0.1:8787
  ```
- **Invite the teammate into the tailnet.** Tailscale admin console → Users → Invite. The hub address does not change.
- **Console → Settings:**
  - *When an agent edits a file someone else claimed*: **warn the agent**. In bypass an `ask` cannot be answered: CodeTgh turns it into a warning, but `warn` says it explicitly.
  - *Push modes allowed*: **rewake** is ticked on a new team; tick it on a team created before this default.

## 2. Each person (on the VPS, under your own Unix user)

1. Follow the member [Quickstart](../README.md#quickstart), installing the CLI in your home, never with sudo: run `npm config set prefix ~/.local` once first (`~/.local/bin` must be on PATH). Setup picks the push mode itself: **rewake** when the team allows it (section 1), otherwise `hooks`. Setup leaves the plugin **off at user scope**, so it only runs in team repositories.

   If you installed the plugin before, turn it off everywhere else: `claude plugin disable codetgh@codetgh --scope user`. Before the event, `codetgh upgrade` brings the CLI and the plugin up to date.
2. In the hackathon repository, the first person runs `codetgh project new "<name>"` and commits `.claude/settings.json` and `CLAUDE.md`. The other pulls them.
3. Open Claude Code in the repository. Its first line says it all:
   ```
   CodeTgh ✓ <project> · @you · push rewake · Claude Code 2.1.299 · 2 online · 0 unread
   ```
   Anything to fix follows on that line after ⚠: rewake not allowed by the team, or a Claude Code older than the tested 2.1.296. `codetgh doctor` gives the details and the fix for each check.

## 3. How messages reach a busy agent

| Your agent is… | It sees a teammate's message… |
| --- | --- |
| working through tool calls | after its next tool call: at most one hub check every 25 s, through the `inbox` hook |
| idle, waiting | at once, woken by `rewake` (at most 6 wakes per 10 min) |
| at a prompt you type | with that prompt |

- **Blocked on a question.** An agent that cannot go on without an answer uses `ask_peer` with `priority: "blocking"`. If the answer is not back within the wait, it keeps working; the answer arrives between its tool calls.
- **Acknowledging.** Messages are delivered in batches of 5, and an agent must call `ack` once it handled them, or newer ones queue behind.
- **Limits.** Past 10 injections per 10 min, or 12 agent messages between the same two people per 10 min, CodeTgh stops pushing and says so. Read the console, then let a human decide.
- **Loops.** After 5 agent messages in a row in one thread, the hub mutes it. Without an orchestrator, a human reopens it by replying from the console.

### Loop orchestrator (optional)

An agent of its own judges muted loops in place of a human: it reads the thread, posts one verdict to both agents (and their people), and may reopen the thread once. A second loop in the same thread waits for a human (alert *loop: human decision*).

1. Invite a member for it (e.g. `codetgh invite orchestrator@<your-domain>`), sign in once, and create its personal token.
2. Console → Settings → *Loop orchestrator*: its handle (e.g. `orchestrator`).
3. On the VPS, in its own folder with only a `CLAUDE.md` saying "You are the team's loop orchestrator: for every CodeTgh delivery, follow the codetgh:orchestrate skill":
   ```
   cd ~/orchestrator && codetgh setup        # its hub URL and token; push mode rewake
   tmux new -s orchestrator 'claude --allowedTools "mcp__plugin_codetgh_hub__*" --disallowedTools "Bash Edit Write WebFetch"'
   ```
   It can only read and write on the hub. Leave it idle: rewake wakes it when a loop arrives. It uses the Claude account it runs under.

## 4. Stop everything

| What | How |
| --- | --- |
| All agent traffic, at once | Console dashboard → Kill switch → **Stop agent traffic** (a reason is required; type `yes` to resume) |
| Your own agents only | `codetgh pause` (then `codetgh resume`) |
| The hub off the tailnet | `sudo tailscale serve reset` |
| The hub itself | `docker compose -f deploy/compose.yaml --env-file deploy/.env stop hub` |

## 5. Rehearsal script

Two sessions, each started with `claude --dangerously-skip-permissions` in the repository, each given a long task such as "implement X, run the tests until green".

1. While both are working, session A asks session B something only B knows, using `ask_peer` with priority `blocking`.
   - **Expected:** B shows the question within about 30 s, between two tool calls.
   - **Expected:** B answers with `send_message` (`reply_to`), and A gets the answer within about 60 s in all, without anyone typing.
2. A claims a file it is editing. B edits that file.
   - **Expected:** B gets a warning naming A, not a blocked tool.
3. Console → Agents: both sessions show online, with their project and the end of their agent id.
4. Console → Kill switch → Stop agent traffic.
   - **Expected:** both agents' next CodeTgh calls are refused. Resume it.
