-- =============================================================================
-- DB regression test for guard_tournament_prizes_in_checkout
-- (003_functions_triggers.sql, #523): while a player holds a live checkout on a
-- platform-distributed tournament, its prizes can't be raised beyond what the
-- funders have paid in. Otherwise the player could pay the still-live CHIP link
-- and be confirmed against a pool that no longer covers the prizes, because
-- settle_registration_payment never re-checks the pool.
--
-- Covers:
--   H1  a raise beyond the funded pool during a live checkout is refused
--   H2  a change the funded pool still covers is allowed, up to exactly funded
--   H3  an organizer-paid tournament is never held, but switching it to the
--       platform during a live checkout is refused
--   H4  once the hold lapses the raise is allowed, and the pool gate then
--       blocks the next checkout
--   H5  after a paid registration the paid lock is what reports the refusal
--
-- Two sessions racing (a checkout and a prize edit at the same moment) are in
-- supabase/tests/prize_pool_checkout_race.sql.
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. The whole thing runs inside a transaction that
-- ROLLBACKs at the end, so it builds throwaway fixtures and persists NOTHING. A
-- failing assertion RAISEs (and rolls back); on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
--
-- Prizes: Open 1st RM300 + 2nd RM150 (Acme) and Best Junior RM50 (Ministry),
-- RM500 (50000c) declared. The platform tournaments are funded in full.
-- =============================================================================

BEGIN;

CREATE FUNCTION pg_temp.make_tournament(p_org uuid, p_name text, p_distribution text)
RETURNS uuid
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
    current_date + 20, current_date + 21, (current_date + 19)::timestamptz,
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

CREATE FUNCTION pg_temp.fund(p_t uuid, p_cents integer) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_f uuid;
BEGIN
  INSERT INTO prize_fundings (tournament_id, funder_name, funder_email, amount_cents, chip_transaction_id)
    VALUES (p_t, 'Acme', 'acme@sponsor.test', p_cents, 'hold_' || p_t) RETURNING id INTO v_f;
  PERFORM settle_prize_funding(v_f, true, p_cents);
END $$;

-- Sets Open 1st to p_cents (declared total = p_cents + 20000).
CREATE FUNCTION pg_temp.set_first(p_t uuid, p_cents integer) RETURNS void
LANGUAGE sql AS $$
  UPDATE tournaments
  SET prizes = jsonb_set(prizes, '{categories,0,entries,0,amount_cents}', to_jsonb(p_cents))
  WHERE id = p_t;
$$;

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
  v_org  uuid;
  v_p    uuid[];
  v_t    uuid;   -- platform, funded
  v_t0   uuid;   -- organizer-paid
  v_t5   uuid;   -- platform, funded, with a paid registration
  v_res  jsonb;
  v_err  text;
BEGIN
  WITH ins AS (
    INSERT INTO users (email, first_name, last_name)
    SELECT format('hold-player-%s@test.local', i), 'P' || i, 'T' FROM generate_series(1, 5) i
    RETURNING id, email
  )
  SELECT array_agg(id ORDER BY email) INTO v_p FROM ins;

  INSERT INTO organizations (name, email, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('HOLD ORG', 'hold-org@test.local', 'company', current_organizer_agreement_version(), now(), 'approved')
    RETURNING id INTO v_org;

  v_t  := pg_temp.make_tournament(v_org, 'HOLD PLATFORM', 'platform');
  v_t0 := pg_temp.make_tournament(v_org, 'HOLD ORGANIZER', 'organizer');
  v_t5 := pg_temp.make_tournament(v_org, 'HOLD PAID', 'platform');
  PERFORM pg_temp.fund(v_t, 50000);
  PERFORM pg_temp.fund(v_t5, 50000);

  -- ===== H1: a raise during a live checkout ==================================
  PERFORM create_registration_with_payment(v_p[1], v_t, 'standard', 10000);

  v_err := pg_temp.error_of(format('SELECT pg_temp.set_first(%L, 30001)', v_t));
  IF v_err IS NULL OR v_err NOT LIKE 'P0001 PRIZES_IN_CHECKOUT: 1 checkouts are live%' THEN
    RAISE EXCEPTION 'H1 FAIL: raising beyond the funded pool mid-checkout gave %', COALESCE(v_err, 'no error');
  END IF;
  IF (SELECT prizes #>> '{categories,0,entries,0,amount_cents}' FROM tournaments WHERE id = v_t) <> '30000' THEN
    RAISE EXCEPTION 'H1 FAIL: the refused raise was saved';
  END IF;
  RAISE NOTICE 'H1 PASS — a raise beyond the funded pool is refused while a checkout is live';

  -- ===== H2: changes the pool still covers ===================================
  PERFORM pg_temp.set_first(v_t, 20000);   -- declared 40000 of 50000 funded
  PERFORM pg_temp.set_first(v_t, 30000);   -- declared 50000: exactly funded
  UPDATE tournaments SET prizes = jsonb_set(prizes, '{categories,0,name}', '"Open Section"') WHERE id = v_t;
  IF prize_pool_blocks_registration(v_t) THEN
    RAISE EXCEPTION 'H2 FAIL: a covered change left the pool short';
  END IF;
  RAISE NOTICE 'H2 PASS — changes the funded pool still covers are allowed during a checkout';

  -- ===== H3: organizer-paid tournaments ======================================
  PERFORM create_registration_with_payment(v_p[2], v_t0, 'standard', 10000);
  PERFORM pg_temp.set_first(v_t0, 90000);
  v_err := pg_temp.error_of(format(
    $q$UPDATE tournaments SET prizes = jsonb_set(prizes, '{distribution}', '"platform"') WHERE id = %L$q$, v_t0));
  IF v_err IS NULL OR v_err NOT LIKE 'P0001 PRIZES_IN_CHECKOUT:%' THEN
    RAISE EXCEPTION 'H3 FAIL: switching to an unfunded platform pool mid-checkout gave %', COALESCE(v_err, 'no error');
  END IF;
  RAISE NOTICE 'H3 PASS — organizer pools are never held; switching one to the platform mid-checkout is refused';

  -- ===== H4: the hold lapses =================================================
  UPDATE registrations SET registered_at = now() - interval '11 minutes' WHERE tournament_id = v_t;
  PERFORM pg_temp.set_first(v_t, 40000);
  IF NOT prize_pool_blocks_registration(v_t) THEN
    RAISE EXCEPTION 'H4 FAIL: the raise should leave the pool short';
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT create_registration_with_payment(%L, %L, 'standard', 10000)$q$, v_p[3], v_t));
  IF v_err IS NULL OR v_err NOT LIKE 'P0001 PRIZE_POOL_NOT_FUNDED:%' THEN
    RAISE EXCEPTION 'H4 FAIL: a checkout into the short pool gave %', COALESCE(v_err, 'no error');
  END IF;
  RAISE NOTICE 'H4 PASS — after the hold lapses the raise is saved and the gate blocks new checkouts';

  -- ===== H5: the paid lock reports first =====================================
  v_res := create_registration_with_payment(v_p[4], v_t5, 'standard', 10000);
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, true, 11000);
  PERFORM create_registration_with_payment(v_p[5], v_t5, 'standard', 10000);
  v_err := pg_temp.error_of(format('SELECT pg_temp.set_first(%L, 90000)', v_t5));
  IF v_err IS NULL OR v_err NOT LIKE 'P0001 tournament % has paid registrations; these fields are locked: prizes' THEN
    RAISE EXCEPTION 'H5 FAIL: expected the paid lock, got %', COALESCE(v_err, 'no error');
  END IF;
  RAISE NOTICE 'H5 PASS — after a payment, the paid lock reports the refusal';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
