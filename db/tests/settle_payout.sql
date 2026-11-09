-- =============================================================================
-- DB money-state regression test for organizer payouts (#520):
--   * available_payout_cents, queue_payout, settle_payout (007_payment_functions.sql)
--   * the payouts unique indexes (002_indexes.sql)
--   * tournament_payout_summary draining on a settled payout
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations and seed. The whole thing runs inside a transaction that
-- ROLLBACKs at the end, so it builds throwaway fixtures and persists NOTHING. A
-- failing assertion RAISEs an exception (and rolls back); on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
--
-- Pricing: entry RM100 (10000c), commission_rate 10, organizer_commission_pct 0
-- => a paid registration is gross 11000 / fee 1000 / net 10000 (table defaults).
-- =============================================================================

BEGIN;

-- A tournament with a declared RM500 prize pool and one paid registration (net 10000).
CREATE FUNCTION pg_temp.paid_tournament(p_org uuid, p_player uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_t   uuid;
  v_res jsonb;
BEGIN
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, prizes, max_participants, status
  ) VALUES (
    p_org, 'PAYOUT T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}',
    '{"categories": [{"name": "Open", "funding": {"source": "sponsor", "funder_name": "Acme"}, "entries": [{"place": "1st", "amount_cents": 50000}]}], "special": [], "distribution": "organizer"}',
    100, 'published'
  ) RETURNING id INTO v_t;

  v_res := create_registration_with_payment(p_player, v_t, 'standard', 10000);
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, true, 11000);
  RETURN v_t;
END $$;

DO $$
DECLARE
  v_owner_role integer;
  v_org   uuid;
  v_ben   uuid;
  v_org_owner uuid;  v_org_owner_auth uuid := gen_random_uuid();
  v_ben_owner uuid;
  v_player uuid;
  v_player2 uuid;
  v_t     uuid;
  v_id    uuid;
  v_id2   uuid;
  v_res   jsonb;
  v_reg   uuid;
  v_refund uuid;
  v_req   uuid;
  v_count integer;
  v_row   tournament_payout_summary%ROWTYPE;
  v_po    payouts;
  v_ledger payments;
