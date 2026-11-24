-- =============================================================================
-- Regression test: a guardian creates and revokes dependents through
-- create_dependent() and revoke_dependent() (#712).
--
-- Covers:
--   D1  a minor dependent: managed users row with no login or email, a
--       player_profiles row with the date of birth, an active 'minor'
--       guardianship with the Terms version and no authorisation method; the
--       guardian reads the dependent's profile through can_act_for()
--   D2  an authorised adult dependent records 'guardian_attestation' and a
--       lower-cased contact email
--   D3  the basis must match the age (minor under 18, authorised 18 or over),
--       'appointed' is refused, and a future date of birth, a blank name,
--       missing Terms, a contact email on a minor and a 'carer' minor are
--       refused; nothing is written by a refused call
--   D4  only a live self-managed account with a login can add dependents
--   D5  adding the same dependent again: active raises DEPENDENT_EXISTS;
--       revoked reactivates the same row and player record (case-insensitive
--       name match), with the new basis and Terms
--   D6  revoke: a stranger or a second revoke gets DEPENDENT_NOT_FOUND; a
--       pending_payment registration blocks it; confirmed upcoming
--       registrations are returned, not cancelled; registrations and payments
--       are unchanged; the guardian loses access at once
--   D7  the cap of 10 active dependents holds for create and reactivation
--   D8  contact_email is refused on a self-managed account
--   D9  clients can't call either function
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs, so it builds throwaway
-- fixtures and persists NOTHING. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_today          date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_child_dob      date := ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '10 years')::date;
  v_adult_dob      date := ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '40 years')::date;
  v_just_18_dob    date := ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date;
  v_guardian_auth  uuid := gen_random_uuid();
  v_other_auth     uuid := gen_random_uuid();
  v_guardian       uuid;
  v_other          uuid;
  v_managed        uuid;
  v_org            uuid;
  v_t_upcoming     uuid;
  v_t_second       uuid;
  v_res            jsonb;
  v_child          uuid;
  v_child_g        uuid;
  v_adult          uuid;
  v_reg_confirmed  uuid;
  v_reg_pending    uuid;
  v_pay_confirmed  uuid;
  v_pay_pending    uuid;
  v_gross          integer;
  v_users_before   integer;
  v_count          integer;
  v_row            record;
  v_i              integer;
