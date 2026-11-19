# Database migrations

How schema changes reach staging and production (#631). The Supabase CLI applies every migration a database hasn't run yet: staging automatically on merge, production by hand. Databases are never rebuilt, only migrated forward.

## Layout

| Path                                    | What                                                                                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/001`–`007`         | The original migrations, from before #631: the schema (001–006) and the RBAC roles and permissions (007).                                                                                      |
| `supabase/migrations/<14 digits>_*.sql` | Every change since, one file each, applied in filename order.                                                                                                                                  |
| `supabase/staging/`                     | Staging-only scripts, run by hand: `seed.sql` (test data), `drop_all.sql` (local teardown), and the QA access scripts ([staging-db-access.md](staging-db-access.md)). Never run on production. |
| `supabase/tests/`                       | SQL regression suites. Each runs in a transaction that rolls back and prints `ALL SCENARIOS PASSED`.                                                                                           |

`supabase/migrations` is where the CLI looks by default, so it runs from the repo root with no extra setup.

**Migrations are append-only.** The CLI records each one it applies in `supabase_migrations.schema_migrations` (the dashboard's **Database → Migrations** page) and never runs it again. Editing or renaming an applied migration changes nothing on the database, and makes a fresh build differ from it. Every change is a new file.

## Writing a migration

```sh
touch "supabase/migrations/$(date -u +%Y%m%d%H%M%S)_short_description.sql"
```

(`npx supabase migration new short_description` does the same.)

- **Write it against the current schema:** `ALTER TABLE … ADD COLUMN`, not an edit to the `CREATE TABLE` in `001`. To change a function, copy its whole current definition into the new file as `CREATE OR REPLACE FUNCTION` and change it there, with its `REVOKE`/`GRANT` lines.
- **No `BEGIN`, `COMMIT` or `ROLLBACK`.** The CLI runs each file in its own transaction. A file that ends it early is no longer all-or-nothing. (So no `CREATE INDEX CONCURRENTLY` either.)
- **No psql meta-commands** (`\i`, `\set`, …). The CLI isn't psql.
- **Guards fail loudly.** A check that must pass first is a `DO` block that `RAISE EXCEPTION`s, which fails the file.
- **Hot tables:** start with `SET LOCAL lock_timeout = '10s';` so a migration that can't get its lock fails instead of stalling the live app.

### Ordering against the deploy

The migration workflow and the Netlify staging deploy start from the same push and run side by side, and a failed migration doesn't stop the deploy. So **a migration must leave the database working for the app version currently deployed**:

- Adding a column, table, function or policy: one migration.
- Removing or renaming something the deployed app uses: add the new thing in one PR, then drop the old one in a later PR once the app no longer uses it.

## The workflow

**Staging database migrations** (`.github/workflows/staging-migrations.yml`) runs `supabase db push --include-all` against staging, applying every migration it hasn't run yet:

- **On a push to `staging`** (a merge) that touches `supabase/migrations/**`.
- **From the Actions tab** (Run workflow, with **Use workflow from** set to `staging`). This is only offered once the workflow file is on `master`.

PRs don't trigger it. A PR runs the workflow file from its own branch, so it could be edited to print the database URL. The URL is therefore a secret of the `staging` GitHub environment, which only jobs on the `staging` branch can use.

`--include-all` lets through a migration whose timestamp is older than the newest one applied, which happens when two PRs merge in the opposite order from how they were written.

Each migration commits or rolls back on its own. If the second of three fails, the first stays applied, the third is never tried, and the job goes red. Fix it with a new commit: the failed migration was never recorded, so you may still edit it.

## Setup (admin, once)

1. In the Supabase dashboard for **staging**: **Connect** → **Session pooler**. Copy the connection string, put the `postgres` password in it (URL-encode special characters: `@` → `%40`, `#` → `%23`, …) and append `?sslmode=require`. Use the session pooler: the direct host is IPv6-only without the IPv4 add-on, and GitHub's runners only have IPv4. If the project restricts database access by IP, GitHub's runners can't connect.
2. GitHub → repository Settings → **Environments** → **New environment** named `staging`.
   - Under **Deployment branches and tags**, choose **Selected branches and tags** and add `staging`.
   - Under **Environment secrets**, add `STAGING_DATABASE_URL` with the string from step 1.

   Don't add it as a repository secret: every workflow run on any branch could read that.

The workflow uses that database URL and no Supabase access token, which would reach every project on the account. The CLI version is pinned in the workflow; bump it deliberately.

## Production

Production is migrated by hand, from the repo root on a machine with Node, **before** merging `staging` into `master`:

```sh
export DB_URL='<production session pooler string>'
npx supabase@2.122.1 db push --db-url "$DB_URL" --include-all --dry-run
npx supabase@2.122.1 db push --db-url "$DB_URL" --include-all
```
