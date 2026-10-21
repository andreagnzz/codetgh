#!/bin/sh
# Daily Postgres dump of the hub into deploy/backups/ (readable by you only), keeping 7 days.
# The dump goes through docker compose's stdout: no extra volume, no port.
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p deploy/backups
out="deploy/backups/codetgh-$(date +%Y-%m-%dT%H%M).dump"
trap 'rm -f "$out.part"' EXIT
docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T db pg_dump -U codetgh -Fc codetgh > "$out.part"
mv "$out.part" "$out"
find deploy/backups -name 'codetgh-*.dump' -mtime +7 -delete
# A run killed mid-dump (reboot, OOM) leaves its .part behind: none is still being written a day later.
find deploy/backups -name 'codetgh-*.dump.part' -mmin +1440 -delete
echo "$out"
