# Deploy the hub on one VPS

One machine runs two containers: the hub, and the Postgres 17 it uses (`deploy/compose.yaml`).

Nothing is published on the public interfaces:
- The hub listens on `127.0.0.1:8787` only. Docker bypasses ufw, so a port written without `127.0.0.1:` would be public.
- Postgres has no port at all; only the hub reaches it.
- Public HTTPS comes from Tailscale Funnel, which forwards to `http://127.0.0.1:8787`.
- SSH stays on Tailscale.

Hardening, as set in `deploy/compose.yaml`:
- both containers run as non-root users (`node` 1000, `postgres` 999), with a read-only root filesystem and a `tmpfs` where needed;
- `cap_drop: ALL` and `no-new-privileges`;
- memory, CPU and PID limits;
- pinned images: `node:24.21.0-bookworm-slim` and `postgres:17.11-bookworm`;
- the only mounts are the `pgdata` volume and, for dumps, `deploy/backups/` on the host (dumps travel through `docker compose exec`, never through a mount).

## Exposure

- The hub listens on `127.0.0.1` unless `HOST` says otherwise. The container sets `HOST=0.0.0.0` inside, and compose publishes it on `127.0.0.1:8787` only.
- With Tailscale Funnel the hub is public on the internet. With `tailscale serve` it is reachable from your tailnet only, which is enough when every teammate joins the tailnet.
- Per-address limits (browser sign-in) use the socket's address. Behind a proxy every request shares the proxy's address: set `CODETGH_TRUSTED_PROXY` to that address in `deploy/.env` only if the proxy appends `X-Forwarded-For`; the hub then reads the last entry, and ignores the header from anyone else.
- Open to anyone who reaches the hub: the login page, the browser sign-in start (`/v1/device/start`, limited per address), and OAuth client registration (the claude.ai connector registers itself this way). Creating an account still needs an invitation for that email.

## First start

```
git clone https://github.com/andreagnzz/codetgh codetgh && cd codetgh
corepack enable && pnpm install && pnpm build
npm install -g ./apps/hub/dist/codetgh-cli.tgz
codetgh setup            # admin → this machine → GitHub → Tailscale Funnel; writes deploy/.env (0600) with generated secrets
```

1. **GitHub sign-in.** Create an OAuth App at https://github.com/settings/developers with the homepage `https://<machine>.<tailnet>.ts.net` and the callback `https://<machine>.<tailnet>.ts.net/api/auth/callback/github`. Paste its client id and secret into `deploy/.env` (`AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`) yourself, never into a chat.
2. **Start:**
   ```
   docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
   curl -fsS http://127.0.0.1:8787/readyz        # ready
   ```
3. **Public HTTPS (Tailscale Funnel).**
   - Funnel is available on every Tailscale plan, the free Personal plan included, and is still in beta (see `docs/FACTS.md`). It requires MagicDNS, HTTPS certificates, and the `funnel` node attribute (Access controls → Funnel → *Add Funnel to policy*).
   - Turn it on with:
     ```
     sudo tailscale funnel --bg --https=443 http://127.0.0.1:8787
     tailscale funnel status
     ```
4. **First team and owner.** Use the email of your GitHub account: GitHub sign-in only accepts an invited, verified address. The command prints the owner's invitation link, valid 7 days.
   ```
   docker compose -f deploy/compose.yaml --env-file deploy/.env run --rm hub node dist/server/bootstrap.js --team "My team" --email <your GitHub email>
   ```
   There is no SMTP: every invitation is a link (`codetgh invite <email>`).

## Update

```
codetgh update
```

From the checkout (or `--dir <path>`), it runs, in order:
1. `git pull --ff-only`;
2. a backup with its restore check;
3. `docker compose … up -d --build`;
4. a wait of up to 60 s for `/readyz`.

If the pull or the backup fails, no container is touched. If the new hub is not ready, it prints the rollback command with the previous commit. Docker needs your user in the `docker` group, or run `sudo $(which codetgh) update`: under sudo, git still runs as you (your GitHub keys) and the checkout must be yours.

Migrations run when the hub starts. Each one stays compatible with the previous hub version, so rolling back means checking out the previous commit and running `up -d --build` again.

## Backup

