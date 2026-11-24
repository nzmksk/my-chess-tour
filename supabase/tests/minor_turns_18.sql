-- =============================================================================
-- Regression test: a minor dependent turns 18 (#721,
-- 20261124220000_minor_turns_18.sql).
--
-- Covers:
--   A1  minor_guardianship_aged_out: true from the 18th birthday, only on the
--       'minor' basis, never without a date of birth
--   A2  checkout: a guardian can't register an aged-out minor or start a new
--       payment attempt for them (AGED_OUT, 42501), and nothing is written; a
--       17-year-old still registers
--   A3  consent: a guardian's grant for an aged-out minor is refused; their
--       withdrawal is still recorded
--   N1  claim_guardianship_age_out_notices: an upcoming birthday and a passed
--       one each get one notice, once; outside the window, other bases and
--       revoked guardianships get none; access_ends_on = birthday + grace
--   E1  end_aged_out_minor_guardianships: revokes a guardianship whose grace
--       period is over and records the 'ended' notice; leaves one still in
--       grace, and one with a pending handover claim; an expired claim
--       doesn't hold it
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs, so it builds throwaway
-- fixtures and persists NOTHING. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

CREATE FUNCTION pg_temp.error_of(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || ' ' || SQLERRM;
END $$;

CREATE FUNCTION pg_temp.dob_turning_18_in(p_days integer) RETURNS date
LANGUAGE sql AS $$
  SELECT (((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date + p_days) - interval '18 years')::date;
$$;

CREATE FUNCTION pg_temp.dependent(p_name text, p_dob date) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, p_name, 'Dependent', 'managed') RETURNING id INTO v_id;
  INSERT INTO player_profiles (user_id, date_of_birth) VALUES (v_id, p_dob);
  RETURN v_id;
END $$;

CREATE FUNCTION pg_temp.guard(p_guardian uuid, p_dependent uuid, p_basis guardianship_basis DEFAULT 'minor')
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship,
                             basis, authorisation_method, terms_version, terms_accepted_at)
    VALUES (p_guardian, p_dependent,
            CASE WHEN p_basis = 'minor' THEN 'parent' ELSE 'carer' END::guardianship_relationship,
            p_basis,
            CASE WHEN p_basis = 'minor' THEN NULL ELSE 'guardian_attestation' END::guardianship_authorisation_method,
            '2026-11-24', now())
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

