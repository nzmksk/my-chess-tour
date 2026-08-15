-- =============================================================================
-- Regression test for audit-snapshot redaction (#516 / launch-readiness S3).
--
-- audit_trigger_func (003_functions_triggers.sql) writes full row snapshots into
-- audit_logs, a table retained far longer than the rows it mirrors. Sensitive
-- columns must be masked to a last-4 suffix on the way in — enough to answer
-- "did this value change?", never enough to reconstruct the secret.
--
-- Covers:
--   R1  redact_jsonb_columns masks listed keys and leaves the rest untouched
--   R2  INSERT on player_profiles redacts bank_account_number in new_data
--   R3  UPDATE redacts BOTH old_data and new_data (the old value is the one
--       that would otherwise sit in the log forever)
--   R4  oku_document_path is redacted too — it is a capability-bearing storage
--       path, not just a label
--   R5  NULL stays NULL, so "cleared" is still distinguishable from "set"
--   R6  a non-redacted table (tournaments) is unaffected
--
-- The other two redacted columns — organization_bank_accounts.account_number
-- and organization_documents.storage_path (#518) — are covered by scenario A1
-- in db/tests/organizer_onboarding.sql, alongside the organization_id scoping
-- they need. Redaction is the same mechanism; only the column list differs.
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it builds
-- throwaway fixtures and persists NOTHING. A failing assertion RAISEs (and rolls
-- back); on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_user  uuid;
  v_org   uuid;
  v_tour  uuid;
  v_got   text;
  v_json  jsonb;
BEGIN
  -- ---- R1: the helper in isolation ----------------------------------------
  v_json := redact_jsonb_columns(
    '{"bank_account_number": "1234567890", "bank_name": "Maybank", "rating": 1800}'::jsonb,
    ARRAY['bank_account_number']
  );

  IF v_json ->> 'bank_account_number' <> '****7890' THEN
    RAISE EXCEPTION 'R1 FAIL: masked value=% (expected ****7890)', v_json ->> 'bank_account_number';
  END IF;
  IF v_json ->> 'bank_name' <> 'Maybank' THEN
    RAISE EXCEPTION 'R1 FAIL: unlisted key was altered (bank_name=%)', v_json ->> 'bank_name';
  END IF;
  -- Non-string values must survive as their original JSON type, not be
  -- stringified — a snapshot that changes types is a broken snapshot.
  IF jsonb_typeof(v_json -> 'rating') <> 'number' THEN
    RAISE EXCEPTION 'R1 FAIL: numeric key changed type to %', jsonb_typeof(v_json -> 'rating');
  END IF;
  RAISE NOTICE 'R1 PASS — helper masks listed keys only, preserves types';

  -- ---- fixtures (service role: RLS not enforced) --------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'redaction@test.local', 'R', 'T')
    RETURNING id INTO v_user;

  -- ---- R2: INSERT redacts new_data ----------------------------------------
  INSERT INTO player_profiles (user_id, bank_name, bank_account_holder, bank_account_number)
    VALUES (v_user, 'Maybank', 'Test Holder', '1234567890');

  SELECT new_data ->> 'bank_account_number' INTO v_got
  FROM audit_logs
  WHERE table_name = 'player_profiles' AND record_id = v_user::text AND action = 'INSERT';

  IF v_got IS DISTINCT FROM '****7890' THEN
    RAISE EXCEPTION 'R2 FAIL: new_data.bank_account_number=% (expected ****7890)', v_got;
  END IF;
  RAISE NOTICE 'R2 PASS — INSERT snapshot redacted';

  -- ---- R3: UPDATE redacts old_data as well as new_data --------------------
  UPDATE player_profiles SET bank_account_number = '9876543210' WHERE user_id = v_user;

  SELECT old_data ->> 'bank_account_number' INTO v_got
  FROM audit_logs
  WHERE table_name = 'player_profiles' AND record_id = v_user::text AND action = 'UPDATE'
  ORDER BY id DESC LIMIT 1;

  IF v_got IS DISTINCT FROM '****7890' THEN
    RAISE EXCEPTION 'R3 FAIL: old_data.bank_account_number=% (expected ****7890 — the superseded value must not be retained in full)', v_got;
  END IF;

  SELECT new_data ->> 'bank_account_number' INTO v_got
  FROM audit_logs
  WHERE table_name = 'player_profiles' AND record_id = v_user::text AND action = 'UPDATE'
  ORDER BY id DESC LIMIT 1;

  IF v_got IS DISTINCT FROM '****3210' THEN
    RAISE EXCEPTION 'R3 FAIL: new_data.bank_account_number=% (expected ****3210)', v_got;
  END IF;

  -- Nothing anywhere in the audit trail may hold the full number.
  IF EXISTS (
    SELECT 1 FROM audit_logs
    WHERE table_name = 'player_profiles' AND record_id = v_user::text
      AND (old_data::text LIKE '%1234567890%' OR new_data::text LIKE '%1234567890%'
        OR old_data::text LIKE '%9876543210%' OR new_data::text LIKE '%9876543210%')
  ) THEN
    RAISE EXCEPTION 'R3 FAIL: a full account number survives somewhere in audit_logs';
  END IF;
  RAISE NOTICE 'R3 PASS — UPDATE redacts both sides, no full number anywhere';

  -- ---- R4: oku_document_path is redacted too ------------------------------
  UPDATE player_profiles
    SET oku_document_path = 'users/' || v_user::text || '/oku/secret-card.pdf'
    WHERE user_id = v_user;

  SELECT new_data ->> 'oku_document_path' INTO v_got
  FROM audit_logs
  WHERE table_name = 'player_profiles' AND record_id = v_user::text AND action = 'UPDATE'
  ORDER BY id DESC LIMIT 1;

  IF v_got IS DISTINCT FROM '****.pdf' THEN
    RAISE EXCEPTION 'R4 FAIL: oku_document_path=% (expected ****.pdf)', v_got;
  END IF;
  RAISE NOTICE 'R4 PASS — storage path redacted';

  -- ---- R5: NULL stays NULL ------------------------------------------------
  UPDATE player_profiles SET bank_account_number = NULL WHERE user_id = v_user;

  SELECT new_data -> 'bank_account_number' INTO v_json
  FROM audit_logs
  WHERE table_name = 'player_profiles' AND record_id = v_user::text AND action = 'UPDATE'
  ORDER BY id DESC LIMIT 1;

  IF jsonb_typeof(v_json) <> 'null' THEN
    RAISE EXCEPTION 'R5 FAIL: cleared column recorded as % (expected JSON null)', jsonb_typeof(v_json);
  END IF;
  RAISE NOTICE 'R5 PASS — cleared distinguishable from set';

  -- ---- R6: unlisted tables are untouched ----------------------------------
  INSERT INTO organizations (name) VALUES ('REDACTION ORG') RETURNING id INTO v_org;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline, format, time_control,
    entry_fees, max_participants
  ) VALUES (
    v_org, 'REDACTION CUP', 'Hall', 'Selangor', '1 Test Road',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":5,"system":"swiss"}'::jsonb,
    '{"base_minutes":90,"increment_seconds":30}'::jsonb,
    '{"standard":{"amount_cents":10000}}'::jsonb, 20
  ) RETURNING id INTO v_tour;

  SELECT new_data ->> 'venue_name' INTO v_got
  FROM audit_logs
  WHERE table_name = 'tournaments' AND record_id = v_tour::text AND action = 'INSERT';

  IF v_got <> 'Hall' THEN
    RAISE EXCEPTION 'R6 FAIL: tournaments snapshot was altered (venue_name=%)', v_got;
  END IF;
  RAISE NOTICE 'R6 PASS — non-redacted tables unaffected';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
