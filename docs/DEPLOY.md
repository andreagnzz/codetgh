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

Then a fresh `claude -p` reviews the PR in the same worktree, read-only: `Edit`, `Write` and `NotebookEdit` are denied, and so are `git commit`, `git push`, `gh pr merge` and `gh pr review`. It ends with `VERDICT: APPROVE` or `VERDICT: REQUEST_CHANGES`, and the runner posts the review on the PR. GitHub refuses an approval from the PR's author, which the runner's account is, so the review then lands as a comment with the verdict on its last line. On approval the task stays in `review` until the merge. On changes requested the author agent runs again in the worktree with the review, and the runner pushes the fix. After 3 rounds without approval the task is `blocked` and the owner gets a note. Only the last line of the reviewer's JSON `result` counts, and only if no other line names a verdict: a review with no verdict, an ambiguous one, a crash or a timeout counts as changes requested. The review reaches the author capped and escaped, as untrusted data. The reviewer is not a security boundary, since the code it reads can steer it: review anything sensitive yourself before merging, and leave `auto_merge` off for such repositories.

It is bounded like the launcher:
- it runs on the owner's machine with the owner's token, and the hub only says *on* or *off* and which task to take;
- the folders come from a local list, and the commands are fixed in the CLI;
- each agent runs in `auto` mode unless `runner.json` says otherwise. It gets the delegate deny rules, edits denied in `.git`, `.codetgh`, `.claude`, `.github/workflows` and CodeTgh's own files, and the CodeTgh Bash check;
- the runner's own git and gh calls ignore repository hooks, fsmonitor and `core.sshCommand`, and it pushes nothing if the repository's git config or hooks changed since it started: restart it after you change them;
- an agent runs with the owner's rights on this machine: use a dedicated machine or container, without secrets.

Setup, once:

1. **Claude Code is logged in** on this machine and the CodeTgh plugin is installed (`codetgh setup`). **`gh` is logged in** with push and PR rights on the repositories: `gh auth login`.
2. **A clone per project**, with an `origin`. The runner refuses a relative path, or a folder that is not a git repository with an origin.
3. **The local list and settings.** Write `~/.config/codetgh/runner.json` (mode 0600). The project id is shown on the console's Projects page.
   ```json
   {
     "projects": { "prj_…": "/home/you/code/my-repo" },
     "max_agents": 3,
     "permission_mode": "auto",
     "auto_merge": false,
     "job_timeout_min": 45
   }
   ```
   `max_agents` counts every agent on this machine. `permission_mode: "bypassPermissions"` and `auto_merge: true` (`gh pr merge --merge --auto` once the reviewer approves) are opt-ins. An agent that runs past `job_timeout_min` is stopped and its task is `blocked`.
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
   Restart=on-failure
   TimeoutStopSec=30

   [Install]
   WantedBy=default.target
   UNIT
   systemctl --user daemon-reload && systemctl --user enable --now codetgh-runner
   journalctl --user -u codetgh-runner -f      # the tasks it takes, their PRs and blocks
   ```

**Hardened setup (recommended).** An agent runs as the user that runs the runner, and nothing short of OS isolation fully contains it. Run the runner as a dedicated user, or in a container, that owns its own clones and holds no other secrets. On Linux, as a system service:
   ```bash
   sudo useradd --system --create-home --home-dir /var/lib/codetgh-runner --shell /bin/bash codetgh-runner
   sudo -u codetgh-runner -H bash -c 'cd && git clone https://github.com/you/my-repo.git'
   sudo -u codetgh-runner -H bash -c 'codetgh login && claude && gh auth login'   # once, then write its runner.json
   sudo tee /etc/systemd/system/codetgh-runner.service <<'UNIT'
   [Unit]
   Description=CodeTgh runner (dedicated user)
   After=network-online.target

   [Service]
   User=codetgh-runner
   ExecStart=/usr/local/bin/codetgh runner
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
   On Linux the runner tags each agent's processes and kills every one that is still running once the agent exits, those it detached included, before it checks the git config and pushes. So don't keep a shell or an editor open inside a runner worktree: it would be killed too. This cleanup runs however a job ends, a lost lease or `systemctl stop` included. If the git config changed or a process survived, the runner writes `<worktree>.quarantine` next to the worktree. Since the worktrees share the clone's `.git`, no task of that project runs again, even after a restart, and each one is `blocked`, until you inspect the clone and delete the worktree and the marker. On macOS and Windows the runner can only end the agent's process tree, so it refuses `permission_mode: "bypassPermissions"` there.

Each agent's output goes to `~/.config/codetgh/runner-logs/<task>-<attempt>.log`. A failed task is `blocked` with a fixed reason and the log's name; the agent's output never leaves this machine. The worktree is kept for inspection. Stopping the service stops the agents. The runner keeps one id in `~/.config/codetgh/runner-id`: restarted within 10 minutes, it resumes its own leases; otherwise they expire, a task without a PR goes back to the queue and a task with one goes back to review.

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