- `codetgh backup` runs `deploy/backup.sh`, then `deploy/restore-test.sh` on the new dump, and fails if it does not restore.
- `deploy/backup.sh` writes `deploy/backups/codetgh-<date>.dump` (`pg_dump -Fc`, mode 0600) and deletes dumps older than 7 days.
- It runs every night at 03:17 from a crontab that can run `docker`: root's (`sudo crontab -e`), or a user in the `docker` group. The line is `17 3 * * * cd <repo> && deploy/backup.sh >> deploy/backups/backup.log 2>&1`. Run that exact command once by hand to check it writes a dump.
- Copy `deploy/backups/` off the machine from time to time; a backup kept on the same disk does not survive the disk.

## Restore

- **Check that a dump restores**, without touching the live database: `deploy/restore-test.sh [dump]`. It loads the dump into a scratch database and compares row counts.
- **Replace the live database with a dump**, while the hub is stopped:
  ```
  docker compose -f deploy/compose.yaml --env-file deploy/.env stop hub
  docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T db dropdb -U codetgh codetgh
  docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T db createdb -U codetgh codetgh
  docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T db pg_restore -U codetgh -d codetgh --no-owner < deploy/backups/<dump>
  docker compose -f deploy/compose.yaml --env-file deploy/.env start hub
  ```

## Stop

```
sudo tailscale funnel reset                                        # no more public access
docker compose -f deploy/compose.yaml --env-file deploy/.env down  # containers stop; the pgdata volume stays
```

`down -v` also deletes the database volume. Take a dump first.

## Remote Control launcher (optional, owner only)

The launcher lets the team owner start Claude Code sessions on this machine from the console. In **Projects**, use *Start Remote Control*, then open the session at https://claude.ai/code or in the Claude app.

It is bounded on purpose:
- it runs on the owner's machine with the owner's token;
- the hub only says *on* or *off* for a project;
- the folder comes from a local list, and the command is always `claude remote-control --name "CodeTgh · <project>"`;
- a project missing from the list is refused, and the console says so.

Setup, once:

1. **Claude Code is logged in** on this machine with a Pro, Max, Team or Enterprise account (Remote Control does not work with API keys), and you have trusted each project folder once. Run `cd <repo> && claude`, accept the trust dialog, then quit. The launcher has no terminal, so Claude Code refuses an untrusted folder.
2. **The local list.** Write `~/.config/codetgh/launcher.json` (mode 0600). The project id is shown on the console's Projects page.
   ```json
   { "projects": { "prj_…": "/home/you/code/my-repo" } }
   ```
3. **The owner's token** is in the keychain or the environment: `codetgh login --url https://<hub>`.
4. **Run it as a user service** that survives logout:
   ```bash
   mkdir -p ~/.config/systemd/user
   cat > ~/.config/systemd/user/codetgh-launcher.service <<'UNIT'
   [Unit]
   Description=CodeTgh Remote Control launcher
   After=network-online.target

   [Service]
   ExecStart=%h/.npm-global/bin/codetgh launcher
   Restart=on-failure

   [Install]
   WantedBy=default.target
   UNIT
   systemctl --user daemon-reload && systemctl --user enable --now codetgh-launcher
   sudo loginctl enable-linger "$USER"
   journalctl --user -u codetgh-launcher -f      # what it starts and stops
   ```
   Adjust `ExecStart` to the output of `which codetgh`.

Each folder runs a single Remote Control server. A session you create from claude.ai/code runs in that folder, with your Claude Code permissions and settings. Stop it from the console, or with `systemctl --user stop codetgh-launcher`.

## Runner (optional, owner only)

The runner does the tasks flagged `runner` (`/codetgh:split --run`) of the projects the owner switched on in the console, **Projects**. Only an owner or an admin can flag a task for the runner. For each task it creates a git worktree in `~/.config/codetgh/worktrees/<project>/<task>`, outside the clone, on a branch `codetgh/<task>`. It runs `claude -p` there, pushes the branch and opens a PR with `gh`, titled with the task's title. The task then moves to `review`. A task whose dependency is in review is stacked on the parent's branch.

Then a fresh `claude -p` reviews the PR in the same worktree, read-only: `Edit`, `Write` and `NotebookEdit` are denied, and so are `git commit`, `git push`, `gh pr merge` and `gh pr review`. It ends with `VERDICT: APPROVE` or `VERDICT: REQUEST_CHANGES`, and the runner posts the review on the PR. GitHub refuses an approval from the PR's author, which the runner's account is, so the review then lands as a comment with the verdict on its last line. On approval the task stays in `review` until the merge. On changes requested the author agent runs again in the worktree with the review, and the runner pushes the fix. After 3 rounds without approval the task is `blocked` and the owner gets a note. Only the last line of the reviewer's JSON `result` counts, and only if no other line names a verdict: a review with no verdict, an ambiguous one, a crash or a timeout counts as changes requested. The review reaches the author capped and escaped, as untrusted data. The reviewer is not a security boundary, since the code it reads can steer it: review anything sensitive yourself before merging, and leave `auto_merge` off for such repositories. An approved PR is not reviewed again unless a restack changes its code.

