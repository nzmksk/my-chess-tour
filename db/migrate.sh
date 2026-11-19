#!/usr/bin/env bash
# =============================================================================
# Bring an existing database up to date (#631).
#
#   DATABASE_URL=postgresql://... db/migrate.sh [--dry-run]
#
# Applies, in ONE transaction:
#   1. every db/deltas/*.sql not yet recorded in migrations.applied, in
#      filename order, recording each one;
#   2. the replayable base migrations (007, all CREATE OR REPLACE), whenever
#      one changed since it was last replayed or a delta was applied.
#
# Any error rolls the whole run back, so the database is never left half
# migrated. --dry-run does all of it and then rolls back.
#
# A delta that was already applied must never change: the run fails if its
# checksum differs from the one recorded. Fix forward with a new delta.
#
# See wiki/database-migrations.md.
# =============================================================================
set -euo pipefail

DRY_RUN=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  *)
    echo "usage: DATABASE_URL=... $0 [--dry-run]" >&2
    exit 2
    ;;
esac

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL is not set" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
# The path psql is given for \i. Under Git Bash, a native Windows psql can't
# open /d/..., so use the D:/... form there.
PSQL_ROOT="$(pwd -W 2>/dev/null || pwd)"

# Base migrations that are safe to re-run in full on a live database.
REPLAYABLE=(db/migrations/007_payment_functions.sql)

# YYYYMMDDHHMM_slug.sql. A fixed-width timestamp keeps filename order equal to
# creation order, and two PRs written in parallel don't collide on a number.
DELTA_NAME='^[0-9]{12}_[a-z0-9_]+\.sql$'

# The runner owns the transaction. A delta that opens or ends its own would
# commit part of the run, or end it early. (END is left out: every PL/pgSQL
# body ends in "END;".)
TX_CONTROL='^[[:space:]]*(BEGIN|COMMIT|ROLLBACK|START[[:space:]]+TRANSACTION|ABORT)[[:space:]]*;'

GIT_SHA="${GITHUB_SHA:-$(git rev-parse HEAD 2>/dev/null || true)}"
[[ "$GIT_SHA" =~ ^[0-9a-f]{7,40}$ ]] || GIT_SHA=""

checksum() {
  # Ignore CRs so a Windows checkout hashes the same as CI.
  tr -d '\r' <"$1" | sha256sum | cut -d' ' -f1
}

psql_q() {
  psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 "$@"
}

# One value per line, without the CR a native Windows psql adds.
psql_rows() {
  psql_q -At -c "$1" | tr -d '\r'
}

# --- validate the deltas ------------------------------------------------------
shopt -s nullglob
deltas=(db/deltas/*.sql)
shopt -u nullglob

for f in "${deltas[@]}"; do
  name="$(basename "$f")"
  if [[ ! "$name" =~ $DELTA_NAME ]]; then
    echo "error: $f: delta names must look like YYYYMMDDHHMM_slug.sql (lowercase slug)" >&2
    exit 1
  fi
  if grep -qiE "$TX_CONTROL" "$f"; then
    echo "error: $f: remove BEGIN/COMMIT/ROLLBACK; the runner wraps every delta in its own transaction" >&2
    exit 1
  fi
done

# --- what has already run -----------------------------------------------------
declare -A applied=()
has_table="$(psql_rows "SELECT to_regclass('migrations.applied') IS NOT NULL")"
if [[ "$has_table" == "t" ]]; then
  while IFS='|' read -r fname sum; do
    [[ -n "$fname" ]] && applied["$fname"]="$sum"
  done < <(psql_rows "SELECT filename, checksum FROM migrations.applied")
fi

# --- plan ---------------------------------------------------------------------
pending=()
for f in "${deltas[@]}"; do
  sum="$(checksum "$f")"
  if [[ -n "${applied[$f]+x}" ]]; then
    if [[ "${applied[$f]}" != "$sum" ]]; then
      echo "error: $f was changed after it was applied (recorded ${applied[$f]:0:12}, now ${sum:0:12})." >&2
      echo "       Applied deltas are immutable: revert the edit and add a new delta." >&2
      exit 1
    fi
  else
    pending+=("$f")
  fi
done

replay=()
for f in "${REPLAYABLE[@]}"; do
  if [[ ${#pending[@]} -gt 0 || "${applied[$f]:-}" != "$(checksum "$f")" ]]; then
    replay+=("$f")
  fi
done

if [[ ${#pending[@]} -eq 0 && ${#replay[@]} -eq 0 ]]; then
  echo "Database is up to date: no pending deltas, replayable migrations unchanged."
  exit 0
fi

echo "Plan:"
for f in "${pending[@]}"; do echo "  apply   $f"; done
for f in "${replay[@]}"; do echo "  replay  $f"; done

# --- build and run one transaction --------------------------------------------
wrapper="$(mktemp)"
trap 'rm -f "$wrapper"' EXIT

sql_record() {
  local f="$1" sum="$2" sha="NULL"
  [[ -n "$GIT_SHA" ]] && sha="'$GIT_SHA'"
  # Filenames match DELTA_NAME or are fixed paths, and checksums are hex, so
  # nothing here needs escaping.
  cat <<SQL
INSERT INTO migrations.applied (filename, checksum, git_sha)
VALUES ('$f', '$sum', $sha)
ON CONFLICT (filename) DO UPDATE
  SET checksum = EXCLUDED.checksum, git_sha = EXCLUDED.git_sha, applied_at = now();
SQL
}

# Per-file settings: don't wait forever on a lock held by the live app, and
# undo any session setting the previous file changed.
SETTINGS="RESET ALL; SET LOCAL lock_timeout = '10s'; SET LOCAL search_path = public, extensions;"

{
  echo "BEGIN;"
  echo "$SETTINGS"
  cat <<'SQL'
SET LOCAL client_min_messages = warning;  -- no "already exists, skipping"
CREATE SCHEMA IF NOT EXISTS migrations;
COMMENT ON SCHEMA migrations IS
  'Bookkeeping for db/migrate.sh (#631). Not exposed through the API.';
REVOKE ALL ON SCHEMA migrations FROM PUBLIC;
CREATE TABLE IF NOT EXISTS migrations.applied (
  filename   text        PRIMARY KEY,
  checksum   text        NOT NULL,
  git_sha    text,
  applied_at timestamptz NOT NULL DEFAULT now()
);
-- Two runs at once would both see the same deltas as pending. The second one
-- waits here, then fails on the primary key and rolls back. A dry run holds
-- the lock too, so wait out one rather than fail after the usual 10 s.
SET LOCAL lock_timeout = '5min';
LOCK TABLE migrations.applied IN EXCLUSIVE MODE;
SQL
  for f in "${pending[@]}"; do
    echo "\\echo '==> apply $f'"
    echo "$SETTINGS"
    echo "\\i '$PSQL_ROOT/$f'"
    sql_record "$f" "$(checksum "$f")"
  done
  for f in "${replay[@]}"; do
    echo "\\echo '==> replay $f'"
    echo "$SETTINGS"
    echo "\\i '$PSQL_ROOT/$f'"
    sql_record "$f" "$(checksum "$f")"
  done
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "ROLLBACK;"
  else
    echo "COMMIT;"
  fi
} >"$wrapper"

psql_q -f "$wrapper"

if [[ $DRY_RUN -eq 1 ]]; then
  echo "Dry run succeeded; everything was rolled back."
else
  echo "Migrated: ${#pending[@]} delta(s) applied, ${#replay[@]} migration(s) replayed."
fi