BEGIN
  SELECT id INTO v_owner_role FROM roles WHERE name = 'owner' AND scope = 'organization';

  INSERT INTO users (id, auth_user_id, email, first_name, last_name)
    VALUES (v_org_owner_auth, v_org_owner_auth, 'po-owner@test.local', 'O', 'T') RETURNING id INTO v_org_owner;
  INSERT INTO users (email, first_name, last_name) VALUES ('po-ben@test.local', 'B', 'T') RETURNING id INTO v_ben_owner;
  INSERT INTO users (email, first_name, last_name) VALUES ('po-player@test.local', 'P', 'T') RETURNING id INTO v_player;
  INSERT INTO users (email, first_name, last_name) VALUES ('po-player2@test.local', 'Q', 'T') RETURNING id INTO v_player2;

  INSERT INTO organizations (name, email, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('PO ORG', 'org@test.local', 'company', current_organizer_agreement_version(), now(), 'approved') RETURNING id INTO v_org;
  INSERT INTO organizations (name, email, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('PO BEN', 'ben@test.local', 'society', current_organizer_agreement_version(), now(), 'approved') RETURNING id INTO v_ben;

  INSERT INTO organization_bank_accounts (organization_id, bank_name, bank_code, account_holder, account_number, status, chip_bank_account_id, verified_at)
    VALUES (v_org, 'Maybank', 'MBBEMYKL', 'Org', '514100000001', 'verified', 920001, now()),
           (v_ben, 'Maybank', 'MBBEMYKL', 'Ben', '514100000002', 'verified', 920002, now());

  INSERT INTO organization_memberships (organization_id, user_id, role_id) VALUES
    (v_org, v_org_owner, v_owner_role),
    (v_ben, v_ben_owner, v_owner_role);

  -- ===== 1: available = net payout, unaffected by a declared prize pool =====
  v_t := pg_temp.paid_tournament(v_org, v_player);
  -- The pool is declared on the tournament above; here it is also funded and part-paid.
  INSERT INTO payments (type, tournament_id, organization_id, gross_amount_cents, net_amount_cents, status)
    VALUES ('prize_funding', v_t, v_org, 500000, 500000, 'paid'),
           ('player_prize',  v_t, v_org,   3000,   3000, 'paid');

  SELECT * INTO v_row FROM tournament_payout_summary WHERE tournament_id = v_t;
  IF v_row.net_payout_cents <> 10000 THEN
    RAISE EXCEPTION '1 FAIL: net_payout_cents=% (expected 10000; prizes must not reduce it)', v_row.net_payout_cents;
  END IF;
  IF available_payout_cents(v_t) <> 10000 THEN
    RAISE EXCEPTION '1 FAIL: available=% (expected 10000)', available_payout_cents(v_t);
  END IF;
  RAISE NOTICE '1 PASS — available equals net payout; prize money does not touch it';

  -- ===== 2: an in-flight payout reserves available, not net_payout ===========
  v_id := queue_payout(v_t, 'automatic', 4000, v_org_owner);
  IF available_payout_cents(v_t) <> 6000 THEN
    RAISE EXCEPTION '2 FAIL: available=% (expected 6000 with 4000 in flight)', available_payout_cents(v_t);
  END IF;
  IF available_payout_cents(v_t, v_id) <> 10000 THEN
    RAISE EXCEPTION '2 FAIL: available excluding self=% (expected 10000)', available_payout_cents(v_t, v_id);
  END IF;
  SELECT * INTO v_row FROM tournament_payout_summary WHERE tournament_id = v_t;
  IF v_row.net_payout_cents <> 10000 THEN
    RAISE EXCEPTION '2 FAIL: net_payout_cents=% (a pending payout must not move it)', v_row.net_payout_cents;
  END IF;
  RAISE NOTICE '2 PASS — in-flight payout reserves available only';

  -- ===== 3: settling books one ledger row and drains the balance =============
  UPDATE payouts SET amount_cents = 10000 WHERE id = v_id;
  v_res := settle_payout(v_id, 5001, true, 10000, 'https://receipt.test/1', NULL);
  IF (v_res->>'over_payout')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION '3 FAIL: unexpected over_payout: %', v_res;
  END IF;
  SELECT count(*) INTO v_count FROM payments WHERE tournament_id = v_t AND type = 'organizer_payout';
  IF v_count <> 1 THEN RAISE EXCEPTION '3 FAIL: ledger rows=% (expected 1)', v_count; END IF;

  SELECT * INTO v_ledger FROM payments WHERE tournament_id = v_t AND type = 'organizer_payout';
  IF v_ledger.gross_amount_cents <> 10000 OR v_ledger.net_amount_cents <> 10000
     OR v_ledger.platform_fee_cents <> 0 OR v_ledger.organizer_commission_cents <> 0
     OR v_ledger.player_commission_cents <> 0 THEN
    RAISE EXCEPTION '3 FAIL: ledger amounts wrong: gross=% net=% fee=%',
      v_ledger.gross_amount_cents, v_ledger.net_amount_cents, v_ledger.platform_fee_cents;
  END IF;
  IF v_ledger.chip_transaction_id <> 'send_5001' OR v_ledger.status <> 'paid'
     OR v_ledger.payment_method <> 'chip_send' OR v_ledger.user_id IS NOT NULL OR v_ledger.paid_at IS NULL THEN
    RAISE EXCEPTION '3 FAIL: ledger metadata wrong: chip=% status=%', v_ledger.chip_transaction_id, v_ledger.status;
  END IF;

  SELECT * INTO v_po FROM payouts WHERE id = v_id;
  IF v_po.status <> 'paid' OR v_po.payment_id <> v_ledger.id OR v_po.processed_at IS NULL
     OR v_po.settled_amount_cents <> 10000 OR v_po.chip_receipt_url <> 'https://receipt.test/1'
     OR v_po.chip_send_instruction_id <> 5001 THEN
    RAISE EXCEPTION '3 FAIL: payout not stamped correctly';
  END IF;

  SELECT * INTO v_row FROM tournament_payout_summary WHERE tournament_id = v_t;
  IF v_row.net_payout_cents <> 0 THEN
    RAISE EXCEPTION '3 FAIL: net_payout_cents=% (expected 0)', v_row.net_payout_cents;
  END IF;
  RAISE NOTICE '3 PASS — settle booked one ledger row and drained the balance';

  -- ===== 5: a duplicate settle is a no-op ====================================
  v_res := settle_payout(v_id, 5001, true, 10000, NULL, NULL);
  IF (v_res->>'already_processed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '5 FAIL: expected already_processed, got %', v_res;
  END IF;
  SELECT count(*) INTO v_count FROM payments WHERE tournament_id = v_t AND type = 'organizer_payout';
  IF v_count <> 1 THEN RAISE EXCEPTION '5 FAIL: ledger rows=% (expected 1)', v_count; END IF;
  RAISE NOTICE '5 PASS — duplicate settle is an idempotent no-op';

  -- ===== 4: with a beneficiary, the ledger row keeps the ORGANIZING org ======
  INSERT INTO users (email, first_name, last_name)
    SELECT 'po-p4@test.local', 'R', 'T' RETURNING id INTO v_player2;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'PO BEN T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical"}', '{"base_minutes":90}', '{"standard": {"amount_cents": 10000}}', 100, 'published'
  ) RETURNING id INTO v_t;
  PERFORM nominate_payout_beneficiary(v_t, v_ben, v_org_owner);
  PERFORM accept_payout_nomination(v_t, v_ben_owner);
  v_res := create_registration_with_payment(v_player2, v_t, 'standard', 10000);
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, true, 11000);

  v_id := queue_payout(v_t, 'automatic', NULL, v_org_owner);
  SELECT * INTO v_po FROM payouts WHERE id = v_id;
  IF v_po.organization_id <> v_org OR v_po.recipient_organization_id <> v_ben
     OR v_po.bank_account_id <> (SELECT id FROM organization_bank_accounts WHERE organization_id = v_ben) THEN
    RAISE EXCEPTION '4 FAIL: queue_payout did not route to the accepted beneficiary';
  END IF;
  PERFORM settle_payout(v_id, 5002, true, 10000, NULL, NULL);

  SELECT * INTO v_ledger FROM payments WHERE tournament_id = v_t AND type = 'organizer_payout';
  IF v_ledger.organization_id <> v_org THEN
    RAISE EXCEPTION '4 FAIL: ledger organization_id=% (expected the organizing org)', v_ledger.organization_id;
  END IF;
  SELECT count(*) INTO v_count FROM tournament_payout_summary WHERE tournament_id = v_t;
  IF v_count <> 1 THEN RAISE EXCEPTION '4 FAIL: view split into % groups', v_count; END IF;
  SELECT * INTO v_row FROM tournament_payout_summary WHERE tournament_id = v_t;
  IF v_row.net_payout_cents <> 0 THEN
    RAISE EXCEPTION '4 FAIL: net_payout_cents=% (the GROUP BY trap)', v_row.net_payout_cents;
  END IF;
  RAISE NOTICE '4 PASS — beneficiary paid, organizer balance still drains';

  -- ===== 6: a failed settle books nothing and is terminal ====================
  INSERT INTO users (email, first_name, last_name) VALUES ('po-p6@test.local', 'S', 'T') RETURNING id INTO v_player2;
  v_t := pg_temp.paid_tournament(v_org, v_player2);
  v_id := queue_payout(v_t, 'automatic', NULL, v_org_owner);
  v_res := settle_payout(v_id, 5003, false, NULL, NULL, 'send_instruction_rejected');
  SELECT * INTO v_po FROM payouts WHERE id = v_id;
  IF v_po.status <> 'failed' OR v_po.processed_at IS NULL
     OR v_po.failure_reason <> 'send_instruction_rejected' OR v_po.chip_send_instruction_id <> 5003 THEN
    RAISE EXCEPTION '6 FAIL: failed payout not stamped terminal';
  END IF;
  IF EXISTS (SELECT 1 FROM payments WHERE tournament_id = v_t AND type = 'organizer_payout') THEN
    RAISE EXCEPTION '6 FAIL: a failed payout booked a ledger row';
  END IF;
  SELECT * INTO v_row FROM tournament_payout_summary WHERE tournament_id = v_t;
  IF v_row.net_payout_cents <> 10000 OR available_payout_cents(v_t) <> 10000 THEN
    RAISE EXCEPTION '6 FAIL: failure should release the money: net=% available=%',
      v_row.net_payout_cents, available_payout_cents(v_t);
  END IF;
  -- A late `completed` for a written-off row books nothing but must raise the alarm.
  v_res := settle_payout(v_id, 5003, true, 10000, NULL, NULL);
  IF (v_res->>'already_processed')::boolean IS NOT TRUE OR (v_res->>'paid_after_failed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '6 FAIL: paid-after-failed not flagged: %', v_res;
  END IF;
  RAISE NOTICE '6 PASS — failure is terminal, books nothing, releases the money';

  -- ===== 8: one live automatic payout; a failed one may be re-queued =========
  -- v_id above failed, so a retry is a NEW row linked via superseded_by.
  v_id2 := queue_payout(v_t, 'automatic', NULL, v_org_owner);
  IF v_id2 IS NULL OR v_id2 = v_id THEN
    RAISE EXCEPTION '8 FAIL: a failed automatic payout could not be re-queued as a new row';
  END IF;
  IF (SELECT superseded_by FROM payouts WHERE id = v_id) IS DISTINCT FROM v_id2 THEN
    RAISE EXCEPTION '8 FAIL: failed row not linked to its retry';
  END IF;
  -- queue_payout's own answer to a duplicate is NULL ...
  IF queue_payout(v_t, 'automatic', NULL, v_org_owner) IS NOT NULL THEN
    RAISE EXCEPTION '8 FAIL: a second live automatic payout was queued';
  END IF;
  -- ... and the index is the last line of defence against a hand-rolled insert.
  BEGIN
    INSERT INTO payouts (tournament_id, organization_id, recipient_organization_id, kind, amount_cents, approval)
      VALUES (v_t, v_org, v_org, 'automatic', 2000, 'approved');
    RAISE EXCEPTION '8 FAIL: a second live automatic payout was inserted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  RAISE NOTICE '8 PASS — uniq_automatic_payout_per_tournament holds; failed may re-queue';

  -- ===== 7: over_payout — refund to zero, then settle a stale in-flight payout
  -- v_id2 is in flight for 10000 when the only registration is fully refunded.
  SELECT r.id INTO v_reg FROM registrations r WHERE r.tournament_id = v_t;
  INSERT INTO refunds (registration_id, refund_amount_cents, reason, status)
    VALUES (v_reg, 11000, 'test', 'pending') RETURNING id INTO v_refund;
  PERFORM settle_refund(v_refund, 'chip-refund-po', true, NULL);

  SELECT * INTO v_row FROM tournament_payout_summary WHERE tournament_id = v_t;
  IF v_row.net_revenue_cents <> 0 THEN
    RAISE EXCEPTION '7 FAIL: precondition, net_revenue_cents=%', v_row.net_revenue_cents;
  END IF;
  v_res := settle_payout(v_id2, 5004, true, 10000, NULL, NULL);
  IF (v_res->>'over_payout')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION '7 FAIL: over_payout not flagged: %', v_res;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payments WHERE chip_transaction_id = 'send_5004' AND status = 'paid') THEN
    RAISE EXCEPTION '7 FAIL: the money left, but no ledger row was booked';
  END IF;
  RAISE NOTICE '7 PASS — over-payout flagged and still booked';

  -- ===== 9b: an unaccepted nomination doesn't redirect queue_payout ==========
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'PO PENDING NOM', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical"}', '{"base_minutes":90}', '{"standard": {"amount_cents": 10000}}', 100, 'published'
  ) RETURNING id INTO v_t;
  PERFORM nominate_payout_beneficiary(v_t, v_ben, v_org_owner);
  INSERT INTO users (email, first_name, last_name) VALUES ('po-p9@test.local', 'U', 'T') RETURNING id INTO v_player2;
  v_res := create_registration_with_payment(v_player2, v_t, 'standard', 10000);
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, true, 11000);
  v_id := queue_payout(v_t, 'automatic', NULL, v_org_owner);
  IF (SELECT recipient_organization_id FROM payouts WHERE id = v_id) <> v_org THEN
    RAISE EXCEPTION '9b FAIL: an unaccepted nomination redirected the payout';
  END IF;
  RAISE NOTICE '9b PASS — unaccepted nomination redirects nothing';

  -- ===== Q: queue_payout's refusals ==========================================
  INSERT INTO users (email, first_name, last_name) VALUES ('po-pq@test.local', 'V', 'T') RETURNING id INTO v_player2;
  v_t := pg_temp.paid_tournament(v_org, v_player2);

  -- An explicit amount above what is available is refused, not reduced (#560).
  BEGIN
    PERFORM queue_payout(v_t, 'automatic', 10001, v_org_owner);
    RAISE EXCEPTION 'Q FAIL: payout above the available balance queued';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PAYOUT_EXCEEDS_AVAILABLE: 10001 cents requested, 10000 cents is available%' THEN RAISE; END IF;
  END;

  -- Exactly what is available is fine.
  v_id := queue_payout(v_t, 'automatic', 10000, v_org_owner);
  IF (SELECT amount_cents FROM payouts WHERE id = v_id) <> 10000 THEN
    RAISE EXCEPTION 'Q FAIL: the full available amount was not queued as asked';
  END IF;
  DELETE FROM payouts WHERE id = v_id;

  BEGIN
    PERFORM queue_payout(v_t, 'automatic', 999, v_org_owner);
    RAISE EXCEPTION 'Q FAIL: below-minimum payout queued';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PAYOUT_BELOW_MINIMUM%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM queue_payout(v_t, 'early', 2000, v_org_owner);
    RAISE EXCEPTION 'Q FAIL: an early payout went through queue_payout';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PAYOUT_KIND_UNSUPPORTED%' THEN RAISE; END IF;
  END;

  UPDATE organization_bank_accounts SET status = 'pending', verified_at = NULL WHERE organization_id = v_org;
  BEGIN
    PERFORM queue_payout(v_t, 'automatic', NULL, v_org_owner);
    RAISE EXCEPTION 'Q FAIL: payout queued to an unverified bank account';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PAYOUT_RECIPIENT_INELIGIBLE: bank_account_not_verified%' THEN RAISE; END IF;
  END;
  -- A bad amount is the admin's own mistake, so it is reported before the recipient's.
  BEGIN
    PERFORM queue_payout(v_t, 'automatic', 10001, v_org_owner);
    RAISE EXCEPTION 'Q FAIL: payout above the available balance queued';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PAYOUT_EXCEEDS_AVAILABLE%' THEN RAISE; END IF;
  END;
  UPDATE organization_bank_accounts SET status = 'verified', verified_at = now() WHERE organization_id = v_org;

  UPDATE organizations SET agreement_version = '2020-01-01' WHERE id = v_org;
  BEGIN
    PERFORM queue_payout(v_t, 'automatic', NULL, v_org_owner);
    RAISE EXCEPTION 'Q FAIL: payout queued on a stale agreement';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PAYOUT_RECIPIENT_INELIGIBLE: agreement_not_current%' THEN RAISE; END IF;
  END;
  UPDATE organizations SET agreement_version = current_organizer_agreement_version() WHERE id = v_org;

  INSERT INTO tournament_cancellation_requests (tournament_id, requested_by, reason)
    VALUES (v_t, v_org_owner, 'Venue fell through') RETURNING id INTO v_req;
  BEGIN
    PERFORM queue_payout(v_t, 'automatic', NULL, v_org_owner);
    RAISE EXCEPTION 'Q FAIL: payout queued during a pending cancellation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PAYOUT_BLOCKED: cancellation_pending%' THEN RAISE; END IF;
  END;
  DELETE FROM tournament_cancellation_requests WHERE id = v_req;

  SELECT r.id INTO v_reg FROM registrations r WHERE r.tournament_id = v_t;
  INSERT INTO refunds (registration_id, refund_amount_cents, reason, status)
    VALUES (v_reg, 11000, 'test', 'pending') RETURNING id INTO v_refund;
  BEGIN
    PERFORM queue_payout(v_t, 'automatic', NULL, v_org_owner);
    RAISE EXCEPTION 'Q FAIL: payout queued with a live refund outstanding';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PAYOUT_BLOCKED: refund_pending%' THEN RAISE; END IF;
  END;
  DELETE FROM refunds WHERE id = v_refund;

  UPDATE tournaments SET status = 'cancelled' WHERE id = v_t;
  BEGIN
    PERFORM queue_payout(v_t, 'automatic', NULL, v_org_owner);
    RAISE EXCEPTION 'Q FAIL: payout queued on a cancelled tournament';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'PAYOUT_BLOCKED: tournament_cancelled%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'Q PASS — every queue_payout refusal holds';

  -- ===== R: the read helpers ================================================
  -- Overview: an organizer sees its own; a beneficiary sees only what it accepted.
  INSERT INTO users (email, first_name, last_name) VALUES ('po-pr@test.local', 'W', 'T') RETURNING id INTO v_player2;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'PO READ T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical"}', '{"base_minutes":90}', '{"standard": {"amount_cents": 10000}}', 100, 'published'
  ) RETURNING id INTO v_id2;
  PERFORM nominate_payout_beneficiary(v_id2, v_ben, v_org_owner);

  IF NOT EXISTS (SELECT 1 FROM list_pending_payout_nominations(v_ben) n WHERE n.tournament_id = v_id2) THEN
    RAISE EXCEPTION 'R FAIL: pending nomination not listed for the nominee';
  END IF;
  IF EXISTS (SELECT 1 FROM list_organization_payout_overview(v_ben) o WHERE o.tournament_id = v_id2) THEN
    RAISE EXCEPTION 'R FAIL: an unaccepted nomination exposed the tournament to the nominee';
  END IF;

  PERFORM accept_payout_nomination(v_id2, v_ben_owner);
  IF EXISTS (SELECT 1 FROM list_pending_payout_nominations(v_ben) n WHERE n.tournament_id = v_id2) THEN
    RAISE EXCEPTION 'R FAIL: an accepted nomination is still listed as pending';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM list_organization_payout_overview(v_ben) o
    WHERE o.tournament_id = v_id2 AND o.is_beneficiary AND o.recipient_organization_id = v_ben
  ) THEN
    RAISE EXCEPTION 'R FAIL: the beneficiary cannot see the tournament it accepted';
  END IF;

  v_res := create_registration_with_payment(v_player2, v_id2, 'standard', 10000);
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, true, 11000);
  IF (SELECT o.available_cents FROM list_organization_payout_overview(v_org) o WHERE o.tournament_id = v_id2) <> 10000 THEN
    RAISE EXCEPTION 'R FAIL: overview available_cents wrong';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM list_admin_payout_candidates() c
    WHERE c.tournament_id = v_id2 AND c.available_cents = 10000 AND c.is_beneficiary
      AND c.block_reason IS NULL AND c.recipient_problem IS NULL
  ) THEN
    RAISE EXCEPTION 'R FAIL: payable tournament missing from the admin candidates';
  END IF;

  -- A live automatic payout takes it off the list.
  PERFORM queue_payout(v_id2, 'automatic', NULL, v_org_owner);
  IF EXISTS (SELECT 1 FROM list_admin_payout_candidates() c WHERE c.tournament_id = v_id2) THEN
    RAISE EXCEPTION 'R FAIL: a tournament with a live automatic payout is still a candidate';
  END IF;
  RAISE NOTICE 'R PASS — overview, nominations and admin candidates';

  -- ===== W: clients have no write path to payouts ============================
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_org_owner_auth, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    INSERT INTO payouts (tournament_id, organization_id, recipient_organization_id, kind, amount_cents, approval)
      VALUES (v_t, v_org, v_org, 'automatic', 2000, 'approved');
    RAISE EXCEPTION 'W FAIL: an org owner inserted a payout directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '{}', true);
  RAISE NOTICE 'W PASS — org owner cannot insert a payout through PostgREST';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