The merge comes back through the team's GitHub webhook: in the console, **Settings › GitHub › Create the webhook**, then in the repository on GitHub, **Settings › Webhooks › Add webhook** (or in your GitHub App) paste the URL and the secret, content type `application/json`, with the **Pull requests** event (and **Create**: see [Tags that finish tasks](#tags-that-finish-tasks-optional)). A merged PR of the project's repository whose number and branch `codetgh/<task>` are a runner task's moves that task from `review` or `in_progress` to `done`, with the note "merged"; a PR closed without merge moves it to `blocked`. An event not newer than the last one applied to the task (GitHub's `closed_at` or `updated_at`) is ignored, so a replayed or late delivery changes nothing; a `done` task never changes, and a reopened PR restores nothing: use `codetgh run retry`. The hub does it, audited with the delivery id, from the event's metadata only. On its next pass the runner restacks, for each PR in review that is stacked on a parent's branch:
- parent merged: `gh pr edit <child> --base <default branch>` (or, if that fails, `gh api -X PATCH repos/{owner}/{repo}/pulls/<child> -f base=<default branch>`), then `git rebase --onto origin/<default branch> <recorded base>` in the child's worktree;
- parent with new commits: the same rebase onto the parent's new tip.

The recorded base is the commit the child's worktree started from, in `<worktree>.base`. The runner pushes with `--force-with-lease` on the child's own `codetgh/<task>` branch only, after the git config check. A rebase that conflicts is aborted, nothing is pushed, and the task is `blocked` with "restack conflict". A restack does not count a review round; when it changed the code, the PR is reviewed once more. Nothing is restacked or cleaned in a project with a quarantined worktree. Once a task is `done`, the runner removes its worktree, its local branch, its lock and its recorded base, never a `.quarantine`.

From the runner's machine, with the owner's login:
```
codetgh run status [--project <id>]   ready, waiting, in progress, review (PR, round), blocked (reason), done in 24 h
codetgh run retry <task>              a blocked runner task back to todo, its lease and rounds cleared
```
`run retry` refuses while that project has a `.quarantine`: inspect the worktree and the clone's git config, remove the marker, then retry. A retried task with a PR goes back to review, where the next pass restacks or reviews it. The blocked reasons are codes: `runner_error` (see the log), `review_rounds`, `restack_conflict`, `pr_closed`, `quarantined`, `other`.

It is bounded like the launcher:
- it runs on the owner's machine with the owner's token, and the hub only says *on* or *off* and which task to take;
- the folders come from a local list, and the commands are fixed in the CLI;
- each agent, author or reviewer, runs in a throwaway Docker container (`"isolation": "docker"`, the default), which is the security boundary. The container sees only the task's worktree, at `/work`, read-only for the reviewer, with the worktree's `.git` pointer hidden, so git does not work inside. It gets one variable, the Claude credential that `claude_auth_env` names, and nothing else of this machine: no `CODETGH_TOKEN`, no gh token, no SSH agent or keys, no home, no `~/.claude`, no Docker socket. Root filesystem read-only, `/tmp` in memory, every capability dropped, `no-new-privileges`, process, memory and CPU limits, uid 10001. It reaches the network through Docker's default bridge: the internet, and whatever this host or your LAN exposes to that bridge;
- the author leaves its changes in the worktree, and the runner commits them as `CodeTgh runner <runner@codetgh.invalid>` with the task's title. It refuses, and blocks the task, any change under `.git`, `.github/workflows`, `.codetgh` or `.claude`, a submodule, or a symlink that leads out of the worktree;
- each agent runs in `auto` mode unless `runner.json` says otherwise, with the delegate deny rules and edits denied in `.git`, `.codetgh`, `.claude`, `.github/workflows` and CodeTgh's own files. The CodeTgh plugin and its Bash check are not in the container;
- the runner's own git and gh calls ignore repository hooks, fsmonitor and `core.sshCommand`, and it pushes nothing if the repository's git config or hooks changed since it started: restart it after you change them;
- with `"isolation": "none"` an agent runs with the runner user's rights on this machine, and the runner prints a warning at each start and refuses `bypassPermissions`.

