-- =============================================================================
-- DB regression test for the tournament_payout_summary view in
-- db/migrations/001_tables.sql (guards issue #350 — organizer dashboard's
-- Total Revenue / Pending Payout, and the admin dashboard's platform revenue).
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. The whole thing runs inside a transaction that
-- ROLLBACKs at the end, so it builds throwaway fixtures and persists NOTHING.
-- A failing assertion RAISEs an exception (and rolls back); on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
--
-- The view must compute every figure from the per-payment ledger columns
-- (gross_amount_cents / platform_fee_cents / net_amount_cents) rather than
-- re-deriving the fee from tournaments.commission_rate. Uses the real
-- create_registration_with_payment / settle_registration_payment RPCs so the
-- registration rows carry authentic gross/fee/net splits.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org  uuid;
  v_t1   uuid; v_t2 uuid; v_t3 uuid;
  v_user_a uuid; v_user_b uuid; v_user_c uuid; v_user_d uuid; v_user_e uuid;
  v_res    jsonb;
  v_reg    uuid;
  v_pay    uuid;
  v_gross  integer;
  v_row    tournament_payout_summary%ROWTYPE;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  -- Each tournament is priced so the issue's worked example holds: entry RM100
  -- (10000c), commission_rate 10, organizer_commission_pct 0 => a paid
  -- registration is gross 11000 / fee 1000 / net 10000.
  INSERT INTO organizations (name) VALUES ('PAYOUT VIEW ORG') RETURNING id INTO v_org;

  INSERT INTO users (email, first_name, last_name) VALUES ('payout-a@test.local','A','T') RETURNING id INTO v_user_a;
  INSERT INTO users (email, first_name, last_name) VALUES ('payout-b@test.local','B','T') RETURNING id INTO v_user_b;
  INSERT INTO users (email, first_name, last_name) VALUES ('payout-c@test.local','C','T') RETURNING id INTO v_user_c;
  INSERT INTO users (email, first_name, last_name) VALUES ('payout-d@test.local','D','T') RETURNING id INTO v_user_d;
  INSERT INTO users (email, first_name, last_name) VALUES ('payout-e@test.local','E','T') RETURNING id INTO v_user_e;

  -- commission_rate (10) and organizer_commission_pct (0) use table defaults.
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES
    (v_org, 'PAYOUT T1', 'Venue', 'Selangor', 'Address',
     current_date + 30, current_date + 31, now() + interval '20 days',
     '{"type":"classical","rounds":9,"system":"swiss"}',
     '{"base_minutes":90,"increment_seconds":30}',
     '{"standard": {"amount_cents": 10000}}', 100, 'published')
  RETURNING id INTO v_t1;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES
    (v_org, 'PAYOUT T2', 'Venue', 'Selangor', 'Address',
     current_date + 30, current_date + 31, now() + interval '20 days',
     '{"type":"classical","rounds":9,"system":"swiss"}',
     '{"base_minutes":90,"increment_seconds":30}',
     '{"standard": {"amount_cents": 10000}}', 100, 'published')
  RETURNING id INTO v_t2;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES
    (v_org, 'PAYOUT T3', 'Venue', 'Selangor', 'Address',
     current_date + 30, current_date + 31, now() + interval '20 days',
     '{"type":"classical","rounds":9,"system":"swiss"}',
     '{"base_minutes":90,"increment_seconds":30}',
     '{"standard": {"amount_cents": 10000}}', 100, 'published')
  RETURNING id INTO v_t3;

  -- ===== S1: single paid registration; a pending one must be ignored ========
  -- This is the exact issue example: player charged RM110, organizer earns RM100.
  v_res  := create_registration_with_payment(v_user_a, v_t1, 'standard', 10000);
  v_pay  := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay;   -- 11000
  PERFORM settle_registration_payment(v_pay, true, v_gross);

  -- Pending attempt (never settled) — must NOT count toward any figure.
  PERFORM create_registration_with_payment(v_user_b, v_t1, 'standard', 10000);

  SELECT * INTO v_row FROM tournament_payout_summary WHERE tournament_id = v_t1;
  IF v_row.total_registration_cents <> 11000 THEN
    RAISE EXCEPTION 'S1 FAIL: total_registration_cents=% (expected 11000)', v_row.total_registration_cents;
  END IF;
  IF v_row.effective_platform_fee_cents <> 1000 THEN
    RAISE EXCEPTION 'S1 FAIL: effective_platform_fee_cents=% (expected 1000, ledger fee not gross*rate)', v_row.effective_platform_fee_cents;
  END IF;
  IF v_row.net_revenue_cents <> 10000 THEN
    RAISE EXCEPTION 'S1 FAIL: net_revenue_cents=% (expected 10000 — organizer portion, not gross)', v_row.net_revenue_cents;
  END IF;
  IF v_row.net_payout_cents <> 10000 THEN
    RAISE EXCEPTION 'S1 FAIL: net_payout_cents=% (expected 10000 — equals revenue, no payout yet)', v_row.net_payout_cents;
  END IF;
  IF v_row.total_payouts_cents <> 0 THEN
    RAISE EXCEPTION 'S1 FAIL: total_payouts_cents=% (expected 0)', v_row.total_payouts_cents;
  END IF;
  RAISE NOTICE 'S1 PASS — net revenue/payout from ledger; pending ignored';

  -- ===== S2: an executed organizer_payout drains pending payout to zero ======
  v_res  := create_registration_with_payment(v_user_c, v_t2, 'standard', 10000);
  v_pay  := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay;
  PERFORM settle_registration_payment(v_pay, true, v_gross);

  -- The organizer has already been paid their RM100.
  INSERT INTO payments (type, tournament_id, organization_id,
    gross_amount_cents, platform_fee_cents, net_amount_cents, status)
  VALUES ('organizer_payout', v_t2, v_org, 10000, 0, 10000, 'paid');

  SELECT * INTO v_row FROM tournament_payout_summary WHERE tournament_id = v_t2;
  IF v_row.net_revenue_cents <> 10000 THEN
    RAISE EXCEPTION 'S2 FAIL: net_revenue_cents=% (expected 10000 — payouts do not reduce revenue)', v_row.net_revenue_cents;
  END IF;
  IF v_row.total_payouts_cents <> 10000 THEN
    RAISE EXCEPTION 'S2 FAIL: total_payouts_cents=% (expected 10000)', v_row.total_payouts_cents;
  END IF;
  IF v_row.net_payout_cents <> 0 THEN
    RAISE EXCEPTION 'S2 FAIL: net_payout_cents=% (expected 0 — already paid out)', v_row.net_payout_cents;
  END IF;
  RAISE NOTICE 'S2 PASS — executed payout zeroes pending payout';

  -- ===== S3: refunds net out; prizes reduce the payout ======================
  v_res  := create_registration_with_payment(v_user_d, v_t3, 'standard', 10000);
  v_pay  := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay;
  PERFORM settle_registration_payment(v_pay, true, v_gross);

  v_res  := create_registration_with_payment(v_user_e, v_t3, 'standard', 10000);
  v_pay  := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay;
  PERFORM settle_registration_payment(v_pay, true, v_gross);

  -- Fully refund one registration (reverses gross/fee/net) ...
  INSERT INTO payments (type, tournament_id, organization_id, user_id,
    gross_amount_cents, platform_fee_cents, net_amount_cents, status)
  VALUES ('refund', v_t3, v_org, v_user_e, 11000, 1000, 10000, 'paid');
  -- ... and pay out a RM5 player prize.
  INSERT INTO payments (type, tournament_id, organization_id, user_id,
    gross_amount_cents, platform_fee_cents, net_amount_cents, status)
  VALUES ('player_prize', v_t3, v_org, v_user_d, 500, 0, 500, 'paid');

  SELECT * INTO v_row FROM tournament_payout_summary WHERE tournament_id = v_t3;
  IF v_row.net_revenue_cents <> 10000 THEN
    RAISE EXCEPTION 'S3 FAIL: net_revenue_cents=% (expected 10000 — two regs net 20000 minus one 10000 refund)', v_row.net_revenue_cents;
  END IF;
  IF v_row.effective_platform_fee_cents <> 1000 THEN
    RAISE EXCEPTION 'S3 FAIL: effective_platform_fee_cents=% (expected 1000 — 2000 collected minus 1000 refunded)', v_row.effective_platform_fee_cents;
  END IF;
  IF v_row.total_prizes_cents <> 500 THEN
    RAISE EXCEPTION 'S3 FAIL: total_prizes_cents=% (expected 500)', v_row.total_prizes_cents;
  END IF;
  IF v_row.net_payout_cents <> 9500 THEN
    RAISE EXCEPTION 'S3 FAIL: net_payout_cents=% (expected 9500 — 10000 revenue minus 500 prize)', v_row.net_payout_cents;
  END IF;
  RAISE NOTICE 'S3 PASS — refunds netted, prizes deducted';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