DO $$
DECLARE
  v_guardian  uuid;
  v_org       uuid;
  v_t         uuid;
  v_adult18   uuid;  -- turned 18 today
  v_seventeen uuid;  -- turns 18 tomorrow
  v_soon      uuid;  -- turns 18 in 10 days
  v_far       uuid;  -- turns 18 in 60 days
  v_helped    uuid;  -- authorised basis, turns 18 in 10 days
  v_revoked   uuid;  -- revoked guardianship, turns 18 in 10 days
  v_grace     uuid;  -- turned 18 ten days ago
  v_over      uuid;  -- turned 18 forty days ago
  v_claiming  uuid;  -- turned 18 forty days ago, pending handover claim
  v_lapsed    uuid;  -- turned 18 forty days ago, expired handover claim
  g_adult18   uuid;
  g_soon      uuid;
  g_grace     uuid;
  g_over      uuid;
  g_claiming  uuid;
  g_lapsed    uuid;
  v_reg       uuid;
  v_err       text;
  v_count     integer;
  v_row       record;
  v_today     date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'mt18-guardian@test.local', 'Gwen', 'Guardian')
    RETURNING id INTO v_guardian;

  v_adult18   := pg_temp.dependent('Adam',  pg_temp.dob_turning_18_in(0));
  v_seventeen := pg_temp.dependent('Sean',  pg_temp.dob_turning_18_in(1));
  v_soon      := pg_temp.dependent('Sara',  pg_temp.dob_turning_18_in(10));
  v_far       := pg_temp.dependent('Faris', pg_temp.dob_turning_18_in(60));
  v_helped    := pg_temp.dependent('Hani',  pg_temp.dob_turning_18_in(10));
  v_revoked   := pg_temp.dependent('Rina',  pg_temp.dob_turning_18_in(10));
  v_grace     := pg_temp.dependent('Gina',  pg_temp.dob_turning_18_in(-10));
  v_over      := pg_temp.dependent('Omar',  pg_temp.dob_turning_18_in(-40));
  v_claiming  := pg_temp.dependent('Cali',  pg_temp.dob_turning_18_in(-40));
  v_lapsed    := pg_temp.dependent('Lina',  pg_temp.dob_turning_18_in(-40));

  g_adult18  := pg_temp.guard(v_guardian, v_adult18);
  PERFORM pg_temp.guard(v_guardian, v_seventeen);
  g_soon     := pg_temp.guard(v_guardian, v_soon);
  PERFORM pg_temp.guard(v_guardian, v_far);
  PERFORM pg_temp.guard(v_guardian, v_helped, 'authorised');
  PERFORM pg_temp.guard(v_guardian, v_revoked);
  UPDATE guardianships SET status = 'revoked', revoked_at = now() WHERE dependent_user_id = v_revoked;
  g_grace    := pg_temp.guard(v_guardian, v_grace);
  g_over     := pg_temp.guard(v_guardian, v_over);
  g_claiming := pg_temp.guard(v_guardian, v_claiming);
  g_lapsed   := pg_temp.guard(v_guardian, v_lapsed);

  INSERT INTO account_claims (dependent_user_id, guardian_user_id, email, token_hash, expires_at)
  VALUES (v_claiming, v_guardian, 'cali@test.local', md5('cali') || md5('cali-2'), now() + interval '2 days'),
         (v_lapsed,   v_guardian, 'lina@test.local', md5('lina') || md5('lina-2'), now() - interval '1 day');

  INSERT INTO organizations (name) VALUES ('MT18 ORG') RETURNING id INTO v_org;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'MT18 T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}',
    100, 'published'
  ) RETURNING id INTO v_t;

  -- ===== A1: the test ========================================================
  IF NOT minor_guardianship_aged_out('minor', pg_temp.dob_turning_18_in(0)) THEN
    RAISE EXCEPTION 'A1 FAIL: the 18th birthday itself must count';
  END IF;
  IF minor_guardianship_aged_out('minor', pg_temp.dob_turning_18_in(1)) THEN
    RAISE EXCEPTION 'A1 FAIL: the day before the 18th birthday must not count';
  END IF;
  IF minor_guardianship_aged_out('authorised', pg_temp.dob_turning_18_in(-100)) THEN
    RAISE EXCEPTION 'A1 FAIL: an adult basis never ages out';
  END IF;
  IF minor_guardianship_aged_out('minor', NULL) IS NOT FALSE THEN
    RAISE EXCEPTION 'A1 FAIL: no date of birth must be false, not NULL';
  END IF;
  RAISE NOTICE 'A1 PASS — a minor guardianship ages out on the 18th birthday';

  -- ===== A2: checkout ==========================================================
  v_err := pg_temp.error_of(format(
    $q$SELECT create_registration_with_payment(%L, %L, 'standard', 4000, p_payer_user_id => %L)$q$,
    v_adult18, v_t, v_guardian));
  IF v_err NOT LIKE '42501%AGED_OUT%' THEN
    RAISE EXCEPTION 'A2 FAIL: registering an 18-year-old gave %', COALESCE(v_err, 'no error');
  END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE user_id = v_adult18) THEN
    RAISE EXCEPTION 'A2 FAIL: a refused registration was written';
  END IF;

  PERFORM create_registration_with_payment(v_seventeen, v_t, 'standard', 4000, p_payer_user_id => v_guardian);

  INSERT INTO registrations (user_id, tournament_id, fee_tier, status)
    VALUES (v_grace, v_t, 'standard', 'failed_payment') RETURNING id INTO v_reg;
  v_err := pg_temp.error_of(format(
    $q$SELECT start_new_payment_attempt(%L, 'standard', 4000, %L)$q$, v_reg, v_guardian));
  IF v_err NOT LIKE '42501%AGED_OUT%' THEN
    RAISE EXCEPTION 'A2 FAIL: a new payment attempt for an aged-out minor gave %', COALESCE(v_err, 'no error');
  END IF;
  IF EXISTS (SELECT 1 FROM payments WHERE registration_id = v_reg) THEN
    RAISE EXCEPTION 'A2 FAIL: a refused payment attempt was written';
  END IF;
  RAISE NOTICE 'A2 PASS — no new registration or payment for an aged-out minor; a 17-year-old still registers';

  -- ===== A3: consent ===========================================================
  v_err := pg_temp.error_of(format(
    $q$SELECT record_sensitive_data_consent(%L, 'health', true, '2026-11-24', %L)$q$,
    v_adult18, v_guardian));
  IF v_err NOT LIKE '42501%AGED_OUT%' THEN
    RAISE EXCEPTION 'A3 FAIL: a guardian''s grant for an 18-year-old gave %', COALESCE(v_err, 'no error');
  END IF;

  INSERT INTO sensitive_data_consents (user_id, category, granted, version, granted_by, on_behalf_basis)
    VALUES (v_adult18, 'health', true, '2026-11-24', v_guardian, 'minor');
  IF NOT record_sensitive_data_consent(v_adult18, 'health', false, NULL, v_guardian) THEN
    RAISE EXCEPTION 'A3 FAIL: the guardian''s withdrawal was not recorded';
  END IF;
  IF record_sensitive_data_consent(v_seventeen, 'health', true, '2026-11-24', v_guardian) IS NOT TRUE THEN
    RAISE EXCEPTION 'A3 FAIL: a guardian''s grant for a 17-year-old was refused';
  END IF;
  RAISE NOTICE 'A3 PASS — an aged-out minor''s consent is their own; withdrawal still works';

  -- ===== E1: ending guardianships past the grace period =======================
  -- Runs before N1, as the scheduled job does, so a revoked guardianship gets
  -- no turned_18 notice.
  SELECT count(*) INTO v_count FROM end_aged_out_minor_guardianships(30);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'E1 FAIL: expected 2 guardianships ended, got %', v_count;
  END IF;
  IF (SELECT status FROM guardianships WHERE id = g_over) <> 'revoked'
     OR (SELECT status FROM guardianships WHERE id = g_lapsed) <> 'revoked' THEN
    RAISE EXCEPTION 'E1 FAIL: a guardianship past its grace period is still active';
  END IF;
  IF (SELECT status FROM guardianships WHERE id = g_grace) <> 'active' THEN
    RAISE EXCEPTION 'E1 FAIL: a guardianship still in its grace period was ended';
  END IF;
  IF (SELECT status FROM guardianships WHERE id = g_claiming) <> 'active' THEN
    RAISE EXCEPTION 'E1 FAIL: a pending handover claim did not hold the guardianship';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM guardianship_age_out_notices WHERE guardianship_id = g_over AND stage = 'ended') THEN
    RAISE EXCEPTION 'E1 FAIL: no ended notice recorded';
  END IF;
  IF (SELECT count(*) FROM end_aged_out_minor_guardianships(30)) <> 0 THEN
    RAISE EXCEPTION 'E1 FAIL: a second run ended something again';
  END IF;
  v_err := pg_temp.error_of('SELECT * FROM end_aged_out_minor_guardianships(-1)');
  IF v_err NOT LIKE '22023%' THEN
    RAISE EXCEPTION 'E1 FAIL: a negative grace period gave %', COALESCE(v_err, 'no error');
  END IF;
  RAISE NOTICE 'E1 PASS — the guardianship ends after the grace period unless a handover is pending';

  -- ===== N1: notices ===========================================================
  CREATE TEMP TABLE mt18_notices ON COMMIT DROP AS
    SELECT * FROM claim_guardianship_age_out_notices(30, 30);

  SELECT * INTO v_row FROM mt18_notices WHERE guardianship_id = g_soon;
  IF v_row.stage IS DISTINCT FROM 'upcoming'
     OR v_row.turns_18_on <> v_today + 10
     OR v_row.access_ends_on <> v_today + 40
     OR v_row.guardian_user_id <> v_guardian
     OR v_row.dependent_user_id <> v_soon THEN
    RAISE EXCEPTION 'N1 FAIL: upcoming notice: %', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM mt18_notices WHERE guardianship_id = g_grace;
  IF v_row.stage IS DISTINCT FROM 'turned_18' OR v_row.access_ends_on <> v_today + 20 THEN
    RAISE EXCEPTION 'N1 FAIL: turned_18 notice: %', row_to_json(v_row);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM mt18_notices WHERE guardianship_id = g_adult18 AND stage = 'turned_18') THEN
    RAISE EXCEPTION 'N1 FAIL: a birthday today must send the turned_18 notice';
  END IF;
  IF EXISTS (SELECT 1 FROM mt18_notices WHERE dependent_user_id IN (v_far, v_helped, v_revoked, v_over, v_lapsed)) THEN
    RAISE EXCEPTION 'N1 FAIL: a notice went to someone outside the window, on another basis, revoked or ended';
  END IF;
  IF (SELECT count(*) FROM claim_guardianship_age_out_notices(30, 30)) <> 0 THEN
    RAISE EXCEPTION 'N1 FAIL: a second run sent the same notices again';
  END IF;
  v_err := pg_temp.error_of('SELECT * FROM claim_guardianship_age_out_notices(-1, 30)');
  IF v_err NOT LIKE '22023%' THEN
    RAISE EXCEPTION 'N1 FAIL: a negative notice window gave %', COALESCE(v_err, 'no error');
  END IF;
  RAISE NOTICE 'N1 PASS — each notice goes out once, to active minor guardianships in the window';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
