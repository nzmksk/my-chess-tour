-- =============================================================================
-- DB money-state regression test for the platform-managed prize pool (#523):
--   * prize_pool_position, available_prize_pool_cents, declared_prize_total_cents
--   * the registration gate (prize_pool_blocks_registration, enforced inside
--     create_registration_with_payment)
--   * settle_prize_funding: partial funding from several sponsors, idempotency,
--     the amount guard, "real money wins"
--   * enter_prize_award, review_prize_award (the sum guard), claim_prize_award_send,
--     settle_prize_award (idempotent, one player_prize ledger row)
--   * prize money never moving net_payout_cents
--   * set_player_bank_account and the player branch of
--     settle_bank_account_verification
--   * no client writes on the new tables
--
-- The concurrent-approval case of the sum guard needs two sessions; it is in
-- db/tests/prize_award_review_race.sql.
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. The whole thing runs inside a transaction that
-- ROLLBACKs at the end, so it builds throwaway fixtures and persists NOTHING. A
-- failing assertion RAISEs (and rolls back); on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
--
-- Pricing: entry RM100 (10000c), commission_rate 10, organizer_commission_pct 0
-- => a paid registration is gross 11000 / fee 1000 / net 10000 (table defaults).
-- Prizes on the platform tournament: Open 1st RM300, Open 2nd RM150, special
-- "Best Junior" RM50 => RM500 (50000c) declared.
-- =============================================================================

BEGIN;

CREATE FUNCTION pg_temp.make_tournament(
  p_org uuid, p_name text, p_distribution text, p_days_from_now integer
) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_t uuid;
BEGIN
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, prizes, max_participants, status
  ) VALUES (
    p_org, p_name, 'Venue', 'Selangor', 'Address',
    current_date + p_days_from_now, current_date + p_days_from_now + 1,
    (current_date + p_days_from_now)::timestamptz - interval '1 day',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}',
    jsonb_build_object(
      'categories', jsonb_build_array(jsonb_build_object(
        'name', 'Open',
        'funding', jsonb_build_object('source', 'sponsor', 'funder_name', 'Acme'),
        'entries', jsonb_build_array(
          jsonb_build_object('place', '1st', 'amount_cents', 30000),
          jsonb_build_object('place', '2nd', 'amount_cents', 15000)))),
      'special', jsonb_build_array(jsonb_build_object(
        'name', 'Best Junior',
        'funding', jsonb_build_object('source', 'grant', 'funder_name', 'Ministry'),
        'amount_cents', 5000)),
      'distribution', p_distribution),
    100, 'published'
  ) RETURNING id INTO v_t;
  RETURN v_t;
END $$;

CREATE FUNCTION pg_temp.register_paid(p_player uuid, p_t uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_res jsonb;
BEGIN
  v_res := create_registration_with_payment(p_player, p_t, 'standard', 10000);
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, true, 11000);
END $$;

