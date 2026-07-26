-- =============================================================================
-- DB money-state regression test for the tournament-cancellation refund flow:
--   * review_tournament_cancellation (003_functions_triggers.sql) queuing a
--     pending refund per confirmed+paid registration on approve
--   * settle_refund (007_payment_functions.sql) booking the type='refund' ledger
--     row and stamping the refund (idempotent, "already processed" no-op)
--   * the uniq_active_refund_per_registration guard (002_indexes.sql)
--   * tournament_payout_summary reversing a fully-refunded tournament to zero
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. The whole thing runs inside a transaction that
-- ROLLBACKs at the end, so it builds throwaway fixtures and persists NOTHING.
-- A failing assertion RAISEs an exception (and rolls back); on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
--
-- Pricing: entry RM100 (10000c), commission_rate 10, organizer_commission_pct 0
-- => a paid registration is gross 11000 / fee 1000 / net 10000 (table defaults).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org       uuid;
  v_tournament uuid;
  v_admin     uuid;
  v_user_a uuid; v_user_b uuid; v_user_c uuid; v_user_d uuid;
  v_res     jsonb;
  v_reg_a uuid; v_reg_b uuid; v_reg_c uuid; v_reg_d uuid;
  v_pay_a uuid; v_pay_b uuid;
  v_gross   integer;
  v_request uuid;
  v_refund_a uuid; v_refund_b uuid;
  v_src     payments;
  v_ledger  payments;
  v_count   integer;
  v_amount  integer;
  v_status  text;
  v_reason  text;
  v_reqby   uuid;
  v_tstatus text;
  v_row     tournament_payout_summary%ROWTYPE;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('REFUND ORG') RETURNING id INTO v_org;
  INSERT INTO users (email, first_name, last_name) VALUES ('refund-admin@test.local','Ad','T') RETURNING id INTO v_admin;
  INSERT INTO users (email, first_name, last_name) VALUES ('refund-a@test.local','A','T') RETURNING id INTO v_user_a;
  INSERT INTO users (email, first_name, last_name) VALUES ('refund-b@test.local','B','T') RETURNING id INTO v_user_b;
  INSERT INTO users (email, first_name, last_name) VALUES ('refund-c@test.local','C','T') RETURNING id INTO v_user_c;
  INSERT INTO users (email, first_name, last_name) VALUES ('refund-d@test.local','D','T') RETURNING id INTO v_user_d;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'REFUND T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  -- A, B: confirmed (paid) — must be refunded.
  v_res := create_registration_with_payment(v_user_a, v_tournament, 'standard', 10000);
  v_reg_a := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;
  PERFORM settle_registration_payment(v_pay_a, true, v_gross, 'fpx_b2c');

  v_res := create_registration_with_payment(v_user_b, v_tournament, 'standard', 10000);
  v_reg_b := (v_res->>'registration_id')::uuid;
  v_pay_b := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay_b, true, v_gross, 'visa');

  -- C: pending_payment (never settled) — no money, no refund.
  v_res := create_registration_with_payment(v_user_c, v_tournament, 'standard', 10000);
  v_reg_c := (v_res->>'registration_id')::uuid;

  -- D: failed_payment — no refund.
  v_res := create_registration_with_payment(v_user_d, v_tournament, 'standard', 10000);
  v_reg_d := (v_res->>'registration_id')::uuid;
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, false, NULL);

  -- The organizer's cancellation request the admin will approve.
  INSERT INTO tournament_cancellation_requests (tournament_id, requested_by, reason)
    VALUES (v_tournament, v_user_a, 'Venue fell through')
    RETURNING id INTO v_request;

  -- ===== R1: approve queues one pending refund per confirmed+paid reg =======
  PERFORM review_tournament_cancellation(v_request, v_admin, 'approve', NULL);

  SELECT status INTO v_tstatus FROM tournaments WHERE id = v_tournament;
  IF v_tstatus <> 'cancelled' THEN
    RAISE EXCEPTION 'R1 FAIL: tournament status=% (expected cancelled)', v_tstatus;
  END IF;

  SELECT count(*) INTO v_count FROM refunds WHERE registration_id IN (v_reg_a, v_reg_b, v_reg_c, v_reg_d);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'R1 FAIL: refund count=% (expected 2 — only confirmed+paid A,B)', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM refunds WHERE registration_id IN (v_reg_c, v_reg_d)) THEN
    RAISE EXCEPTION 'R1 FAIL: refund created for a non-paid registration';
  END IF;

  SELECT id INTO v_refund_a FROM refunds WHERE registration_id = v_reg_a;
  SELECT id INTO v_refund_b FROM refunds WHERE registration_id = v_reg_b;

  SELECT refund_amount_cents, status, reason, requested_by
    INTO v_amount, v_status, v_reason, v_reqby
  FROM refunds WHERE id = v_refund_a;
  IF v_amount <> 11000 THEN
    RAISE EXCEPTION 'R1 FAIL: refund_amount_cents=% (expected 11000 gross)', v_amount;
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'R1 FAIL: refund status=% (expected pending)', v_status;
  END IF;
  IF v_reason <> 'tournament_cancelled' THEN
    RAISE EXCEPTION 'R1 FAIL: refund reason=% (expected tournament_cancelled)', v_reason;
  END IF;
  IF v_reqby <> v_admin THEN
    RAISE EXCEPTION 'R1 FAIL: refund requested_by=% (expected reviewing admin %)', v_reqby, v_admin;
  END IF;
  RAISE NOTICE 'R1 PASS — approve queued full pending refunds for paid players only';

  -- ===== R2: settle_refund books the mirrored paid ledger row ================
  v_res := settle_refund(v_refund_a, 'chip-refund-a', true, 'fpx_b2c');
  IF (v_res->>'settled')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'R2 FAIL: expected settled=true, got %', v_res;
  END IF;

  SELECT * INTO v_src FROM payments WHERE id = v_pay_a;
  SELECT * INTO v_ledger FROM payments
    WHERE registration_id = v_reg_a AND type = 'refund' AND status = 'paid';
  IF v_ledger.gross_amount_cents <> v_src.gross_amount_cents
     OR v_ledger.platform_fee_cents <> v_src.platform_fee_cents
     OR v_ledger.organizer_commission_cents <> v_src.organizer_commission_cents
     OR v_ledger.player_commission_cents <> v_src.player_commission_cents
     OR v_ledger.net_amount_cents <> v_src.net_amount_cents THEN
    RAISE EXCEPTION 'R2 FAIL: refund ledger amounts do not mirror the registration payment';
  END IF;
  IF v_ledger.chip_transaction_id <> 'chip-refund-a' OR v_ledger.paid_at IS NULL THEN
    RAISE EXCEPTION 'R2 FAIL: refund ledger chip id / paid_at not set';
  END IF;

  SELECT status INTO v_status FROM refunds WHERE id = v_refund_a;
  IF v_status <> 'approved'
     OR (SELECT processed_at FROM refunds WHERE id = v_refund_a) IS NULL
     OR (SELECT chip_refund_id FROM refunds WHERE id = v_refund_a) <> 'chip-refund-a' THEN
    RAISE EXCEPTION 'R2 FAIL: refund not stamped approved/processed/chip_refund_id';
  END IF;
  RAISE NOTICE 'R2 PASS — settle booked a mirrored paid refund ledger row';

  -- ===== R3: settle_refund is idempotent (no duplicate ledger row) ==========
  v_res := settle_refund(v_refund_a, 'chip-refund-a-DUP', true, NULL);
  IF (v_res->>'already_processed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'R3 FAIL: expected already_processed=true, got %', v_res;
  END IF;
  SELECT count(*) INTO v_count FROM payments WHERE registration_id = v_reg_a AND type = 'refund';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'R3 FAIL: refund payment rows=% (expected 1 — no duplicate)', v_count;
  END IF;
  RAISE NOTICE 'R3 PASS — duplicate settle is an idempotent no-op';

  -- ===== R4: a refund failure books no ledger row, stays pending ============
  v_res := settle_refund(v_refund_b, 'chip-refund-b', false, NULL);
  IF (v_res->>'settled')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'R4 FAIL: expected settled=false, got %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM payments WHERE registration_id = v_reg_b AND type = 'refund') THEN
    RAISE EXCEPTION 'R4 FAIL: a failed refund must not book a ledger row';
  END IF;
  SELECT status INTO v_status FROM refunds WHERE id = v_refund_b;
  IF v_status <> 'pending' OR (SELECT processed_at FROM refunds WHERE id = v_refund_b) IS NOT NULL THEN
    RAISE EXCEPTION 'R4 FAIL: failed refund should stay pending/unprocessed';
  END IF;
  RAISE NOTICE 'R4 PASS — refund failure left pending for retry';

  -- ===== R5: retry after failure settles; payout summary nets to zero ========
  PERFORM settle_refund(v_refund_b, 'chip-refund-b2', true, 'visa');
  SELECT * INTO v_row FROM tournament_payout_summary WHERE tournament_id = v_tournament;
  IF v_row.net_revenue_cents <> 0 THEN
    RAISE EXCEPTION 'R5 FAIL: net_revenue_cents=% (expected 0 — both regs fully refunded)', v_row.net_revenue_cents;
  END IF;
  IF v_row.effective_platform_fee_cents <> 0 THEN
    RAISE EXCEPTION 'R5 FAIL: effective_platform_fee_cents=% (expected 0 — fees returned)', v_row.effective_platform_fee_cents;
  END IF;
  IF v_row.total_refunded_cents <> 22000 THEN
    RAISE EXCEPTION 'R5 FAIL: total_refunded_cents=% (expected 22000)', v_row.total_refunded_cents;
  END IF;
  RAISE NOTICE 'R5 PASS — retried refund settled; payout summary reversed to zero';

  -- ===== R6: uniq_active_refund_per_registration blocks a second live refund =
  BEGIN
    INSERT INTO refunds (registration_id, refund_amount_cents, reason, status, requested_by)
      VALUES (v_reg_b, 11000, 'dup', 'pending', v_user_b);
    RAISE EXCEPTION 'R6 FAIL: a second live refund for one registration was allowed';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'R6 PASS — duplicate active refund rejected (23505)';
  END;

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
