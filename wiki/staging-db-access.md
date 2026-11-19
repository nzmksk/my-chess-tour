# Staging database: read-only access for QA

External QA can connect to the **staging** database from a terminal (`psql`) to check what the app wrote: registrations, payments, refunds, audit rows. They can read every table and view in `public` and change nothing. Production has no such access.

## What a tester can and can't do

Each tester logs in as their own role, `qa_<name>`, which is a member of the `qa_readonly` group role.

| Can                                                   | Can't                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `SELECT` from every table and view in `public`        | `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` anything                     |
| See every row: RLS doesn't filter them                | Call the server-only functions (`settle_*`, `create_*`, `review_*`, ...) |
| Read tables added by later migrations, with no re-run | Create tables, or use sequences                                          |
|                                                       | Read the `auth` or `storage` schemas (password hashes, sessions, files)  |

The grants are what enforce this. Logins also default to read-only transactions, but a tester can turn that off in their own session, so it only catches accidental writes. Queries time out after 30 s and an idle open transaction after 60 s, so one bad query can't hold up the shared database. Each login allows 3 connections and expires after 90 days.

A tester sees users' emails and bank account numbers, so **staging must only ever hold test data**.

`db/tests/qa_readonly_access.sql` checks all of the above. Run it after setup and after any migration that adds grants or functions.

## Setup (admin, once per staging database)

1. In the Supabase SQL editor for **staging**, run `db/maintenance/apply_qa_readonly_role.sql` with its final `ROLLBACK` changed to `COMMIT`. It is idempotent.
2. Run `db/tests/qa_readonly_access.sql`. It should print `ALL SCENARIOS PASSED`.

`db/staging/drop_all.sql` doesn't drop roles, and the default privileges stay in place. After a teardown and 001–007, the role can read the new tables without re-running step 1.

## Adding a tester (admin)

1. In `db/maintenance/add_qa_tester.sql`, set `v_login` to `qa_<name>` (and `v_valid_days` if 90 days is wrong). Change `ROLLBACK` to `COMMIT`, then run it on staging.
2. Set the password from `psql`, connected to staging as `postgres`:

   ```
   \password qa_<name>
   ```

   `\password` sends only the hash, so the password never shows up in the SQL editor's query history. Until it is set, nobody can log in as the role.

3. Send the tester the connection details below, with the password over a separate channel.

The login gets `BYPASSRLS` because every table in `public` has RLS enabled, and every policy matches through `auth.uid()`. Without it, every query would return zero rows. It is set on each login rather than on `qa_readonly` because Postgres doesn't pass role attributes down through membership.

Supabase's `postgres` isn't a superuser. It can only create a `BYPASSRLS` role on Postgres 16 or later (check with `SHOW server_version;`). On an older version, step 1 fails with a permission error.

## Removing or extending access

```sql
DROP ROLE qa_<name>;                              -- revoke
ALTER ROLE qa_<name> VALID UNTIL '2027-06-30';    -- extend
```

`DROP ROLE` doesn't end open sessions. To end them, run `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = 'qa_<name>';` first.

To see who is connected: `SELECT usename, client_addr, backend_start FROM pg_stat_activity WHERE usename LIKE 'qa\_%';`

## Connecting (tester)

Get the host and project ref from the admin. They come from the staging project's **Connect** dialog in the Supabase dashboard, under **Session pooler**.

```sh
psql "postgresql://qa_<name>.<project-ref>@<pooler-host>:5432/postgres?sslmode=require"
```

- **User:** through the pooler it is `qa_<name>.<project-ref>`, not just `qa_<name>`. It is the dashboard's connection string with `postgres.` replaced by `qa_<name>.`.
- **Session pooler, not direct:** the direct host (`db.<project-ref>.supabase.co`) is IPv6-only unless the project has the IPv4 add-on. The session pooler works over IPv4.
- **Network restrictions:** if the project restricts database access by IP (Database settings → Network restrictions), the admin must add the tester's address.
- `psql` prompts for the password. Don't put it in the URL, where it ends up in shell history.

Useful once connected:

```sql
\dt                     -- list tables
\d registrations        -- columns of one table
SELECT id, status, registered_at FROM registrations ORDER BY registered_at DESC LIMIT 20;
```

`ERROR: cannot execute INSERT in a read-only transaction` or `permission denied for table ...` mean the access is working as intended.