Setup, once:

1. **`gh` is logged in** with push and PR rights on the repositories: `gh auth login`. **Docker runs** and this user may use it (`docker version` answers; on Linux, `sudo usermod -aG docker $USER`, then log in again). Membership of the `docker` group is as good as root on this machine: that is one more reason for a dedicated user, below.
   - **The image.** `codetgh runner build-image` builds `codetgh-runner-agent:<CodeTgh version>` from `deploy/runner-agent.Dockerfile`: Node, git and Claude Code at a pinned version, no gh, no keys. Build it again after each CodeTgh update; the runner refuses to start without it.
   - **The agents' Claude credential.** Run `claude setup-token` once (a one-year token for your Claude subscription), and give the runner its value as `CLAUDE_CODE_OAUTH_TOKEN`, in a 0600 file the service reads: `install -m 600 /dev/null ~/.config/codetgh/runner.env`, then write `CLAUDE_CODE_OAUTH_TOKEN=…` in it. For API billing, use `ANTHROPIC_API_KEY` and `"claude_auth_env": "ANTHROPIC_API_KEY"` instead. The runner refuses to start when that variable is empty, and passes it to each container by name, never on a command line or in a log.
   - With `"isolation": "none"` instead: Claude Code logged in on this machine and the CodeTgh plugin installed (`codetgh setup`).
2. **A clone per project, for the runner alone**, with an `origin`: `git clone <origin> ~/runner/<project>`, never the folder you work in. The runner refuses a relative path, or a folder that is not a git repository with an origin. On Linux it also refuses to start while another process of this user (a shell, an editor, a Claude session) has its current folder in the clone, and names it.
3. **The local list and settings.** Write `~/.config/codetgh/runner.json` (mode 0600). The project id is shown on the console's Projects page.
   ```json
   {
     "projects": { "prj_…": "/home/you/code/my-repo" },
     "max_agents": 3,
     "permission_mode": "auto",
     "auto_merge": false,
     "job_timeout_min": 45,
     "isolation": "docker",
     "claude_auth_env": "CLAUDE_CODE_OAUTH_TOKEN",
     "memory": "4g",
     "cpus": 2
   }
   ```
   `memory` and `cpus` cap each container. `max_agents` counts every agent on this machine. `permission_mode: "bypassPermissions"` and `auto_merge: true` (`gh pr merge --merge --auto` once the reviewer approves) are opt-ins. An agent that runs past `job_timeout_min` is stopped and its task is `blocked`.
4. **Optional routing.** `.codetgh/routing.json`, committed on the default branch, picks `--model` and `--effort` with ordered rules; the first match wins. The runner reads it from `origin/HEAD`, never from a worktree:
   ```json
   { "rules": [{ "match": { "role": "reviewer" }, "model": "opus" }, { "match": { "role": "author" }, "model": "sonnet", "effort": "medium" }] }
   ```
5. **Run it as a user service**, like the launcher:
   ```bash
   cat > ~/.config/systemd/user/codetgh-runner.service <<'UNIT'
   [Unit]
   Description=CodeTgh runner
   After=network-online.target

   [Service]
   ExecStart=%h/.npm-global/bin/codetgh runner
   EnvironmentFile=-%h/.config/codetgh/runner.env
   Restart=on-failure
   TimeoutStopSec=30

   [Install]
   WantedBy=default.target
   UNIT
   systemctl --user daemon-reload && systemctl --user enable --now codetgh-runner
   journalctl --user -u codetgh-runner -f      # the tasks it takes, their PRs and blocks
   ```

