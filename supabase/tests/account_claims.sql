-- =============================================================================
-- Regression test: a guardian hands a dependent's record over to its player
-- (account claiming, #720).
--
-- Covers:
--   A1  create_account_claim stores a pending claim with a 72-hour expiry and
--       the lower-cased address
--   A2  only the active guardian of a managed dependent aged 18 or over can
--       start one (DEPENDENT_NOT_FOUND, CLAIM_NOT_ALLOWED, UNDER_18), and not
--       to an address an account already uses, in any Gmail form (EMAIL_TAKEN)
--   A3  starting a second claim cancels the first: one pending claim per
--       dependent
--   A4  the player's signup links the existing users row: same id, the new
--       login, account_type 'self', contact_email cleared, the Terms they
--       accepted; no second users row; the profile, registrations and the
--       guardian's payment stay as they were; every active guardianship
--       becomes 'claimed'; the claim is accepted
--   A5  the guardian's access ends at once: can_act_for() is false for them
--   A6  the link step refuses, and the login isn't created, for: a used
--       link, an expired link, a cancelled link, an unverified email, a
--       different mailbox, a revoked guardianship, and an address that
--       gained an account in the meantime
--   A7  cancel_account_claim withdraws a pending claim; a stranger can't
--   A8  an ordinary signup (no claim) still creates a new users row
--   A9  the guardian reads the claims they started but not their token hash,
--       a stranger reads none, and clients can't call the functions
--   A10 a signup that isn't confirmed yet gets no users row; confirming its
--       email links the record then, in the confirming UPDATE
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs, so it builds throwaway
-- fixtures and persists NOTHING. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

CREATE FUNCTION pg_temp.claim_signup(
  p_email     text,
  p_hash      text,
  p_confirmed boolean DEFAULT true
) RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE
  v_auth uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (v_auth, p_email, CASE WHEN p_confirmed THEN now() END,
          jsonb_build_object('claim_token_hash', p_hash,
                             'terms_version', '2026-11-24',
                             'first_name', 'Ignored', 'last_name', 'Ignored'));
  RETURN v_auth;
END;
$fn$;

CREATE FUNCTION pg_temp.expect_claim_refused(
  p_label     text,
  p_email     text,
  p_hash      text,
  p_sentinel  text,
  p_confirmed boolean DEFAULT true
) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  v_msg text;
  v_before integer;
BEGIN
  SELECT count(*) INTO v_before FROM auth.users;
  BEGIN
    PERFORM pg_temp.claim_signup(p_email, p_hash, p_confirmed);
    RAISE EXCEPTION 'A6 FAIL (%): the claim was accepted', p_label;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE 'A6 FAIL%' THEN RAISE; END IF;
    IF v_msg NOT LIKE '%' || p_sentinel || '%' THEN
      RAISE EXCEPTION 'A6 FAIL (%): refused with % (expected %)', p_label, v_msg, p_sentinel;
    END IF;
  END;
  IF (SELECT count(*) FROM auth.users) <> v_before THEN
    RAISE EXCEPTION 'A6 FAIL (%): the login was created anyway', p_label;
  END IF;
END;
$fn$;

DO $$
DECLARE
  v_adult_dob     date := ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '25 years')::date;
  v_child_dob     date := ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '10 years')::date;
  v_guardian_auth uuid := gen_random_uuid();
  v_second_auth   uuid := gen_random_uuid();
  v_stranger_auth uuid := gen_random_uuid();
  v_guardian      uuid;
  v_second        uuid;
  v_stranger      uuid;
  v_adult         uuid;
  v_child         uuid;
  v_helped        uuid;
  v_other         uuid;
  v_org           uuid;
  v_tournament    uuid;
  v_reg           uuid;
  v_pay           uuid;
  v_res           jsonb;
  v_auth          uuid;
  v_row           record;
  v_count         integer;
  v_msg           text;
  v_hash1         text := repeat('a', 64);
  v_hash2         text := repeat('b', 64);
  v_hash_other    text := repeat('c', 64);
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_guardian_auth, 'claims-guardian@test.local', 'Gwen', 'Guardian')
    RETURNING id INTO v_guardian;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_second_auth, 'claims-second@test.local', 'Sam', 'Second')
    RETURNING id INTO v_second;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_stranger_auth, 'existing.player@gmail.com', 'Stan', 'Stranger')
    RETURNING id INTO v_stranger;
  INSERT INTO player_profiles (user_id) VALUES (v_guardian), (v_second), (v_stranger);

  v_adult := (create_dependent(v_guardian, 'Ada', 'Adult', v_adult_dob, 'carer',
                               'authorised', '2026-11-24', 'female', 'Malaysia',
                               'ada.old@test.local')->>'dependent_id')::uuid;
  v_child := (create_dependent(v_guardian, 'Kai', 'Kid', v_child_dob, 'parent',
                               'minor', '2026-11-24')->>'dependent_id')::uuid;
  v_other := (create_dependent(v_guardian, 'Ola', 'Other', v_adult_dob, 'carer',
                               'authorised', '2026-11-24')->>'dependent_id')::uuid;
  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship,
                             basis, authorisation_method, terms_version, terms_accepted_at)
    VALUES (v_second, v_adult, 'coach', 'authorised', 'guardian_attestation', '2026-11-24', now());
  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship,
                             basis, authorisation_method, terms_version, terms_accepted_at)
    VALUES (v_guardian, v_stranger, 'carer', 'authorised', 'player_invite', '2026-11-24', now());
  v_helped := v_stranger;

  INSERT INTO organizations (name) VALUES ('CLAIMS ORG') RETURNING id INTO v_org;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'CLAIMS T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}', 100, 'published'
  ) RETURNING id INTO v_tournament;
  v_res := create_registration_with_payment(v_adult, v_tournament, 'standard', 4000,
                                            p_payer_user_id => v_guardian);
  v_reg := (v_res->>'registration_id')::uuid;
  v_pay := (v_res->>'payment_id')::uuid;

  -- ===== A1 ===============================================================
  v_res := create_account_claim(v_guardian, v_adult, '  Ada.Player@Test.Local ', v_hash1);
  SELECT * INTO v_row FROM account_claims WHERE id = (v_res->>'claim_id')::uuid;
  IF v_row.status <> 'pending' OR v_row.email <> 'ada.player@test.local'
     OR v_row.guardian_user_id <> v_guardian OR v_row.token_hash <> v_hash1
     OR abs(extract(epoch FROM (v_row.expires_at - now())) - 72 * 3600) > 60 THEN
    RAISE EXCEPTION 'A1 FAIL: claim is %', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'A1 PASS — a pending claim with a 72-hour link';

  -- ===== A2 ===============================================================
  BEGIN
    PERFORM create_account_claim(v_stranger, v_adult, 'x@test.local', repeat('d', 64));
    RAISE EXCEPTION 'A2 FAIL: a stranger started a claim';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'DEPENDENT_NOT_FOUND%' THEN RAISE EXCEPTION 'A2 FAIL: %', v_msg; END IF;
  END;
  BEGIN
    PERFORM create_account_claim(v_guardian, v_child, 'kid@test.local', repeat('d', 64));
    RAISE EXCEPTION 'A2 FAIL: a claim for a minor was started';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'UNDER_18%' THEN RAISE EXCEPTION 'A2 FAIL: %', v_msg; END IF;
  END;
  BEGIN
    PERFORM create_account_claim(v_guardian, v_helped, 'helped@test.local', repeat('d', 64));
    RAISE EXCEPTION 'A2 FAIL: a self-managed account was offered for a claim';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'CLAIM_NOT_ALLOWED%' THEN RAISE EXCEPTION 'A2 FAIL: %', v_msg; END IF;
  END;
  BEGIN
    PERFORM create_account_claim(v_guardian, v_other, 'Existing.Player+chess@googlemail.com', repeat('d', 64));
    RAISE EXCEPTION 'A2 FAIL: a claim to a taken mailbox was started';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'EMAIL_TAKEN%' THEN RAISE EXCEPTION 'A2 FAIL: %', v_msg; END IF;
  END;
  RAISE NOTICE 'A2 PASS — who may start a claim, and to which address';

  -- ===== A3 ===============================================================
  PERFORM create_account_claim(v_guardian, v_adult, 'ada.player@test.local', v_hash2);
  SELECT count(*) INTO v_count FROM account_claims WHERE dependent_user_id = v_adult AND status = 'pending';
  IF v_count <> 1 OR (SELECT status FROM account_claims WHERE token_hash = v_hash1) <> 'cancelled' THEN
    RAISE EXCEPTION 'A3 FAIL: % pending claims, first is %',
      v_count, (SELECT status FROM account_claims WHERE token_hash = v_hash1);
  END IF;
  RAISE NOTICE 'A3 PASS — a new claim replaces the old one';

  -- ===== A6 (before the claim is used) ===================================
  PERFORM pg_temp.expect_claim_refused('cancelled link', 'ada.player@test.local', v_hash1, 'CLAIM_INVALID');
  PERFORM pg_temp.expect_claim_refused('unknown link', 'ada.player@test.local', repeat('e', 64), 'CLAIM_INVALID');
  PERFORM pg_temp.expect_claim_refused('different mailbox', 'someone.else@test.local', v_hash2, 'CLAIM_EMAIL_MISMATCH');

  UPDATE account_claims SET expires_at = now() - interval '1 minute' WHERE token_hash = v_hash2;
  PERFORM pg_temp.expect_claim_refused('expired link', 'ada.player@test.local', v_hash2, 'CLAIM_INVALID');
  UPDATE account_claims SET expires_at = now() + interval '72 hours' WHERE token_hash = v_hash2;

  PERFORM create_account_claim(v_guardian, v_other, 'ola@test.local', v_hash_other);
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'Ola@Test.Local', 'Ola', 'Twin');
  PERFORM pg_temp.expect_claim_refused('address taken since', 'ola@test.local', v_hash_other, 'EMAIL_TAKEN');
  UPDATE guardianships SET status = 'revoked', revoked_at = now()
    WHERE guardian_user_id = v_guardian AND dependent_user_id = v_other;
  PERFORM pg_temp.expect_claim_refused('revoked guardianship', 'ola@test.local', v_hash_other, 'CLAIM_INVALID');
  RAISE NOTICE 'A6 PASS (part 1) — bad links are refused and create no login';

  -- ===== A4 ===============================================================
  SELECT count(*) INTO v_count FROM users;
  v_auth := pg_temp.claim_signup('Ada.Player@test.local', v_hash2);

  IF (SELECT count(*) FROM users) <> v_count THEN
    RAISE EXCEPTION 'A4 FAIL: signup created a second users row';
  END IF;
  SELECT u.id, u.auth_user_id, u.email, u.account_type, u.contact_email,
         u.first_name, u.terms_version, u.terms_accepted_at, p.date_of_birth, p.nationality
    INTO v_row
    FROM users u JOIN player_profiles p ON p.user_id = u.id
    WHERE u.id = v_adult;
  IF v_row.auth_user_id IS DISTINCT FROM v_auth OR v_row.account_type <> 'self'
     OR v_row.email <> 'Ada.Player@test.local' OR v_row.contact_email IS NOT NULL
     OR v_row.first_name <> 'Ada' OR v_row.terms_version <> '2026-11-24'
     OR v_row.terms_accepted_at IS NULL OR v_row.date_of_birth <> v_adult_dob
     OR v_row.nationality <> 'Malaysia' THEN
    RAISE EXCEPTION 'A4 FAIL: the record after handover is %', row_to_json(v_row);
  END IF;
  IF (SELECT user_id FROM registrations WHERE id = v_reg) <> v_adult
     OR (SELECT user_id FROM payments WHERE id = v_pay) <> v_guardian THEN
    RAISE EXCEPTION 'A4 FAIL: the registration or the guardian''s payment moved';
  END IF;
  SELECT count(*) INTO v_count FROM guardianships
    WHERE dependent_user_id = v_adult AND status <> 'claimed';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'A4 FAIL: % guardianships of the player are still not claimed', v_count;
  END IF;
  SELECT status, auth_user_id, accepted_at INTO v_row FROM account_claims WHERE token_hash = v_hash2;
  IF v_row.status <> 'accepted' OR v_row.auth_user_id IS DISTINCT FROM v_auth OR v_row.accepted_at IS NULL THEN
    RAISE EXCEPTION 'A4 FAIL: the claim is %', row_to_json(v_row);
  END IF;
  IF (SELECT id FROM users WHERE auth_user_id = v_auth) IS DISTINCT FROM v_adult THEN
    RAISE EXCEPTION 'A4 FAIL: the new login doesn''t resolve to the existing record';
  END IF;
  RAISE NOTICE 'A4 PASS — the player now signs in to the same record, with its history';

  -- ===== A5 ===============================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_guardian_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF can_act_for(v_adult) THEN
    RESET ROLE;
    RAISE EXCEPTION 'A5 FAIL: the guardian still acts for the player after the handover';
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RAISE NOTICE 'A5 PASS — the guardian''s access ended at the handover';

  -- ===== A6 (after) ======================================================
  PERFORM pg_temp.expect_claim_refused('used link', 'ada.player@test.local', v_hash2, 'CLAIM_INVALID');
  RAISE NOTICE 'A6 PASS (part 2) — a link works once';

  -- ===== A7 ===============================================================
  v_res := create_account_claim(v_guardian, (create_dependent(v_guardian, 'Cy', 'Cancel',
             v_adult_dob, 'carer', 'authorised', '2026-11-24')->>'dependent_id')::uuid,
             'cy@test.local', repeat('f', 64));
  SELECT dependent_user_id INTO v_row FROM account_claims WHERE id = (v_res->>'claim_id')::uuid;
  BEGIN
    PERFORM cancel_account_claim(v_stranger, v_row.dependent_user_id);
    RAISE EXCEPTION 'A7 FAIL: a stranger cancelled a claim';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg NOT LIKE 'DEPENDENT_NOT_FOUND%' THEN RAISE EXCEPTION 'A7 FAIL: %', v_msg; END IF;
  END;
  IF NOT cancel_account_claim(v_guardian, v_row.dependent_user_id) THEN
    RAISE EXCEPTION 'A7 FAIL: cancelling a pending claim reported nothing cancelled';
  END IF;
  IF (SELECT status FROM account_claims WHERE id = (v_res->>'claim_id')::uuid) <> 'cancelled' THEN
    RAISE EXCEPTION 'A7 FAIL: the claim is still pending';
  END IF;
  IF cancel_account_claim(v_guardian, v_row.dependent_user_id) THEN
    RAISE EXCEPTION 'A7 FAIL: cancelling again reported a cancellation';
  END IF;
  RAISE NOTICE 'A7 PASS — the guardian can withdraw a claim';

  -- ===== A8 ===============================================================
  SELECT count(*) INTO v_count FROM users;
  v_auth := gen_random_uuid();
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    VALUES (v_auth, 'fresh-signup@test.local', now(),
            jsonb_build_object('first_name', 'Fresh', 'last_name', 'Signup',
                               'terms_version', '2026-11-24'));
  IF (SELECT count(*) FROM users) <> v_count + 1
     OR (SELECT account_type FROM users WHERE auth_user_id = v_auth) <> 'self' THEN
    RAISE EXCEPTION 'A8 FAIL: an ordinary signup didn''t create its own record';
  END IF;
  RAISE NOTICE 'A8 PASS — ordinary signup unchanged';

  -- ===== A9 ===============================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_guardian_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM account_claims;
  RESET ROLE;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'A9 FAIL: the guardian can''t read their claims';
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_second_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM account_claims;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'A9 FAIL: another guardian reads % claims they didn''t start', v_count;
  END IF;
  IF has_column_privilege('authenticated', 'account_claims', 'token_hash', 'SELECT') THEN
    RAISE EXCEPTION 'A9 FAIL: clients can read token_hash';
  END IF;
  IF has_function_privilege('authenticated', 'create_account_claim(uuid, uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'link_claimed_account(uuid, text, timestamptz, text, varchar)', 'EXECUTE') THEN
    RAISE EXCEPTION 'A9 FAIL: clients can call the claim functions';
  END IF;
  RAISE NOTICE 'A9 PASS — claims are private to the guardian who started them';

  -- ===== A10 ==============================================================
  v_other := (create_dependent(v_guardian, 'Una', 'Unconfirmed', v_adult_dob, 'carer',
                               'authorised', '2026-11-24')->>'dependent_id')::uuid;
  PERFORM create_account_claim(v_guardian, v_other, 'una@test.local', repeat('9', 64));
  SELECT count(*) INTO v_count FROM users;
  v_auth := pg_temp.claim_signup('una@test.local', repeat('9', 64), false);
  IF (SELECT count(*) FROM users) <> v_count
     OR (SELECT account_type FROM users WHERE id = v_other) <> 'managed'
     OR (SELECT status FROM account_claims WHERE token_hash = repeat('9', 64)) <> 'pending' THEN
    RAISE EXCEPTION 'A10 FAIL: an unconfirmed signup linked or created a record';
  END IF;

  UPDATE auth.users SET email_confirmed_at = now() WHERE id = v_auth;
  IF (SELECT auth_user_id FROM users WHERE id = v_other) IS DISTINCT FROM v_auth
     OR (SELECT status FROM account_claims WHERE token_hash = repeat('9', 64)) <> 'accepted'
     OR (SELECT count(*) FROM users) <> v_count THEN
    RAISE EXCEPTION 'A10 FAIL: confirming the email didn''t link the record';
  END IF;

  PERFORM create_account_claim(v_guardian,
    (create_dependent(v_guardian, 'Vic', 'Late', v_adult_dob, 'carer', 'authorised',
                      '2026-11-24')->>'dependent_id')::uuid,
    'vic@test.local', repeat('8', 64));
  v_auth := pg_temp.claim_signup('vic@test.local', repeat('8', 64), false);
  UPDATE account_claims SET status = 'cancelled', cancelled_at = now() WHERE token_hash = repeat('8', 64);
  BEGIN
    UPDATE auth.users SET email_confirmed_at = now() WHERE id = v_auth;
    RAISE EXCEPTION 'A10 FAIL: a cancelled claim was linked on confirmation';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
    IF v_msg LIKE 'A10 FAIL%' THEN RAISE; END IF;
    IF v_msg NOT LIKE '%CLAIM_INVALID%' THEN RAISE EXCEPTION 'A10 FAIL: refused with %', v_msg; END IF;
  END;
  IF (SELECT email_confirmed_at FROM auth.users WHERE id = v_auth) IS NOT NULL THEN
    RAISE EXCEPTION 'A10 FAIL: the refused confirmation was kept';
  END IF;
  RAISE NOTICE 'A10 PASS — an unconfirmed signup links only when its email is confirmed';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
