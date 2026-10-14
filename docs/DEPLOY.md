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
- Open to anyone who reaches the hub: the login page, and OAuth client registration (the claude.ai connector registers itself this way). Creating an account still needs an invitation for that email.

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

If the pull or the backup fails, no container is touched. If the new hub is not ready, it prints the rollback command with the previous commit. Docker needs your user in the `docker` group, or run `sudo $(which codetgh) update`.

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
