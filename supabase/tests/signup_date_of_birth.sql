-- =============================================================================
-- Regression test for the date of birth taken at signup (#710).
--
-- Signup asks for a date of birth, and an account holder must be 18 or over.
-- The route refuses an under-18 date first; handle_new_user is the backstop for
-- an auth user created any other way.
--
-- Covers:
--   D1  handle_new_user copies date_of_birth from auth metadata onto
--       player_profiles
--   D2  no date_of_birth in the metadata leaves it NULL, so rows created outside
--       signup still work
--   D3  an under-18 date of birth refuses the signup and creates no users row;
--       the day before the 18th birthday is refused and the birthday itself
--       isn't (today in Asia/Kuala_Lumpur)
--   D4  a value that isn't a date refuses the signup
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it builds
-- throwaway fixtures and persists NOTHING. A failing assertion RAISEs (and rolls
-- back); on success it prints "ALL SCENARIOS PASSED" via NOTICE.
--
-- Inserts into auth.users directly to fire on_auth_user_created; that is what
-- the signup route does through the Auth API.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_today       date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_turns_18    date := ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date;
  v_auth        uuid;
  v_dob         date;
  v_refused     boolean;
BEGIN
  -- ---- D1: the date of birth reaches player_profiles ----------------------
  v_auth := gen_random_uuid();
  INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_auth, 'dob-d1@test.local',
            '{"first_name":"D","last_name":"One","date_of_birth":"1990-05-17"}'::jsonb);
  SELECT p.date_of_birth INTO v_dob
  FROM player_profiles p JOIN users u ON u.id = p.user_id
  WHERE u.auth_user_id = v_auth;
  IF v_dob IS DISTINCT FROM DATE '1990-05-17' THEN
    RAISE EXCEPTION 'D1 FAIL: date_of_birth = % (expected 1990-05-17)', v_dob;
  END IF;
  RAISE NOTICE 'D1 PASS — signup stores the date of birth';

  -- ---- D2: no date of birth stays NULL ------------------------------------
  v_auth := gen_random_uuid();
  INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_auth, 'dob-d2@test.local', '{"first_name":"D","last_name":"Two"}'::jsonb);
  SELECT p.date_of_birth INTO v_dob
  FROM player_profiles p JOIN users u ON u.id = p.user_id
  WHERE u.auth_user_id = v_auth;
  IF NOT FOUND OR v_dob IS NOT NULL THEN
    RAISE EXCEPTION 'D2 FAIL: expected a profile with no date of birth (found %, dob %)', FOUND, v_dob;
  END IF;
  RAISE NOTICE 'D2 PASS — no date of birth in the metadata leaves it NULL';

  -- ---- D3: under 18 is refused, the 18th birthday isn't -------------------
  v_auth := gen_random_uuid();
  v_refused := false;
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES (v_auth, 'dob-d3a@test.local',
              jsonb_build_object('first_name', 'D', 'last_name', 'ThreeA',
                                 'date_of_birth', (v_turns_18 + 1)::text));
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%UNDER_18%' THEN
      RAISE EXCEPTION 'D3 FAIL: wrong error for an under-18 date of birth: %', SQLERRM;
    END IF;
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'D3 FAIL: a signup the day before the 18th birthday was accepted';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE auth_user_id = v_auth) THEN
    RAISE EXCEPTION 'D3 FAIL: a refused signup left a users row';
  END IF;

  v_auth := gen_random_uuid();
  v_refused := false;
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES (v_auth, 'dob-d3b@test.local',
              jsonb_build_object('first_name', 'D', 'last_name', 'ThreeB',
                                 'date_of_birth', v_today::text));
  EXCEPTION WHEN raise_exception THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'D3 FAIL: a signup born today was accepted';
  END IF;

  v_auth := gen_random_uuid();
  INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_auth, 'dob-d3c@test.local',
            jsonb_build_object('first_name', 'D', 'last_name', 'ThreeC',
                               'date_of_birth', v_turns_18::text));
  SELECT p.date_of_birth INTO v_dob
  FROM player_profiles p JOIN users u ON u.id = p.user_id
  WHERE u.auth_user_id = v_auth;
  IF v_dob IS DISTINCT FROM v_turns_18 THEN
    RAISE EXCEPTION 'D3 FAIL: a signup on the 18th birthday was not stored (dob %)', v_dob;
  END IF;
  RAISE NOTICE 'D3 PASS — under 18 refused, 18 today accepted';

  -- ---- D4: a value that isn't a date is refused ---------------------------
  v_auth := gen_random_uuid();
  v_refused := false;
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES (v_auth, 'dob-d4@test.local',
              '{"first_name":"D","last_name":"Four","date_of_birth":"2000-02-30"}'::jsonb);
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    v_refused := true;
  END;
  IF NOT v_refused THEN
    RAISE EXCEPTION 'D4 FAIL: a signup with 2000-02-30 as its date of birth was accepted';
  END IF;
  RAISE NOTICE 'D4 PASS — a value that isn''t a date refuses the signup';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
