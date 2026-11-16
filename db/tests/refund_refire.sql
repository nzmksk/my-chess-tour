-- =============================================================================
-- DB regression test for the ops re-fire path for stuck refunds (#497):
--   * refund_fire_due — never fired / fired long enough ago / failed since fired
--   * claim_refund_fire — stamps last_fired_at once, refuses a refund that is
--     settled (processed_at, chip_refund_id or 'approved'), rejected, in flight,
--     missing, or has no CHIP purchase to refund against
--   * list_stuck_refunds — lists exactly the refunds claim_refund_fire would
--     accept, plus the no-purchase ones that need a hand
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. The whole thing runs inside a transaction that
-- ROLLBACKs at the end, so it builds throwaway fixtures and persists NOTHING.
-- A failing assertion RAISEs an exception (and rolls back); on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
--
-- now() is fixed for the whole transaction, so "fired 20 minutes ago" is set up
-- by writing last_fired_at / failed_at directly rather than by waiting.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org        uuid;
  v_tournament uuid;
  v_admin      uuid;
  v_user_a uuid; v_user_b uuid; v_user_c uuid;
  v_reg_a  uuid; v_reg_b  uuid; v_reg_c  uuid;
  v_pay_a  uuid; v_pay_b  uuid; v_pay_c  uuid;
  v_refund_a uuid; v_refund_b uuid; v_refund_c uuid;
  v_res     jsonb;
  v_gross   integer;
  v_request uuid;
  v_fired   timestamptz;
  v_count   integer;
  v_row     record;
  c_age     constant interval := interval '15 minutes';
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('REFIRE ORG') RETURNING id INTO v_org;
  INSERT INTO users (email, first_name, last_name) VALUES ('refire-admin@test.local','Ad','T') RETURNING id INTO v_admin;
  INSERT INTO users (email, first_name, last_name) VALUES ('refire-a@test.local','Aina','Tan') RETURNING id INTO v_user_a;
  INSERT INTO users (email, first_name, last_name) VALUES ('refire-b@test.local','Badrul','T') RETURNING id INTO v_user_b;
  INSERT INTO users (email, first_name, last_name) VALUES ('refire-c@test.local','Chen','T') RETURNING id INTO v_user_c;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'REFIRE T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  -- A, B, C all paid. C's payment lost its CHIP purchase id (the no_purchase case).
  v_res := create_registration_with_payment(v_user_a, v_tournament, 'standard', 10000);
  v_reg_a := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;
  PERFORM settle_registration_payment(v_pay_a, true, v_gross, 'fpx_b2c');
  UPDATE payments SET chip_transaction_id = 'refire-purchase-a' WHERE id = v_pay_a;

  v_res := create_registration_with_payment(v_user_b, v_tournament, 'standard', 10000);
  v_reg_b := (v_res->>'registration_id')::uuid;
  v_pay_b := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay_b, true, v_gross, 'visa');
  UPDATE payments SET chip_transaction_id = 'refire-purchase-b' WHERE id = v_pay_b;

  v_res := create_registration_with_payment(v_user_c, v_tournament, 'standard', 10000);
  v_reg_c := (v_res->>'registration_id')::uuid;
  v_pay_c := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay_c, true, v_gross, 'visa');
  UPDATE payments SET chip_transaction_id = NULL WHERE id = v_pay_c;

  INSERT INTO tournament_cancellation_requests (tournament_id, requested_by, reason)
    VALUES (v_tournament, v_user_a, 'Venue fell through')
    RETURNING id INTO v_request;
  PERFORM review_tournament_cancellation(v_request, v_admin, 'approve', NULL);

  SELECT id INTO v_refund_a FROM refunds WHERE registration_id = v_reg_a;
  SELECT id INTO v_refund_b FROM refunds WHERE registration_id = v_reg_b;
  SELECT id INTO v_refund_c FROM refunds WHERE registration_id = v_reg_c;
  IF v_refund_a IS NULL OR v_refund_b IS NULL OR v_refund_c IS NULL THEN
    RAISE EXCEPTION 'SETUP FAIL: approve did not queue a refund for each paid player';
  END IF;

  -- ===== F1: a never-fired refund is stuck and listed with its details =======
  SELECT count(*) INTO v_count FROM list_stuck_refunds(c_age)
    WHERE refund_id IN (v_refund_a, v_refund_b, v_refund_c);
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'F1 FAIL: % never-fired refunds listed (expected 3)', v_count;
  END IF;

  SELECT * INTO v_row FROM list_stuck_refunds(c_age) WHERE refund_id = v_refund_a;
  IF v_row.tournament_id <> v_tournament OR v_row.tournament_name <> 'REFIRE T'
     OR v_row.player_name <> 'Aina Tan' OR v_row.player_email <> 'refire-a@test.local'
     OR v_row.amount_cents <> v_gross
     OR v_row.original_chip_purchase_id <> 'refire-purchase-a'
     OR v_row.last_fired_at IS NOT NULL OR v_row.failed_at IS NOT NULL THEN
    RAISE EXCEPTION 'F1 FAIL: listed row has the wrong details: %', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'F1 PASS — never-fired refunds are listed as stuck, with player, tournament and purchase';

  -- ===== F2: claiming stamps last_fired_at and hands back the purchase =======
  v_res := claim_refund_fire(v_refund_a, c_age);
  IF NOT (v_res->>'claimed')::boolean
     OR v_res->>'original_chip_purchase_id' <> 'refire-purchase-a' THEN
    RAISE EXCEPTION 'F2 FAIL: first claim returned %', v_res;
  END IF;
  SELECT last_fired_at INTO v_fired FROM refunds WHERE id = v_refund_a;
  IF v_fired IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'F2 FAIL: last_fired_at=% (expected now())', v_fired;
  END IF;
  RAISE NOTICE 'F2 PASS — claim stamps last_fired_at and returns the CHIP purchase id';

  -- ===== F3: a just-fired refund is in flight: not claimable, not listed ======
  v_res := claim_refund_fire(v_refund_a, c_age);
  IF (v_res->>'claimed')::boolean OR v_res->>'reason' <> 'in_flight' THEN
    RAISE EXCEPTION 'F3 FAIL: second claim returned % (expected in_flight)', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM list_stuck_refunds(c_age) WHERE refund_id = v_refund_a) THEN
    RAISE EXCEPTION 'F3 FAIL: a refund awaiting its webhook was listed as stuck';
  END IF;
  RAISE NOTICE 'F3 PASS — a refund fired moment ago is in flight, not stuck';

  -- ===== F4: once fired long enough ago it is stuck again ====================
  UPDATE refunds SET last_fired_at = now() - interval '20 minutes' WHERE id = v_refund_a;
  IF NOT EXISTS (SELECT 1 FROM list_stuck_refunds(c_age) WHERE refund_id = v_refund_a) THEN
    RAISE EXCEPTION 'F4 FAIL: a refund fired 20 minutes ago is not listed at a 15-minute threshold';
  END IF;
  IF EXISTS (SELECT 1 FROM list_stuck_refunds(interval '30 minutes') WHERE refund_id = v_refund_a) THEN
    RAISE EXCEPTION 'F4 FAIL: a refund fired 20 minutes ago is listed at a 30-minute threshold';
  END IF;
  v_res := claim_refund_fire(v_refund_a, c_age);
  IF NOT (v_res->>'claimed')::boolean THEN
    RAISE EXCEPTION 'F4 FAIL: claim of an aged refund returned %', v_res;
  END IF;
  RAISE NOTICE 'F4 PASS — the age threshold decides when an unanswered fire is stuck';

  -- ===== F5: a failure reported after the fire makes it due straight away ====
  UPDATE refunds SET last_fired_at = now() - interval '2 minutes' WHERE id = v_refund_a;
  PERFORM settle_refund(v_refund_a, NULL, false, NULL);   -- failed_at := now()
  IF NOT EXISTS (SELECT 1 FROM list_stuck_refunds(c_age) WHERE refund_id = v_refund_a) THEN
    RAISE EXCEPTION 'F5 FAIL: a refund that failed after it was fired is not listed';
  END IF;
  v_res := claim_refund_fire(v_refund_a, c_age);
  IF NOT (v_res->>'claimed')::boolean THEN
    RAISE EXCEPTION 'F5 FAIL: claim after a failure returned %', v_res;
  END IF;

  -- failed_at is first-failure-only: an old failure doesn't make a fresh fire due.
  UPDATE refunds
    SET failed_at = now() - interval '10 minutes', last_fired_at = now() - interval '1 minute'
    WHERE id = v_refund_a;
  v_res := claim_refund_fire(v_refund_a, c_age);
  IF v_res->>'reason' IS DISTINCT FROM 'in_flight' THEN
    RAISE EXCEPTION 'F5 FAIL: a failure older than the last fire made it due: %', v_res;
  END IF;
  RAISE NOTICE 'F5 PASS — failed since the fire is due now; an earlier failure is not';

  -- ===== F6: a settled refund is never re-fired ==============================
  PERFORM settle_refund(v_refund_b, 'refire-refund-pay-b', true, 'visa');
  v_res := claim_refund_fire(v_refund_b, c_age);
  IF (v_res->>'claimed')::boolean OR v_res->>'reason' <> 'settled' THEN
    RAISE EXCEPTION 'F6 FAIL: claim of a settled refund returned %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM list_stuck_refunds(c_age) WHERE refund_id = v_refund_b) THEN
    RAISE EXCEPTION 'F6 FAIL: a settled refund was listed as stuck';
  END IF;

  -- chip_refund_id alone (no processed_at) is enough to refuse: money moved.
  UPDATE refunds
    SET chip_refund_id = 'refire-orphan-pay', last_fired_at = NULL, failed_at = NULL
    WHERE id = v_refund_a;
  v_res := claim_refund_fire(v_refund_a, c_age);
  IF v_res->>'reason' IS DISTINCT FROM 'settled' THEN
    RAISE EXCEPTION 'F6 FAIL: a refund with a chip_refund_id was claimable: %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM list_stuck_refunds(c_age) WHERE refund_id = v_refund_a) THEN
    RAISE EXCEPTION 'F6 FAIL: a refund with a chip_refund_id was listed as stuck';
  END IF;
  SELECT last_fired_at INTO v_fired FROM refunds WHERE id = v_refund_a;
  IF v_fired IS NOT NULL THEN
    RAISE EXCEPTION 'F6 FAIL: a refused claim stamped last_fired_at';
  END IF;
  RAISE NOTICE 'F6 PASS — processed_at or chip_refund_id refuses a re-fire, unstamped';

  -- ===== F7: no CHIP purchase → refused unstamped, still listed ==============
  v_res := claim_refund_fire(v_refund_c, c_age);
  IF (v_res->>'claimed')::boolean OR v_res->>'reason' <> 'no_purchase' THEN
    RAISE EXCEPTION 'F7 FAIL: claim without a purchase returned %', v_res;
  END IF;
  SELECT * INTO v_row FROM list_stuck_refunds(c_age) WHERE refund_id = v_refund_c;
  IF NOT FOUND OR v_row.original_chip_purchase_id IS NOT NULL OR v_row.last_fired_at IS NOT NULL THEN
    RAISE EXCEPTION 'F7 FAIL: the no-purchase refund should stay listed, unstamped: %', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'F7 PASS — a refund with nothing to refund against stays on the list for a hand';

  -- ===== F8: rejected and missing refunds ====================================
  UPDATE refunds SET status = 'rejected' WHERE id = v_refund_c;
  v_res := claim_refund_fire(v_refund_c, c_age);
  IF v_res->>'reason' IS DISTINCT FROM 'rejected' THEN
    RAISE EXCEPTION 'F8 FAIL: claim of a rejected refund returned %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM list_stuck_refunds(c_age) WHERE refund_id = v_refund_c) THEN
    RAISE EXCEPTION 'F8 FAIL: a rejected refund was listed as stuck';
  END IF;
  v_res := claim_refund_fire(gen_random_uuid(), c_age);
  IF v_res->>'reason' IS DISTINCT FROM 'not_found' THEN
    RAISE EXCEPTION 'F8 FAIL: claim of a missing refund returned %', v_res;
  END IF;
  RAISE NOTICE 'F8 PASS — rejected and missing refunds are refused';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
