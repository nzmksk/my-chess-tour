# Deltas

One file per schema change, `YYYYMMDDHHMM_slug.sql` (UTC), each taking a database from the previous base migrations to the next. `db/migrate.sh` applies the ones a database hasn't had yet, in one transaction, and the **Staging database migrations** workflow runs it on every merge to `staging`.

No `BEGIN`/`COMMIT`/`ROLLBACK`, and never edit a delta once it has been applied. See [wiki/database-migrations.md](../../wiki/database-migrations.md).
