-- =============================================================================
-- ONE-OFF: bring an existing database up to #502 (ledger integrity)
--
-- #502 edits the base migrations in place: payments.fee_tier in 001, the
-- registrations constraint chk_cancelled_fields_consistent in 001, and both
-- payment-creating functions in 006. A fresh build gets all of it. A
-- long-lived database (staging, production) needs these steps, in order:
--
--   1. CHECK  — read-only. Lists registrations that would violate the new
--               constraint. It must return no rows before step 2. If it does
--               return rows, stop: each one is a real inconsistency to
--               understand and fix by hand, not something to paper over.
--   2. APPLY  — adds the column and the constraint in one transaction. It ends
--               in ROLLBACK, so it is a dry run until that line is changed to
--               COMMIT.
--   3. Re-run db/migrations/006_payment_functions.sql in full. Every statement
--      in it is CREATE OR REPLACE / REVOKE / GRANT, so re-running is safe. It
--      must come after step 2: the new function bodies write payments.fee_tier.
--
-- Existing payment rows keep fee_tier NULL on purpose. Copying
-- registrations.fee_tier onto them would claim to know the tier each old
-- attempt was charged at, and for a retried registration we don't.
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres / service role), against
-- staging first, then production.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. CHECK (read-only)
-- -----------------------------------------------------------------------------
SELECT id, status, cancelled_at, cancellation_reason, registered_at, confirmed_at
FROM registrations
WHERE (status IN ('cancelled_payment', 'forfeited')) <> (cancelled_at IS NOT NULL)
ORDER BY registered_at;


-- -----------------------------------------------------------------------------
-- 2. APPLY (dry run until the last line says COMMIT)
-- -----------------------------------------------------------------------------
BEGIN;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS fee_tier varchar(50);

-- Fails, and rolls everything back, if step 1 would have returned any rows.
ALTER TABLE registrations
  ADD CONSTRAINT chk_cancelled_fields_consistent
  CHECK ((status IN ('cancelled_payment', 'forfeited')) = (cancelled_at IS NOT NULL));

ROLLBACK;
