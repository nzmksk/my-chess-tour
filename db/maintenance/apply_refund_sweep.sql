-- =============================================================================
-- ONE-OFF: bring an existing database up to #496 (refund sweep off the request)
--
-- This issue edits the base migrations in place, in 006 only:
--   * adds list_unfired_cancellation_refunds (the sweep's work list),
--   * changes list_stuck_refunds to leave out a never-fired refund queued less
--     than p_min_age ago, and
--   * removes list_pending_cancellation_refunds, which only the old in-request
--     fan-out called.
-- A fresh build gets all of it. A long-lived database (staging, production)
-- needs these steps, in order:
--
--   1. BEFORE deploying the app: re-run db/migrations/006_payment_functions.sql
--      in full. Every statement in it is CREATE OR REPLACE / REVOKE / GRANT, so
--      re-running is safe. The new cron route calls
--      list_unfired_cancellation_refunds, so it has to exist first.
--   2. BEFORE deploying the app: HAND OVER below (dry run until COMMIT).
--   3. Deploy the app, and give the cancellation-refunds GitHub Actions workflow
--      its secrets if they aren't there already (CRON_SECRET, PRODUCTION_URL:
--      the same ones the payout and FIDE crons use).
--   4. AFTER the deploy: DROP below (dry run until COMMIT). The app that was
--      live before step 3 calls list_pending_cancellation_refunds on every
--      approval, so dropping it earlier would leave that approval's refunds
--      unfired until the sweep exists.
--
-- Why HAND OVER: the sweep sends every unfired refund (last_fired_at NULL) on a
-- cancelled tournament straight to CHIP, without asking CHIP first. That is
-- right for a refund queued after this deploy, which nothing can have touched.
-- It is not right for rows already in the table: those queued before #497 have
-- last_fired_at NULL even if the old fan-out fired them, and the money may have
-- moved. HAND OVER stamps them as fired long ago, which keeps them off the
-- sweep and on the admin Stuck refunds page, where Retry reads the purchase at
-- CHIP before refunding (see wiki/refund-flow.md, Stuck refunds). Run its
-- SELECT first: if it returns nothing, there is nothing to hand over.
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres / service role), against
-- staging first, then production.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 2. HAND OVER (dry run until the last line says COMMIT)
-- -----------------------------------------------------------------------------
BEGIN;

-- What would be handed over: the refunds the sweep would otherwise pick up.
SELECT refund_id, tournament_id, requested_at
FROM list_unfired_cancellation_refunds(interval '0 seconds', 100000);

UPDATE refunds
  SET last_fired_at = requested_at
  WHERE id IN (
    SELECT refund_id
    FROM list_unfired_cancellation_refunds(interval '0 seconds', 100000)
  );

ROLLBACK;


-- -----------------------------------------------------------------------------
-- 4. DROP (dry run until the last line says COMMIT)
-- -----------------------------------------------------------------------------
BEGIN;

DROP FUNCTION IF EXISTS list_pending_cancellation_refunds(uuid);

ROLLBACK;
