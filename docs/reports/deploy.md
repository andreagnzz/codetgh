# Deploy report: the hub on one VPS

Date: 2026-10-14. Everything below was checked on the machine, not copied from the plan. How to reproduce it: [DEPLOY.md](../DEPLOY.md).

## What runs

| Service | Image | Listens on | User | Root FS | Limits |
| --- | --- | --- | --- | --- | --- |
| hub | `codetgh-hub:local` (from `node:24.21.0-bookworm-slim`) | `127.0.0.1:8787` | 1000 | read-only | 768 MB, 1.5 CPU |
| db | `postgres:17.11-bookworm` | Docker network only | 999 | read-only | 512 MB, 1 CPU |
| discord (optional) | `codetgh-discord-bot:local` | `127.0.0.1:8790` | 1000 | read-only | 128 MB, 0.25 CPU |

All three containers run with `cap_drop: ALL` and `no-new-privileges`. They mount nothing outside `deploy/` and the `pgdata` volume.

## Network

- **No public port opened, ufw untouched.** On the host, the only sockets outside loopback are:
  - SSH;
  - Tailscale's own sockets on `tailscale0`.
- **Public HTTPS** comes from Tailscale Funnel, at no cost:
  - `https://claude-vps.tailf3fd40.ts.net` → `http://127.0.0.1:8787` (hub);
  - `https://claude-vps.tailf3fd40.ts.net:8443` → `http://127.0.0.1:8790` (Discord interactions).
- **Funnel permission.** The admin console no longer has a Funnel toggle. It is granted in the tailnet policy file (JSON editor) with `nodeAttrs: [{ "target": ["autogroup:member"], "attr": ["funnel"] }]`. The Funnel commands were run by the owner, not by an agent.

## Sign-in and secrets

- **Sign-in** is GitHub only. There is no SMTP: invitations are links.
- **Secrets** live in `deploy/.env`, which has mode 0600 and is ignored by Git. No agent read it; the values never appeared in a chat, a log or a commit.
- **Discord.** `deploy/.env` holds only the public Discord values, the application ID and the public key. The bot token is used once, from the owner's shell, to register the commands, and is stored nowhere.

## Checks from outside (over Funnel)

| Check | Result |
| --- | --- |
| `GET /readyz` | 200 |
| `GET /login` | 200, with the GitHub button |
| `GET /v1/whoami` without a token / with a made-up token | 401 / 401 |
| Discord interaction without a valid Ed25519 signature | 401 |
| Discord signed PING (Developer Portal endpoint check) | accepted |
| `/cli/codetgh.tgz` | serves the current CLI (it contains `codetgh backup`) |

Not done: `whoami` with a real throwaway token. Creating one needs the owner's account.

## Backup and restore

- `deploy/backup.sh` writes `deploy/backups/codetgh-<date>.dump` (`pg_dump -Fc`, mode 0600) and keeps 7 days.
- **Restore test on the live, non-empty database.** `deploy/restore-test.sh` loads the dump into a scratch database and compares row counts:

  | Table | Live | Restored |
  | --- | --- | --- |
  | team | 1 | 1 |
  | membership | 1 | 1 |
  | user | 1 | 1 |
  | message | 0 | 0 |
  | audit_event | 5 | 5 |

- **Fixed during this check:** the nightly cron was in the crontab of a user outside the `docker` group, so the dump step could never run. It now sits in root's crontab:
  ```
  17 3 * * * cd /home/andrea/code/codetgh-public && deploy/backup.sh >> deploy/backups/backup.log 2>&1
  ```
  Its exact command was run once by hand and wrote a dump. The alternative was to add the user to the `docker` group, which is root-equivalent, so it was left out.
- **Off-machine copy** of `deploy/backups/`: made by the owner on 2026-10-14.

## Updates

`codetgh update` runs `git pull --ff-only`, then a backup with its restore check, then `docker compose … up -d --build`, then waits for `/readyz`. If the pull or the backup fails, it touches no container. The hub was redeployed from `main` this way, by hand, after each merged fix. Migration 0011 (launcher) ran on start.

## Fixes shipped on the way

- **#1.** The login page showed no GitHub button.
- **#2.** Postgres idle-connection errors crashed the hub.
- **#9 and #15.** CodeTgh on Windows:
  - the hook never ran;
  - claimed paths were not matched;
  - the build failed;
  - `claude.cmd` was not found.
- **#10.** The console showed private replies to the whole thread.
- **#11.** The outbox could send a queued message to another hub or as another user.
- **#12.** Expired messages kept being delivered.

## Open

- `whoami` with a real throwaway token.
- Monitoring: nothing alerts when the hub goes down.

## Follow-up

- 2026-10-27: the root crontab line above runs `deploy/backup.sh` from a checkout that an unprivileged user owns, so that user's processes could rewrite what root runs. [DEPLOY.md](../DEPLOY.md#nightly-job) now runs the job from a root-owned copy of `deploy/`. This report stays as it was on 2026-10-14.
