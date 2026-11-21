-- =============================================================================
-- Regression test for anonymise_user_audit_logs (#503).
--
-- audit_logs keeps full users / player_profiles snapshots, so deleting an
-- account leaves its personal data behind unless the deletion runbook
-- (docs/wiki/account-deletion.md) also anonymises that history. Financial audit rows
-- must survive untouched: the 7-year obligation overrides the deletion request.
--
-- Covers:
--   X1  a live account (deleted_at NULL) is refused with USER_NOT_DELETED
--   X2  after a soft delete, none of the user's personal data survives in their
--       users / player_profiles audit rows; the rows themselves, and the
--       allowlisted ids and timestamps, do
--   X3  payments and registrations audit rows are byte-for-byte unchanged,
--       including a changed_by that points at the deleted user
--   X4  a non-financial row the user authored keeps everything but changed_by
--   X5  re-running is a no-op
--   X6  another user's history is untouched, and "Users can view own account
--       audit logs" still returns exactly their own rows
--   X7  the hard-delete path: with the users row gone, the DELETE snapshot
--       (which carries the full pre-delete row) is anonymised too
--   X8  invitation audit rows (#470), run as the runbook does: snapshots of
--       invitations addressed to the user, at their current address or one
--       they used before, are anonymised but kept; an invitation to someone
--       else is untouched; re-running changes nothing
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it builds
-- throwaway fixtures and persists NOTHING. A failing assertion RAISEs (and rolls
-- back); on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  c_financial  constant text[] := ARRAY['payments', 'refunds', 'payouts', 'registrations'];
  v_auth_a     uuid := gen_random_uuid();
  v_auth_b     uuid := gen_random_uuid();
  v_a          uuid;
  v_b          uuid;
  v_c          uuid;
  v_org        uuid;
  v_tour       uuid;
  v_reg        uuid;
  v_fin_before text;
  v_b_before   text;
  v_rows_a     integer;
  v_count      integer;
  v_snap       integer;
  v_cleared    integer;
  v_json       jsonb;
  v_d          uuid;
  v_inviter    uuid;
  v_inv_org    uuid;
  v_inv_rows   integer;
  v_other_inv  text;
BEGIN
  -- ---- fixtures (service role: RLS not enforced) --------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_auth_a, 'anon-me@test.local', 'Aisyah', 'Rahmanova')
    RETURNING id INTO v_a;
  INSERT INTO player_profiles (
    user_id, date_of_birth, gender, nationality, fide_id, fide_verified_name,
    oku_status, oku_rejection_reason
  ) VALUES (
    v_a, '2010-05-17', 'female', 'Malaysian', 98765432, 'Rahmanova, Aisyah',
    'rejected', 'Card shows a diagnosis of zzcondition'
  );
  -- A prize bank account (#523): its audit rows are keyed by the account id,
  -- not the user id, and must be anonymised all the same.
  -- Bank details are held only with financial-data consent (#451).
  PERFORM record_sensitive_data_consent(v_a, 'financial', true, '2026-11-19');
  PERFORM set_player_bank_account(v_a, 'MBBEMYKL', 'Maybank', 'Aisyah Rahmanova', '514100009999');

  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_auth_b, 'keep-me@test.local', 'Bryan', 'Keepwell')
    RETURNING id INTO v_b;
  INSERT INTO player_profiles (user_id, date_of_birth) VALUES (v_b, '2001-01-01');

  INSERT INTO organizations (name) VALUES ('ANONYMISATION ORG') RETURNING id INTO v_org;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline, format, time_control,
    entry_fees, max_participants
  ) VALUES (
    v_org, 'ANONYMISATION CUP', 'Hall', 'Selangor', '1 Test Road',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":5,"system":"swiss"}'::jsonb,
    '{"base_minutes":90,"increment_seconds":30}'::jsonb,
    '{"standard":{"amount_cents":10000}}'::jsonb, 20
  ) RETURNING id INTO v_tour;

  -- Writes made AS user A, so changed_by = A: their own profile, a
  -- non-financial row elsewhere, and two financial rows.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth_a)::text, true);
  UPDATE player_profiles SET nationality = 'Malaysian (PR)' WHERE user_id = v_a;
  UPDATE organizations SET name = 'ANONYMISATION ORG RENAMED' WHERE id = v_org;
  INSERT INTO registrations (user_id, tournament_id, fee_tier)
    VALUES (v_a, v_tour, 'standard') RETURNING id INTO v_reg;
  INSERT INTO payments (type, tournament_id, registration_id, user_id, organization_id,
                        gross_amount_cents, net_amount_cents)
    VALUES ('registration', v_tour, v_reg, v_a, v_org, 10000, 10000);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_auth_b)::text, true);
  UPDATE player_profiles SET nationality = 'Malaysian' WHERE user_id = v_b;
  PERFORM set_config('request.jwt.claims', '{}', true);

  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE changed_by = v_a AND table_name = 'registrations') THEN
    RAISE EXCEPTION 'fixture FAIL: registration audit row was not attributed to user A';
  END IF;

  SELECT md5(string_agg(row_to_json(a)::text, '|' ORDER BY a.id)) INTO v_fin_before
    FROM audit_logs a WHERE a.table_name = ANY (c_financial);
  SELECT md5(string_agg(row_to_json(a)::text, '|' ORDER BY a.id)) INTO v_b_before
    FROM audit_logs a
    WHERE a.table_name IN ('users', 'player_profiles') AND a.record_id = v_b::text;

  -- ---- X1: a live account is refused --------------------------------------
  BEGIN
    PERFORM anonymise_user_audit_logs(v_a);
    RAISE EXCEPTION 'X1 FAIL: a live account was anonymised';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'USER_NOT_DELETED' THEN
      RAISE EXCEPTION 'X1 FAIL: expected USER_NOT_DELETED, got %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'X1 PASS — live account refused';

  -- ---- X2: soft delete, then anonymise ------------------------------------
  -- Only deleted_at changes, so every snapshot, old and new, still carries the
  -- full personal data going in. That makes "nothing survives" a real test.
  UPDATE users SET deleted_at = now() WHERE id = v_a;

  SELECT count(*) INTO v_rows_a FROM audit_logs
    WHERE (table_name IN ('users', 'player_profiles') AND record_id = v_a::text)
       OR (table_name = 'player_bank_accounts' AND new_data ->> 'user_id' = v_a::text);

  -- Guard against a vacuous pass: the pattern below must match going in.
  IF NOT EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.table_name = 'player_profiles' AND a.record_id = v_a::text
      AND a.old_data::text ~* 'zzcondition'
  ) THEN
    RAISE EXCEPTION 'X2 fixture FAIL: user A''s snapshots do not carry the OKU note to begin with';
  END IF;

  SELECT r.snapshots_anonymised, r.changed_by_cleared INTO v_snap, v_cleared
    FROM anonymise_user_audit_logs(v_a) r;

  IF v_snap <> v_rows_a THEN
    RAISE EXCEPTION 'X2 FAIL: anonymised % snapshots, expected all % of user A''s', v_snap, v_rows_a;
  END IF;
  IF EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE ((a.table_name IN ('users', 'player_profiles') AND a.record_id = v_a::text)
        OR (a.table_name = 'player_bank_accounts' AND COALESCE(a.new_data, a.old_data) ->> 'user_id' = v_a::text))
      AND concat(a.old_data::text, a.new_data::text) ~* 'anon-me@|aisyah|rahmanova|2010-05-17|98765432|maybank|MBBEMYKL|zzcondition|"female"|"rejected"|malaysian'
  ) THEN
    RAISE EXCEPTION 'X2 FAIL: personal data survives in user A''s audit snapshots';
  END IF;

  SELECT count(*) INTO v_count FROM audit_logs
    WHERE (table_name IN ('users', 'player_profiles') AND record_id = v_a::text)
       OR (table_name = 'player_bank_accounts' AND new_data ->> 'user_id' = v_a::text);
  IF v_count <> v_rows_a THEN
    RAISE EXCEPTION 'X2 FAIL: % audit rows left of % — anonymising must not delete history', v_count, v_rows_a;
  END IF;

  SELECT new_data INTO v_json FROM audit_logs
    WHERE table_name = 'users' AND record_id = v_a::text AND action = 'UPDATE'
    ORDER BY id DESC LIMIT 1;
  IF v_json ->> 'id' IS DISTINCT FROM v_a::text
     OR v_json ->> 'deleted_at' IS NULL OR v_json ->> 'deleted_at' = '[anonymised]'
     OR v_json ->> 'email' IS DISTINCT FROM '[anonymised]'
     OR v_json ->> 'auth_user_id' IS DISTINCT FROM '[anonymised]' THEN
    RAISE EXCEPTION 'X2 FAIL: users snapshot kept the wrong keys: %', v_json;
  END IF;
  RAISE NOTICE 'X2 PASS — % snapshots anonymised, rows and ids/timestamps kept', v_snap;

  -- ---- X3: financial rows untouched ---------------------------------------
  IF (SELECT md5(string_agg(row_to_json(a)::text, '|' ORDER BY a.id))
        FROM audit_logs a WHERE a.table_name = ANY (c_financial)) IS DISTINCT FROM v_fin_before THEN
    RAISE EXCEPTION 'X3 FAIL: a payments/refunds/payouts/registrations audit row changed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE changed_by = v_a AND table_name = 'payments') THEN
    RAISE EXCEPTION 'X3 FAIL: changed_by on a payments audit row was cleared';
  END IF;
  RAISE NOTICE 'X3 PASS — financial audit rows unchanged';

  -- ---- X4: authored non-financial rows lose only changed_by ---------------
  IF EXISTS (SELECT 1 FROM audit_logs WHERE changed_by = v_a AND table_name <> ALL (c_financial)) THEN
    RAISE EXCEPTION 'X4 FAIL: a non-financial audit row still names user A as changed_by';
  END IF;
  SELECT new_data INTO v_json FROM audit_logs
    WHERE table_name = 'organizations' AND record_id = v_org::text AND action = 'UPDATE'
    ORDER BY id DESC LIMIT 1;
  IF v_json ->> 'name' IS DISTINCT FROM 'ANONYMISATION ORG RENAMED' THEN
    RAISE EXCEPTION 'X4 FAIL: the organizations row A edited lost its snapshot (%)', v_json;
  END IF;
  IF v_cleared < 2 THEN  -- A's own profile update and the organizations rename
    RAISE EXCEPTION 'X4 FAIL: changed_by_cleared=% (expected at least 2)', v_cleared;
  END IF;
  RAISE NOTICE 'X4 PASS — % authored rows kept, changed_by cleared', v_cleared;

  -- ---- X5: idempotent -----------------------------------------------------
  SELECT r.snapshots_anonymised, r.changed_by_cleared INTO v_snap, v_cleared
    FROM anonymise_user_audit_logs(v_a) r;
  IF v_snap <> 0 OR v_cleared <> 0 THEN
    RAISE EXCEPTION 'X5 FAIL: second run changed % snapshots / % changed_by', v_snap, v_cleared;
  END IF;
  RAISE NOTICE 'X5 PASS — re-running is a no-op';

  -- ---- X6: another user is untouched, and still sees their own rows -------
  IF (SELECT md5(string_agg(row_to_json(a)::text, '|' ORDER BY a.id))
        FROM audit_logs a
        WHERE a.table_name IN ('users', 'player_profiles') AND a.record_id = v_b::text)
     IS DISTINCT FROM v_b_before THEN
    RAISE EXCEPTION 'X6 FAIL: user B''s audit history changed';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_auth_b, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM audit_logs;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);

  IF v_count = 0 OR v_count <> (
    SELECT count(*) FROM audit_logs
    WHERE table_name IN ('users', 'player_profiles') AND record_id = v_b::text
  ) THEN
    RAISE EXCEPTION 'X6 FAIL: user B sees % audit rows through RLS (expected exactly their own)', v_count;
  END IF;
  RAISE NOTICE 'X6 PASS — other users untouched; own-account RLS view still works (% rows)', v_count;

  -- ---- X7: hard delete ----------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'hard-delete@test.local', 'Chandra', 'Gonewell')
    RETURNING id INTO v_c;
  INSERT INTO player_profiles (user_id, date_of_birth, mcf_id) VALUES (v_c, '1999-09-09', 556677);

  DELETE FROM users WHERE id = v_c;  -- cascades to player_profiles

  IF NOT EXISTS (
    SELECT 1 FROM audit_logs
    WHERE table_name = 'users' AND record_id = v_c::text AND action = 'DELETE'
      AND old_data ->> 'email' = 'hard-delete@test.local'
  ) THEN
    RAISE EXCEPTION 'X7 fixture FAIL: expected the DELETE snapshot to carry the email';
  END IF;

  PERFORM anonymise_user_audit_logs(v_c);

  IF EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.table_name IN ('users', 'player_profiles') AND a.record_id = v_c::text
      AND concat(a.old_data::text, a.new_data::text) ~* 'hard-delete@|chandra|gonewell|1999-09-09|556677'
  ) THEN
    RAISE EXCEPTION 'X7 FAIL: personal data survives after a hard delete';
  END IF;
  RAISE NOTICE 'X7 PASS — hard-deleted account anonymised, DELETE snapshot included';

  -- ---- X8: invitation audit rows ------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'x8-old@test.local', 'Dewi', 'Moved')
    RETURNING id INTO v_d;
  -- An address change: the users snapshots now hold both addresses.
  UPDATE users SET email = 'x8-new@test.local' WHERE id = v_d;

  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'x8-inviter@test.local', 'Ivan', 'Viter')
    RETURNING id INTO v_inviter;
  INSERT INTO organizations (name, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('X8 ORG', 'society', current_organizer_agreement_version(), now(), 'approved')
    RETURNING id INTO v_inv_org;
  INSERT INTO organization_memberships (organization_id, user_id, role_id)
    SELECT v_inv_org, v_inviter, id FROM roles WHERE name = 'owner' AND scope = 'organization';

  PERFORM create_organization_invitation(v_inv_org, 'x8-old@test.local', 'member', v_inviter,
                                         encode(sha256('x8-a'::bytea), 'hex'));
  PERFORM create_organization_invitation(v_inv_org, 'x8-new@test.local', 'member', v_inviter,
                                         encode(sha256('x8-b'::bytea), 'hex'));
  PERFORM create_organization_invitation(v_inv_org, 'x8-someone@test.local', 'member', v_inviter,
                                         encode(sha256('x8-c'::bytea), 'hex'));
  SELECT md5(string_agg(row_to_json(a)::text, '|' ORDER BY a.id)) INTO v_other_inv
    FROM audit_logs a
    WHERE a.table_name = 'organization_invitations' AND a.new_data ->> 'email' = 'x8-someone@test.local';

  -- The runbook, step 5: invitations to the current address, then the user.
  DELETE FROM organization_invitations WHERE email = 'x8-new@test.local';
  DELETE FROM users WHERE id = v_d;

  SELECT count(*) INTO v_inv_rows FROM audit_logs a
    WHERE a.table_name = 'organization_invitations'
      AND COALESCE(a.new_data, a.old_data) ->> 'email' IN ('x8-old@test.local', 'x8-new@test.local');
  IF v_inv_rows < 3 THEN  -- two INSERTs and the DELETE
    RAISE EXCEPTION 'X8 fixture FAIL: expected at least 3 invitation audit rows for the user, found %', v_inv_rows;
  END IF;

  PERFORM anonymise_user_audit_logs(v_d);

  IF EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.table_name = 'organization_invitations'
      AND concat(a.old_data::text, a.new_data::text) ~* 'x8-old@|x8-new@'
  ) THEN
    RAISE EXCEPTION 'X8 FAIL: an invitation snapshot still holds one of the user''s addresses';
  END IF;
  SELECT count(*) INTO v_count FROM audit_logs a
    WHERE a.table_name = 'organization_invitations'
      AND COALESCE(a.new_data, a.old_data) ->> 'organization_id' = v_inv_org::text
      AND COALESCE(a.new_data, a.old_data) ->> 'email' = '[anonymised]'
      AND COALESCE(a.new_data, a.old_data) ->> 'status' = 'pending'
      AND COALESCE(a.new_data, a.old_data) ->> 'invited_by' = v_inviter::text;
  IF v_count <> v_inv_rows THEN
    RAISE EXCEPTION 'X8 FAIL: % of % invitation rows kept with ids and status (rows must stay)', v_count, v_inv_rows;
  END IF;
  IF (SELECT md5(string_agg(row_to_json(a)::text, '|' ORDER BY a.id))
        FROM audit_logs a
        WHERE a.table_name = 'organization_invitations'
          AND a.new_data ->> 'email' = 'x8-someone@test.local') IS DISTINCT FROM v_other_inv THEN
    RAISE EXCEPTION 'X8 FAIL: another invitee''s audit rows changed';
  END IF;

  SELECT r.snapshots_anonymised INTO v_snap FROM anonymise_user_audit_logs(v_d) r;
  IF v_snap <> 0 THEN
    RAISE EXCEPTION 'X8 FAIL: second run changed % snapshots', v_snap;
  END IF;
  RAISE NOTICE 'X8 PASS — % invitation snapshots anonymised, old address included', v_inv_rows;

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