**Hardened setup (recommended).** The container holds the agents, but the runner itself holds the CodeTgh token, the gh login and, through Docker, root on the host. Run it as a dedicated user that owns its own clones and holds no other secrets. On Linux, as a system service:
   ```bash
   sudo useradd --system --create-home --home-dir /var/lib/codetgh-runner --shell /bin/bash codetgh-runner
   sudo usermod -aG docker codetgh-runner
   sudo -u codetgh-runner -H bash -c 'cd && git clone https://github.com/you/my-repo.git'
   sudo -u codetgh-runner -H bash -c 'codetgh login && gh auth login && codetgh runner build-image'   # once, then write its runner.json and runner.env
   sudo tee /etc/systemd/system/codetgh-runner.service <<'UNIT'
   [Unit]
   Description=CodeTgh runner (dedicated user)
   After=network-online.target

   [Service]
   User=codetgh-runner
   ExecStart=/usr/local/bin/codetgh runner
   EnvironmentFile=-/var/lib/codetgh-runner/.config/codetgh/runner.env
   Restart=on-failure
   TimeoutStopSec=30
   # The people's homes are out of reach; only the runner's own home is writable.
   ProtectHome=yes
   ProtectSystem=strict
   ReadWritePaths=/var/lib/codetgh-runner
   PrivateTmp=yes
   NoNewPrivileges=yes

   [Install]
   WantedBy=multi-user.target
   UNIT
   sudo systemctl daemon-reload && sudo systemctl enable --now codetgh-runner
   ```
   Each container is named `codetgh-job-<task>` and labelled `codetgh.runner=<runner id>`. A timeout, a lost lease or `systemctl stop` runs `docker kill` on it, and the runner removes it at the end of every job, and removes those a stopped runner left when it starts again. A container that stays quarantines the worktree, like a surviving process below.

   The container holds the agent's processes, so the runner kills nothing else on the host. With `"isolation": "none"`, on Linux, the runner tags each agent's processes and kills every one that is still running once the agent exits, those it detached included, plus any process whose current folder is in the job's worktree, before it checks the git config and pushes. So don't keep a shell or an editor open inside a runner worktree: it would be killed too. A process in the clone without the tag is never killed. This cleanup runs however a job ends, a lost lease or `systemctl stop` included. If the git config changed or a process survived, the runner writes `<worktree>.quarantine` next to the worktree. Since the worktrees share the clone's `.git`, no task of that project runs again, even after a restart, and each one is `blocked`, until you inspect the clone and delete the worktree and the marker. With `"isolation": "none"` this sweep is all there is, and only on Linux; the runner refuses `permission_mode: "bypassPermissions"` without a container.

Each agent's output goes to `~/.config/codetgh/runner-logs/<task>-<attempt>.log`. A failed task is `blocked` with a fixed reason and the log's name; the agent's output never leaves this machine. The worktree is kept for inspection. Stopping the service stops the agents. The runner keeps one id in `~/.config/codetgh/runner-id`: restarted within 10 minutes, it resumes its own leases; otherwise they expire, a task without a PR goes back to the queue and a task with one goes back to review.

## Tags that finish tasks (optional)

A task can wait for a git tag: `task_create` or `task_update` with `verify: {tag: "step-02-harness"}`. When that tag is created in the project's repository, the hub moves the task to `done` with the note "verified by tag step-02-harness". It needs the same team webhook as the runner's merge link, with the **Create** event ticked too (a GitHub App needs read access to **Contents** for it). The hub checks the signature, finds the project by the repository, and moves only that project's tasks that are not `done` or `cancelled`; a tag of another repository, or a replayed delivery, changes nothing. GitHub sends no `create` event when more than three tags are pushed at once, so push the tag alone.

## Discord bot (optional)

A small bot for a community server: `/install`, `/docs`, `/status` (CI of main), `/bug`, `/security`. It uses Discord's HTTP interactions, so there is no gateway connection and no token at runtime. Every request is checked against Discord's Ed25519 signature. It sees neither the hub nor its data.

1. In the [Developer Portal](https://discord.com/developers/applications), copy the application's **Application ID** and **Public Key** (both public) into `deploy/.env` as `DISCORD_APP_ID` and `DISCORD_PUBLIC_KEY`.
2. Start it, and expose it on a second Funnel port:
   ```
   docker compose -f deploy/compose.yaml --env-file deploy/.env --profile discord up -d --build discord
   sudo tailscale funnel --bg --https=8443 http://127.0.0.1:8790
   ```
3. In the portal, set **Interactions Endpoint URL** to `https://<your-machine>.<tailnet>.ts.net:8443/interactions` and save. Discord checks it with a signed PING.
4. Register the commands once. The bot token (portal → Bot → Reset Token) stays in your shell, never in a file:
   ```
   read -rs DISCORD_BOT_TOKEN && export DISCORD_BOT_TOKEN
   docker compose -f deploy/compose.yaml --env-file deploy/.env --profile discord run --rm -e DISCORD_BOT_TOKEN discord node register.js
   unset DISCORD_BOT_TOKEN
   ```
5. Invite the bot with `https://discord.com/oauth2/authorize?client_id=<Application ID>&scope=applications.commands`.
