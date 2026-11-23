-- =============================================================================
-- Regression test: the payer and the participant are kept apart (#708).
--
-- registrations.user_id is the participant; payments.user_id is the payer.
-- Today the checkout passes the same person as both, but a guardian or helper
-- (#705) will pay for someone else, and a refund or a handover (#720) must
-- follow the money, not the seat.
--
-- Covers:
--   P1  create_registration_with_payment with a separate payer puts the
--       participant on the registration and the payer on the payment
--   P2  without p_payer_user_id the participant pays, as before
--   P3  start_new_payment_attempt books the new attempt to whoever retries,
--       and the superseded attempt keeps its own payer
--   P4  a settled refund's ledger row names the payer of the refunded payment
--   P5  payments.user_id is documented as the payer
--   P6  the admin's stuck-refunds list names the payer, who is owed the money
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs, so it builds throwaway
-- fixtures and persists NOTHING. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org         uuid;
  v_tournament  uuid;
  v_player      uuid;
  v_guardian    uuid;
  v_helper      uuid;
  v_solo        uuid;
  v_res         jsonb;
  v_reg         uuid;
  v_pay         uuid;
  v_pay2        uuid;
  v_solo_reg    uuid;
  v_solo_pay    uuid;
  v_refund      uuid;
  v_gross       integer;
  v_reg_user    uuid;
  v_pay_user    uuid;
  v_comment     text;
  v_kid         uuid;
  v_kid_reg     uuid;
  v_kid_pay     uuid;
  v_row         record;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('PAYER ORG') RETURNING id INTO v_org;
  INSERT INTO users (email, first_name, last_name)
    VALUES ('payer-player@test.local', 'Pat', 'Player') RETURNING id INTO v_player;
  INSERT INTO users (email, first_name, last_name)
    VALUES ('payer-guardian@test.local', 'Gail', 'Guardian') RETURNING id INTO v_guardian;
  INSERT INTO users (email, first_name, last_name)
    VALUES ('payer-helper@test.local', 'Hal', 'Helper') RETURNING id INTO v_helper;
  INSERT INTO users (email, first_name, last_name)
    VALUES ('payer-solo@test.local', 'Sol', 'Solo') RETURNING id INTO v_solo;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'PAYER T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  -- ===== P1 ===============================================================
  v_res := create_registration_with_payment(
    v_player, v_tournament, 'standard', 4000, p_payer_user_id => v_guardian);
  v_reg := (v_res->>'registration_id')::uuid;
  v_pay := (v_res->>'payment_id')::uuid;

  SELECT user_id INTO v_reg_user FROM registrations WHERE id = v_reg;
  SELECT user_id INTO v_pay_user FROM payments WHERE id = v_pay;
  IF v_reg_user IS DISTINCT FROM v_player THEN
    RAISE EXCEPTION 'P1 FAIL: registration belongs to % (expected the participant %)', v_reg_user, v_player;
  END IF;
  IF v_pay_user IS DISTINCT FROM v_guardian THEN
    RAISE EXCEPTION 'P1 FAIL: payment belongs to % (expected the payer %)', v_pay_user, v_guardian;
  END IF;
  RAISE NOTICE 'P1 PASS — participant on the registration, payer on the payment';

  -- ===== P2 ===============================================================
  v_res := create_registration_with_payment(v_solo, v_tournament, 'standard', 4000);
  v_solo_reg := (v_res->>'registration_id')::uuid;
  v_solo_pay := (v_res->>'payment_id')::uuid;

  SELECT user_id INTO v_reg_user FROM registrations WHERE id = v_solo_reg;
  SELECT user_id INTO v_pay_user FROM payments WHERE id = v_solo_pay;
  IF v_reg_user IS DISTINCT FROM v_solo OR v_pay_user IS DISTINCT FROM v_solo THEN
    RAISE EXCEPTION 'P2 FAIL: registration % / payment % (expected both %)', v_reg_user, v_pay_user, v_solo;
  END IF;
  RAISE NOTICE 'P2 PASS — with no payer given, the participant pays';

  -- ===== P3 ===============================================================
  PERFORM settle_registration_payment(v_pay, false, NULL);
  v_res := start_new_payment_attempt(v_reg, 'standard', 4000, p_payer_user_id => v_helper);
  v_pay2 := (v_res->>'payment_id')::uuid;

  SELECT user_id INTO v_pay_user FROM payments WHERE id = v_pay2;
  IF v_pay_user IS DISTINCT FROM v_helper THEN
    RAISE EXCEPTION 'P3 FAIL: retry payment belongs to % (expected the retrying payer %)', v_pay_user, v_helper;
  END IF;
  SELECT user_id INTO v_pay_user FROM payments WHERE id = v_pay;
  IF v_pay_user IS DISTINCT FROM v_guardian THEN
    RAISE EXCEPTION 'P3 FAIL: superseded payment now belongs to % (expected %)', v_pay_user, v_guardian;
  END IF;
  SELECT user_id INTO v_reg_user FROM registrations WHERE id = v_reg;
  IF v_reg_user IS DISTINCT FROM v_player THEN
    RAISE EXCEPTION 'P3 FAIL: registration moved to % (expected the participant %)', v_reg_user, v_player;
  END IF;
  RAISE NOTICE 'P3 PASS — a retry is paid by whoever retries';

  -- ===== P4 ===============================================================
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay2;
  PERFORM settle_registration_payment(v_pay2, true, v_gross, 'fpx_b2c');

  INSERT INTO refunds (registration_id, refund_amount_cents, reason)
    VALUES (v_reg, v_gross, 'tournament_cancelled')
    RETURNING id INTO v_refund;
  PERFORM settle_refund(v_refund, 'chip-refund-payer', true, 'fpx_b2c');

  SELECT user_id INTO v_pay_user
  FROM payments WHERE registration_id = v_reg AND type = 'refund';
  IF v_pay_user IS DISTINCT FROM v_helper THEN
    RAISE EXCEPTION 'P4 FAIL: refund ledger row belongs to % (expected the payer %)', v_pay_user, v_helper;
  END IF;
  RAISE NOTICE 'P4 PASS — the refund goes back to the payer';

  -- ===== P5 ===============================================================
  SELECT col_description('payments'::regclass, attnum) INTO v_comment
  FROM pg_attribute
  WHERE attrelid = 'payments'::regclass AND attname = 'user_id';
  IF v_comment IS NULL OR v_comment NOT ILIKE '%payer%' THEN
    RAISE EXCEPTION 'P5 FAIL: payments.user_id comment is %', coalesce(v_comment, 'missing');
  END IF;
  RAISE NOTICE 'P5 PASS — payments.user_id is documented as the payer';

  -- ===== P6 ===============================================================
  INSERT INTO users (email, first_name, last_name)
    VALUES ('payer-kid@test.local', 'Kit', 'Kid') RETURNING id INTO v_kid;
  v_res := create_registration_with_payment(
    v_kid, v_tournament, 'standard', 4000, p_payer_user_id => v_guardian);
  v_kid_reg := (v_res->>'registration_id')::uuid;
  v_kid_pay := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_kid_pay, true, v_gross, 'fpx_b2c');

  INSERT INTO refunds (registration_id, refund_amount_cents, reason, requested_at)
    VALUES (v_kid_reg, v_gross, 'tournament_cancelled', now() - interval '1 hour')
    RETURNING id INTO v_refund;

  SELECT * INTO v_row FROM list_stuck_refunds(interval '10 minutes') WHERE refund_id = v_refund;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P6 FAIL: the stuck refund is not listed';
  END IF;
  IF v_row.payer_email IS DISTINCT FROM 'payer-guardian@test.local'
     OR v_row.payer_name IS DISTINCT FROM 'Gail Guardian' THEN
    RAISE EXCEPTION 'P6 FAIL: stuck refund names % <%> (expected the payer Gail Guardian)',
      v_row.payer_name, v_row.payer_email;
  END IF;
  RAISE NOTICE 'P6 PASS — a stuck refund names the payer';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
