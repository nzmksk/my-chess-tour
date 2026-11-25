# Audit logs: retention and pruning

`audit_logs` holds a snapshot of every insert, update and delete on the audited
tables (`audit_trigger_func`, one `audit_trail` trigger per table), with the
actor and request context. What's redacted on the way in is described in
[launch-readiness.md §S3](./launch-readiness.md). What happens to a deleted
account's history is described in [account-deletion.md](./account-deletion.md).
This page covers how long rows are kept and how they're removed (#507).

## Retention

The policy is `audit_log_retention()` in
`supabase/migrations/003_functions_triggers.sql`. This table
describes it, and `/privacy` (with the signup `PrivacyModal`) publishes it. A
change touches all three, plus a new migration.

| Audited table                                                                                                                                                               | Kept                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `payments`, `refunds`, `payouts`, `prize_awards`, `prize_fundings`, `organization_bank_accounts`, `player_bank_accounts`, `tournaments`, `tournament_cancellation_requests` | Never pruned (7 years)                             |
| `registrations` that were ever paid, confirmed or forfeited                                                                                                                 | Never pruned (7 years)                             |
| `registrations` never paid (abandoned, failed or expired checkouts)                                                                                                         | 30 days after the tournament's registration closes |
| `users`, `player_profiles`, `organizations`, `organization_memberships`, `organization_documents`, `organization_invitations`, `user_global_roles`                          | 1 year                                             |

- **Never pruned** covers the financial records and the evidence for them: the
  bank account a payout went to, the entry fee and prizes a player paid for,
  and the cancellation behind a refund. The 7-year obligation (Income Tax Act)
  applies to them. Disposal after 7 years isn't automated; it'll be a separate
  job when the first rows reach that age.
- A table not in `audit_log_retention()` is never pruned. A newly audited table
  is kept until someone adds it to the policy.
- A registration's rows qualify for the 30-day rule only while the registration
  exists, isn't `confirmed` or `forfeited`, and has no `paid` payment, and only
  once its tournament closed registration
  (`COALESCE(registration_closed_at, registration_deadline)`) more than 30 days
  ago. Before the close an unpaid registration isn't dead: checkout reuses a
  failed or cancelled row for the same player (`start_new_payment_attempt`), so
  someone who abandons on day 0 can pay on day 40 and keep their whole history.
- After the close, a `paid` result can still arrive only for a purchase paid
  before `due_strict` expired it whose webhooks were all lost (CHIP stops
  retrying after 36h26m), reconciled later from the return page. The pruner
  locks the registration rows it deletes for (`FOR UPDATE … SKIP LOCKED`), so
  a settlement in flight is skipped, and once it commits the registration is
  confirmed and no longer eligible. `supabase/tests/audit_log_retention_race.sql`
  runs the two in separate sessions.

## Volume

Measured on a scratch database (2026-11-23), one paid single-player checkout
writes **4 rows, about 3.8 KB of heap** (before indexes): the registration and
payment inserts, then the payment and registration updates at settlement. An
abandoned checkout writes 3 (two inserts and the expiry update), which go 30
days after the tournament's registration closes.

Pointing a new registration at its first payment attempt
(`registrations.current_payment_id`) used to write a fifth row, about 0.9 KB,
that repeated what the payment's insert already records. `audit_trigger_func`
now skips a `registrations` update whose snapshots differ only in
`current_payment_id`.

## Pruning

`prune_audit_logs(p_dry_run DEFAULT true, p_limit DEFAULT 5000)` returns, for
each table in the policy, how many rows are past retention (`eligible`) and how
many it deleted. One call deletes at most `p_limit` rows, oldest first within
each table, so no single statement removes millions of rows. The financial
tables are excluded twice: the function refuses a policy that names one, and
its `DELETE` filters them out regardless. `supabase/tests/audit_log_retention.sql`
checks that decade-old rows of each survive an unbounded run.
`idx_audit_logs_table_created` serves the per-table cutoff scans.

**Schedule.** `.github/workflows/audit-log-retention.yml` POSTs
`/api/v1/cron/audit-logs` daily at 02:30 UTC with `CRON_SECRET`, and calls again
while the answer has `more: true` (at most 20 calls a run). The project's other
background jobs use the same scheduler; there's no `pg_cron`.

**Dry run first.** The route deletes only when the server has
`AUDIT_LOG_PRUNE=delete`. Without it, every run is a dry run that logs and
returns the counts. To turn deletion on:

1. Let the workflow run for a few days and read the per-table `eligible`
   counts in its log. Check that they're plausible: no financial table should
   appear, and registrations should only be abandoned checkouts.
2. Set `AUDIT_LOG_PRUNE=delete` in the Netlify environment and redeploy.
3. Check the next run's log. `deleted` should match the previous day's
   `eligible`, and later runs should delete only what aged past retention since.

To run it by hand, use `SELECT * FROM prune_audit_logs();` (dry run) in the SQL
editor. Pass `false` and a limit to delete.

## Storage

Every run also returns `audit_logs_storage()`: the table's total size including
indexes and TOAST, and its estimated row count. Above 250 MB
(`AUDIT_LOGS_WARN_BYTES` in `src/services/audit/retention.ts`, half of the
Supabase free tier's 500 MB database) the route logs an error, which
[Sentry](./error-monitoring.md) reports. On a paid plan that's an early warning,
not a limit. Raise the constant once the plan's actual limit is confirmed.
