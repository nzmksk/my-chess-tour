# Database migrations

How schema changes reach staging and production (#631). Every database is built and migrated by the Supabase CLI from `db/migrations`: staging automatically, production by hand.

## Layout

| Path                              | What                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `db/migrations/001`–`007`         | The original migrations, from before #631: the whole schema (001–006) and the RBAC roles and permissions (007).           |
| `db/migrations/<14 digits>_*.sql` | Every change since, one file each, applied in filename order.                                                             |
| `db/staging/seed.sql`             | Test data for staging and local databases: accounts, organizations, tournaments, registrations. Never run on production.  |
| `db/staging/drop_all.sql`         | Teardown for a staging or local reset.                                                                                    |
| `db/maintenance/`                 | Staging QA access, run by hand: the read-only role and a login per tester ([staging-db-access.md](staging-db-access.md)). |

**The migrations are append-only.** Once a migration has run against staging, it never runs again, so editing it changes nothing on staging and makes a fresh build differ from staging. Every change is a new file, including changes to tables, functions, policies and roles that live in `001`–`007`.

The Supabase CLI records what it has applied in `supabase_migrations.schema_migrations`. The dashboard's **Database → Migrations** page shows the same table.

## Writing a migration

```sh
touch "db/migrations/$(date -u +%Y%m%d%H%M%S)_short_description.sql"
```

- **Name:** `YYYYMMDDHHMMSS_description.sql`, UTC, lowercase. That's the format `supabase migration new` uses, but the CLI only creates files under `supabase/migrations`, so create the file yourself.
- **Write it against the current schema:** `ALTER TABLE … ADD COLUMN`, not an edit to the `CREATE TABLE` in `001`. To change a function, copy the whole current definition into the new file as `CREATE OR REPLACE FUNCTION` and change it there. Repeat its `REVOKE`/`GRANT` lines too.
- **No `BEGIN`, `COMMIT` or `ROLLBACK`.** The CLI runs each file in its own transaction. A file that ends that transaction early is no longer all-or-nothing. That also rules out `CREATE INDEX CONCURRENTLY`, but at staging's table sizes a plain `CREATE INDEX` is fine.
- **No psql meta-commands** (`\i`, `\set`, …). The CLI isn't psql.
- **Guards fail loudly.** A check that must pass first ("no rows violate the new constraint") is a `DO` block that `RAISE EXCEPTION`s, which fails the file. A `SELECT` for someone to read does not.
- **Hot tables:** start with `SET LOCAL lock_timeout = '10s';` so a migration that can't get its lock fails instead of stalling the live app behind it.

The PR check enforces the name, the transaction rule and the meta-command rule.

### Ordering against the deploy

The migration workflow and the Netlify staging deploy start from the same push and run side by side. The migration usually finishes first, but nothing guarantees it, and a failed migration doesn't stop the deploy. So **a migration must leave the database working for the app version currently deployed**:

- Adding a column, table, function or policy: one migration.
- Removing or renaming something the deployed app uses: add the new thing in one PR, then drop the old one in a later PR once the app no longer uses it.

## What happens automatically

The **Staging database migrations** workflow (`.github/workflows/staging-migrations.yml`) runs when a PR or push touches `db/migrations/**`.

**On a PR to `staging`:**

1. Lints the migrations the PR adds (name, transaction control, meta-commands).
2. Fails if the PR edits, renames or deletes a migration staging has already applied.
3. Runs every migration staging doesn't have yet, against staging, in **one transaction that is rolled back**. The CLI's own `--dry-run` only lists the files without running them, so this step is what catches a migration that doesn't apply to what staging actually holds.

**On a push to `staging` (a merge):** `supabase db push --include-all`. `--include-all` lets a migration through whose timestamp is older than one already applied, which happens when two PRs are merged in the opposite order from how they were written.

**Actions tab → Run workflow:** a dry run (lists what is pending), or an apply. This only appears once the workflow file is on the default branch (`master`).

Each migration commits or rolls back on its own. If the second of three pending migrations fails, the first stays applied and recorded, and the third is never tried. The job goes red. Fix it with a new commit to `staging`: the failed migration was never recorded, so you may edit it.

Dependabot PRs and PRs from forks get no repository secrets, so they only get the lint.

## Setup (admin, once)

1. In the Supabase dashboard for **staging**: **Connect** → **Session pooler**. Copy the connection string, put the `postgres` password in it (URL-encode special characters: `@` → `%40`, `#` → `%23`, …) and append `?sslmode=require`.
   - Use the session pooler, not the direct host. `db.<ref>.supabase.co` is IPv6-only without the IPv4 add-on, and GitHub's runners only have IPv4.
   - If the project restricts database access by IP (Database settings → Network restrictions), GitHub's runners can't connect. Lift the restriction for staging.
2. GitHub → repository Settings → Secrets and variables → Actions → **New repository secret**: `STAGING_DATABASE_URL`, the string from step 1.

That's all. A database URL only reaches staging. The workflow doesn't use a Supabase access token, which would reach every project on the account.

The CLI version is pinned in the workflow (`SUPABASE_CLI_VERSION`). Bump it deliberately.

## Production

Production is migrated by hand, from a machine with Node, **before** merging `staging` into `master`. The CLI reads `<workdir>/supabase/migrations`, so stage a copy first:

```sh
work="$(mktemp -d)" && mkdir -p "$work/supabase/migrations" && cp db/migrations/*.sql "$work/supabase/migrations/"
export DB_URL='<production session pooler string>'

npx supabase@2.122.1 db push --include-all --dry-run --workdir "$work" --db-url "$DB_URL"
npx supabase@2.122.1 db push --include-all --workdir "$work" --db-url "$DB_URL"
```

## Rebuilding a database

Both staging and production were built by hand before #631, so they have the schema but no migration history. The workflow refuses to run against such a database, because the CLI would try to run `001` on top of it. Each one is rebuilt once, from `db/migrations`. **This deletes every row and every auth account in it.** It is also how staging is reset later.

1. **Empty the `avatars`, `oku-documents` and `organization-documents` buckets** from the dashboard (Storage). `drop_all` removes their metadata rows, but SQL can't delete the files themselves. On production these may include real OKU cards and KYB documents.
2. **Run `db/staging/drop_all.sql`** in the SQL editor for that database. It drops everything the migrations create, every auth account, and the migration history. It doesn't drop roles, so staging's QA logins survive.
3. **Build it:**
   - Staging: re-run the workflow's failed **Migrate staging** job (Actions → the run → **Re-run failed jobs**). Any later push that touches `db/migrations` works too. The job finds an empty database and runs `001` onwards.
   - Production: the two `npx supabase` commands in [Production](#production).
4. **Staging only: run `db/staging/seed.sql`**, in the SQL editor or with `psql --single-transaction -f`. Then run `db/tests/qa_readonly_access.sql` to confirm QA can still read everything.
5. **Production only:** sign up the platform admin's account, then grant it `platform_admin` by hand (see [roles-and-permissions.md](roles-and-permissions.md)). The seed's accounts don't exist there.

After merging #631, the first push to `staging` fails with "Staging has the app schema but no migration history". That is expected: rebuild staging as above, starting from step 1.

`drop_all.sql` is meant for staging and local resets. Running it on production is a one-off, before launch, while production holds no real users.
