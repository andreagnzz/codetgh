#!/bin/sh
# Proves a dump restores: loads it into a scratch database next to the live one and compares each table's row count
# with the rows the dump itself holds (live counts drift: messages expire and threads are archived after the dump).
# Usage: deploy/restore-test.sh [deploy/backups/codetgh-….dump]   (default: the latest dump)
set -eu
cd "$(dirname "$0")/.."
dump="${1:-$(ls -t deploy/backups/codetgh-*.dump | head -1)}"
dc="docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T db"
$dc dropdb -U codetgh --if-exists codetgh_restore_check
trap '$dc dropdb -U codetgh --if-exists codetgh_restore_check' EXIT
$dc createdb -U codetgh codetgh_restore_check
$dc pg_restore -U codetgh -d codetgh_restore_check --no-owner < "$dump"
status=0
for t in team membership user message audit_event; do
  # One COPY line per row: text format escapes newlines inside values.
  dumped=$($dc pg_restore --data-only -t "$t" -f - < "$dump" | awk '/^COPY /{on=1; next} /^\\\.$/{on=0} on{n++} END{print n+0}')
  restored=$($dc psql -U codetgh -d codetgh_restore_check -Atc "select count(*) from \"$t\"")
  echo "$t: dumped $dumped, restored $restored"
  [ "$restored" -eq "$dumped" ] || status=1
done
[ "$status" -eq 0 ] && echo "restore OK: $dump" || { echo "restore FAILED: $dump"; exit 1; }
