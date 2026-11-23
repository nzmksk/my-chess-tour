-- =============================================================================
-- Regression test: the guardianship schema (#706).
--
-- Covers:
--   G1  users.account_type defaults to 'self'; only a managed account may have
--       no email; a managed account has no login; unknown types are refused
--   G2  registrations.registered_by defaults to NULL and is cleared, not
--       cascaded, when that account is deleted
--   G3  guardianship constraints: no self-guardianship, one row per pair,
--       known relationship / basis / status / method values, a minor's
--       guardian is a parent or legal guardian with no authorisation method,
--       an adult's always has one, and revoked <=> revoked_at
--   G4  deleting either side of a guardianship is refused (RESTRICT)
--   G5  a guardian holds at most 10 active guardianships: the 11th insert and
--       reactivating a revoked one at the cap are refused; revoked and claimed
--       rows don't count
--   G6  inserts and updates are written to audit_logs
--   G7  RLS: the guardian and a dependent with a login can read the row,
--       anyone else can't, and a client can't write
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs, so it builds throwaway
-- fixtures and persists NOTHING. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_guardian_auth uuid := gen_random_uuid();
  v_adult_auth    uuid := gen_random_uuid();
  v_stranger_auth uuid := gen_random_uuid();
  v_guardian      uuid;
  v_adult         uuid;
  v_stranger      uuid;
  v_child         uuid;
  v_kids          uuid[] := ARRAY[]::uuid[];
  v_kid           uuid;
  v_org           uuid;
  v_tournament    uuid;
  v_registrar     uuid;
  v_reg           uuid;
  v_g_child       uuid;
  v_g_adult       uuid;
  v_g_tenth       uuid;
  v_type          text;
  v_by            uuid;
  v_count         integer;
  v_ok            boolean;
  i               integer;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_guardian_auth, 'guard-guardian@test.local', 'Gina', 'Guardian')
    RETURNING id INTO v_guardian;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_adult_auth, 'guard-adult@test.local', 'Ada', 'Adult')
    RETURNING id INTO v_adult;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_stranger_auth, 'guard-stranger@test.local', 'Stan', 'Stranger')
    RETURNING id INTO v_stranger;

  -- ===== G1 ===============================================================
  SELECT account_type INTO v_type FROM users WHERE id = v_guardian;
  IF v_type <> 'self' THEN
    RAISE EXCEPTION 'G1 FAIL: account_type defaulted to % (expected self)', v_type;
  END IF;

  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Kai', 'Child', 'managed')
    RETURNING id INTO v_child;

  BEGIN
    INSERT INTO users (email, first_name, last_name) VALUES (NULL, 'No', 'Email');
    RAISE EXCEPTION 'G1 FAIL: a self account was created with no email';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO users (auth_user_id, email, first_name, last_name, account_type)
      VALUES (gen_random_uuid(), 'guard-managed-login@test.local', 'Has', 'Login', 'managed');
    RAISE EXCEPTION 'G1 FAIL: a managed account was created with a login';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO users (email, first_name, last_name, account_type)
      VALUES ('guard-odd@test.local', 'Odd', 'Type', 'shared');
    RAISE EXCEPTION 'G1 FAIL: an unknown account_type was accepted';
  EXCEPTION WHEN invalid_text_representation THEN NULL;
  END;

  BEGIN
    UPDATE users SET email = NULL WHERE id = v_adult;
    RAISE EXCEPTION 'G1 FAIL: a self account''s email was cleared';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'G1 PASS — account_type, nullable email and no-login rules hold';

  -- ===== G2 ===============================================================
  INSERT INTO organizations (name) VALUES ('GUARD ORG') RETURNING id INTO v_org;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'GUARD T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  v_reg := (create_registration_with_payment(v_adult, v_tournament, 'standard', 4000)
            ->> 'registration_id')::uuid;
  SELECT registered_by INTO v_by FROM registrations WHERE id = v_reg;
  IF v_by IS NOT NULL THEN
    RAISE EXCEPTION 'G2 FAIL: registered_by defaulted to % (expected NULL)', v_by;
  END IF;

  INSERT INTO users (email, first_name, last_name)
    VALUES ('guard-registrar@test.local', 'Reg', 'Istrar')
    RETURNING id INTO v_registrar;
  UPDATE registrations SET registered_by = v_registrar WHERE id = v_reg;
  DELETE FROM users WHERE id = v_registrar;
  SELECT registered_by INTO v_by FROM registrations WHERE id = v_reg;
  IF v_by IS NOT NULL OR NOT FOUND THEN
    RAISE EXCEPTION 'G2 FAIL: deleting the registrar left registered_by = % or removed the registration', v_by;
  END IF;
  RAISE NOTICE 'G2 PASS — registered_by is NULL by default and set null on delete';

  -- ===== G3 ===============================================================
  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                             terms_version, terms_accepted_at)
    VALUES (v_guardian, v_child, 'parent', 'minor', '2026-11-23', now())
    RETURNING id INTO v_g_child;

  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                             authorisation_method, terms_version, terms_accepted_at)
    VALUES (v_guardian, v_adult, 'carer', 'authorised', 'player_invite', '2026-11-23', now())
    RETURNING id INTO v_g_adult;

  BEGIN
    INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                               authorisation_method, terms_version, terms_accepted_at)
      VALUES (v_adult, v_adult, 'other', 'authorised', 'player_invite', '2026-11-23', now());
    RAISE EXCEPTION 'G3 FAIL: someone became their own guardian';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                               terms_version, terms_accepted_at)
      VALUES (v_guardian, v_child, 'legal_guardian', 'minor', '2026-11-23', now());
    RAISE EXCEPTION 'G3 FAIL: a second row for the same pair was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  FOR i IN 1..7 LOOP
    v_ok := false;
    BEGIN
      CASE i
        WHEN 1 THEN  -- unknown relationship
          INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                                     authorisation_method, terms_version, terms_accepted_at)
            VALUES (v_stranger, v_adult, 'sibling', 'authorised', 'player_invite', 'v', now());
        WHEN 2 THEN  -- unknown basis
          INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                                     authorisation_method, terms_version, terms_accepted_at)
            VALUES (v_stranger, v_adult, 'carer', 'inferred', 'player_invite', 'v', now());
        WHEN 3 THEN  -- unknown status
          INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                                     authorisation_method, status, terms_version, terms_accepted_at)
            VALUES (v_stranger, v_adult, 'carer', 'authorised', 'player_invite', 'paused', 'v', now());
        WHEN 4 THEN  -- unknown authorisation method
          INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                                     authorisation_method, terms_version, terms_accepted_at)
            VALUES (v_stranger, v_adult, 'carer', 'authorised', 'email', 'v', now());
        WHEN 5 THEN  -- a minor's guardian with an authorisation method
          INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                                     authorisation_method, terms_version, terms_accepted_at)
            VALUES (v_stranger, v_child, 'parent', 'minor', 'document', 'v', now());
        WHEN 6 THEN  -- an adult's helper with no authorisation method
          INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                                     terms_version, terms_accepted_at)
            VALUES (v_stranger, v_adult, 'carer', 'authorised', 'v', now());
        WHEN 7 THEN  -- a coach accepting the Terms for a child
          INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                                     terms_version, terms_accepted_at)
            VALUES (v_stranger, v_child, 'coach', 'minor', 'v', now());
      END CASE;
    EXCEPTION WHEN check_violation OR invalid_text_representation THEN
      v_ok := true;
    END;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'G3 FAIL: invalid guardianship case % was accepted', i;
    END IF;
  END LOOP;

  BEGIN
    UPDATE guardianships SET status = 'revoked' WHERE id = v_g_adult;
    RAISE EXCEPTION 'G3 FAIL: revoked without a revoked_at';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE guardianships SET revoked_at = now() WHERE id = v_g_adult;
    RAISE EXCEPTION 'G3 FAIL: an active row carries a revoked_at';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                               terms_version, terms_accepted_at)
      VALUES (v_guardian, v_stranger, 'parent', 'minor', NULL, now());
    RAISE EXCEPTION 'G3 FAIL: a guardianship was created with no Terms version';
  EXCEPTION WHEN not_null_violation THEN NULL;
  END;
  RAISE NOTICE 'G3 PASS — guardianship constraints hold';

  -- ===== G4 ===============================================================
  BEGIN
    DELETE FROM users WHERE id = v_child;
    RAISE EXCEPTION 'G4 FAIL: a dependent was deleted out from under a guardianship';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM users WHERE id = v_guardian;
    RAISE EXCEPTION 'G4 FAIL: a guardian was deleted out from under a guardianship';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'G4 PASS — neither side of a guardianship can be deleted';

  -- ===== G5 ===============================================================
  -- v_guardian holds 2 active rows (the child, the adult). Add 8 more to reach 10.
  FOR i IN 1..9 LOOP
    INSERT INTO users (email, first_name, last_name, account_type)
      VALUES (NULL, 'Kid', i::text, 'managed')
      RETURNING id INTO v_kid;
    v_kids := v_kids || v_kid;
  END LOOP;

  FOR i IN 1..8 LOOP
    INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                               terms_version, terms_accepted_at)
      VALUES (v_guardian, v_kids[i], 'parent', 'minor', 'v', now())
      RETURNING id INTO v_g_tenth;
  END LOOP;

  SELECT count(*) INTO v_count FROM guardianships
  WHERE guardian_user_id = v_guardian AND status = 'active';
  IF v_count <> 10 THEN
    RAISE EXCEPTION 'G5 FAIL: guardian holds % active rows (expected 10)', v_count;
  END IF;

  BEGIN
    INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                               terms_version, terms_accepted_at)
      VALUES (v_guardian, v_kids[9], 'parent', 'minor', 'v', now());
    RAISE EXCEPTION 'G5 FAIL: an 11th active guardianship was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'GUARDIANSHIP_LIMIT_REACHED%' THEN RAISE; END IF;
  END;

  -- A revoked row frees a place, and a claimed row doesn't take one.
  UPDATE guardianships SET status = 'revoked', revoked_at = now() WHERE id = v_g_tenth;
  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                             terms_version, terms_accepted_at)
    VALUES (v_guardian, v_kids[9], 'parent', 'minor', 'v', now());

  BEGIN
    UPDATE guardianships SET status = 'active', revoked_at = NULL WHERE id = v_g_tenth;
    RAISE EXCEPTION 'G5 FAIL: reactivating a revoked row went past the cap';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'GUARDIANSHIP_LIMIT_REACHED%' THEN RAISE; END IF;
  END;

  UPDATE guardianships SET status = 'claimed' WHERE id = v_g_adult;
  UPDATE guardianships SET status = 'active', revoked_at = NULL WHERE id = v_g_tenth;

  -- Editing an active row in place isn't a new place.
  UPDATE guardianships SET relationship = 'legal_guardian' WHERE id = v_g_child;
  UPDATE guardianships SET status = 'active' WHERE id = v_g_child;
  RAISE NOTICE 'G5 PASS — at most 10 active guardianships per guardian';

  -- ===== G6 ===============================================================
  SELECT count(*) INTO v_count FROM audit_logs
  WHERE table_name = 'guardianships' AND record_id = v_g_child::text AND action = 'INSERT';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'G6 FAIL: % INSERT audit rows for the guardianship (expected 1)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM audit_logs
  WHERE table_name = 'guardianships' AND record_id = v_g_tenth::text AND action = 'UPDATE';
  IF v_count < 2 THEN
    RAISE EXCEPTION 'G6 FAIL: % UPDATE audit rows for the revoked and restored row (expected 2+)', v_count;
  END IF;
  RAISE NOTICE 'G6 PASS — guardianship writes are audited';

  -- ===== G7 ===============================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_guardian_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM guardianships;
  RESET ROLE;
  IF v_count <> 11 THEN
    RAISE EXCEPTION 'G7 FAIL: guardian sees % rows (expected their 11)', v_count;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_adult_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM guardianships;
  RESET ROLE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'G7 FAIL: the adult dependent sees % rows (expected 1)', v_count;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_stranger_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM guardianships;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'G7 FAIL: an unrelated user sees % rows (expected 0)', v_count;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_guardian_auth, 'role', 'authenticated')::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                               authorisation_method, terms_version, terms_accepted_at)
      VALUES (v_guardian, v_stranger, 'carer', 'authorised', 'guardian_attestation', 'v', now());
    RAISE EXCEPTION 'G7 FAIL: a client inserted a guardianship';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE guardianships SET status = 'revoked', revoked_at = now() WHERE id = v_g_child;
    RAISE EXCEPTION 'G7 FAIL: a client updated a guardianship';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);

  FOREACH v_type IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
    IF has_table_privilege('authenticated', 'guardianships', v_type)
       OR has_table_privilege('anon', 'guardianships', v_type) THEN
      RAISE EXCEPTION 'G7 FAIL: a client role holds % on guardianships', v_type;
    END IF;
  END LOOP;
  RAISE NOTICE 'G7 PASS — guardian and dependent read, nobody else, no client writes';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
