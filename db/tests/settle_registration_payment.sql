-- =============================================================================
-- DB money-state regression test for the registration/payment functions in
-- db/migrations/007_payment_functions.sql (+ the capacity trigger in 003).
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. The whole thing runs inside a transaction that
-- ROLLBACKs at the end, so it builds throwaway fixtures and persists NOTHING.
-- A failing assertion RAISEs an exception (and rolls back); on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
--
-- Covers the money-loss-critical paths that the vitest suite can't (it mocks the
-- RPCs): "real money wins" settlement, supersession, expiry, and idempotency.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org        uuid;
  v_tournament uuid;
  v_user_a uuid; v_user_b uuid; v_user_c uuid; v_user_d uuid; v_user_e uuid;
  v_user_f uuid;
  v_res    jsonb;
  v_reg    uuid;
  v_pay_a  uuid;
  v_pay_b  uuid;
  v_gross  integer;
  v_pay    text;
  v_regst  text;
  v_method text;
  v_rows   integer;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('VERIFY ORG') RETURNING id INTO v_org;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-a@test.local','A','T') RETURNING id INTO v_user_a;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-b@test.local','B','T') RETURNING id INTO v_user_b;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-c@test.local','C','T') RETURNING id INTO v_user_c;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-d@test.local','D','T') RETURNING id INTO v_user_d;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-e@test.local','E','T') RETURNING id INTO v_user_e;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-f@test.local','F','T') RETURNING id INTO v_user_f;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'VERIFY T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  -- ===== S1 (#1): decline, then retry-success on the SAME payment ===========
  v_res   := create_registration_with_payment(v_user_a, v_tournament, 'standard', 4000);
  v_reg   := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;

  PERFORM settle_registration_payment(v_pay_a, false, NULL);                 -- purchase.payment_failure
  PERFORM settle_registration_payment(v_pay_a, true,  v_gross, 'fpx_b2c');   -- retry clears the same purchase

  SELECT status, payment_method INTO v_pay, v_method FROM payments WHERE id = v_pay_a;
  SELECT status INTO v_regst FROM registrations WHERE id = v_reg;
  IF v_pay <> 'paid' OR v_regst <> 'confirmed' THEN
    RAISE EXCEPTION 'S1 FAIL: payment=% registration=% (expected paid/confirmed)', v_pay, v_regst;
  END IF;
  IF v_method IS DISTINCT FROM 'fpx_b2c' THEN
    RAISE EXCEPTION 'S1 FAIL: payment_method=% (expected fpx_b2c)', v_method;
  END IF;
  RAISE NOTICE 'S1 PASS — decline-then-retry rescued, method recorded';

  -- ===== S2 (#2/#4): supersede A with B, then a late paid for A =============
  v_res   := create_registration_with_payment(v_user_b, v_tournament, 'standard', 4000);
  v_reg   := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;

  v_res   := start_new_payment_attempt(v_reg, 'standard', 4000); -- A superseded by B
  v_pay_b := (v_res->>'payment_id')::uuid;

  PERFORM settle_registration_payment(v_pay_a, true, v_gross);   -- late paid for the superseded A

  SELECT status INTO v_pay   FROM payments      WHERE id = v_pay_a;
  SELECT status INTO v_regst FROM registrations WHERE id = v_reg;
  IF v_pay <> 'paid' OR v_regst <> 'confirmed' THEN
    RAISE EXCEPTION 'S2 FAIL: paymentA=% registration=% (expected paid/confirmed)', v_pay, v_regst;
  END IF;
  IF (SELECT current_payment_id FROM registrations WHERE id = v_reg) <> v_pay_a THEN
    RAISE EXCEPTION 'S2 FAIL: current_payment_id should point at the paid attempt A';
  END IF;
  RAISE NOTICE 'S2 PASS — superseded attempt rescued by late paid';

  -- ===== S3a: duplicate paid is idempotent =================================
  v_res   := create_registration_with_payment(v_user_c, v_tournament, 'standard', 4000);
  v_reg   := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;
  PERFORM settle_registration_payment(v_pay_a, true, v_gross, 'visa');
  PERFORM settle_registration_payment(v_pay_a, true, v_gross, NULL);  -- late dup w/o method
  SELECT status, payment_method INTO v_pay, v_method FROM payments WHERE id = v_pay_a;
  SELECT status INTO v_regst FROM registrations WHERE id = v_reg;
  IF v_pay <> 'paid' OR v_regst <> 'confirmed' THEN
    RAISE EXCEPTION 'S3a FAIL: payment=% registration=%', v_pay, v_regst;
  END IF;
  -- The idempotent re-settle must not clobber the recorded method with NULL.
  IF v_method IS DISTINCT FROM 'visa' THEN
    RAISE EXCEPTION 'S3a FAIL: payment_method=% (expected visa preserved)', v_method;
  END IF;
  RAISE NOTICE 'S3a PASS — duplicate paid idempotent, method preserved';

  -- ===== S3b: amount mismatch leaves it untouched ==========================
  v_res   := create_registration_with_payment(v_user_d, v_tournament, 'standard', 4000);
  v_reg   := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;
  v_res := settle_registration_payment(v_pay_a, true, v_gross + 1);  -- wrong amount
  IF (v_res->>'amount_mismatch')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'S3b FAIL: expected amount_mismatch=true';
  END IF;
  SELECT status INTO v_pay   FROM payments      WHERE id = v_pay_a;
  SELECT status INTO v_regst FROM registrations WHERE id = v_reg;
  IF v_pay <> 'pending' OR v_regst <> 'pending_payment' THEN
    RAISE EXCEPTION 'S3b FAIL: payment=% registration=% (expected pending/pending_payment)', v_pay, v_regst;
  END IF;
  RAISE NOTICE 'S3b PASS — amount mismatch left pending';

  -- ===== S3c: paid is protected from a stray late failure ==================
  v_res   := create_registration_with_payment(v_user_e, v_tournament, 'standard', 4000);
  v_reg   := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;
  PERFORM settle_registration_payment(v_pay_a, true,  v_gross);  -- paid
  PERFORM settle_registration_payment(v_pay_a, false, NULL);     -- stray late failure
  SELECT status INTO v_pay   FROM payments      WHERE id = v_pay_a;
  SELECT status INTO v_regst FROM registrations WHERE id = v_reg;
  IF v_pay <> 'paid' OR v_regst <> 'confirmed' THEN
    RAISE EXCEPTION 'S3c FAIL: payment=% registration=% (expected paid/confirmed)', v_pay, v_regst;
  END IF;
  RAISE NOTICE 'S3c PASS — paid protected from late failure';

  -- ===== S4: expiry terminalizes a stale hold but leaves the payment pending =
  v_res   := create_registration_with_payment(v_user_f, v_tournament, 'standard', 4000);
  v_reg   := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;
  UPDATE registrations SET registered_at = now() - interval '20 minutes' WHERE id = v_reg;

  SELECT count(*) INTO v_rows
  FROM expire_stale_pending_payments('10 minutes', NULL, v_reg, NULL);
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'S4 FAIL: expected 1 expired registration, got %', v_rows;
  END IF;
  SELECT status INTO v_pay   FROM payments      WHERE id = v_pay_a;
  SELECT status INTO v_regst FROM registrations WHERE id = v_reg;
  IF v_regst <> 'cancelled_payment' OR v_pay <> 'pending' THEN
    RAISE EXCEPTION 'S4 FAIL: registration=% payment=% (expected cancelled_payment/pending)', v_regst, v_pay;
  END IF;
  RAISE NOTICE 'S4 PASS — stale hold expired, payment left pending';

  -- ===== S5: a late paid rescues a just-expired registration ===============
  PERFORM settle_registration_payment(v_pay_a, true, v_gross);  -- reuse S4's expired row
  SELECT status INTO v_pay   FROM payments      WHERE id = v_pay_a;
  SELECT status INTO v_regst FROM registrations WHERE id = v_reg;
  IF v_pay <> 'paid' OR v_regst <> 'confirmed' THEN
    RAISE EXCEPTION 'S5 FAIL: payment=% registration=% (expected paid/confirmed)', v_pay, v_regst;
  END IF;
  RAISE NOTICE 'S5 PASS — late paid rescued an expired registration';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