-- Runs a statement and returns the error it raised, or NULL if it didn't.
CREATE FUNCTION pg_temp.error_of(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

DO $$
DECLARE
  v_owner_role integer;
  v_org     uuid;
  v_admin   uuid;
  v_p       uuid[];
  v_outsider uuid;
  v_t       uuid;   -- platform-distributed, finished
  v_t0      uuid;   -- organizer-distributed, finished
  v_t2      uuid;   -- platform-distributed, not finished
  v_t3      uuid;   -- platform-distributed, never funded
  v_fund_a  uuid;
  v_fund_b  uuid;
  v_award1  uuid;
  v_award2  uuid;
  v_award3  uuid;
  v_award4  uuid;
  v_award5  uuid;
  v_bank1   uuid;
  v_bank2   uuid;
  v_drain   uuid;
  v_res     jsonb;
  v_err     text;
  v_count   integer;
  v_text    text;
  v_pos     record;
  v_sum     tournament_payout_summary%ROWTYPE;
  v_net_before integer;
  v_award   prize_awards;
  v_ledger  payments;
  v_auth    uuid := gen_random_uuid();
BEGIN
  SELECT id INTO v_owner_role FROM roles WHERE name = 'owner' AND scope = 'organization';

  INSERT INTO users (email, first_name, last_name) VALUES ('pp-admin@test.local', 'A', 'T') RETURNING id INTO v_admin;
  WITH ins AS (
    INSERT INTO users (email, first_name, last_name)
    SELECT format('pp-player-%s@test.local', i), 'P' || i, 'T' FROM generate_series(1, 4) i
    RETURNING id, email
  )
  SELECT array_agg(id ORDER BY email) INTO v_p FROM ins;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_auth, 'pp-outsider@test.local', 'O', 'T') RETURNING id INTO v_outsider;

  INSERT INTO organizations (name, email, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('PP ORG', 'pp-org@test.local', 'company', current_organizer_agreement_version(), now(), 'approved')
    RETURNING id INTO v_org;
  INSERT INTO organization_memberships (organization_id, user_id, role_id) VALUES (v_org, v_admin, v_owner_role);

  v_t  := pg_temp.make_tournament(v_org, 'PP PLATFORM',  'platform',  -3);
  v_t0 := pg_temp.make_tournament(v_org, 'PP ORGANIZER', 'organizer', -3);
  v_t2 := pg_temp.make_tournament(v_org, 'PP FUTURE',    'platform',  20);
  v_t3 := pg_temp.make_tournament(v_org, 'PP UNFUNDED',  'platform',  -3);

  -- ===== G1: the registration gate ===========================================
  IF declared_prize_total_cents((SELECT prizes FROM tournaments WHERE id = v_t)) <> 50000 THEN
    RAISE EXCEPTION 'G1 FAIL: declared total=% (expected 50000)',
      declared_prize_total_cents((SELECT prizes FROM tournaments WHERE id = v_t));
  END IF;
  IF declared_prize_total_cents(NULL) <> 0
     OR declared_prize_total_cents('{"categories": [{"entries": [{"amount_cents": "100"}]}]}') <> 0 THEN
    RAISE EXCEPTION 'G1 FAIL: a missing or non-numeric prize document must total 0';
  END IF;

  SELECT * INTO v_pos FROM prize_pool_position(v_t);
  IF v_pos.fully_funded OR v_pos.declared_cents <> 50000 OR v_pos.funded_cents <> 0 THEN
    RAISE EXCEPTION 'G1 FAIL: unfunded position wrong: %', row_to_json(v_pos);
  END IF;
  IF NOT prize_pool_blocks_registration(v_t) THEN
    RAISE EXCEPTION 'G1 FAIL: an unfunded platform pool must block registration';
  END IF;

  v_err := pg_temp.error_of(format(
    $q$SELECT create_registration_with_payment(%L, %L, 'standard', 10000)$q$, v_p[1], v_t));
  IF v_err IS NULL OR v_err NOT LIKE 'P0001 PRIZE_POOL_NOT_FUNDED:%' THEN
    RAISE EXCEPTION 'G1 FAIL: registering into an unfunded pool gave %', COALESCE(v_err, 'no error');
  END IF;

  -- The organizer pays its own winners: nothing to fund, nothing gated.
  IF prize_pool_blocks_registration(v_t0) THEN
    RAISE EXCEPTION 'G1 FAIL: an organizer-distributed tournament must never be gated';
  END IF;
  PERFORM pg_temp.register_paid(v_p[1], v_t0);
  RAISE NOTICE 'G1 PASS — an unfunded platform pool blocks registration; organizer pools do not';

  -- ===== F1: partial funding from two sponsors ===============================
  INSERT INTO prize_fundings (tournament_id, funder_name, funder_email, amount_cents, chip_transaction_id, created_by)
    VALUES (v_t, 'Sponsor A', 'a@sponsor.test', 30000, 'pp_purchase_a', v_admin) RETURNING id INTO v_fund_a;
  INSERT INTO prize_fundings (tournament_id, funder_name, funder_email, amount_cents, chip_transaction_id, created_by)
    VALUES (v_t, 'Sponsor B', 'b@sponsor.test', 20000, 'pp_purchase_b', v_admin) RETURNING id INTO v_fund_b;

  -- A pending contribution funds nothing.
  SELECT * INTO v_pos FROM prize_pool_position(v_t);
  IF v_pos.funded_cents <> 0 THEN
    RAISE EXCEPTION 'F1 FAIL: pending fundings counted (%)', v_pos.funded_cents;
  END IF;

  v_res := settle_prize_funding(v_fund_a, true, 30000, 'fpx_b2c');
  IF NOT (v_res->>'newly_paid')::boolean OR (v_res->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'F1 FAIL: first settle of A: %', v_res;
  END IF;
  SELECT * INTO v_pos FROM prize_pool_position(v_t);
  IF v_pos.funded_cents <> 30000 OR v_pos.balance_cents <> 30000 OR v_pos.fully_funded THEN
    RAISE EXCEPTION 'F1 FAIL: after A, position=%', row_to_json(v_pos);
  END IF;
  IF NOT prize_pool_blocks_registration(v_t) THEN
    RAISE EXCEPTION 'F1 FAIL: a partly funded pool must still block registration';
  END IF;

  -- Paid for the wrong amount: left pending for a person, nothing booked.
  v_res := settle_prize_funding(v_fund_b, true, 19999, NULL);
  IF NOT (v_res->>'amount_mismatch')::boolean
     OR (SELECT status FROM prize_fundings WHERE id = v_fund_b) <> 'pending' THEN
    RAISE EXCEPTION 'F1 FAIL: amount mismatch not refused: %', v_res;
  END IF;

  -- A failure, then a late paid on the same purchase: real money wins.
  PERFORM settle_prize_funding(v_fund_b, false);
  IF (SELECT status FROM prize_fundings WHERE id = v_fund_b) <> 'failed' THEN
    RAISE EXCEPTION 'F1 FAIL: a failed purchase did not mark the funding failed';
  END IF;
  v_res := settle_prize_funding(v_fund_b, true, 20000, 'visa');
  IF NOT (v_res->>'newly_paid')::boolean THEN
    RAISE EXCEPTION 'F1 FAIL: a paid outcome after a failure was not honored: %', v_res;
  END IF;

  SELECT * INTO v_pos FROM prize_pool_position(v_t);
  IF v_pos.funded_cents <> 50000 OR NOT v_pos.fully_funded OR prize_pool_blocks_registration(v_t) THEN
    RAISE EXCEPTION 'F1 FAIL: fully funded pool still gated: %', row_to_json(v_pos);
  END IF;
  RAISE NOTICE 'F1 PASS — balance tracks partial funding from two sponsors; the gate opens at full funding';

  -- ===== F2: settling twice books one ledger row =============================
  v_res := settle_prize_funding(v_fund_a, true, 30000, 'fpx_b2c');
  IF NOT (v_res->>'already_processed')::boolean OR (v_res->>'newly_paid')::boolean THEN
    RAISE EXCEPTION 'F2 FAIL: duplicate settle of A: %', v_res;
  END IF;
  -- A failure arriving after the money cleared never undoes it.
  PERFORM settle_prize_funding(v_fund_a, false);
  IF (SELECT status FROM prize_fundings WHERE id = v_fund_a) <> 'paid' THEN
    RAISE EXCEPTION 'F2 FAIL: a late failure undid a paid funding';
  END IF;

  SELECT count(*) INTO v_count FROM payments WHERE tournament_id = v_t AND type = 'prize_funding';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'F2 FAIL: % prize_funding ledger rows (expected 2)', v_count;
  END IF;
  SELECT * INTO v_ledger FROM payments
    WHERE id = (SELECT payment_id FROM prize_fundings WHERE id = v_fund_a);
  IF v_ledger.gross_amount_cents <> 30000 OR v_ledger.net_amount_cents <> 30000
     OR v_ledger.platform_fee_cents <> 0 OR v_ledger.status <> 'paid'
     OR v_ledger.organization_id IS DISTINCT FROM v_org OR v_ledger.user_id IS NOT NULL
     OR v_ledger.chip_transaction_id <> 'pp_purchase_a' OR v_ledger.payment_method <> 'fpx_b2c' THEN
    RAISE EXCEPTION 'F2 FAIL: funding ledger row wrong: %', row_to_json(v_ledger);
  END IF;
  RAISE NOTICE 'F2 PASS — a duplicate settle is a no-op; one ledger row per contribution';

  -- ===== F3: prize money never moves the organizer's revenue =================
  PERFORM pg_temp.register_paid(v_p[1], v_t);
  PERFORM pg_temp.register_paid(v_p[2], v_t);
  PERFORM pg_temp.register_paid(v_p[3], v_t);
  PERFORM pg_temp.register_paid(v_p[4], v_t);

  SELECT * INTO v_sum FROM tournament_payout_summary WHERE tournament_id = v_t;
  IF v_sum.net_revenue_cents <> 40000 OR v_sum.net_payout_cents <> 40000 THEN
    RAISE EXCEPTION 'F3 FAIL: revenue %/payout % (expected 40000/40000; funding must not count)',
      v_sum.net_revenue_cents, v_sum.net_payout_cents;
  END IF;
  IF v_sum.prize_pool_balance_cents <> 50000 OR available_payout_cents(v_t) <> 40000 THEN
    RAISE EXCEPTION 'F3 FAIL: pool %, available payout %', v_sum.prize_pool_balance_cents, available_payout_cents(v_t);
  END IF;
  v_net_before := v_sum.net_payout_cents;
  RAISE NOTICE 'F3 PASS — funding sits in prize_pool_balance_cents, not net_payout_cents';

  -- ===== A1: entering winners ================================================
  v_err := pg_temp.error_of(format(
    $q$SELECT enter_prize_award(%L, %L, 'Open', '1st', 30000, %L)$q$, v_t0, v_p[1], v_admin));
  IF v_err NOT LIKE '%PRIZE_AWARD_NOT_ALLOWED: not_platform_distributed%' THEN
    RAISE EXCEPTION 'A1 FAIL: organizer-distributed tournament gave %', v_err;
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT enter_prize_award(%L, %L, 'Open', '1st', 30000, %L)$q$, v_t2, v_p[1], v_admin));
  IF v_err NOT LIKE '%PRIZE_AWARD_NOT_ALLOWED: tournament_not_finished%' THEN
    RAISE EXCEPTION 'A1 FAIL: a tournament still to be played gave %', v_err;
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT enter_prize_award(%L, %L, 'Open', '1st', 30000, %L)$q$, v_t, v_outsider, v_admin));
  IF v_err NOT LIKE '%PRIZE_AWARD_NOT_ALLOWED: winner_not_registered%' THEN
    RAISE EXCEPTION 'A1 FAIL: a player who did not play gave %', v_err;
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT enter_prize_award(%L, %L, 'Open', '4th', 1000, %L)$q$, v_t, v_p[1], v_admin));
  IF v_err NOT LIKE '%PRIZE_AWARD_NOT_ALLOWED: prize_not_declared%' THEN
    RAISE EXCEPTION 'A1 FAIL: an undeclared place gave %', v_err;
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT enter_prize_award(%L, %L, 'Best Junior', '1st', 1000, %L)$q$, v_t, v_p[1], v_admin));
  IF v_err NOT LIKE '%PRIZE_AWARD_NOT_ALLOWED: prize_not_declared%' THEN
    RAISE EXCEPTION 'A1 FAIL: a special prize with a place gave %', v_err;
  END IF;

  v_award1 := enter_prize_award(v_t, v_p[1], 'Open', '1st', 30000, v_admin);
  v_err := pg_temp.error_of(format(
    $q$SELECT enter_prize_award(%L, %L, 'Open', '1st', 1, %L)$q$, v_t, v_p[2], v_admin));
  IF v_err NOT LIKE '%PRIZE_AWARD_EXCEEDS_PRIZE: 1 cents requested, 0 cents of this prize is left%' THEN
    RAISE EXCEPTION 'A1 FAIL: overfilling a prize gave %', v_err;
  END IF;

  -- A tie: 2nd split between two players.
  v_award2 := enter_prize_award(v_t, v_p[2], 'Open', '2nd', 7500, v_admin);
  v_award3 := enter_prize_award(v_t, v_p[3], ' Open ', ' 2nd ', 7500, v_admin);
  IF (SELECT category || '/' || place FROM prize_awards WHERE id = v_award3) <> 'Open/2nd' THEN
    RAISE EXCEPTION 'A1 FAIL: category and place were not trimmed';
  END IF;

  v_award4 := enter_prize_award(v_t, v_p[4], 'Best Junior', NULL, 2500, v_admin);
  v_err := pg_temp.error_of(format(
    $q$SELECT enter_prize_award(%L, %L, 'Best Junior', NULL, 2500, %L)$q$, v_t, v_p[4], v_admin));
  IF v_err NOT LIKE '23505%' THEN
    RAISE EXCEPTION 'A1 FAIL: the same winner twice for one prize gave %', COALESCE(v_err, 'no error');
  END IF;

  SELECT * INTO v_pos FROM prize_pool_position(v_t);
  IF v_pos.reserved_cents <> 0 OR v_pos.pending_review_cents <> 47500 OR v_pos.available_cents <> 50000 THEN
    RAISE EXCEPTION 'A1 FAIL: an award awaiting review must reserve nothing: %', row_to_json(v_pos);
  END IF;
  RAISE NOTICE 'A1 PASS — winners checked against the roster and the declared prizes; ties split a prize';

  -- ===== R1: review refusals =================================================
  -- Funding is gated on registration, so this winner is seated directly.
  INSERT INTO registrations (user_id, tournament_id, fee_tier, status, confirmed_at)
    VALUES (v_p[1], v_t3, 'standard', 'confirmed', now());
  v_award5 := enter_prize_award(v_t3, v_p[1], 'Open', '1st', 30000, v_admin);
  v_err := pg_temp.error_of(format(
    $q$SELECT review_prize_award(%L, %L, 'approve', NULL)$q$, v_award5, v_admin));
  IF v_err NOT LIKE '%PRIZE_AWARD_NOT_ALLOWED: pool_not_funded%' THEN
    RAISE EXCEPTION 'R1 FAIL: approving against an unfunded pool gave %', v_err;
  END IF;
  IF (SELECT approval FROM prize_awards WHERE id = v_award5) <> 'pending' THEN
    RAISE EXCEPTION 'R1 FAIL: a refused approval changed the award';
  END IF;

  v_err := pg_temp.error_of(format(
    $q$SELECT review_prize_award(%L, %L, 'reject', '  ')$q$, v_award5, v_admin));
  IF v_err NOT LIKE '22023%' THEN
    RAISE EXCEPTION 'R1 FAIL: a blank rejection reason gave %', v_err;
  END IF;
  v_res := review_prize_award(v_award5, v_admin, 'reject', 'Wrong player');
  IF v_res->>'approval' <> 'rejected'
     OR (SELECT rejection_reason FROM prize_awards WHERE id = v_award5) <> 'Wrong player' THEN
    RAISE EXCEPTION 'R1 FAIL: reject: %', v_res;
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT review_prize_award(%L, %L, 'approve', NULL)$q$, v_award5, v_admin));
  IF v_err NOT LIKE '%PRIZE_AWARD_ALREADY_REVIEWED%' THEN
    RAISE EXCEPTION 'R1 FAIL: re-reviewing gave %', v_err;
  END IF;
  -- A rejected award frees its prize for the right winner.
  PERFORM enter_prize_award(v_t3, v_p[1], 'Open', '1st', 30000, v_admin);
  RAISE NOTICE 'R1 PASS — an unfunded pool refuses approval; reject needs a reason and frees the prize';

  -- ===== R2: approval reserves, and the sum guard refuses beyond the pool ====
  v_res := review_prize_award(v_award1, v_admin, 'approve', NULL);
  IF v_res->>'approval' <> 'approved' THEN
    RAISE EXCEPTION 'R2 FAIL: approve: %', v_res;
  END IF;
  SELECT * INTO v_pos FROM prize_pool_position(v_t);
  IF v_pos.reserved_cents <> 30000 OR v_pos.available_cents <> 20000 OR v_pos.balance_cents <> 50000 THEN
    RAISE EXCEPTION 'R2 FAIL: after approving 30000: %', row_to_json(v_pos);
  END IF;

  -- The ledger moved underneath the pool (as an over-settled award would move
  -- it): 15000 out, so only 5000 is left to commit.
  INSERT INTO payments (type, tournament_id, user_id, organization_id, gross_amount_cents, net_amount_cents,
                        chip_transaction_id, status, paid_at)
    VALUES ('player_prize', v_t, v_p[3], v_org, 15000, 15000, 'send_pp_drain', 'paid', now())
    RETURNING id INTO v_drain;
  IF available_prize_pool_cents(v_t) <> 5000 THEN
    RAISE EXCEPTION 'R2 FAIL: available=% after the drain (expected 5000)', available_prize_pool_cents(v_t);
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT review_prize_award(%L, %L, 'approve', NULL)$q$, v_award2, v_admin));
  IF v_err NOT LIKE '%PRIZE_AWARD_EXCEEDS_POOL: 7500 cents requested, 5000 cents of the collected pool is uncommitted%' THEN
    RAISE EXCEPTION 'R2 FAIL: an award beyond the collected pool gave %', COALESCE(v_err, 'no error');
  END IF;
  DELETE FROM payments WHERE id = v_drain;
  RAISE NOTICE 'R2 PASS — approval reserves pool money; an award beyond the collected pool is refused';

  -- ===== C1: the claim needs a verified bank account ========================
  IF claim_prize_award_send(v_award2) <> 'not_claimable' THEN
    RAISE EXCEPTION 'C1 FAIL: an unapproved award was claimable';
  END IF;
  IF claim_prize_award_send(v_award1) IS DISTINCT FROM 'bank_account_not_verified' THEN
    RAISE EXCEPTION 'C1 FAIL: a winner with no bank account gave %', claim_prize_award_send(v_award1);
  END IF;

  -- Bank details are held only with financial-data consent (#451).
  PERFORM record_sensitive_data_consent(v_p[1], 'financial', true, '2026-11-19');
  v_bank1 := (set_player_bank_account(v_p[1], 'MBBEMYKL', 'Maybank', 'Player One', '514100000101') ->> 'id')::uuid;
  IF claim_prize_award_send(v_award1) IS DISTINCT FROM 'bank_account_not_verified' THEN
    RAISE EXCEPTION 'C1 FAIL: a pending bank account was accepted';
  END IF;

  v_res := settle_bank_account_verification(v_bank1, 930101, true);
  IF v_res->>'owner' <> 'player' OR (v_res->>'user_id')::uuid <> v_p[1]
     OR v_res->>'organization_id' IS NOT NULL OR (v_res->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'C1 FAIL: player verification settle: %', v_res;
  END IF;

  IF claim_prize_award_send(v_award1) IS NOT NULL THEN
    RAISE EXCEPTION 'C1 FAIL: a verified winner could not be claimed';
  END IF;
  SELECT * INTO v_award FROM prize_awards WHERE id = v_award1;
  IF v_award.status <> 'processing' OR v_award.bank_account_id IS DISTINCT FROM v_bank1 THEN
    RAISE EXCEPTION 'C1 FAIL: claimed award: status %, bank %', v_award.status, v_award.bank_account_id;
  END IF;
  IF claim_prize_award_send(v_award1) <> 'not_claimable' THEN
    RAISE EXCEPTION 'C1 FAIL: an award was claimed twice';
  END IF;
  RAISE NOTICE 'C1 PASS — the claim waits for a verified account and snapshots it';

  -- ===== S1: settle_prize_award is idempotent ================================
  v_res := settle_prize_award(v_award1, 7001, true, 30000, 'https://receipt.test/p1', NULL);
  IF (v_res->>'already_processed')::boolean OR (v_res->>'over_award')::boolean THEN
    RAISE EXCEPTION 'S1 FAIL: first settle: %', v_res;
  END IF;
  v_res := settle_prize_award(v_award1, 7001, true, 30000, NULL, NULL);
  IF NOT (v_res->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'S1 FAIL: duplicate settle: %', v_res;
  END IF;

  SELECT count(*) INTO v_count FROM payments WHERE tournament_id = v_t AND type = 'player_prize';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'S1 FAIL: % player_prize ledger rows (expected exactly 1)', v_count;
  END IF;
  SELECT * INTO v_ledger FROM payments WHERE tournament_id = v_t AND type = 'player_prize';
  IF v_ledger.user_id IS DISTINCT FROM v_p[1] OR v_ledger.organization_id IS DISTINCT FROM v_org
     OR v_ledger.chip_transaction_id <> 'send_7001' OR v_ledger.gross_amount_cents <> 30000
     OR v_ledger.payment_method <> 'chip_send' OR v_ledger.status <> 'paid' THEN
    RAISE EXCEPTION 'S1 FAIL: prize ledger row wrong: %', row_to_json(v_ledger);
  END IF;
  SELECT * INTO v_award FROM prize_awards WHERE id = v_award1;
  IF v_award.status <> 'paid' OR v_award.payment_id IS DISTINCT FROM v_ledger.id
     OR v_award.settled_amount_cents <> 30000 OR v_award.processed_at IS NULL
     OR v_award.chip_receipt_url <> 'https://receipt.test/p1' THEN
    RAISE EXCEPTION 'S1 FAIL: settled award wrong: %', row_to_json(v_award);
  END IF;

  SELECT * INTO v_pos FROM prize_pool_position(v_t);
  IF v_pos.paid_out_cents <> 30000 OR v_pos.balance_cents <> 20000 OR v_pos.reserved_cents <> 0 THEN
    RAISE EXCEPTION 'S1 FAIL: pool after paying 30000: %', row_to_json(v_pos);
  END IF;
  SELECT * INTO v_sum FROM tournament_payout_summary WHERE tournament_id = v_t;
  IF v_sum.net_payout_cents <> v_net_before OR v_sum.prize_pool_balance_cents <> 20000 THEN
    RAISE EXCEPTION 'S1 FAIL: paying a prize moved net_payout_cents (% -> %)', v_net_before, v_sum.net_payout_cents;
  END IF;
  RAISE NOTICE 'S1 PASS — one player_prize row however often it settles; net_payout_cents untouched';

  -- ===== S2: a failed award is terminal and the winner can be re-entered =====
  PERFORM review_prize_award(v_award2, v_admin, 'approve', NULL);
  PERFORM record_sensitive_data_consent(v_p[2], 'financial', true, '2026-11-19');
  v_bank2 := (set_player_bank_account(v_p[2], 'CIBBMYKL', 'CIMB Bank', 'Player Two', '800000000202') ->> 'id')::uuid;
  PERFORM settle_bank_account_verification(v_bank2, 930202, true);
  IF claim_prize_award_send(v_award2) IS NOT NULL THEN
    RAISE EXCEPTION 'S2 FAIL: could not claim award 2';
  END IF;
  v_res := settle_prize_award(v_award2, 7002, false, NULL, NULL, 'send_instruction_rejected');
  SELECT * INTO v_award FROM prize_awards WHERE id = v_award2;
  IF v_award.status <> 'failed' OR v_award.failure_reason <> 'send_instruction_rejected'
     OR v_award.payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'S2 FAIL: failed award wrong: %', row_to_json(v_award);
  END IF;
  IF (SELECT count(*) FROM payments WHERE tournament_id = v_t AND type = 'player_prize') <> 1 THEN
    RAISE EXCEPTION 'S2 FAIL: a failed award booked a ledger row';
  END IF;
  -- A paid report on an award already written off is reported, not booked.
  v_res := settle_prize_award(v_award2, 7002, true, 7500, NULL, NULL);
  IF NOT (v_res->>'paid_after_failed')::boolean THEN
    RAISE EXCEPTION 'S2 FAIL: paid after failed not flagged: %', v_res;
  END IF;

  v_award2 := enter_prize_award(v_t, v_p[2], 'Open', '2nd', 7500, v_admin);
  RAISE NOTICE 'S2 PASS — a failed award books nothing, frees its prize, and the winner is entered again';

  -- ===== K1: a cancelled tournament pays no one ==============================
  PERFORM review_prize_award(v_award3, v_admin, 'approve', NULL);
  INSERT INTO tournament_cancellation_requests (tournament_id, requested_by, reason)
    VALUES (v_t, v_admin, 'Venue flooded');
  IF claim_prize_award_send(v_award3) IS DISTINCT FROM 'cancellation_pending' THEN
    RAISE EXCEPTION 'K1 FAIL: claim during a pending cancellation gave %', claim_prize_award_send(v_award3);
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT review_prize_award(%L, %L, 'approve', NULL)$q$, v_award4, v_admin));
  IF v_err NOT LIKE '%PRIZE_AWARD_NOT_ALLOWED: cancellation_pending%' THEN
    RAISE EXCEPTION 'K1 FAIL: approving during a pending cancellation gave %', v_err;
  END IF;
  UPDATE tournaments SET status = 'cancelled' WHERE id = v_t;
  IF claim_prize_award_send(v_award3) IS DISTINCT FROM 'tournament_cancelled' THEN
    RAISE EXCEPTION 'K1 FAIL: claim on a cancelled tournament gave %', claim_prize_award_send(v_award3);
  END IF;
  RAISE NOTICE 'K1 PASS — nothing is approved or sent while a cancellation is pending or done';

  -- ===== B1: set_player_bank_account ========================================
  v_res := set_player_bank_account(v_p[1], 'MBBEMYKL', 'Maybank', 'Player One', '514100000101');
  IF (v_res->>'changed')::boolean OR (v_res->>'id')::uuid <> v_bank1 OR v_res->>'status' <> 'verified' THEN
    RAISE EXCEPTION 'B1 FAIL: an unchanged re-save must keep the verified row: %', v_res;
  END IF;
  IF v_res ? 'account_number' OR v_res->>'account_number_last4' <> '0101' THEN
    RAISE EXCEPTION 'B1 FAIL: the full account number came back: %', v_res;
  END IF;

  v_res := set_player_bank_account(v_p[1], 'MBBEMYKL', 'Maybank', 'Player One', '514100000999');
  IF NOT (v_res->>'changed')::boolean OR v_res->>'status' <> 'pending' OR (v_res->>'id')::uuid = v_bank1 THEN
    RAISE EXCEPTION 'B1 FAIL: a changed account must supersede: %', v_res;
  END IF;
  IF (SELECT is_active FROM player_bank_accounts WHERE id = v_bank1) THEN
    RAISE EXCEPTION 'B1 FAIL: the superseded row is still active';
  END IF;
  -- The paid award still names the account the money went to.
  IF (SELECT bank_account_id FROM prize_awards WHERE id = v_award1) <> v_bank1 THEN
    RAISE EXCEPTION 'B1 FAIL: superseding moved a paid award off its account';
  END IF;

  v_res := set_player_bank_account(v_p[1], NULL, NULL, NULL, NULL);
  IF NOT (v_res->>'changed')::boolean
     OR EXISTS (SELECT 1 FROM player_bank_accounts WHERE user_id = v_p[1] AND is_active) THEN
    RAISE EXCEPTION 'B1 FAIL: clearing left an active account: %', v_res;
  END IF;
  -- A verdict on a superseded account is recorded but reported inactive.
  v_res := settle_bank_account_verification((SELECT id FROM player_bank_accounts
    WHERE user_id = v_p[1] AND account_number = '514100000999'), NULL, false, NULL);
  IF (v_res->>'is_active')::boolean OR (v_res->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'B1 FAIL: verdict on a superseded account: %', v_res;
  END IF;
  RAISE NOTICE 'B1 PASS — player accounts supersede, no-op when unchanged, clear, and never return the number';

  -- ===== W1: no client writes ================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_err := pg_temp.error_of(format(
    $q$INSERT INTO prize_awards (tournament_id, organization_id, user_id, category, amount_cents, approval)
       VALUES (%L, %L, %L, 'Open', 100, 'approved')$q$, v_t0, v_org, v_outsider));
  v_text := pg_temp.error_of(format(
    $q$INSERT INTO prize_fundings (tournament_id, funder_name, funder_email, amount_cents)
       VALUES (%L, 'X', 'x@x.test', 100)$q$, v_t0));
  IF v_err NOT LIKE '42501%' OR v_text NOT LIKE '42501%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'W1 FAIL: client inserts were not refused (% / %)', v_err, v_text;
  END IF;
  v_err := pg_temp.error_of(format(
    $q$INSERT INTO player_bank_accounts (user_id, bank_name, bank_code, account_holder, account_number, status)
       VALUES (%L, 'Maybank', 'MBBEMYKL', 'O', '514100000777', 'verified')$q$, v_outsider));
  IF v_err NOT LIKE '42501%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'W1 FAIL: a client could write its own verified bank account (%)', v_err;
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT set_player_bank_account(%L, 'MBBEMYKL', 'Maybank', 'O', '514100000777')$q$, v_outsider));
  IF v_err NOT LIKE '42501%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'W1 FAIL: a client could call set_player_bank_account (%)', v_err;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RAISE NOTICE 'W1 PASS — no client writes to prize awards, fundings or player bank accounts';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
