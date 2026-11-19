-- =============================================================================
-- DB money-state regression test for the registration/payment functions in
-- db/migrations/006_payment_functions.sql (+ the capacity trigger in 003).
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
  v_user_f uuid; v_user_g uuid; v_user_h uuid; v_user_i uuid;
  v_res    jsonb;
  v_reg    uuid;
  v_pay_a  uuid;
  v_pay_b  uuid;
  v_gross  integer;
  v_pay    text;
  v_regst  text;
  v_method text;
  v_rows   integer;
  v_tier_a text;
  v_tier_b text;
  v_cancelled_at timestamptz;
  v_reason       text;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('VERIFY ORG') RETURNING id INTO v_org;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-a@test.local','A','T') RETURNING id INTO v_user_a;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-b@test.local','B','T') RETURNING id INTO v_user_b;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-c@test.local','C','T') RETURNING id INTO v_user_c;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-d@test.local','D','T') RETURNING id INTO v_user_d;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-e@test.local','E','T') RETURNING id INTO v_user_e;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-f@test.local','F','T') RETURNING id INTO v_user_f;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-g@test.local','G','T') RETURNING id INTO v_user_g;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-h@test.local','H','T') RETURNING id INTO v_user_h;
  INSERT INTO users (email, first_name, last_name) VALUES ('verify-i@test.local','I','T') RETURNING id INTO v_user_i;

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
  v_res := settle_registration_payment(v_pay_a, true,  v_gross, 'fpx_b2c');  -- retry clears the same purchase
  IF (v_res->>'newly_confirmed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'S1 FAIL: the rescuing paid settle should report newly_confirmed, got %', v_res;
  END IF;

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
  v_res := settle_registration_payment(v_pay_a, true, v_gross, 'visa');
  IF (v_res->>'newly_confirmed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'S3a FAIL: first paid settle should report newly_confirmed, got %', v_res;
  END IF;
  v_res := settle_registration_payment(v_pay_a, true, v_gross, NULL);  -- late dup w/o method
  IF (v_res->>'newly_confirmed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'S3a FAIL: duplicate paid settle must not report newly_confirmed, got %', v_res;
  END IF;
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
  IF (v_res->>'newly_confirmed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'S3b FAIL: a mismatched amount must not report newly_confirmed, got %', v_res;
  END IF;
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

  -- ===== S6: a second paid attempt on a confirmed registration =============
  -- Both attempts were paid (e.g. the player paid twice). The registration is
  -- confirmed once; the second settle records its money but must not report a
  -- fresh confirmation, or the player is emailed twice.
  v_res   := create_registration_with_payment(v_user_g, v_tournament, 'standard', 4000);
  v_reg   := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;
  v_res   := start_new_payment_attempt(v_reg, 'standard', 4000);
  v_pay_b := (v_res->>'payment_id')::uuid;

  v_res := settle_registration_payment(v_pay_b, true, v_gross);
  IF (v_res->>'newly_confirmed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'S6 FAIL: first paid attempt should report newly_confirmed, got %', v_res;
  END IF;
  v_res := settle_registration_payment(v_pay_a, true, v_gross);
  SELECT status INTO v_pay FROM payments WHERE id = v_pay_a;
  IF v_pay <> 'paid' OR (v_res->>'newly_confirmed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'S6 FAIL: second paid attempt payment=% result=% (expected paid, not newly_confirmed)', v_pay, v_res;
  END IF;
  RAISE NOTICE 'S6 PASS — a second paid attempt does not re-confirm';

  -- ===== S7: each attempt records the tier it was charged at ===============
  -- The player's tier changes between a failed attempt and the retry (e.g. a
  -- corrected DOB moves them off the junior rate). The ledger must keep both
  -- tiers; registrations.fee_tier only follows the current attempt.
  v_res   := create_registration_with_payment(v_user_h, v_tournament, 'age_based', 2000);
  v_reg   := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay_a, false, NULL);
  v_res   := start_new_payment_attempt(v_reg, 'standard', 4000);
  v_pay_b := (v_res->>'payment_id')::uuid;

  SELECT fee_tier INTO v_tier_a FROM payments WHERE id = v_pay_a;
  SELECT fee_tier INTO v_tier_b FROM payments WHERE id = v_pay_b;
  IF v_tier_a IS DISTINCT FROM 'age_based' OR v_tier_b IS DISTINCT FROM 'standard' THEN
    RAISE EXCEPTION 'S7 FAIL: payment tiers A=% B=% (expected age_based/standard)', v_tier_a, v_tier_b;
  END IF;
  IF (SELECT fee_tier FROM registrations WHERE id = v_reg) <> 'standard' THEN
    RAISE EXCEPTION 'S7 FAIL: registration fee_tier should follow the current attempt';
  END IF;
  RAISE NOTICE 'S7 PASS — each attempt keeps the tier it was charged at';

  -- ===== S8: cancelled_at must agree with the status ======================
  -- chk_cancelled_fields_consistent. Reuses S7's live pending_payment row; each
  -- write is in its own sub-block so the rejected change rolls back alone.
  BEGIN
    UPDATE registrations SET status = 'confirmed', confirmed_at = now(), cancelled_at = now()
      WHERE id = v_reg;
    RAISE EXCEPTION 'S8 FAIL: confirmed with a cancelled_at was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE registrations SET status = 'cancelled_payment' WHERE id = v_reg;
    RAISE EXCEPTION 'S8 FAIL: cancelled_payment without a cancelled_at was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE registrations SET status = 'failed_payment', cancelled_at = now() WHERE id = v_reg;
    RAISE EXCEPTION 'S8 FAIL: failed_payment with a cancelled_at was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'S8 PASS — cancelled_at and status cannot disagree';

  -- ===== S9: a late paid rescue clears both cancellation fields ============
  v_res   := create_registration_with_payment(v_user_i, v_tournament, 'standard', 4000);
  v_reg   := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;
  UPDATE registrations SET registered_at = now() - interval '20 minutes' WHERE id = v_reg;
  PERFORM expire_stale_pending_payments('10 minutes', NULL, v_reg, NULL);

  SELECT cancelled_at, cancellation_reason INTO v_cancelled_at, v_reason
    FROM registrations WHERE id = v_reg;
  IF v_cancelled_at IS NULL OR v_reason IS DISTINCT FROM 'payment_expired' THEN
    RAISE EXCEPTION 'S9 FAIL: expiry should stamp cancelled_at and the reason, got % / %', v_cancelled_at, v_reason;
  END IF;

  PERFORM settle_registration_payment(v_pay_a, true, v_gross);
  SELECT status, cancelled_at, cancellation_reason INTO v_regst, v_cancelled_at, v_reason
    FROM registrations WHERE id = v_reg;
  IF v_regst <> 'confirmed' OR v_cancelled_at IS NOT NULL OR v_reason IS NOT NULL THEN
    RAISE EXCEPTION 'S9 FAIL: rescued registration=% cancelled_at=% reason=% (expected confirmed/NULL/NULL)',
      v_regst, v_cancelled_at, v_reason;
  END IF;
  RAISE NOTICE 'S9 PASS — late paid rescue clears cancelled_at and the reason';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
