-- =============================================================================
-- Regression test: a self-managed account whose holder is under 18 can't
-- register (#711).
--
-- Covers:
--   U1  self_managed_minor: true for a self account under 18 today in
--       Malaysia; false for an adult, someone turning 18 today, a self account
--       with no date of birth, a managed account, and an unknown user
--   U2  create_registration_with_payment refuses an under-18 self-managed
--       participant with UNDER_18, even when someone else pays, and creates
--       nothing
--   U3  a managed (dependent) participant under 18 registers, paid by their
--       guardian
--   U4  an adult, and a self account with no date of birth, register
--   U5  start_new_payment_attempt refuses a retry once an under-18 date of
--       birth was written another way, and leaves the registration as it was
--
-- Since #714 a payer other than the participant needs an active guardianship
-- of them, so the guardian in U3 has one.
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs, so it builds throwaway
-- fixtures and persists NOTHING. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_org        uuid;
  v_tournament uuid;
  v_adult      uuid;
  v_minor      uuid;
  v_eighteen   uuid;
  v_almost     uuid;
  v_no_dob     uuid;
  v_dependent  uuid;
  v_guardian   uuid;
  v_late       uuid;
  v_res        jsonb;
  v_reg        uuid;
  v_pay        uuid;
  v_status     text;
  v_count      integer;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('UNDER 18 ORG') RETURNING id INTO v_org;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'UNDER 18 T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'u18-adult@test.local', 'Ada', 'Adult') RETURNING id INTO v_adult;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'u18-minor@test.local', 'Mia', 'Minor') RETURNING id INTO v_minor;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'u18-eighteen@test.local', 'Ed', 'Eighteen') RETURNING id INTO v_eighteen;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'u18-almost@test.local', 'Al', 'Almost') RETURNING id INTO v_almost;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'u18-nodob@test.local', 'Nod', 'Ob') RETURNING id INTO v_no_dob;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'u18-guardian@test.local', 'Gus', 'Guardian') RETURNING id INTO v_guardian;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'u18-late@test.local', 'Lee', 'Late') RETURNING id INTO v_late;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Dee', 'Dependent', 'managed') RETURNING id INTO v_dependent;

  INSERT INTO player_profiles (user_id, date_of_birth) VALUES
    (v_adult,     date '1990-01-01'),
    (v_minor,     (v_today - interval '15 years')::date),
    (v_eighteen,  (v_today - interval '18 years')::date),
    (v_almost,    (v_today - interval '18 years')::date + 1),
    (v_no_dob,    NULL),
    (v_guardian,  date '1980-01-01'),
    (v_late,      NULL),
    (v_dependent, (v_today - interval '10 years')::date);

  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship,
                             basis, terms_version, terms_accepted_at)
    VALUES (v_guardian, v_dependent, 'parent', 'minor', '2026-11-24', now());

  -- ===== U1 ===============================================================
  IF NOT self_managed_minor(v_minor) OR NOT self_managed_minor(v_almost) THEN
    RAISE EXCEPTION 'U1 FAIL: an under-18 self account was not flagged';
  END IF;
  IF self_managed_minor(v_adult) OR self_managed_minor(v_eighteen)
     OR self_managed_minor(v_no_dob) OR self_managed_minor(v_dependent)
     OR self_managed_minor(gen_random_uuid()) THEN
    RAISE EXCEPTION 'U1 FAIL: flagged an adult, an 18th birthday, no DOB, a dependent or nobody';
  END IF;
  RAISE NOTICE 'U1 PASS: self_managed_minor';

  -- ===== U2 ===============================================================
  BEGIN
    PERFORM create_registration_with_payment(v_minor, v_tournament, 'standard', 10000);
    RAISE EXCEPTION 'U2 FAIL: an under-18 self-managed account registered';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'UNDER_18%' THEN RAISE EXCEPTION 'U2 FAIL: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM create_registration_with_payment(v_almost, v_tournament, 'standard', 10000, v_guardian);
    RAISE EXCEPTION 'U2 FAIL: an under-18 self-managed account registered with someone else paying';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'UNDER_18%' THEN RAISE EXCEPTION 'U2 FAIL: got %', SQLERRM; END IF;
  END;
  SELECT count(*) INTO v_count FROM registrations WHERE user_id IN (v_minor, v_almost);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'U2 FAIL: a refused registration left % rows', v_count;
  END IF;
  RAISE NOTICE 'U2 PASS: an under-18 self-managed participant is refused';

  -- ===== U3 ===============================================================
  v_res := create_registration_with_payment(v_dependent, v_tournament, 'standard', 10000, v_guardian);
  IF NOT EXISTS (SELECT 1 FROM registrations
                 WHERE id = (v_res->>'registration_id')::uuid AND user_id = v_dependent) THEN
    RAISE EXCEPTION 'U3 FAIL: the dependent was not registered';
  END IF;
  RAISE NOTICE 'U3 PASS: a managed dependent under 18 registers';

  -- ===== U4 ===============================================================
  PERFORM create_registration_with_payment(v_adult, v_tournament, 'standard', 10000);
  PERFORM create_registration_with_payment(v_eighteen, v_tournament, 'standard', 10000);
  PERFORM create_registration_with_payment(v_no_dob, v_tournament, 'standard', 10000);
  RAISE NOTICE 'U4 PASS: adults and accounts with no date of birth register';

  -- ===== U5 ===============================================================
  v_res := create_registration_with_payment(v_late, v_tournament, 'standard', 10000);
  v_reg := (v_res->>'registration_id')::uuid;
  v_pay := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay, false);
  UPDATE player_profiles SET date_of_birth = (v_today - interval '16 years')::date
    WHERE user_id = v_late;

  BEGIN
    PERFORM start_new_payment_attempt(v_reg, 'standard', 10000);
    RAISE EXCEPTION 'U5 FAIL: a retry went through for an under-18 self-managed account';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'UNDER_18%' THEN RAISE EXCEPTION 'U5 FAIL: got %', SQLERRM; END IF;
  END;
  SELECT status INTO v_status FROM registrations WHERE id = v_reg;
  SELECT count(*) INTO v_count FROM payments WHERE registration_id = v_reg;
  IF v_status <> 'failed_payment' OR v_count <> 1 THEN
    RAISE EXCEPTION 'U5 FAIL: a refused retry changed the registration (%, % payments)', v_status, v_count;
  END IF;
  RAISE NOTICE 'U5 PASS: a retry is refused once the date of birth says under 18';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
