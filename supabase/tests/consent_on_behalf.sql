-- =============================================================================
-- Regression test: a guardian or helper records sensitive-data consent for the
-- player they act for, and uploads the player's OKU card (#717).
--
-- Covers:
--   O1  a guardian records health consent for a minor dependent: user_id is
--       the dependent, granted_by the guardian, on_behalf_basis 'minor'
--   O2  a helper records consent for the self-managed adult they help, under
--       'authorised'
--   O3  the player's own consent leaves granted_by and on_behalf_basis NULL;
--       passing the player as p_recorded_by is the same as passing nothing
--   O4  a stranger and a revoked guardian are refused with NOT_GUARDIAN
--       (42501), and nothing is written
--   O5  a withdrawal by the guardian names them; withdrawing again is still a
--       no-op
--   O6  the log refuses granted_by without a basis, and granted_by naming the
--       subject
--   O7  has_sensitive_data_consent in a guardian's session answers for their
--       dependent; in a stranger's session it answers false
--   O8  OKU upload: a guardian can upload into the dependent's folder once
--       the DEPENDENT has consented (the guardian's own consent doesn't
--       count); a stranger can't, even with consent of their own; a folder
--       that isn't a user id is refused
--   O9  OKU read: the guardian can read the dependent's card, a stranger can't
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it
-- builds throwaway fixtures and persists NOTHING. A failing assertion RAISEs;
-- on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_guardian_auth uuid := gen_random_uuid();
  v_stranger_auth uuid := gen_random_uuid();
  v_helper_auth   uuid := gen_random_uuid();
  v_adult_auth    uuid := gen_random_uuid();
  v_guardian      uuid;
  v_stranger      uuid;
  v_helper        uuid;
  v_adult         uuid;
  v_child         uuid;
  v_former        uuid;
  v_changed       boolean;
  v_count         integer;
  v_row           record;
  v_state         text;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_guardian_auth, 'behalf-guardian@test.local', 'Gwen', 'Guardian')
    RETURNING id INTO v_guardian;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_stranger_auth, 'behalf-stranger@test.local', 'Stan', 'Stranger')
    RETURNING id INTO v_stranger;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_helper_auth, 'behalf-helper@test.local', 'Hana', 'Helper')
    RETURNING id INTO v_helper;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_adult_auth, 'behalf-adult@test.local', 'Adam', 'Adult')
    RETURNING id INTO v_adult;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Cara', 'Child', 'managed') RETURNING id INTO v_child;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Fred', 'Former', 'managed') RETURNING id INTO v_former;

  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship,
                             basis, authorisation_method, terms_version, terms_accepted_at)
  VALUES (v_guardian, v_child,  'parent', 'minor',      NULL,            '2026-11-24', now()),
         (v_guardian, v_former, 'parent', 'minor',      NULL,            '2026-11-24', now()),
         (v_helper,   v_adult,  'carer',  'authorised', 'player_invite', '2026-11-24', now());
  UPDATE guardianships SET status = 'revoked', revoked_at = now()
    WHERE dependent_user_id = v_former;

  -- ===== O1 ===============================================================
  v_changed := record_sensitive_data_consent(v_child, 'health', true, '2026-11-24', v_guardian);
  SELECT user_id, granted, version, granted_by, on_behalf_basis INTO v_row
    FROM sensitive_data_consents WHERE user_id = v_child ORDER BY id DESC LIMIT 1;
  IF NOT v_changed OR v_row.granted_by IS DISTINCT FROM v_guardian
     OR v_row.on_behalf_basis IS DISTINCT FROM 'minor' OR NOT v_row.granted
     OR v_row.version <> '2026-11-24' THEN
    RAISE EXCEPTION 'O1 FAIL: row is %', row_to_json(v_row);
  END IF;
  IF NOT has_sensitive_data_consent(v_child, 'health') THEN
    RAISE EXCEPTION 'O1 FAIL: the dependent has no health consent after the guardian granted it';
  END IF;
  IF record_sensitive_data_consent(v_child, 'health', true, '2026-11-24', v_guardian) THEN
    RAISE EXCEPTION 'O1 FAIL: re-granting the same wording wrote a row';
  END IF;
  RAISE NOTICE 'O1 PASS — a guardian consents on a minor''s behalf, and the log says so';

  -- ===== O2 ===============================================================
  PERFORM record_sensitive_data_consent(v_adult, 'health', true, '2026-11-24', v_helper);
  SELECT granted_by, on_behalf_basis INTO v_row
    FROM sensitive_data_consents WHERE user_id = v_adult ORDER BY id DESC LIMIT 1;
  IF v_row.granted_by IS DISTINCT FROM v_helper OR v_row.on_behalf_basis IS DISTINCT FROM 'authorised' THEN
    RAISE EXCEPTION 'O2 FAIL: row is %', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'O2 PASS — a helper records the player''s consent under ''authorised''';

  -- ===== O3 ===============================================================
  PERFORM record_sensitive_data_consent(v_adult, 'financial', true, '2026-11-19');
  PERFORM record_sensitive_data_consent(v_stranger, 'financial', true, '2026-11-19', v_stranger);
  SELECT count(*) INTO v_count FROM sensitive_data_consents
    WHERE user_id IN (v_adult, v_stranger) AND category = 'financial'
      AND granted_by IS NULL AND on_behalf_basis IS NULL;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'O3 FAIL: % self-recorded rows have granted_by NULL (expected 2)', v_count;
  END IF;
  RAISE NOTICE 'O3 PASS — the player''s own consent names nobody else';

  -- ===== O4 ===============================================================
  SELECT count(*) INTO v_count FROM sensitive_data_consents;
  BEGIN
    PERFORM record_sensitive_data_consent(v_child, 'financial', true, '2026-11-19', v_stranger);
    RAISE EXCEPTION 'O4 FAIL: a stranger recorded a dependent''s consent';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_state = MESSAGE_TEXT;
    IF v_state NOT LIKE 'NOT_GUARDIAN%' THEN
      RAISE EXCEPTION 'O4 FAIL: refused with %', v_state;
    END IF;
  END;
  BEGIN
    PERFORM record_sensitive_data_consent(v_former, 'health', true, '2026-11-24', v_guardian);
    RAISE EXCEPTION 'O4 FAIL: a revoked guardian recorded consent';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
  IF (SELECT count(*) FROM sensitive_data_consents) <> v_count THEN
    RAISE EXCEPTION 'O4 FAIL: a refused call wrote a row';
  END IF;
  RAISE NOTICE 'O4 PASS — only someone acting for the player can record their consent';

  -- ===== O5 ===============================================================
  PERFORM record_sensitive_data_consent(v_adult, 'health', false, NULL, v_helper);
  SELECT granted, version, granted_by INTO v_row
    FROM sensitive_data_consents WHERE user_id = v_adult AND category = 'health'
    ORDER BY id DESC LIMIT 1;
  IF v_row.granted OR v_row.version IS NOT NULL OR v_row.granted_by IS DISTINCT FROM v_helper THEN
    RAISE EXCEPTION 'O5 FAIL: withdrawal row is %', row_to_json(v_row);
  END IF;
  IF record_sensitive_data_consent(v_adult, 'health', false, NULL, v_helper) THEN
    RAISE EXCEPTION 'O5 FAIL: withdrawing again wrote a row';
  END IF;
  RAISE NOTICE 'O5 PASS — a withdrawal by the helper names them';

  -- ===== O6 ===============================================================
  BEGIN
    INSERT INTO sensitive_data_consents (user_id, category, granted, version, granted_by)
      VALUES (v_child, 'financial', true, '2026-11-19', v_guardian);
    RAISE EXCEPTION 'O6 FAIL: granted_by without a basis was stored';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO sensitive_data_consents (user_id, category, granted, version, granted_by, on_behalf_basis)
      VALUES (v_child, 'financial', true, '2026-11-19', v_child, 'minor');
    RAISE EXCEPTION 'O6 FAIL: granted_by naming the subject was stored';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RAISE NOTICE 'O6 PASS — the log''s shape is enforced';

  -- ===== O7 ===============================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_guardian_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF NOT has_sensitive_data_consent(v_child, 'health') THEN
    RESET ROLE;
    RAISE EXCEPTION 'O7 FAIL: the guardian can''t see their dependent''s consent';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_stranger_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF has_sensitive_data_consent(v_child, 'health') THEN
    RESET ROLE;
    RAISE EXCEPTION 'O7 FAIL: a stranger sees the dependent''s consent';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'O7 PASS — has_sensitive_data_consent answers through can_act_for()';

  -- ===== O8 ===============================================================
  PERFORM record_sensitive_data_consent(v_guardian, 'health', true, '2026-11-19');
  PERFORM record_sensitive_data_consent(v_stranger, 'health', true, '2026-11-19');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_guardian_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  INSERT INTO storage.objects (bucket_id, name)
    VALUES ('oku-documents', 'users/' || v_child::text || '/oku/1.png');
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
      VALUES ('oku-documents', 'users/' || v_former::text || '/oku/1.png');
    RESET ROLE;
    RAISE EXCEPTION 'O8 FAIL: a revoked guardian uploaded a card';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
      VALUES ('oku-documents', 'users/not-a-user-id/oku/1.png');
    RESET ROLE;
    RAISE EXCEPTION 'O8 FAIL: a non-uuid folder was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  PERFORM record_sensitive_data_consent(v_child, 'health', false, NULL, v_guardian);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
      VALUES ('oku-documents', 'users/' || v_child::text || '/oku/2.png');
    RESET ROLE;
    RAISE EXCEPTION 'O8 FAIL: uploaded on the guardian''s own consent, not the dependent''s';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
  PERFORM record_sensitive_data_consent(v_child, 'health', true, '2026-11-24', v_guardian);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_stranger_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
      VALUES ('oku-documents', 'users/' || v_child::text || '/oku/3.png');
    RESET ROLE;
    RAISE EXCEPTION 'O8 FAIL: a stranger uploaded into a dependent''s folder';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'O8 PASS — uploads follow can_act_for() and the data subject''s consent';

  -- ===== O9 ===============================================================
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM storage.objects
    WHERE bucket_id = 'oku-documents' AND name LIKE 'users/' || v_child::text || '/%';
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'O9 FAIL: a stranger reads the dependent''s card';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_guardian_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM storage.objects
    WHERE bucket_id = 'oku-documents' AND name LIKE 'users/' || v_child::text || '/%';
  RESET ROLE;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'O9 FAIL: the guardian sees % of the dependent''s cards (expected 1)', v_count;
  END IF;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RAISE NOTICE 'O9 PASS — the guardian can read the dependent''s card, a stranger can''t';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
