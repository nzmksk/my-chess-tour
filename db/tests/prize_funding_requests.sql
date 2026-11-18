-- =============================================================================
-- DB regression test for automatic prize-funding requests and the
-- 'pending_funding' tournament state (#523):
--   * declared_prize_funders: one share per funder, matched ignoring case and
--     spaces, prizes without money or a funder left out
--   * set_prize_funder_contacts: validation, replace-whole semantics
--   * reconcile_prize_funding_requests: one open request per funder, kept when
--     it still matches, superseded when a share or an address changes, a
--     top-up after a partial payment, missing contacts reported, everything
--     withdrawn when the tournament stops asking
--   * release_funded_tournament: the payment that completes the pool lists the
--     tournament (settle_prize_funding reports went_live); a partial one doesn't
--   * the public can't see a pending_funding tournament or any funder contact
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it
-- persists NOTHING. A failing assertion RAISEs; on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
--
-- Prizes: Open 1st RM300 + 2nd RM150 funded by "Acme", special "Best Junior"
-- RM50 funded by "Ministry" => Acme owes 45000c, Ministry 5000c.
-- =============================================================================

BEGIN;

CREATE FUNCTION pg_temp.prizes(p_distribution text, p_acme_first integer DEFAULT 30000)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'categories', jsonb_build_array(
      jsonb_build_object(
        'name', 'Open',
        'funding', jsonb_build_object('source', 'sponsor', 'funder_name', 'Acme'),
        'entries', jsonb_build_array(
          jsonb_build_object('place', '1st', 'amount_cents', p_acme_first),
          jsonb_build_object('place', '2nd', 'amount_cents', 15000))),
      -- Placeholder category: no money, so no share.
      jsonb_build_object(
        'name', 'Veterans',
        'funding', jsonb_build_object('source', 'sponsor', 'funder_name', 'Nobody'),
        'entries', jsonb_build_array(jsonb_build_object('place', '1st', 'amount_cents', 0)))),
    'special', jsonb_build_array(
      jsonb_build_object(
        'name', 'Best Junior',
        -- Same funder spelled differently from how a contact will name it.
        'funding', jsonb_build_object('source', 'grant', 'funder_name', ' Ministry '),
        'amount_cents', 5000)),
    'distribution', p_distribution);
$$;

