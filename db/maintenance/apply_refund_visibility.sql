-- =============================================================================
-- ONE-OFF: bring an existing database up to #511 / #512 (refund visibility and
-- refund outcome emails)
--
-- These issues edit the base migrations in place: refunds.failed_at in 001, the
-- player refunds SELECT policy in 004, and settle_refund in 006. A fresh build
-- gets all of it. A long-lived database (staging, production) needs these
-- steps, in order:
--
--   1. APPLY  — adds the column and swaps the policy in one transaction. It
--               ends in ROLLBACK, so it is a dry run until that line is changed
--               to COMMIT.
--   2. Re-run db/migrations/006_payment_functions.sql in full. Every statement
--      in it is CREATE OR REPLACE / REVOKE / GRANT, so re-running is safe. It
--      must come after step 1: the new settle_refund writes refunds.failed_at.
--
-- Existing refund rows keep failed_at NULL on purpose. Nothing recorded a
-- failure before this column (a failure webhook passes no CHIP id, so
-- chip_refund_id says nothing either), and a refund that is pending today
-- may just be waiting on CHIP. If one of those later fails, settle_refund
-- stamps it then and the player gets the failure email then.
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres / service role), against
-- staging first, then production.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. APPLY (dry run until the last line says COMMIT)
-- -----------------------------------------------------------------------------
BEGIN;

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS failed_at timestamptz;

DROP POLICY IF EXISTS "Players can view own refunds" ON refunds;
DROP POLICY IF EXISTS "Players can view refunds of own registrations" ON refunds;
CREATE POLICY "Players can view refunds of own registrations"
ON refunds FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM registrations r
    WHERE r.id = refunds.registration_id
      AND can_act_for(r.user_id)
  )
);

ROLLBACK;


-- -----------------------------------------------------------------------------
-- 2. Now re-run db/migrations/006_payment_functions.sql in full.
-- -----------------------------------------------------------------------------
