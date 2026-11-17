-- =============================================================================
-- ONE-OFF: bring an existing database up to #497 (ops re-fire for stuck refunds)
--
-- This issue edits the base migrations in place: refunds.last_fired_at in 001,
-- and refund_fire_due / claim_refund_fire / list_stuck_refunds (plus their
-- REVOKE / GRANT lines) in 007. A fresh build gets all of it. A long-lived
-- database (staging, production) needs these steps, in order:
--
--   1. APPLY  — adds the column. It ends in ROLLBACK, so it is a dry run until
--               that line is changed to COMMIT.
--   2. Re-run db/migrations/007_payment_functions.sql in full. Every statement
--      in it is CREATE OR REPLACE / REVOKE / GRANT, so re-running is safe. It
--      must come after step 1: claim_refund_fire writes refunds.last_fired_at.
--
-- Deploy the app AFTER both steps: the new code calls claim_refund_fire before
-- every CHIP refund, so on a database without it every refund would be skipped
-- (and logged) until the function exists.
--
-- Existing refund rows keep last_fired_at NULL on purpose. Nothing recorded when
-- they were fired, and NULL reads as "never fired", so any refund still pending
-- today shows up on the admin Stuck refunds page straight away. That is the
-- point: those are exactly the ones nobody has looked at. Retrying one is safe
-- even if CHIP already refunded it, because the retry checks the purchase at
-- CHIP first and settles from it instead of refunding twice.
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres / service role), against
-- staging first, then production.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. APPLY (dry run until the last line says COMMIT)
-- -----------------------------------------------------------------------------
BEGIN;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS last_fired_at timestamptz;

ROLLBACK;


-- -----------------------------------------------------------------------------
-- 2. Now re-run db/migrations/007_payment_functions.sql in full.
-- -----------------------------------------------------------------------------
