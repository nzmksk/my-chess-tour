#!/usr/bin/env bash
# Runs the SQL regression suites in supabase/tests against a database (#633).
#
#   supabase/tests/run.sh                       # every suite
#   supabase/tests/run.sh supabase/tests/x.sql  # just these
#
# A suite passes when psql exits cleanly and it printed "ALL SCENARIOS PASSED".
# Every suite runs even after one fails; the script exits 1 if any did.
#
# The database must already have the migrations applied, and
# supabase/staging/apply_qa_readonly_role.sql committed for
# qa_readonly_access.sql. Most suites roll back, but the *_race.sql suites
# commit fixtures (and delete them again), so never point this at production.
#
# Environment:
#   DB_URL         where psql connects. Defaults to the database
#                  `supabase db start` runs.
#   RACE_CONNINFO  how the *_race.sql suites' second session (dblink) reaches
#                  the same database, as seen from the database server. dblink
#                  only lets a non-superuser connect if the password is
#                  actually checked, and the Supabase image trusts 127.0.0.1
#                  without one, so the default goes through the container's
#                  own name on its Docker network instead. For a local
#                  Postgres that checks passwords on localhost, use
#                  'host=localhost dbname=<db> user=postgres password=...'.

set -uo pipefail

DB_URL=${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}
RACE_CONNINFO=${RACE_CONNINFO:-host=supabase_db_my-chess-tour port=5432 dbname=postgres user=postgres password=postgres}

if [ "$#" -gt 0 ]; then
  suites=("$@")
else
  suites=("$(dirname "$0")"/*.sql)
fi

# The value goes inside a SQL string literal, so double any single quote.
set_conninfo="SET capacity_race.conninfo = '${RACE_CONNINFO//\'/\'\'}'"

failed=()
for suite in "${suites[@]}"; do
  if output=$(psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 \
    -c "$set_conninfo" -f "$suite" 2>&1) &&
    grep -q "ALL SCENARIOS PASSED" <<<"$output"; then
    echo "PASS  $suite"
  else
    echo "FAIL  $suite"
    echo "$output" | sed 's/^/      /'
    failed+=("$suite")
  fi
done

echo
if [ "${#failed[@]}" -gt 0 ]; then
  echo "${#failed[@]} of ${#suites[@]} suites failed:"
  printf '  %s\n' "${failed[@]}"
  exit 1
fi
echo "All ${#suites[@]} suites passed."
