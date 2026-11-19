-- =============================================================================
-- DB regression test for the refund sweep's work list (#496):
--   * list_unfired_cancellation_refunds — the cancellation refunds nobody has
--     sent to CHIP yet, oldest first and capped, leaving out refunds queued
--     too recently, already fired, settled, rejected, with no CHIP purchase, or
--     on a tournament that isn't cancelled
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. The whole thing runs inside a transaction that
-- ROLLBACKs at the end, so it builds throwaway fixtures and persists NOTHING.
-- A failing assertion RAISEs an exception (and rolls back); on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
--
-- now() is fixed for the whole transaction, so "queued 10 minutes ago" is set up
-- by writing requested_at directly rather than by waiting.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org        uuid;
  v_cancelled  uuid;
  v_live       uuid;
  v_admin      uuid;
  v_user_a uuid; v_user_b uuid; v_user_c uuid; v_user_d uuid;
  v_reg_a  uuid; v_reg_b  uuid; v_reg_c  uuid; v_reg_d  uuid;
  v_pay    uuid;
  v_refund_a uuid; v_refund_b uuid; v_refund_c uuid; v_refund_d uuid;
  v_res     jsonb;
  v_gross   integer;
  v_request uuid;
  v_ids     uuid[];
  c_grace   constant interval := interval '1 minute';
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('SWEEP ORG') RETURNING id INTO v_org;
  INSERT INTO users (email, first_name, last_name) VALUES ('sweep-admin@test.local','Ad','T') RETURNING id INTO v_admin;
  INSERT INTO users (email, first_name, last_name) VALUES ('sweep-a@test.local','Aina','T') RETURNING id INTO v_user_a;
  INSERT INTO users (email, first_name, last_name) VALUES ('sweep-b@test.local','Badrul','T') RETURNING id INTO v_user_b;
  INSERT INTO users (email, first_name, last_name) VALUES ('sweep-c@test.local','Chen','T') RETURNING id INTO v_user_c;
  INSERT INTO users (email, first_name, last_name) VALUES ('sweep-d@test.local','Devi','T') RETURNING id INTO v_user_d;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'SWEEP CANCELLED', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}',
    100, 'published'
  ) RETURNING id INTO v_cancelled;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'SWEEP LIVE', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}',
    100, 'published'
  ) RETURNING id INTO v_live;

  -- A, B, C paid for the tournament that gets cancelled. C's payment lost its
  -- CHIP purchase id (the no_purchase case).
  v_res := create_registration_with_payment(v_user_a, v_cancelled, 'standard', 10000);
  v_reg_a := (v_res->>'registration_id')::uuid;
  v_pay := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay;
  PERFORM settle_registration_payment(v_pay, true, v_gross, 'fpx_b2c');
  UPDATE payments SET chip_transaction_id = 'sweep-purchase-a' WHERE id = v_pay;

  v_res := create_registration_with_payment(v_user_b, v_cancelled, 'standard', 10000);
  v_reg_b := (v_res->>'registration_id')::uuid;
  v_pay := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay, true, v_gross, 'visa');
  UPDATE payments SET chip_transaction_id = 'sweep-purchase-b' WHERE id = v_pay;

  v_res := create_registration_with_payment(v_user_c, v_cancelled, 'standard', 10000);
  v_reg_c := (v_res->>'registration_id')::uuid;
  v_pay := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay, true, v_gross, 'visa');
  UPDATE payments SET chip_transaction_id = NULL WHERE id = v_pay;

  -- D paid for a tournament that is still on, and has a pending refund on it:
  -- the shape a player-requested refund awaiting review (#509) would have.
  v_res := create_registration_with_payment(v_user_d, v_live, 'standard', 10000);
  v_reg_d := (v_res->>'registration_id')::uuid;
  v_pay := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay, true, v_gross, 'visa');
  UPDATE payments SET chip_transaction_id = 'sweep-purchase-d' WHERE id = v_pay;
  INSERT INTO refunds (registration_id, refund_amount_cents, reason, requested_by, requested_at)
    VALUES (v_reg_d, v_gross, 'Player asked', v_user_d, now() - interval '1 hour')
    RETURNING id INTO v_refund_d;

  INSERT INTO tournament_cancellation_requests (tournament_id, requested_by, reason)
    VALUES (v_cancelled, v_user_a, 'Venue fell through')
    RETURNING id INTO v_request;
  PERFORM review_tournament_cancellation(v_request, v_admin, 'approve', NULL);

  SELECT id INTO v_refund_a FROM refunds WHERE registration_id = v_reg_a;
  SELECT id INTO v_refund_b FROM refunds WHERE registration_id = v_reg_b;
  SELECT id INTO v_refund_c FROM refunds WHERE registration_id = v_reg_c;
  IF v_refund_a IS NULL OR v_refund_b IS NULL OR v_refund_c IS NULL THEN
    RAISE EXCEPTION 'SETUP FAIL: approve did not queue a refund for each paid player';
  END IF;

  -- ===== S1: a refund queued a moment ago waits out the grace period ========
  IF EXISTS (SELECT 1 FROM list_unfired_cancellation_refunds(c_grace, 100)
             WHERE refund_id IN (v_refund_a, v_refund_b, v_refund_c)) THEN
    RAISE EXCEPTION 'S1 FAIL: a refund queued moments ago was listed inside the grace period';
  END IF;
  RAISE NOTICE 'S1 PASS — a just-queued refund waits for the cancellation notice to go out';

  -- B was queued before A, so B comes first.
  UPDATE refunds SET requested_at = now() - interval '10 minutes' WHERE id = v_refund_a;
  UPDATE refunds SET requested_at = now() - interval '20 minutes' WHERE id = v_refund_b;
  UPDATE refunds SET requested_at = now() - interval '30 minutes' WHERE id = v_refund_c;

  -- ===== S2: lists the owed, unfired refunds, oldest first ===================
  -- C (no purchase) and D (tournament not cancelled) are left out.
  SELECT array_agg(refund_id ORDER BY ord) INTO v_ids
    FROM list_unfired_cancellation_refunds(c_grace, 100) WITH ORDINALITY AS l(refund_id, tournament_id, requested_at, ord)
    WHERE refund_id IN (v_refund_a, v_refund_b, v_refund_c, v_refund_d);
  IF v_ids IS DISTINCT FROM ARRAY[v_refund_b, v_refund_a] THEN
    RAISE EXCEPTION 'S2 FAIL: listed % (expected B then A)', v_ids;
  END IF;
  IF (SELECT tournament_id FROM list_unfired_cancellation_refunds(c_grace, 100)
      WHERE refund_id = v_refund_a) IS DISTINCT FROM v_cancelled THEN
    RAISE EXCEPTION 'S2 FAIL: the listed row does not name its tournament';
  END IF;
  RAISE NOTICE 'S2 PASS — owed, unfired refunds are listed oldest first; no-purchase and non-cancelled are not';

  -- ===== S3: the limit caps a run =============================================
  IF (SELECT count(*) FROM list_unfired_cancellation_refunds(c_grace, 1)) <> 1 THEN
    RAISE EXCEPTION 'S3 FAIL: limit 1 returned more or fewer than one row';
  END IF;
  RAISE NOTICE 'S3 PASS — p_limit caps how many one run takes';

  -- ===== S4: a fired refund leaves the list for good =========================
  v_res := claim_refund_fire(v_refund_b, interval '15 minutes');
  IF NOT (v_res->>'claimed')::boolean THEN
    RAISE EXCEPTION 'S4 SETUP FAIL: claim returned %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM list_unfired_cancellation_refunds(c_grace, 100) WHERE refund_id = v_refund_b) THEN
    RAISE EXCEPTION 'S4 FAIL: a claimed refund is still on the unfired list';
  END IF;
  -- Even once it is old enough to count as stuck: that is the admin re-fire's job.
  UPDATE refunds SET last_fired_at = now() - interval '1 hour' WHERE id = v_refund_b;
  IF EXISTS (SELECT 1 FROM list_unfired_cancellation_refunds(c_grace, 100) WHERE refund_id = v_refund_b) THEN
    RAISE EXCEPTION 'S4 FAIL: a stuck refund came back on the unfired list';
  END IF;
  RAISE NOTICE 'S4 PASS — once fired, a refund is never swept again';

  -- ===== S5: settled and rejected refunds are left out =======================
  PERFORM settle_refund(v_refund_a, 'sweep-refund-pay-a', true, 'fpx_b2c');
  IF EXISTS (SELECT 1 FROM list_unfired_cancellation_refunds(c_grace, 100) WHERE refund_id = v_refund_a) THEN
    RAISE EXCEPTION 'S5 FAIL: a settled refund is on the unfired list';
  END IF;

  -- A refund with a CHIP refund id but no processed_at: money moved.
  UPDATE refunds SET processed_at = NULL, status = 'pending' WHERE id = v_refund_a;
  IF EXISTS (SELECT 1 FROM list_unfired_cancellation_refunds(c_grace, 100) WHERE refund_id = v_refund_a) THEN
    RAISE EXCEPTION 'S5 FAIL: a refund with a chip_refund_id is on the unfired list';
  END IF;

  UPDATE refunds SET chip_refund_id = NULL, status = 'rejected' WHERE id = v_refund_a;
  IF EXISTS (SELECT 1 FROM list_unfired_cancellation_refunds(c_grace, 100) WHERE refund_id = v_refund_a) THEN
    RAISE EXCEPTION 'S5 FAIL: a rejected refund is on the unfired list';
  END IF;
  RAISE NOTICE 'S5 PASS — settled, mid-settle and rejected refunds are not swept';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
