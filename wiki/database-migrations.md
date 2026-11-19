# Database migrations

How schema changes reach a database that already has data in it, and how staging gets them automatically (#631).

## Two kinds of SQL file

| Files                     | Describe                                         | Run                                                                  |
| ------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| `db/migrations/001`–`007` | The whole schema, as a fresh build has it        | By hand, once, on an empty database (`001`–`005`, `007`, then `006`) |
| `db/deltas/*.sql`         | One change, from the previous schema to the next | By `db/migrate.sh`, once per database, in filename order             |

The base migrations stay the single picture of the schema: a change is still made there, in place. A delta is what brings a database built from the _old_ base migrations up to the new ones. Most PRs that touch the schema add both.

`007_payment_functions.sql` is all `CREATE OR REPLACE`, so it is safe to re-run in full on a live database. The runner replays it whenever it changed, so a PR that only changes functions in 007 needs no delta.

## What happens automatically

The **Staging database migrations** workflow (`.github/workflows/staging-migrations.yml`) runs `db/migrate.sh` against staging:

| When                                               | What                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| A PR to `staging` that touches `db/**`             | A **dry run** against staging: everything applied, then rolled back. A failure here means the delta doesn't apply to what staging actually holds. |
| A push to `staging` that touches `db/**` (a merge) | The real thing.                                                                                                                                   |
| Actions tab → Run workflow                         | A dry run by default; untick it to apply.                                                                                                         |

The PR job also warns when a PR changes `001`–`006` without adding a delta. That is fine for a comment-only change; otherwise staging won't get it.

A run does, in **one transaction**:

1. Every `db/deltas/*.sql` not yet recorded in `migrations.applied`, in filename order, recording each.
2. A replay of `007`, if it changed since it was last replayed or a delta was applied.

Any error rolls the whole run back. Staging is never left half migrated, and the job goes red.

`migrations.applied` lives in its own `migrations` schema, which the API doesn't expose and the QA role can't read. It records each file's path, a checksum, the commit and when it ran.

### Ordering against the deploy

The workflow and the Netlify staging deploy start from the same push and run side by side. The migration usually finishes first (seconds, against a build of minutes), but nothing guarantees it, and a failed migration doesn't stop the deploy. So **a delta must leave the database working for the app version currently deployed**, which is how the hand-run scripts were written already:

- Adding a column, table, function or policy: one delta.
- Removing or renaming something the deployed app uses: add the new thing in one PR, and drop the old one in a later PR once the app no longer uses it.

If a migration fails after merge, fix it with a new commit to `staging`. A delta that failed was rolled back and never recorded, so you may edit it.

## Writing a delta

```sh
touch "db/deltas/$(date -u +%Y%m%d%H%M)_short_description.sql"
```

- **Name:** `YYYYMMDDHHMM_slug.sql`, UTC, lowercase slug. The fixed-width timestamp keeps filename order equal to creation order, and PRs written in parallel don't collide.
- **No `BEGIN`, `COMMIT` or `ROLLBACK`.** The runner wraps every run in its own transaction and rejects a file that has them. (So no `CREATE INDEX CONCURRENTLY` either; on staging's table sizes a plain `CREATE INDEX` is fine.)
- **Write it against the previous schema.** The easiest way: diff your base-migration changes and repeat them as `ALTER`s. Something added to a base migration's `CREATE TABLE` is an `ALTER TABLE … ADD COLUMN` here; a new function in `003` is copied in whole.
- **Guards fail loudly.** A check that must pass first ("no rows violate the new constraint") is a `DO` block that `RAISE EXCEPTION`s, not a `SELECT` for someone to read.
- **Runs once.** It doesn't need to be idempotent, but it must apply cleanly to staging as it is today. The PR's dry run checks exactly that.
- **Applied deltas are immutable.** The runner fails if a recorded file's checksum changed. To change something already applied, add another delta.
- **Locks:** each file runs with `lock_timeout = 10s`, so a migration that can't get a table lock fails instead of stalling the live app behind it.

Try it locally against a scratch database first:

```sh
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scratch db/migrate.sh --dry-run
```

## Setup (admin, once)

1. In the Supabase dashboard for **staging**: **Connect** → **Session pooler**. Copy the connection string and put the `postgres` password in it. URL-encode any special characters in the password (`@` → `%40`, `#` → `%23`, …), and append `?sslmode=require`.
   - Use the session pooler, not the direct host: `db.<ref>.supabase.co` is IPv6-only without the IPv4 add-on, and GitHub's runners only have IPv4.
   - If the project restricts database access by IP (Database settings → Network restrictions), GitHub's runners can't connect. Lift the restriction for staging.
2. GitHub → repository Settings → Secrets and variables → Actions → **New repository secret**: `STAGING_DATABASE_URL`, the string from step 1.
3. Actions → **Staging database migrations** → Run workflow (dry run ticked). On the first run, staging has no `migrations.applied` yet, so the plan is "replay 007". Run it again with dry run unticked to create the table.

Staging must already be up to date with every `db/maintenance/apply_*.sql` script from before #631. Those are not deltas, and the runner never runs them.

Dependabot PRs and PRs from forks get no repository secrets, so their dry run is skipped with a notice.

## Production

Production is still migrated by hand, but with the same runner, from a machine with `psql`:

```sh
DATABASE_URL='<production session pooler string>' db/migrate.sh --dry-run
DATABASE_URL='<production session pooler string>' db/migrate.sh
```

It applies whatever staging got that production hasn't, in the same order. As with staging, production must have every pre-#631 `db/maintenance/apply_*.sql` script applied before the first run.

## `db/maintenance/`

Still the home of one-off operational scripts that aren't schema changes: adding a QA tester, scrubbing old audit rows. They end in `ROLLBACK` and are run by hand. The `apply_*.sql` rollout scripts there are the pre-#631 way of doing what a delta now does. They are kept for history; don't add new ones.
