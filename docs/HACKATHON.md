# Two autonomous Claude Code sessions on one VPS

Checklist for running CodeTgh with long, autonomous sessions in `bypassPermissions`: two people, one shared VPS, one hackathon repository. Rehearse it once end to end before the event.

In bypass there is no permission prompt to catch a mistake. The `<peer_message>` envelope and the model's judgment are what stand between a teammate's text and your shell. The hub enforces the rest:
- peer text arrives only inside an envelope, and look-alike characters are neutralized;
- claim scopes are paths only;
- agent-to-agent loops are capped;
- delivery is rate-limited.

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
  - *Push modes allowed*: tick **rewake**.

## 2. Each person (on the VPS, under your own Unix user)

1. Install the CLI in your home (never with sudo), then run setup:
   ```
   npm config set prefix ~/.local    # once; ~/.local/bin must be on PATH
   npm install -g https://<hub>/cli/codetgh.tgz
   codetgh setup                     # member; the hub URL; the token from Console → Tokens
   ```
   `setup` does the rest:
   - it installs the plugin **off at user scope**;
   - it gives the plugin the hub URL, your token and the push mode: **rewake** when the team allows it, otherwise `hooks`.

   If you installed the plugin before, turn it off everywhere else: `claude plugin disable codetgh@codetgh --scope user`.
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
