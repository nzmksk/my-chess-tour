-- =============================================================================
-- Regression test: a dependent's prize goes to the right account (#718:
-- prize_payees and claim_prize_award_send in 006, set_player_bank_account in
-- 003).
--
-- Covers:
--   M1  set_player_bank_account refuses a minor dependent (MINOR_DEPENDENT),
--       whoever saves it; clearing still works
--   H1  a helper saves an adult dependent's details: a stranger is refused
--       (NOT_GUARDIAN, 42501), the helper needs the player's financial
--       consent, and the row records entered_by; the player saving the same
--       details themselves supersedes it with entered_by NULL
--   P1  prize_payees: a minor's guardian (preferring one with a verified
--       account, else the earliest guardianship); a revoked guardianship and
--       an adult's helper don't count
--   C1  claiming a minor's award snapshots the guardian's verified account
--       and records payee_user_id / payee_reason = guardian_of_minor
--   C2  claiming an adult dependent's award uses the player's own account,
--       payee_reason = winner
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

DO $$
DECLARE
  v_child_dob date := ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '10 years')::date;
  v_org       uuid;
  v_t         uuid;
  v_fund      uuid;
  v_admin     uuid;
  v_mum       uuid;
  v_dad       uuid;
  v_former    uuid;
  v_child     uuid;
  v_helper    uuid;
  v_adult     uuid;
  v_stranger  uuid;
  v_bank_dad  uuid;
  v_bank_mum  uuid;
  v_bank_adult uuid;
  v_award_child uuid;
  v_award_adult uuid;
  v_res       jsonb;
  v_err       text;
  v_row       record;
  v_award     prize_awards;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name) VALUES
    (gen_random_uuid(), 'dpa-admin@test.local',    'Ada',   'Admin')
    RETURNING id INTO v_admin;
  INSERT INTO users (auth_user_id, email, first_name, last_name) VALUES
    (gen_random_uuid(), 'dpa-mum@test.local',      'Maria', 'Mother')
    RETURNING id INTO v_mum;
  INSERT INTO users (auth_user_id, email, first_name, last_name) VALUES
    (gen_random_uuid(), 'dpa-dad@test.local',      'Daniel', 'Father')
    RETURNING id INTO v_dad;
  INSERT INTO users (auth_user_id, email, first_name, last_name) VALUES
    (gen_random_uuid(), 'dpa-former@test.local',   'Fiona', 'Former')
    RETURNING id INTO v_former;
  INSERT INTO users (auth_user_id, email, first_name, last_name) VALUES
    (gen_random_uuid(), 'dpa-helper@test.local',   'Hana',  'Helper')
    RETURNING id INTO v_helper;
  INSERT INTO users (auth_user_id, email, first_name, last_name) VALUES
    (gen_random_uuid(), 'dpa-stranger@test.local', 'Stan',  'Stranger')
    RETURNING id INTO v_stranger;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Cara', 'Child', 'managed') RETURNING id INTO v_child;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Aziz', 'Adult', 'managed') RETURNING id INTO v_adult;
  INSERT INTO player_profiles (user_id, date_of_birth) VALUES
    (v_child, v_child_dob), (v_adult, DATE '1960-01-01');

  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship,
                             basis, authorisation_method, terms_version, terms_accepted_at, created_at)
  VALUES (v_former, v_child, 'parent', 'minor',      NULL,                   '2026-11-24', now(), now() - interval '3 days'),
         (v_mum,    v_child, 'parent', 'minor',      NULL,                   '2026-11-24', now(), now() - interval '2 days'),
         (v_dad,    v_child, 'parent', 'minor',      NULL,                   '2026-11-24', now(), now() - interval '1 day'),
         (v_helper, v_adult, 'carer',  'authorised', 'guardian_attestation', '2026-11-24', now(), now());
  UPDATE guardianships SET status = 'revoked', revoked_at = now()
    WHERE guardian_user_id = v_former;

  INSERT INTO organizations (name, approval_status) VALUES ('DPA ORG', 'approved') RETURNING id INTO v_org;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, prizes, max_participants, status
  ) VALUES (
    v_org, 'DPA T', 'Venue', 'Selangor', 'Address',
    current_date - 3, current_date - 2, (current_date - 4)::timestamptz,
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}',
    '{"categories": [{"name": "Open", "funding": {"source": "sponsor", "funder_name": "Acme"},
       "entries": [{"place": "1st", "amount_cents": 30000}, {"place": "2nd", "amount_cents": 15000}]}],
      "special": [], "distribution": "platform"}',
    10, 'published'
  ) RETURNING id INTO v_t;
  INSERT INTO prize_fundings (tournament_id, funder_name, funder_email, amount_cents, chip_transaction_id)
    VALUES (v_t, 'Acme', 'acme@sponsor.test', 45000, 'dpa_funding') RETURNING id INTO v_fund;
  PERFORM settle_prize_funding(v_fund, true, 45000);
  INSERT INTO registrations (user_id, tournament_id, fee_tier, status, confirmed_at) VALUES
    (v_child, v_t, 'standard', 'confirmed', now()),
    (v_adult, v_t, 'standard', 'confirmed', now());

  -- ===== M1: no bank details for a minor =====================================
  PERFORM record_sensitive_data_consent(v_child, 'financial', true, '2026-11-24', v_mum);
  v_err := pg_temp.error_of(format(
    $q$SELECT set_player_bank_account(%L, 'MBBEMYKL', 'Maybank', 'Cara Child', '514100000001', %L)$q$,
    v_child, v_mum));
  IF v_err NOT LIKE '%MINOR_DEPENDENT%' THEN
    RAISE EXCEPTION 'M1 FAIL: saving a minor''s details by their guardian gave %', COALESCE(v_err, 'no error');
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT set_player_bank_account(%L, 'MBBEMYKL', 'Maybank', 'Cara Child', '514100000001')$q$,
    v_child));
  IF v_err NOT LIKE '%MINOR_DEPENDENT%' THEN
    RAISE EXCEPTION 'M1 FAIL: saving a minor''s details as the player gave %', COALESCE(v_err, 'no error');
  END IF;
  v_res := set_player_bank_account(v_child, NULL, NULL, NULL, NULL, v_mum);
  IF v_res->>'id' IS NOT NULL THEN
    RAISE EXCEPTION 'M1 FAIL: clearing a minor''s details returned %', v_res;
  END IF;
  SELECT granted, granted_by INTO v_row FROM sensitive_data_consents
    WHERE user_id = v_child AND category = 'financial' ORDER BY id DESC LIMIT 1;
  IF v_row.granted OR v_row.granted_by IS DISTINCT FROM v_mum THEN
    RAISE EXCEPTION 'M1 FAIL: the withdrawal was not recorded by the guardian: %', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'M1 PASS — a minor can''t hold prize bank details; clearing still withdraws consent';

  -- ===== H1: a helper enters an adult dependent's details ===================
  v_err := pg_temp.error_of(format(
    $q$SELECT set_player_bank_account(%L, 'MBBEMYKL', 'Maybank', 'Aziz Adult', '514100000002', %L)$q$,
    v_adult, v_stranger));
  IF v_err NOT LIKE '42501%NOT_GUARDIAN%' THEN
    RAISE EXCEPTION 'H1 FAIL: a stranger saving the details gave %', COALESCE(v_err, 'no error');
  END IF;
  v_err := pg_temp.error_of(format(
    $q$SELECT set_player_bank_account(%L, 'MBBEMYKL', 'Maybank', 'Aziz Adult', '514100000002', %L)$q$,
    v_adult, v_helper));
  IF v_err NOT LIKE '%CONSENT_REQUIRED%' THEN
    RAISE EXCEPTION 'H1 FAIL: saving without the player''s consent gave %', COALESCE(v_err, 'no error');
  END IF;

  PERFORM record_sensitive_data_consent(v_adult, 'financial', true, '2026-11-24', v_helper);
  v_res := set_player_bank_account(v_adult, 'MBBEMYKL', 'Maybank', 'Aziz Adult', '514100000002', v_helper);
  v_bank_adult := (v_res->>'id')::uuid;
  IF v_bank_adult IS NULL
     OR (SELECT entered_by FROM player_bank_accounts WHERE id = v_bank_adult) IS DISTINCT FROM v_helper THEN
    RAISE EXCEPTION 'H1 FAIL: the helper''s save did not record entered_by: %', v_res;
  END IF;
  IF (set_player_bank_account(v_adult, 'MBBEMYKL', 'Maybank', 'Aziz Adult', '514100000002', v_helper)->>'changed')::boolean THEN
    RAISE EXCEPTION 'H1 FAIL: the helper re-saving the same details was not a no-op';
  END IF;

  v_res := set_player_bank_account(v_adult, 'MBBEMYKL', 'Maybank', 'Aziz Adult', '514100000002', v_adult);
  IF NOT (v_res->>'changed')::boolean OR (v_res->>'id')::uuid = v_bank_adult
     OR (SELECT entered_by FROM player_bank_accounts WHERE id = (v_res->>'id')::uuid) IS NOT NULL THEN
    RAISE EXCEPTION 'H1 FAIL: the player saving the details themselves: %', v_res;
  END IF;
  v_bank_adult := (v_res->>'id')::uuid;

  v_err := pg_temp.error_of(format(
    $q$UPDATE player_bank_accounts SET entered_by = user_id WHERE id = %L$q$, v_bank_adult));
  IF v_err NOT LIKE '23514%' THEN
    RAISE EXCEPTION 'H1 FAIL: entered_by naming the player gave %', COALESCE(v_err, 'no error');
  END IF;
  RAISE NOTICE 'H1 PASS — a helper saves an adult''s details under their consent; entered_by records it';

  -- ===== P1: whose account a prize goes to ===================================
  SELECT * INTO v_row FROM prize_payees(ARRAY[v_child]);
  IF v_row.payee_user_id <> v_mum OR v_row.reason <> 'guardian_of_minor' THEN
    RAISE EXCEPTION 'P1 FAIL: with no guardian account, expected the earliest active guardian: %', row_to_json(v_row);
  END IF;

  PERFORM record_sensitive_data_consent(v_dad, 'financial', true, '2026-11-24');
  v_bank_dad := (set_player_bank_account(v_dad, 'CIBBMYKL', 'CIMB Bank', 'Daniel Father', '800000000003') ->> 'id')::uuid;
  PERFORM settle_bank_account_verification(v_bank_dad, 940003, true, NULL, 'DANIEL FATHER', true);
  PERFORM record_sensitive_data_consent(v_mum, 'financial', true, '2026-11-24');
  v_bank_mum := (set_player_bank_account(v_mum, 'MBBEMYKL', 'Maybank', 'Maria Mother', '514100000004') ->> 'id')::uuid;

  SELECT * INTO v_row FROM prize_payees(ARRAY[v_child]);
  IF v_row.payee_user_id <> v_dad THEN
    RAISE EXCEPTION 'P1 FAIL: a guardian with a verified account should be preferred: %', row_to_json(v_row);
  END IF;

  IF (SELECT count(*) FROM prize_payees(ARRAY[v_child, v_adult, v_stranger, NULL])) <> 3 THEN
    RAISE EXCEPTION 'P1 FAIL: expected one row per non-null winner';
  END IF;
  SELECT * INTO v_row FROM prize_payees(ARRAY[v_adult]);
  IF v_row.payee_user_id <> v_adult OR v_row.reason <> 'winner' THEN
    RAISE EXCEPTION 'P1 FAIL: an adult''s helper must not be the payee: %', row_to_json(v_row);
  END IF;
  SELECT * INTO v_row FROM prize_payees(ARRAY[v_stranger]);
  IF v_row.payee_user_id <> v_stranger OR v_row.reason <> 'winner' THEN
    RAISE EXCEPTION 'P1 FAIL: a player with no guardian: %', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'P1 PASS — a minor''s guardian is the payee, a verified account first; adults are paid themselves';

  -- ===== C1: a minor's award goes to the guardian's account ==================
  v_award_child := enter_prize_award(v_t, v_child, 'Open', '1st', 30000, v_admin);
  PERFORM review_prize_award(v_award_child, v_admin, 'approve', NULL);
  IF claim_prize_award_send(v_award_child) IS NOT NULL THEN
    RAISE EXCEPTION 'C1 FAIL: the minor''s award could not be claimed';
  END IF;
  SELECT * INTO v_award FROM prize_awards WHERE id = v_award_child;
  IF v_award.bank_account_id IS DISTINCT FROM v_bank_dad
     OR v_award.payee_user_id IS DISTINCT FROM v_dad
     OR v_award.payee_reason IS DISTINCT FROM 'guardian_of_minor'
     OR v_award.user_id <> v_child THEN
    RAISE EXCEPTION 'C1 FAIL: claimed award: %', row_to_json(v_award);
  END IF;
  RAISE NOTICE 'C1 PASS — the claim snapshots the guardian''s verified account and says why';

  -- ===== C2: an adult dependent's award goes to their own account ===========
  v_award_adult := enter_prize_award(v_t, v_adult, 'Open', '2nd', 15000, v_admin);
  PERFORM review_prize_award(v_award_adult, v_admin, 'approve', NULL);
  IF claim_prize_award_send(v_award_adult) IS DISTINCT FROM 'bank_account_not_verified' THEN
    RAISE EXCEPTION 'C2 FAIL: an unverified account was accepted';
  END IF;
  PERFORM settle_bank_account_verification(v_bank_adult, 940005, true, NULL, 'AZIZ ADULT', true);
  IF claim_prize_award_send(v_award_adult) IS NOT NULL THEN
    RAISE EXCEPTION 'C2 FAIL: the adult''s award could not be claimed';
  END IF;
  SELECT * INTO v_award FROM prize_awards WHERE id = v_award_adult;
  IF v_award.bank_account_id IS DISTINCT FROM v_bank_adult
     OR v_award.payee_user_id IS DISTINCT FROM v_adult
     OR v_award.payee_reason IS DISTINCT FROM 'winner' THEN
    RAISE EXCEPTION 'C2 FAIL: claimed award: %', row_to_json(v_award);
  END IF;
  RAISE NOTICE 'C2 PASS — an adult dependent is paid into their own account';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
