#!/bin/sh
# Proves a dump restores: loads it into a scratch database next to the live one and compares row counts.
# Usage: deploy/restore-test.sh [deploy/backups/codetgh-….dump]   (default: the latest dump)
set -eu
cd "$(dirname "$0")/.."
dump="${1:-$(ls -t deploy/backups/codetgh-*.dump | head -1)}"
dc="docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T db"
$dc dropdb -U codetgh --if-exists codetgh_restore_check
$dc createdb -U codetgh codetgh_restore_check
$dc pg_restore -U codetgh -d codetgh_restore_check --no-owner < "$dump"
status=0
for t in team membership "user" message audit_event; do
  live=$($dc psql -U codetgh -d codetgh -Atc "select count(*) from \"$t\"")
  restored=$($dc psql -U codetgh -d codetgh_restore_check -Atc "select count(*) from \"$t\"")
  echo "$t: live $live, restored $restored"
  # Rows written after the dump only make the live count larger.
  [ "$restored" -le "$live" ] || status=1
  [ "$restored" -gt 0 ] || [ "$live" -eq 0 ] || status=1
done
$dc dropdb -U codetgh codetgh_restore_check
[ "$status" -eq 0 ] && echo "restore OK: $dump" || { echo "restore FAILED: $dump"; exit 1; }
