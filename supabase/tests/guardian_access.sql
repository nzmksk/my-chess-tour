-- =============================================================================
-- RLS regression test: guardians act for their dependents through
-- can_act_for() (#707).
--
-- Fixtures: a guardian with two active guardianships (a managed child with no
-- login, and an adult with a login whom the guardian helps), a third dependent
-- with a login and no roles, a managed dependent with no profile yet, and a
-- stranger. The helped adult owns an organization and is a platform admin, so
-- there is something for the guardian not to inherit.
--
-- Covers:
--   A1  a guardian reads their active dependents' player_profiles,
--       registrations, payments and refunds, and writes their player_profiles
--       (update, and insert for a dependent with no profile yet); never a
--       stranger's
--   A2  a guardian doesn't inherit a dependent's users row, platform role,
--       organization membership, permissions or account audit logs
--   A3  a dependent with a login of their own can't read the guardian's data,
--       or another dependent's
--   A4  a revoked guardianship and a claimed one stop counting at once: reads
--       and writes on that dependent fail, the guardian's own rows stay
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
  v_helped_auth   uuid := gen_random_uuid();
  v_stranger_auth uuid := gen_random_uuid();
  v_guardian      uuid;
  v_child         uuid;
  v_newborn       uuid;
  v_adult         uuid;
  v_helped        uuid;
  v_stranger      uuid;
  v_org           uuid;
  v_adult_org     uuid;
  v_tournament    uuid;
  v_res           jsonb;
  v_gross         integer;
  v_reg_child     uuid;
  v_reg_adult     uuid;
  v_reg_guardian  uuid;
  v_reg_stranger  uuid;
  v_pay_child     uuid;
  v_pay_adult     uuid;
  v_pay_stranger  uuid;
  v_g_child       uuid;
  v_g_adult       uuid;
  v_count         integer;
  v_text          text;
BEGIN
  -- ---- fixtures (service role: RLS not enforced) --------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_guardian_auth, 'access-guardian@test.local', 'Gina', 'Guardian')
    RETURNING id INTO v_guardian;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Kai', 'Child', 'managed')
    RETURNING id INTO v_child;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Nia', 'Newborn', 'managed')
    RETURNING id INTO v_newborn;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_adult_auth, 'access-adult@test.local', 'Ada', 'Adult')
    RETURNING id INTO v_adult;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_helped_auth, 'access-helped@test.local', 'Hal', 'Helped')
    RETURNING id INTO v_helped;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_stranger_auth, 'access-stranger@test.local', 'Stan', 'Stranger')
    RETURNING id INTO v_stranger;

  INSERT INTO player_profiles (user_id)
    VALUES (v_guardian), (v_child), (v_adult), (v_helped), (v_stranger);

  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                             terms_version, terms_accepted_at)
    VALUES (v_guardian, v_child, 'parent', 'minor', '2026-11-23', now())
    RETURNING id INTO v_g_child;
  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                             terms_version, terms_accepted_at)
    VALUES (v_guardian, v_newborn, 'parent', 'minor', '2026-11-23', now());
  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                             terms_version, terms_accepted_at, authorisation_method)
    VALUES (v_guardian, v_adult, 'carer', 'authorised', '2026-11-23', now(), 'player_invite')
    RETURNING id INTO v_g_adult;
  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship, basis,
                             terms_version, terms_accepted_at, authorisation_method)
    VALUES (v_guardian, v_helped, 'carer', 'authorised', '2026-11-23', now(), 'player_invite');

  -- The helped adult's roles: a platform admin, and the owner of an
  -- organization other than the tournament's.
  INSERT INTO user_global_roles (user_id, role_id)
    SELECT v_adult, id FROM roles WHERE name = 'platform_admin';
  INSERT INTO organizations (name) VALUES ('ACCESS ADULT ORG') RETURNING id INTO v_adult_org;
  INSERT INTO organization_memberships (organization_id, user_id, role_id)
    SELECT v_adult_org, v_adult, id FROM roles WHERE name = 'owner' AND scope = 'organization';

  INSERT INTO organizations (name) VALUES ('ACCESS ORG') RETURNING id INTO v_org;
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'ACCESS T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  -- The guardian pays for the child; the adult and the stranger pay for
  -- themselves.
  v_res := create_registration_with_payment(v_child, v_tournament, 'standard', 10000, v_guardian);
  v_reg_child := (v_res->>'registration_id')::uuid;
  v_pay_child := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_child;
  PERFORM settle_registration_payment(v_pay_child, true, v_gross, 'fpx_b2c');

  v_res := create_registration_with_payment(v_adult, v_tournament, 'standard', 10000);
  v_reg_adult := (v_res->>'registration_id')::uuid;
  v_pay_adult := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay_adult, true, v_gross, 'fpx_b2c');

  v_res := create_registration_with_payment(v_guardian, v_tournament, 'standard', 10000);
  v_reg_guardian := (v_res->>'registration_id')::uuid;
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, true, v_gross, 'fpx_b2c');

  v_res := create_registration_with_payment(v_stranger, v_tournament, 'standard', 10000);
  v_reg_stranger := (v_res->>'registration_id')::uuid;
  v_pay_stranger := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay_stranger, true, v_gross, 'visa');

  INSERT INTO refunds (registration_id, refund_amount_cents, reason, status, requested_by)
    VALUES (v_reg_child, v_gross, 'test', 'pending', v_guardian),
           (v_reg_adult, v_gross, 'test', 'pending', v_adult),
           (v_reg_stranger, v_gross, 'test', 'pending', v_stranger);

  IF (SELECT user_id FROM payments WHERE id = v_pay_child) <> v_guardian THEN
    RAISE EXCEPTION 'SETUP FAIL: the child''s payment is not the guardian''s';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE table_name = 'users' AND record_id = v_adult::text) THEN
    RAISE EXCEPTION 'SETUP FAIL: no account audit log for the adult, so A2 would pass vacuously';
  END IF;

  -- ---- act as the guardian ------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guardian_auth)::text, true);
  SET LOCAL ROLE authenticated;

  -- ===== A1 ===============================================================
  IF NOT (can_act_for(v_guardian) AND can_act_for(v_child) AND can_act_for(v_adult)) THEN
    RAISE EXCEPTION 'A1 FAIL: can_act_for refused the guardian, or an active dependent';
  END IF;
  IF can_act_for(v_stranger) THEN
    RAISE EXCEPTION 'A1 FAIL: can_act_for allowed a stranger';
  END IF;

  SELECT count(*) INTO v_count FROM player_profiles
    WHERE user_id IN (v_guardian, v_child, v_adult, v_helped);
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'A1 FAIL: guardian sees % of 4 own and dependent profiles', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM player_profiles WHERE user_id = v_stranger) THEN
    RAISE EXCEPTION 'A1 FAIL: guardian read a stranger''s profile';
  END IF;

  UPDATE player_profiles SET nationality = 'Malaysia' WHERE user_id IN (v_child, v_stranger);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'A1 FAIL: guardian''s profile update touched % rows (expected the child''s only)', v_count;
  END IF;
  INSERT INTO player_profiles (user_id) VALUES (v_newborn);
  BEGIN
    INSERT INTO player_profiles (user_id) VALUES (gen_random_uuid());
    RAISE EXCEPTION 'A1 FAIL: guardian inserted a profile for someone they don''t act for';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT count(*) INTO v_count FROM registrations;
  IF v_count <> 3 OR NOT EXISTS (SELECT 1 FROM registrations WHERE id = v_reg_child)
     OR NOT EXISTS (SELECT 1 FROM registrations WHERE id = v_reg_adult) THEN
    RAISE EXCEPTION 'A1 FAIL: guardian sees % registrations (expected own, child''s, adult''s)', v_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM payments WHERE id = v_pay_adult) THEN
    RAISE EXCEPTION 'A1 FAIL: guardian can''t read a payment the dependent made';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM payments WHERE id = v_pay_child) THEN
    RAISE EXCEPTION 'A1 FAIL: guardian can''t read the payment they made for the child';
  END IF;
  IF EXISTS (SELECT 1 FROM payments WHERE id = v_pay_stranger) THEN
    RAISE EXCEPTION 'A1 FAIL: guardian read a stranger''s payment';
  END IF;

  SELECT count(*) INTO v_count FROM refunds;
  IF v_count <> 2 OR EXISTS (SELECT 1 FROM refunds WHERE registration_id = v_reg_stranger) THEN
    RAISE EXCEPTION 'A1 FAIL: guardian sees % refunds (expected the child''s and the adult''s)', v_count;
  END IF;
  RAISE NOTICE 'A1 PASS: a guardian reads and writes for active dependents only';

  -- ===== A2 ===============================================================
  IF EXISTS (SELECT 1 FROM users WHERE id IN (v_child, v_adult)) THEN
    RAISE EXCEPTION 'A2 FAIL: guardian read a dependent''s users row';
  END IF;
  IF EXISTS (SELECT 1 FROM user_global_roles WHERE user_id = v_adult) THEN
    RAISE EXCEPTION 'A2 FAIL: guardian read a dependent''s platform role';
  END IF;
  IF has_global_permission(app_user_id(), 'platform.manage') THEN
    RAISE EXCEPTION 'A2 FAIL: guardian inherited the platform admin permission';
  END IF;
  IF EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = v_adult_org) THEN
    RAISE EXCEPTION 'A2 FAIL: guardian read the dependent''s organization membership';
  END IF;
  IF is_org_member(app_user_id(), v_adult_org)
     OR has_org_permission(app_user_id(), v_adult_org, 'org.manage') THEN
    RAISE EXCEPTION 'A2 FAIL: guardian inherited the dependent''s organization';
  END IF;
  IF EXISTS (SELECT 1 FROM audit_logs WHERE record_id IN (v_child::text, v_adult::text)) THEN
    RAISE EXCEPTION 'A2 FAIL: guardian read a dependent''s account audit logs';
  END IF;
  RAISE NOTICE 'A2 PASS: no account record, role, membership or history is inherited';

  -- ===== A3 ===============================================================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_helped_auth)::text, true);
  IF can_act_for(v_guardian) OR can_act_for(v_child) THEN
    RAISE EXCEPTION 'A3 FAIL: a dependent can act for their guardian, or another dependent';
  END IF;
  SELECT count(*) INTO v_count FROM player_profiles;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'A3 FAIL: dependent sees % profiles (expected own only)', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM registrations) OR EXISTS (SELECT 1 FROM payments)
     OR EXISTS (SELECT 1 FROM refunds) THEN
    RAISE EXCEPTION 'A3 FAIL: dependent read registrations, payments or refunds that aren''t theirs';
  END IF;
  UPDATE player_profiles SET nationality = 'Singapore' WHERE user_id = v_guardian;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'A3 FAIL: dependent updated the guardian''s profile';
  END IF;
  RAISE NOTICE 'A3 PASS: access runs from guardian to dependent only';

  -- ===== A4 ===============================================================
  RESET ROLE;
  UPDATE guardianships SET status = 'revoked', revoked_at = now() WHERE id = v_g_child;
  UPDATE guardianships SET status = 'claimed' WHERE id = v_g_adult;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_guardian_auth)::text, true);
  SET LOCAL ROLE authenticated;

  IF can_act_for(v_child) OR can_act_for(v_adult) THEN
    RAISE EXCEPTION 'A4 FAIL: can_act_for still allows a revoked or claimed guardianship';
  END IF;
  IF EXISTS (SELECT 1 FROM player_profiles WHERE user_id IN (v_child, v_adult)) THEN
    RAISE EXCEPTION 'A4 FAIL: guardian still reads a former dependent''s profile';
  END IF;
  UPDATE player_profiles SET nationality = 'Thailand' WHERE user_id = v_child;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'A4 FAIL: guardian still updates a former dependent''s profile';
  END IF;
  IF EXISTS (SELECT 1 FROM registrations WHERE id IN (v_reg_child, v_reg_adult))
     OR EXISTS (SELECT 1 FROM payments WHERE id = v_pay_adult)
     OR EXISTS (SELECT 1 FROM refunds WHERE registration_id IN (v_reg_child, v_reg_adult)) THEN
    RAISE EXCEPTION 'A4 FAIL: guardian still reads a former dependent''s registrations, payments or refunds';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = v_reg_guardian)
     OR NOT EXISTS (SELECT 1 FROM payments WHERE id = v_pay_child)
     OR NOT EXISTS (SELECT 1 FROM player_profiles WHERE user_id = v_helped) THEN
    RAISE EXCEPTION 'A4 FAIL: guardian lost their own rows, or an unrelated active dependent''s';
  END IF;
  RAISE NOTICE 'A4 PASS: revoked and claimed guardianships stop counting at once';

  RESET ROLE;
  SELECT nationality INTO v_text FROM player_profiles WHERE user_id = v_child;
  IF v_text IS DISTINCT FROM 'Malaysia' THEN
    RAISE EXCEPTION 'A4 FAIL: the child''s profile is % (expected the update made while active)', v_text;
  END IF;

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
