-- =============================================================================
-- Regression test for separate sensitive-data consent (#451).
--
-- Health data (an OKU card) and financial data (a player's bank details) are
-- held only with their own explicit consent, recorded in the append-only
-- sensitive_data_consents log. The log is evidence of what a user agreed to and
-- when, so its write rules are load-bearing.
--
-- Covers:
--   C1  no rows = no consent
--   C2  a grant is recorded with its version, and has_sensitive_data_consent
--       turns true
--   C3  re-granting the same wording is a no-op (returns false, no new row)
--   C4  granting newer wording writes a new row, so the log shows it was agreed
--   C5  a withdrawal is recorded with no version, and consent turns false
--   C6  withdrawing again, or withdrawing what was never granted, is a no-op
--   C7  categories are independent: withdrawing health leaves financial alone
--   C8  a grant without a version is refused (22023), and so is a half-shaped
--       row written directly (chk_consent_version)
--   C9  rows are immutable: UPDATE is refused (55000)
--   C10 a deleted or unknown user is refused (P0002)
--   C11 clients hold no write privileges, and a signed-in user cannot insert a
--       grant for themselves (42501)
--   C12 a signed-in user reads their own history and nobody else's, and
--       has_sensitive_data_consent about another user answers false for them
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it builds
-- throwaway fixtures and persists NOTHING. A failing assertion RAISEs (and rolls
-- back); on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_a_auth  uuid := gen_random_uuid();
  v_a       uuid;
  v_b       uuid;
  v_gone    uuid;
  v_changed boolean;
  v_count   integer;
  v_version text;
  v_id      bigint;
  v_role    text;
  v_priv    text;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_a_auth, 'consent-a@test.local', 'Consent', 'A') RETURNING id INTO v_a;
  INSERT INTO users (email, first_name, last_name)
    VALUES ('consent-b@test.local', 'Consent', 'B') RETURNING id INTO v_b;
  INSERT INTO users (email, first_name, last_name, deleted_at)
    VALUES ('consent-gone@test.local', 'Consent', 'Gone', now()) RETURNING id INTO v_gone;

  -- ===== C1 ===============================================================
  IF has_sensitive_data_consent(v_a, 'health') THEN
    RAISE EXCEPTION 'C1 FAIL: consent reported with no rows';
  END IF;
  RAISE NOTICE 'C1 PASS — no rows means no consent';

  -- ===== C2 ===============================================================
  v_changed := record_sensitive_data_consent(v_a, 'health', true, '2026-11-19');
  SELECT version INTO v_version
    FROM sensitive_data_consents
    WHERE user_id = v_a AND category = 'health' AND granted;
  IF NOT v_changed OR v_version IS DISTINCT FROM '2026-11-19'
     OR NOT has_sensitive_data_consent(v_a, 'health') THEN
    RAISE EXCEPTION 'C2 FAIL: changed=% version=%', v_changed, v_version;
  END IF;
  RAISE NOTICE 'C2 PASS — grant recorded with its version';

  -- ===== C3 ===============================================================
  v_changed := record_sensitive_data_consent(v_a, 'health', true, '2026-11-19');
  SELECT count(*) INTO v_count FROM sensitive_data_consents WHERE user_id = v_a;
  IF v_changed OR v_count <> 1 THEN
    RAISE EXCEPTION 'C3 FAIL: changed=% rows=% (expected false, 1)', v_changed, v_count;
  END IF;
  RAISE NOTICE 'C3 PASS — re-granting the same wording writes nothing';

  -- ===== C4 ===============================================================
  v_changed := record_sensitive_data_consent(v_a, 'health', true, '2027-01-01');
  SELECT count(*) INTO v_count FROM sensitive_data_consents WHERE user_id = v_a;
  SELECT version INTO v_version FROM sensitive_data_consents
    WHERE user_id = v_a ORDER BY id DESC LIMIT 1;
  IF NOT v_changed OR v_count <> 2 OR v_version <> '2027-01-01' THEN
    RAISE EXCEPTION 'C4 FAIL: changed=% rows=% newest=%', v_changed, v_count, v_version;
  END IF;
  RAISE NOTICE 'C4 PASS — newer wording is recorded as a new grant';

  -- ===== C5 ===============================================================
  v_changed := record_sensitive_data_consent(v_a, 'health', false);
  SELECT version INTO v_version FROM sensitive_data_consents
    WHERE user_id = v_a ORDER BY id DESC LIMIT 1;
  IF NOT v_changed OR v_version IS NOT NULL
     OR has_sensitive_data_consent(v_a, 'health') THEN
    RAISE EXCEPTION 'C5 FAIL: changed=% version=%', v_changed, v_version;
  END IF;
  RAISE NOTICE 'C5 PASS — withdrawal recorded, consent now false';

  -- ===== C6 ===============================================================
  v_changed := record_sensitive_data_consent(v_a, 'health', false);
  IF v_changed THEN
    RAISE EXCEPTION 'C6 FAIL: a second withdrawal wrote a row';
  END IF;
  v_changed := record_sensitive_data_consent(v_b, 'financial', false);
  IF v_changed OR EXISTS (SELECT 1 FROM sensitive_data_consents WHERE user_id = v_b) THEN
    RAISE EXCEPTION 'C6 FAIL: withdrawing a consent never granted wrote a row';
  END IF;
  RAISE NOTICE 'C6 PASS — redundant withdrawals write nothing';

  -- ===== C7 ===============================================================
  PERFORM record_sensitive_data_consent(v_a, 'health', true, '2026-11-19');
  PERFORM record_sensitive_data_consent(v_a, 'financial', true, '2026-11-19');
  PERFORM record_sensitive_data_consent(v_a, 'health', false);
  IF has_sensitive_data_consent(v_a, 'health')
     OR NOT has_sensitive_data_consent(v_a, 'financial') THEN
    RAISE EXCEPTION 'C7 FAIL: categories are not independent';
  END IF;
  RAISE NOTICE 'C7 PASS — withdrawing health leaves financial consent intact';

  -- ===== C8 ===============================================================
  BEGIN
    PERFORM record_sensitive_data_consent(v_b, 'health', true, NULL);
    RAISE EXCEPTION 'C8 FAIL: a grant with no version was accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;
  BEGIN
    INSERT INTO sensitive_data_consents (user_id, category, granted, version)
      VALUES (v_b, 'health', false, '2026-11-19');
    RAISE EXCEPTION 'C8 FAIL: a withdrawal carrying a version was stored';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RAISE NOTICE 'C8 PASS — grants must name a version; withdrawals must not';

  -- ===== C9 ===============================================================
  SELECT id INTO v_id FROM sensitive_data_consents WHERE user_id = v_a ORDER BY id LIMIT 1;
  BEGIN
    UPDATE sensitive_data_consents SET version = '1999-01-01' WHERE id = v_id;
    RAISE EXCEPTION 'C9 FAIL: a consent row was updated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    NULL;
  END;
  RAISE NOTICE 'C9 PASS — consent rows cannot be updated';

  -- ===== C10 ==============================================================
  BEGIN
    PERFORM record_sensitive_data_consent(v_gone, 'health', true, '2026-11-19');
    RAISE EXCEPTION 'C10 FAIL: consent recorded for a deleted user';
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END;
  BEGIN
    PERFORM record_sensitive_data_consent(gen_random_uuid(), 'health', true, '2026-11-19');
    RAISE EXCEPTION 'C10 FAIL: consent recorded for an unknown user';
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END;
  RAISE NOTICE 'C10 PASS — deleted and unknown users refused';

  -- ===== C11 ==============================================================
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(v_role, 'sensitive_data_consents', v_priv) THEN
        RAISE EXCEPTION 'C11 FAIL: % holds % on sensitive_data_consents', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_a_auth, 'role', 'authenticated')::text, true);
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO sensitive_data_consents (user_id, category, granted, version)
      VALUES (v_a, 'health', true, '2026-11-19');
    RAISE EXCEPTION 'C11 FAIL: a user inserted their own consent grant';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'C11 PASS — no client write path to the consent log';

  -- ===== C12 ==============================================================
  PERFORM record_sensitive_data_consent(v_b, 'health', true, '2026-11-19');

  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM sensitive_data_consents WHERE user_id = v_a;
  IF v_count = 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'C12 FAIL: user cannot read their own consent history';
  END IF;
  SELECT count(*) INTO v_count FROM sensitive_data_consents WHERE user_id = v_b;
  IF v_count <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'C12 FAIL: user reads another user''s consent history';
  END IF;
  IF has_sensitive_data_consent(v_b, 'health') THEN
    RESET ROLE;
    RAISE EXCEPTION 'C12 FAIL: has_sensitive_data_consent reveals another user''s consent';
  END IF;
  IF NOT has_sensitive_data_consent(v_a, 'financial') THEN
    RESET ROLE;
    RAISE EXCEPTION 'C12 FAIL: has_sensitive_data_consent cannot see the user''s own grant';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RAISE NOTICE 'C12 PASS — own history readable, others'' hidden';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
