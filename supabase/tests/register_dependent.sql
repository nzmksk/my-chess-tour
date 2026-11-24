-- =============================================================================
-- Regression test: a guardian registers a dependent for a tournament (#714).
--
-- Covers:
--   R1  a guardian registers a minor dependent: registrations.user_id is the
--       dependent, registered_by the guardian, payments.user_id the guardian;
--       the under-18 block (#711) doesn't apply to a managed participant
--   R2  a player registering themselves leaves registered_by NULL
--   R3  someone with no guardianship of the participant is refused with
--       NOT_GUARDIAN (42501), and nothing is written
--   R4  a revoked guardianship no longer counts
--   R5  start_new_payment_attempt rewrites registered_by on every attempt:
--       the helper's retry records the helper, the player's own retry clears
--       it, and a stranger's retry is refused without touching the row
--   R6  once a guardian's checkout is pending, revoking the guardianship is
--       refused (the other half of the lock order with revoke_dependent)
--   R7  clients can't call assert_payer_acts_for
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs, so it builds throwaway
-- fixtures and persists NOTHING. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_child_dob   date := ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '10 years')::date;
  v_org         uuid;
  v_tournament  uuid;
  v_guardian    uuid;
  v_stranger    uuid;
  v_helper      uuid;
  v_adult       uuid;
  v_child       uuid;
  v_former      uuid;
  v_res         jsonb;
  v_reg         uuid;
  v_pay         uuid;
  v_row         record;
  v_count       integer;
  v_state       text;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('REGISTER DEPENDENT ORG') RETURNING id INTO v_org;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'regdep-guardian@test.local', 'Gwen', 'Guardian')
    RETURNING id INTO v_guardian;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'regdep-stranger@test.local', 'Stan', 'Stranger')
    RETURNING id INTO v_stranger;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'regdep-helper@test.local', 'Hana', 'Helper')
    RETURNING id INTO v_helper;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'regdep-adult@test.local', 'Adam', 'Adult')
    RETURNING id INTO v_adult;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Cara', 'Child', 'managed') RETURNING id INTO v_child;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Fred', 'Former', 'managed') RETURNING id INTO v_former;
  INSERT INTO player_profiles (user_id, date_of_birth) VALUES
    (v_guardian, NULL), (v_stranger, NULL), (v_helper, NULL), (v_adult, NULL),
    (v_child, v_child_dob), (v_former, v_child_dob);

  INSERT INTO guardianships (guardian_user_id, dependent_user_id, relationship,
                             basis, authorisation_method, terms_version, terms_accepted_at)
  VALUES (v_guardian, v_child,  'parent', 'minor',      NULL,            '2026-11-24', now()),
         (v_guardian, v_former, 'parent', 'minor',      NULL,            '2026-11-24', now()),
         (v_helper,   v_adult,  'carer',  'authorised', 'player_invite', '2026-11-24', now());
  UPDATE guardianships SET status = 'revoked', revoked_at = now()
    WHERE dependent_user_id = v_former;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'REGISTER DEPENDENT T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  -- ===== R1 ===============================================================
  v_res := create_registration_with_payment(
    v_child, v_tournament, 'standard', 4000, p_payer_user_id => v_guardian);
  v_reg := (v_res->>'registration_id')::uuid;
  v_pay := (v_res->>'payment_id')::uuid;

  SELECT r.user_id, r.registered_by, p.user_id AS payer
    INTO v_row
    FROM registrations r JOIN payments p ON p.id = r.current_payment_id
    WHERE r.id = v_reg;
  IF v_row.user_id IS DISTINCT FROM v_child
     OR v_row.registered_by IS DISTINCT FROM v_guardian
     OR v_row.payer IS DISTINCT FROM v_guardian
     OR (SELECT id FROM payments WHERE id = v_pay) IS NULL THEN
    RAISE EXCEPTION 'R1 FAIL: registration/payment rows are %', row_to_json(v_row);
  END IF;
  RAISE NOTICE 'R1 PASS — dependent on the registration, guardian as registered_by and payer';

  -- ===== R2 ===============================================================
  v_res := create_registration_with_payment(v_stranger, v_tournament, 'standard', 4000);
  SELECT registered_by INTO v_row FROM registrations
    WHERE id = (v_res->>'registration_id')::uuid;
  IF v_row.registered_by IS NOT NULL THEN
    RAISE EXCEPTION 'R2 FAIL: a self registration has registered_by %', v_row.registered_by;
  END IF;
  RAISE NOTICE 'R2 PASS — a player registering themselves leaves registered_by NULL';

  -- ===== R3 ===============================================================
  SELECT count(*) INTO v_count FROM registrations WHERE user_id = v_adult;
  BEGIN
    PERFORM create_registration_with_payment(
      v_adult, v_tournament, 'standard', 4000, p_payer_user_id => v_stranger);
    RAISE EXCEPTION 'R3 FAIL: a stranger registered someone else';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    GET STACKED DIAGNOSTICS v_state = MESSAGE_TEXT;
    IF v_state NOT LIKE 'NOT_GUARDIAN%' THEN
      RAISE EXCEPTION 'R3 FAIL: refused with %', v_state;
    END IF;
  END;
  IF (SELECT count(*) FROM registrations WHERE user_id = v_adult) <> v_count THEN
    RAISE EXCEPTION 'R3 FAIL: a refused registration left a row';
  END IF;
  RAISE NOTICE 'R3 PASS — no guardianship, no registration';

  -- ===== R4 ===============================================================
  BEGIN
    PERFORM create_registration_with_payment(
      v_former, v_tournament, 'standard', 4000, p_payer_user_id => v_guardian);
    RAISE EXCEPTION 'R4 FAIL: a revoked guardianship still registered the dependent';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
  RAISE NOTICE 'R4 PASS — a revoked guardianship no longer counts';

  -- ===== R5 ===============================================================
  v_res := create_registration_with_payment(v_adult, v_tournament, 'standard', 4000);
  v_reg := (v_res->>'registration_id')::uuid;
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, false, NULL);

  v_res := start_new_payment_attempt(v_reg, 'standard', 4000, p_payer_user_id => v_helper);
  SELECT r.registered_by, p.user_id AS payer INTO v_row
    FROM registrations r JOIN payments p ON p.id = r.current_payment_id
    WHERE r.id = v_reg;
  IF v_row.registered_by IS DISTINCT FROM v_helper OR v_row.payer IS DISTINCT FROM v_helper THEN
    RAISE EXCEPTION 'R5 FAIL: after the helper''s retry the row is %', row_to_json(v_row);
  END IF;

  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, false, NULL);
  v_res := start_new_payment_attempt(v_reg, 'standard', 4000, p_payer_user_id => v_adult);
  SELECT r.registered_by, p.user_id AS payer INTO v_row
    FROM registrations r JOIN payments p ON p.id = r.current_payment_id
    WHERE r.id = v_reg;
  IF v_row.registered_by IS NOT NULL OR v_row.payer IS DISTINCT FROM v_adult THEN
    RAISE EXCEPTION 'R5 FAIL: after the player''s own retry the row is %', row_to_json(v_row);
  END IF;

  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, false, NULL);
  SELECT current_payment_id::text INTO v_state FROM registrations WHERE id = v_reg;
  BEGIN
    PERFORM start_new_payment_attempt(v_reg, 'standard', 4000, p_payer_user_id => v_stranger);
    RAISE EXCEPTION 'R5 FAIL: a stranger started an attempt';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    NULL;
  END;
  IF (SELECT current_payment_id::text FROM registrations WHERE id = v_reg) IS DISTINCT FROM v_state THEN
    RAISE EXCEPTION 'R5 FAIL: a refused attempt changed the registration';
  END IF;
  RAISE NOTICE 'R5 PASS — registered_by follows each attempt''s payer';

  -- ===== R6 ===============================================================
  BEGIN
    PERFORM revoke_dependent(v_guardian, v_child);
    RAISE EXCEPTION 'R6 FAIL: revoked a guardianship with a pending checkout';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_state = MESSAGE_TEXT;
    IF v_state NOT LIKE 'DEPENDENT_HAS_PENDING_PAYMENT%' THEN
      RAISE EXCEPTION 'R6 FAIL: refused with %', v_state;
    END IF;
  END;
  RAISE NOTICE 'R6 PASS — a pending checkout blocks revoking the guardianship';

  -- ===== R7 ===============================================================
  IF has_function_privilege('authenticated', 'assert_payer_acts_for(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'assert_payer_acts_for(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'R7 FAIL: clients can execute assert_payer_acts_for';
  END IF;
  RAISE NOTICE 'R7 PASS — clients can''t call assert_payer_acts_for';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