CREATE FUNCTION pg_temp.error_of(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

-- Open requests for a tournament as "name:amount:email" strings, sorted.
CREATE FUNCTION pg_temp.open_requests(p_t uuid) RETURNS text
LANGUAGE sql AS $$
  SELECT COALESCE(string_agg(funder_name || ':' || amount_cents || ':' || funder_email, ', ' ORDER BY funder_name), '')
  FROM prize_fundings
  WHERE tournament_id = p_t AND status = 'pending' AND cancelled_at IS NULL;
$$;

DO $$
DECLARE
  v_org     uuid;
  v_t       uuid;
  v_t0      uuid;
  v_res     jsonb;
  v_err     text;
  v_text    text;
  v_count   integer;
  v_acme    uuid;
  v_acme2   uuid;
  v_min     uuid;
  v_status  tournament_status;
  v_auth    uuid := gen_random_uuid();
  v_viewer  uuid;
BEGIN
  INSERT INTO organizations (name, email, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('PF ORG', 'pf-org@test.local', 'company', current_organizer_agreement_version(), now(), 'approved')
    RETURNING id INTO v_org;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_auth, 'pf-viewer@test.local', 'V', 'T') RETURNING id INTO v_viewer;

  INSERT INTO tournaments (
    organization_id, name, slug, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, prizes, max_participants, status, published_at
  ) VALUES (
    v_org, 'PF PLATFORM', 'pf-platform', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, (current_date + 30)::timestamptz - interval '1 day',
    '{"type":"classical","rounds":9,"system":"swiss"}', '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}', pg_temp.prizes('platform'), 100, 'pending_funding', now()
  ) RETURNING id INTO v_t;

  INSERT INTO tournaments (
    organization_id, name, slug, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, prizes, max_participants, status, published_at
  ) VALUES (
    v_org, 'PF ORGANIZER', 'pf-organizer', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, (current_date + 30)::timestamptz - interval '1 day',
    '{"type":"classical","rounds":9,"system":"swiss"}', '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}', pg_temp.prizes('organizer'), 100, 'published', now()
  ) RETURNING id INTO v_t0;

  -- ===== D1: each funder's share ==============================================
  SELECT string_agg(funder_key || '=' || funder_name || '=' || amount_cents, ', ' ORDER BY funder_key)
    INTO v_text FROM declared_prize_funders(pg_temp.prizes('platform'));
  IF v_text IS DISTINCT FROM 'acme=Acme=45000, ministry=Ministry=5000' THEN
    RAISE EXCEPTION 'D1 FAIL: shares %', v_text;
  END IF;
  RAISE NOTICE 'D1 PASS — one share per funder, placeholders left out';

  -- ===== K1: contacts ========================================================
  v_err := pg_temp.error_of(format(
    $q$SELECT set_prize_funder_contacts(%L, '[{"funder_name":"Acme","funder_email":"not-an-email"}]')$q$, v_t));
  IF v_err NOT LIKE '%PRIZE_FUNDER_CONTACT_INVALID: invalid email%' THEN
    RAISE EXCEPTION 'K1 FAIL: bad address accepted (%)', v_err;
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT set_prize_funder_contacts(%L, '[{"funder_name":"Acme","funder_email":"a@acme.test"},{"funder_name":" acme","funder_email":"b@acme.test"}]')$q$, v_t));
  IF v_err NOT LIKE '%PRIZE_FUNDER_CONTACT_INVALID: duplicate funder%' THEN
    RAISE EXCEPTION 'K1 FAIL: duplicate funder accepted (%)', v_err;
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT set_prize_funder_contacts(%L, '[{"funder_name":"  ","funder_email":"a@acme.test"}]')$q$, v_t));
  IF v_err NOT LIKE '%PRIZE_FUNDER_CONTACT_INVALID: funder name required%' THEN
    RAISE EXCEPTION 'K1 FAIL: blank funder accepted (%)', v_err;
  END IF;

  PERFORM set_prize_funder_contacts(v_t,
    '[{"funder_name":"Acme","funder_email":"Pay@Acme.test "},{"funder_name":"Gone","funder_email":"g@gone.test"}]');
  PERFORM set_prize_funder_contacts(v_t, '[{"funder_name":"Acme","funder_email":"pay@acme.test"}]');
  SELECT string_agg(funder_name || ':' || funder_email, ', ') INTO v_text
    FROM prize_funder_contacts WHERE tournament_id = v_t;
  IF v_text IS DISTINCT FROM 'Acme:pay@acme.test' THEN
    RAISE EXCEPTION 'K1 FAIL: contacts not replaced whole: %', v_text;
  END IF;
  RAISE NOTICE 'K1 PASS — contacts are validated, normalised and replaced whole';

  -- ===== Q1: one request per funder; a funder with no address is reported =====
  v_res := reconcile_prize_funding_requests(v_t);
  IF jsonb_array_length(v_res->'created') <> 1
     OR v_res->'missing_contacts' <> '["Ministry"]'::jsonb
     OR (v_res->>'released')::boolean THEN
    RAISE EXCEPTION 'Q1 FAIL: %', v_res;
  END IF;
  IF pg_temp.open_requests(v_t) <> 'Acme:45000:pay@acme.test' THEN
    RAISE EXCEPTION 'Q1 FAIL: open requests %', pg_temp.open_requests(v_t);
  END IF;
  v_acme := (v_res->'created'->>0)::uuid;
  RAISE NOTICE 'Q1 PASS — a request per funder with an address; the rest reported';

  -- ===== Q2: nothing changed, nothing churns; a new contact adds its request ==
  PERFORM set_prize_funder_contacts(v_t,
    '[{"funder_name":"Acme","funder_email":"pay@acme.test"},{"funder_name":"ministry","funder_email":"grants@gov.test"}]');
  v_res := reconcile_prize_funding_requests(v_t);
  IF jsonb_array_length(v_res->'created') <> 1 OR jsonb_array_length(v_res->'cancelled') <> 0 THEN
    RAISE EXCEPTION 'Q2 FAIL: %', v_res;
  END IF;
  v_min := (v_res->'created'->>0)::uuid;
  v_res := reconcile_prize_funding_requests(v_t);
  IF jsonb_array_length(v_res->'created') <> 0 OR jsonb_array_length(v_res->'cancelled') <> 0 THEN
    RAISE EXCEPTION 'Q2 FAIL: a second run churned: %', v_res;
  END IF;
  RAISE NOTICE 'Q2 PASS — matching requests are kept';

  -- ===== Q3: a changed share supersedes the open request ======================
  UPDATE prize_fundings SET chip_transaction_id = 'purchase-acme-1', checkout_url = 'https://gate.test/1'
    WHERE id = v_acme;
  UPDATE tournaments SET prizes = pg_temp.prizes('platform', 40000) WHERE id = v_t;
  v_res := reconcile_prize_funding_requests(v_t);
  IF v_res->'cancelled' <> jsonb_build_array(jsonb_build_object('id', v_acme, 'chip_transaction_id', 'purchase-acme-1'))
     OR jsonb_array_length(v_res->'created') <> 1 THEN
    RAISE EXCEPTION 'Q3 FAIL: %', v_res;
  END IF;
  v_acme2 := (v_res->'created'->>0)::uuid;
  IF pg_temp.open_requests(v_t) <> 'Acme:55000:pay@acme.test, Ministry:5000:grants@gov.test' THEN
    RAISE EXCEPTION 'Q3 FAIL: open requests %', pg_temp.open_requests(v_t);
  END IF;
  RAISE NOTICE 'Q3 PASS — a changed share cancels the old link (CHIP id reported) and asks again';

  -- ===== R1: a partial payment doesn't list it; the completing one does =======
  v_res := settle_prize_funding(v_min, true, 5000, 'fpx');
  SELECT status INTO v_status FROM tournaments WHERE id = v_t;
  IF (v_res->>'went_live')::boolean OR v_status <> 'pending_funding' THEN
    RAISE EXCEPTION 'R1 FAIL: listed after a partial payment (% / %)', v_res, v_status;
  END IF;

  -- A late payment on the superseded link is still real money, and Acme's
  -- request is topped up to what remains rather than asked again in full.
  v_res := settle_prize_funding(v_acme, true, 45000, 'fpx');
  IF NOT (v_res->>'newly_paid')::boolean OR (v_res->>'went_live')::boolean THEN
    RAISE EXCEPTION 'R1 FAIL: late payment on a superseded link: %', v_res;
  END IF;
  v_res := reconcile_prize_funding_requests(v_t);
  IF pg_temp.open_requests(v_t) <> 'Acme:10000:pay@acme.test' THEN
    RAISE EXCEPTION 'R1 FAIL: top-up %, result %', pg_temp.open_requests(v_t), v_res;
  END IF;
  SELECT id INTO v_acme2 FROM prize_fundings
    WHERE tournament_id = v_t AND status = 'pending' AND cancelled_at IS NULL;

  v_res := settle_prize_funding(v_acme2, true, 10000, 'card');
  SELECT status INTO v_status FROM tournaments WHERE id = v_t;
  IF NOT (v_res->>'went_live')::boolean OR v_status <> 'published' THEN
    RAISE EXCEPTION 'R1 FAIL: not listed once funded (% / %)', v_res, v_status;
  END IF;
  -- A repeat of the completing delivery doesn't "list" it again.
  v_res := settle_prize_funding(v_acme2, true, 10000, 'card');
  IF (v_res->>'went_live')::boolean THEN
    RAISE EXCEPTION 'R1 FAIL: a repeat delivery reported went_live: %', v_res;
  END IF;
  RAISE NOTICE 'R1 PASS — the payment that completes the pool lists the tournament, once';

  -- ===== R2: release_funded_tournament leaves other states alone ==============
  IF release_funded_tournament(v_t) OR release_funded_tournament(v_t0) THEN
    RAISE EXCEPTION 'R2 FAIL: released a tournament that was not pending_funding';
  END IF;
  -- Switching a pending tournament to organizer-paid needs no funding: listed.
  UPDATE tournaments SET status = 'pending_funding', prizes = pg_temp.prizes('organizer') WHERE id = v_t0;
  v_res := reconcile_prize_funding_requests(v_t0);
  SELECT status INTO v_status FROM tournaments WHERE id = v_t0;
  IF NOT (v_res->>'released')::boolean OR v_status <> 'published' OR jsonb_array_length(v_res->'created') <> 0 THEN
    RAISE EXCEPTION 'R2 FAIL: organizer-paid pending tournament: % / %', v_res, v_status;
  END IF;
  RAISE NOTICE 'R2 PASS — only a pending_funding tournament is released';

  -- ===== C1: a cancelled tournament withdraws every open request ==============
  UPDATE tournaments SET prizes = pg_temp.prizes('platform', 90000) WHERE id = v_t;
  PERFORM reconcile_prize_funding_requests(v_t);
  IF pg_temp.open_requests(v_t) = '' THEN
    RAISE EXCEPTION 'C1 FAIL: raising the prizes of a listed tournament asked for no top-up';
  END IF;
  UPDATE tournaments SET status = 'cancelled' WHERE id = v_t;
  v_res := reconcile_prize_funding_requests(v_t);
  IF pg_temp.open_requests(v_t) <> '' OR jsonb_array_length(v_res->'cancelled') <> 1
     OR jsonb_array_length(v_res->'created') <> 0 THEN
    RAISE EXCEPTION 'C1 FAIL: open after cancellation: % / %', pg_temp.open_requests(v_t), v_res;
  END IF;
  SELECT count(*) INTO v_count FROM prize_fundings WHERE tournament_id = v_t AND status = 'paid';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'C1 FAIL: paid contributions touched (% paid)', v_count;
  END IF;
  RAISE NOTICE 'C1 PASS — cancelling withdraws open requests and leaves paid money booked';

  -- ===== V1: the public sees neither a pending tournament nor a contact ======
  UPDATE tournaments SET status = 'pending_funding' WHERE id = v_t;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_count FROM tournaments WHERE id IN (v_t, v_t0);
  IF v_count <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'V1 FAIL: anon sees % of (pending, published)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM prize_funder_contacts;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'V1 FAIL: anon sees % funder contacts', v_count;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM prize_funder_contacts;
  v_err := pg_temp.error_of(format(
    $q$INSERT INTO prize_funder_contacts (tournament_id, funder_name, funder_email) VALUES (%L, 'X', 'x@x.test')$q$, v_t));
  v_text := pg_temp.error_of(format(
    $q$SELECT reconcile_prize_funding_requests(%L)$q$, v_t));
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF v_count <> 0 OR v_err NOT LIKE '42501%' OR v_text NOT LIKE '42501%' THEN
    RAISE EXCEPTION 'V1 FAIL: outsider sees % contacts / insert % / reconcile %', v_count, v_err, v_text;
  END IF;
  RAISE NOTICE 'V1 PASS — pending tournaments and funder contacts are private';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