BEGIN
  -- ---- fixtures ------------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_guardian_auth, 'dependents-guardian@test.local', 'Gina', 'Guardian')
    RETURNING id INTO v_guardian;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_other_auth, 'dependents-other@test.local', 'Otto', 'Other')
    RETURNING id INTO v_other;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Mia', 'Managed', 'managed')
    RETURNING id INTO v_managed;
  INSERT INTO player_profiles (user_id) VALUES (v_guardian), (v_other), (v_managed);

  INSERT INTO organizations (name) VALUES ('DEPENDENTS ORG') RETURNING id INTO v_org;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES
    (v_org, 'DEPENDENTS UPCOMING', 'Venue', 'Selangor', 'Address',
     current_date + 30, current_date + 31, now() + interval '20 days',
     '{"type":"classical","rounds":9,"system":"swiss"}',
     '{"base_minutes":90,"increment_seconds":30}',
     '{"standard": {"amount_cents": 10000}}', 100, 'published')
  RETURNING id INTO v_t_upcoming;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES
    (v_org, 'DEPENDENTS SECOND', 'Venue', 'Selangor', 'Address',
     current_date + 40, current_date + 41, now() + interval '30 days',
     '{"type":"classical","rounds":9,"system":"swiss"}',
     '{"base_minutes":90,"increment_seconds":30}',
     '{"standard": {"amount_cents": 10000}}', 100, 'published')
  RETURNING id INTO v_t_second;

  -- ===== D1 ===============================================================
  v_res := create_dependent(v_guardian, '  Kai ', 'Child', v_child_dob,
                            'parent', 'minor', '2026-11-24', 'male', 'Malaysia');
  v_child   := (v_res->>'dependent_id')::uuid;
  v_child_g := (v_res->>'guardianship_id')::uuid;
  IF (v_res->>'reactivated')::boolean THEN
    RAISE EXCEPTION 'D1 FAIL: a new dependent was reported as reactivated';
  END IF;

  SELECT u.account_type, u.auth_user_id, u.email, u.first_name, u.contact_email,
         p.date_of_birth, p.gender, p.nationality
    INTO v_row
    FROM users u JOIN player_profiles p ON p.user_id = u.id
    WHERE u.id = v_child;
  IF v_row.account_type <> 'managed' OR v_row.auth_user_id IS NOT NULL
     OR v_row.email IS NOT NULL OR v_row.contact_email IS NOT NULL
     OR v_row.first_name <> 'Kai' OR v_row.date_of_birth <> v_child_dob
     OR v_row.gender <> 'male' OR v_row.nationality <> 'Malaysia' THEN
    RAISE EXCEPTION 'D1 FAIL: dependent rows are %', row_to_json(v_row);
  END IF;

  SELECT * INTO v_row FROM guardianships WHERE id = v_child_g;
  IF v_row.guardian_user_id <> v_guardian OR v_row.dependent_user_id <> v_child
     OR v_row.status <> 'active' OR v_row.basis <> 'minor'
     OR v_row.relationship <> 'parent' OR v_row.authorisation_method IS NOT NULL
     OR v_row.terms_version <> '2026-11-24' OR v_row.terms_accepted_at IS NULL THEN
    RAISE EXCEPTION 'D1 FAIL: guardianship is %', row_to_json(v_row);
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_guardian_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM player_profiles WHERE user_id = v_child;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'D1 FAIL: the guardian can''t read the new dependent''s profile';
  END IF;
  RAISE NOTICE 'D1 PASS: a minor dependent is created in one call';

  -- ===== D2 ===============================================================
  v_res := create_dependent(v_guardian, 'Ada', 'Assisted', v_adult_dob,
                            'carer', 'authorised', '2026-11-24',
                            p_contact_email => '  Ada.Assisted@Example.COM ');
  v_adult := (v_res->>'dependent_id')::uuid;
  SELECT g.authorisation_method, g.basis, u.contact_email, u.email INTO v_row
    FROM guardianships g JOIN users u ON u.id = g.dependent_user_id
    WHERE g.id = (v_res->>'guardianship_id')::uuid;
  IF v_row.authorisation_method <> 'guardian_attestation' OR v_row.basis <> 'authorised'
     OR v_row.contact_email <> 'ada.assisted@example.com' OR v_row.email IS NOT NULL THEN
    RAISE EXCEPTION 'D2 FAIL: authorised dependent is %', row_to_json(v_row);
  END IF;

  v_res := create_dependent(v_guardian, 'Eve', 'Eighteen', v_just_18_dob,
                            'coach', 'authorised', '2026-11-24');
  PERFORM revoke_dependent(v_guardian, (v_res->>'dependent_id')::uuid);
  RAISE NOTICE 'D2 PASS: an authorised adult records the attestation and contact email';

  -- ===== D3 ===============================================================
  SELECT count(*) INTO v_users_before FROM users;

  BEGIN
    PERFORM create_dependent(v_guardian, 'Old', 'Minor', v_adult_dob, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D3 FAIL: an adult was added as a minor';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'BASIS_AGE_MISMATCH%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_dependent(v_guardian, 'Young', 'Adult', v_child_dob, 'carer', 'authorised', '2026-11-24');
    RAISE EXCEPTION 'D3 FAIL: a child was added as authorised';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'BASIS_AGE_MISMATCH%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_dependent(v_guardian, 'Just', 'Turned', v_just_18_dob, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D3 FAIL: someone turning 18 today was added as a minor';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'BASIS_AGE_MISMATCH%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_dependent(v_guardian, 'App', 'Ointed', v_adult_dob, 'legal_guardian', 'appointed', '2026-11-24');
    RAISE EXCEPTION 'D3 FAIL: an appointed guardianship was created';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'BASIS_NOT_SUPPORTED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_dependent(v_guardian, 'Not', 'Born', v_today + 1, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D3 FAIL: a future date of birth was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVALID_DEPENDENT%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_dependent(v_guardian, '   ', 'Blank', v_child_dob, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D3 FAIL: a blank first name was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVALID_DEPENDENT%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_dependent(v_guardian, 'No', 'Terms', v_child_dob, 'parent', 'minor', ' ');
    RAISE EXCEPTION 'D3 FAIL: missing Terms were accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVALID_DEPENDENT%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_dependent(v_guardian, 'Kid', 'Mail', v_child_dob, 'parent', 'minor', '2026-11-24',
                             p_contact_email => 'kid@example.com');
    RAISE EXCEPTION 'D3 FAIL: a minor got a contact email';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVALID_DEPENDENT%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_dependent(v_guardian, 'Carer', 'Kid', v_child_dob, 'carer', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D3 FAIL: a carer was recorded as a minor''s guardian';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  SELECT count(*) INTO v_count FROM users;
  IF v_count <> v_users_before THEN
    RAISE EXCEPTION 'D3 FAIL: refused calls left % users rows behind', v_count - v_users_before;
  END IF;
  RAISE NOTICE 'D3 PASS: basis, age and input rules are enforced';

  -- ===== D4 ===============================================================
  BEGIN
    PERFORM create_dependent(v_managed, 'Sub', 'Dependent', v_child_dob, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D4 FAIL: a managed account added a dependent';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'GUARDIAN_NOT_ELIGIBLE%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_dependent(gen_random_uuid(), 'Nobody', 'Child', v_child_dob, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D4 FAIL: a missing guardian added a dependent';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'GUARDIAN_NOT_ELIGIBLE%' THEN RAISE; END IF;
  END;
  UPDATE users SET deleted_at = now() WHERE id = v_other;
  BEGIN
    PERFORM create_dependent(v_other, 'Deleted', 'Child', v_child_dob, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D4 FAIL: a deleted account added a dependent';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'GUARDIAN_NOT_ELIGIBLE%' THEN RAISE; END IF;
  END;
  UPDATE users SET deleted_at = NULL WHERE id = v_other;
  RAISE NOTICE 'D4 PASS: only a live self-managed account can add dependents';

  -- ===== D5 ===============================================================
  BEGIN
    PERFORM create_dependent(v_guardian, 'kai', 'CHILD', v_child_dob, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D5 FAIL: the same active dependent was added twice';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'DEPENDENT_EXISTS%' THEN RAISE; END IF;
  END;

  v_res := create_dependent(v_other, 'Kai', 'Child', v_child_dob, 'parent', 'minor', '2026-11-24');
  IF (v_res->>'dependent_id')::uuid = v_child THEN
    RAISE EXCEPTION 'D5 FAIL: another guardian was attached to this guardian''s dependent by name';
  END IF;

  PERFORM revoke_dependent(v_guardian, v_child);
  SELECT count(*) INTO v_users_before FROM users;
  v_res := create_dependent(v_guardian, 'KAI', 'child', v_child_dob,
                            'legal_guardian', 'minor', '2026-12-01');
  IF NOT (v_res->>'reactivated')::boolean
     OR (v_res->>'dependent_id')::uuid <> v_child
     OR (v_res->>'guardianship_id')::uuid <> v_child_g THEN
    RAISE EXCEPTION 'D5 FAIL: re-adding a revoked dependent returned %', v_res;
  END IF;
  SELECT count(*) INTO v_count FROM users;
  IF v_count <> v_users_before THEN
    RAISE EXCEPTION 'D5 FAIL: re-adding created a second player record';
  END IF;
  SELECT * INTO v_row FROM guardianships WHERE id = v_child_g;
  IF v_row.status <> 'active' OR v_row.revoked_at IS NOT NULL
     OR v_row.relationship <> 'legal_guardian' OR v_row.terms_version <> '2026-12-01' THEN
    RAISE EXCEPTION 'D5 FAIL: reactivated guardianship is %', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'D5 PASS: re-adding reactivates the existing record';

  -- ===== D6 ===============================================================
  v_res := create_registration_with_payment(v_child, v_t_upcoming, 'standard', 10000, v_guardian);
  v_reg_confirmed := (v_res->>'registration_id')::uuid;
  v_pay_confirmed := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_confirmed;
  PERFORM settle_registration_payment(v_pay_confirmed, true, v_gross, 'fpx_b2c');

  v_res := create_registration_with_payment(v_child, v_t_second, 'standard', 10000, v_guardian);
  v_reg_pending := (v_res->>'registration_id')::uuid;
  v_pay_pending := (v_res->>'payment_id')::uuid;

  BEGIN
    PERFORM revoke_dependent(v_other, v_child);
    RAISE EXCEPTION 'D6 FAIL: a stranger revoked the dependent';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'DEPENDENT_NOT_FOUND%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM revoke_dependent(v_guardian, v_child);
    RAISE EXCEPTION 'D6 FAIL: revoked with a pending payment';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'DEPENDENT_HAS_PENDING_PAYMENT%' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM guardianships WHERE id = v_child_g AND status = 'active') THEN
    RAISE EXCEPTION 'D6 FAIL: a refused revoke changed the guardianship';
  END IF;

  PERFORM settle_registration_payment(v_pay_pending, false);
  IF EXISTS (SELECT 1 FROM registrations WHERE id = v_reg_pending AND status = 'pending_payment') THEN
    RAISE EXCEPTION 'D6 setup: the pending registration didn''t fail';
  END IF;

  v_res := revoke_dependent(v_guardian, v_child);
  IF jsonb_array_length(v_res->'upcoming_registrations') <> 1
     OR (v_res->'upcoming_registrations'->0->>'registration_id')::uuid <> v_reg_confirmed
     OR v_res->'upcoming_registrations'->0->>'tournament_name' <> 'DEPENDENTS UPCOMING' THEN
    RAISE EXCEPTION 'D6 FAIL: revoke returned %', v_res;
  END IF;

  SELECT * INTO v_row FROM guardianships WHERE id = v_child_g;
  IF v_row.status <> 'revoked' OR v_row.revoked_at IS NULL THEN
    RAISE EXCEPTION 'D6 FAIL: guardianship after revoke is %', row_to_json(v_row);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = v_reg_confirmed AND status = 'confirmed' AND user_id = v_child)
     OR NOT EXISTS (SELECT 1 FROM payments WHERE id = v_pay_confirmed AND status = 'paid' AND user_id = v_guardian)
     OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_child AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'D6 FAIL: revoke changed the dependent''s registrations, payments or record';
  END IF;

  BEGIN
    PERFORM revoke_dependent(v_guardian, v_child);
    RAISE EXCEPTION 'D6 FAIL: revoked twice';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'DEPENDENT_NOT_FOUND%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_guardian_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM player_profiles WHERE user_id = v_child;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'D6 FAIL: the guardian still reads a revoked dependent''s profile';
  END IF;
  RAISE NOTICE 'D6 PASS: revoke keeps the dependent''s history and warns about upcoming events';

  -- ===== D7 ===============================================================
  SELECT count(*) INTO v_count FROM guardianships
    WHERE guardian_user_id = v_guardian AND status = 'active';
  FOR v_i IN 1 .. (10 - v_count) LOOP
    PERFORM create_dependent(v_guardian, 'Cap' || v_i, 'Child', v_child_dob, 'parent', 'minor', '2026-11-24');
  END LOOP;
  BEGIN
    PERFORM create_dependent(v_guardian, 'Eleventh', 'Child', v_child_dob, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D7 FAIL: an 11th dependent was created';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'GUARDIANSHIP_LIMIT_REACHED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_dependent(v_guardian, 'Kai', 'Child', v_child_dob, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D7 FAIL: a revoked dependent was reactivated past the cap';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'GUARDIANSHIP_LIMIT_REACHED%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'D7 PASS: the cap of 10 active dependents holds';

  -- ===== D8 ===============================================================
  BEGIN
    UPDATE users SET contact_email = 'x@example.com' WHERE id = v_guardian;
    RAISE EXCEPTION 'D8 FAIL: a self-managed account got a contact email';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'D8 PASS: contact_email is for managed accounts only';

  -- ===== D9 ===============================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_guardian_auth, 'role', 'authenticated')::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM create_dependent(v_guardian, 'Client', 'Child', v_child_dob, 'parent', 'minor', '2026-11-24');
    RAISE EXCEPTION 'D9 FAIL: a client called create_dependent';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM revoke_dependent(v_guardian, v_adult);
    RAISE EXCEPTION 'D9 FAIL: a client called revoke_dependent';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RAISE NOTICE 'D9 PASS: clients can''t call the dependent functions';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
