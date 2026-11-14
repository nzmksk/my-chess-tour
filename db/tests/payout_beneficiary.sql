-- =============================================================================
-- DB regression test for payout beneficiary nomination (#520):
--   * nominate_payout_beneficiary / accept_payout_nomination /
--     decline_payout_nomination
--     (003_functions_triggers.sql)
--   * the money-field freeze and the client-session guard on the beneficiary
--     columns (guard_tournament_money_fields / guard_tournament_beneficiary_columns)
--
-- Covers:
--   B1  nomination is refused for self, and for an unapproved, bank-unverified,
--       stale-agreement or entity-less nominee
--   B2  a valid nomination is stored as pending (accepted_at NULL)
--   B3  nominating needs payout.request on the ORGANIZING org; an org admin is refused
--   B4  acceptance needs payout.request on the NOMINEE; the nominating owner is refused
--   B5  acceptance by the nominee's owner sets accepted_at; repeating it is a no-op
--   B6  nominating a different org resets the earlier acceptance; NULL withdraws
--   B7  a user JWT cannot write the beneficiary columns directly, on INSERT or UPDATE
--   B8  the first paid registration freezes the nomination, and a pending one lapses
--   B9  declining needs payout.request on the NOMINEE, clears a pending nomination,
--       and is refused once accepted or when there is nothing to decline
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations and seed (the owner/admin roles come from 006). Runs
-- inside a transaction that ROLLBACKs, so it persists NOTHING. A failing assertion
-- RAISEs; on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_owner_role integer;
  v_admin_role integer;
  v_org        uuid;  -- organizer
  v_good       uuid;  -- eligible nominee
  v_other      uuid;  -- second eligible nominee
  v_bad        uuid;  -- reshaped per B1 case
  v_owner      uuid;  v_owner_auth uuid := gen_random_uuid();
  v_admin      uuid;
  v_good_owner uuid;
  v_t          uuid;
  v_t2         uuid;
  v_player     uuid;
  v_res        jsonb;
  v_row        tournaments;
  v_case       text;
BEGIN
  SELECT id INTO v_owner_role FROM roles WHERE name = 'owner' AND scope = 'organization';
  SELECT id INTO v_admin_role FROM roles WHERE name = 'admin' AND scope = 'organization';

  INSERT INTO users (id, auth_user_id, email, first_name, last_name)
    VALUES (v_owner_auth, v_owner_auth, 'ben-owner@test.local', 'O', 'T') RETURNING id INTO v_owner;
  INSERT INTO users (email, first_name, last_name) VALUES ('ben-admin@test.local', 'A', 'T') RETURNING id INTO v_admin;
  INSERT INTO users (email, first_name, last_name) VALUES ('ben-good@test.local', 'G', 'T') RETURNING id INTO v_good_owner;
  INSERT INTO users (email, first_name, last_name) VALUES ('ben-player@test.local', 'P', 'T') RETURNING id INTO v_player;

  INSERT INTO organizations (name, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('BEN ORG', 'company', current_organizer_agreement_version(), now(), 'approved') RETURNING id INTO v_org;
  INSERT INTO organizations (name, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('BEN GOOD', 'society', current_organizer_agreement_version(), now(), 'approved') RETURNING id INTO v_good;
  INSERT INTO organizations (name, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('BEN OTHER', 'society', current_organizer_agreement_version(), now(), 'approved') RETURNING id INTO v_other;
  INSERT INTO organizations (name, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('BEN BAD', 'society', current_organizer_agreement_version(), now(), 'approved') RETURNING id INTO v_bad;

  INSERT INTO organization_bank_accounts (organization_id, bank_name, bank_code, account_holder, account_number, status, chip_bank_account_id, verified_at)
    VALUES (v_good,  'Maybank', 'MBBEMYKL', 'Good',  '514000000001', 'verified', 910001, now()),
           (v_other, 'Maybank', 'MBBEMYKL', 'Other', '514000000002', 'verified', 910002, now()),
           (v_bad,   'Maybank', 'MBBEMYKL', 'Bad',   '514000000003', 'verified', 910003, now());

  INSERT INTO organization_memberships (organization_id, user_id, role_id) VALUES
    (v_org,  v_owner,      v_owner_role),
    (v_org,  v_admin,      v_admin_role),
    (v_good, v_good_owner, v_owner_role);

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'BEN T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}', 100, 'published'
  ) RETURNING id INTO v_t;

  -- ===== B1: ineligible nominees ============================================
  BEGIN
    PERFORM nominate_payout_beneficiary(v_t, v_org, v_owner);
    RAISE EXCEPTION 'B1 FAIL: self-nomination allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'B1 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'NOMINATION_SELF%' THEN RAISE EXCEPTION 'B1 FAIL (self): %', SQLERRM; END IF;
  END;

  FOREACH v_case IN ARRAY ARRAY['unapproved', 'bank', 'agreement', 'entity'] LOOP
    IF v_case = 'unapproved' THEN
      UPDATE organizations SET approval_status = 'pending' WHERE id = v_bad;
    ELSIF v_case = 'bank' THEN
      UPDATE organization_bank_accounts SET status = 'pending', verified_at = NULL WHERE organization_id = v_bad;
    ELSIF v_case = 'agreement' THEN
      UPDATE organizations SET agreement_version = '2020-01-01' WHERE id = v_bad;
    ELSE
      UPDATE organizations SET entity_type = NULL WHERE id = v_bad;
    END IF;

    BEGIN
      PERFORM nominate_payout_beneficiary(v_t, v_bad, v_owner);
      RAISE EXCEPTION 'B1 FAIL: % nominee accepted', v_case;
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'B1 FAIL%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE 'NOMINEE_INELIGIBLE%' THEN RAISE EXCEPTION 'B1 FAIL (%): %', v_case, SQLERRM; END IF;
    END;

    -- Restore, so each case tests one thing.
    UPDATE organizations
      SET approval_status = 'approved', entity_type = 'society',
          agreement_version = current_organizer_agreement_version()
      WHERE id = v_bad;
    UPDATE organization_bank_accounts SET status = 'verified', verified_at = now() WHERE organization_id = v_bad;
  END LOOP;
  RAISE NOTICE 'B1 PASS — self and every ineligible nominee refused';

  -- ===== B2: a valid nomination is pending ==================================
  PERFORM nominate_payout_beneficiary(v_t, v_good, v_owner);
  SELECT * INTO v_row FROM tournaments WHERE id = v_t;
  IF v_row.beneficiary_organization_id <> v_good OR v_row.beneficiary_accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'B2 FAIL: expected a pending nomination, got org=% accepted=%',
      v_row.beneficiary_organization_id, v_row.beneficiary_accepted_at;
  END IF;
  RAISE NOTICE 'B2 PASS — nomination stored as pending';

  -- ===== B3: nominating needs payout.request on the organizing org ==========
  BEGIN
    PERFORM nominate_payout_beneficiary(v_t, v_other, v_admin);
    RAISE EXCEPTION 'B3 FAIL: an org admin was allowed to nominate';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'B3 PASS — org admin (no payout.request) refused';

  -- ===== B4: acceptance needs payout.request on the NOMINEE =================
  BEGIN
    PERFORM accept_payout_nomination(v_t, v_owner);
    RAISE EXCEPTION 'B4 FAIL: the nominating owner accepted their own nomination';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF (SELECT beneficiary_accepted_at FROM tournaments WHERE id = v_t) IS NOT NULL THEN
    RAISE EXCEPTION 'B4 FAIL: a refused acceptance still stamped accepted_at';
  END IF;
  RAISE NOTICE 'B4 PASS — a one-sided nomination cannot be accepted by its nominator';

  -- ===== B5: the nominee's owner accepts; repeating is a no-op ==============
  v_res := accept_payout_nomination(v_t, v_good_owner);
  IF (v_res->>'already_accepted')::boolean IS NOT FALSE
     OR (SELECT beneficiary_accepted_at FROM tournaments WHERE id = v_t) IS NULL THEN
    RAISE EXCEPTION 'B5 FAIL: acceptance not recorded: %', v_res;
  END IF;
  v_res := accept_payout_nomination(v_t, v_good_owner);
  IF (v_res->>'already_accepted')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'B5 FAIL: repeat acceptance not idempotent: %', v_res;
  END IF;
  RAISE NOTICE 'B5 PASS — acceptance recorded and idempotent';

  -- ===== B6: re-nominating resets acceptance; NULL withdraws ================
  PERFORM nominate_payout_beneficiary(v_t, v_other, v_owner);
  SELECT * INTO v_row FROM tournaments WHERE id = v_t;
  IF v_row.beneficiary_organization_id <> v_other OR v_row.beneficiary_accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'B6 FAIL: re-nomination kept the old acceptance';
  END IF;
  PERFORM nominate_payout_beneficiary(v_t, NULL, v_owner);
  SELECT * INTO v_row FROM tournaments WHERE id = v_t;
  IF v_row.beneficiary_organization_id IS NOT NULL THEN
    RAISE EXCEPTION 'B6 FAIL: withdrawal left a nominee';
  END IF;
  RAISE NOTICE 'B6 PASS — re-nomination resets acceptance; NULL withdraws';

  -- ===== B9: the nominee declines a pending nomination ======================
  PERFORM nominate_payout_beneficiary(v_t, v_good, v_owner);
  BEGIN
    PERFORM decline_payout_nomination(v_t, v_owner);
    RAISE EXCEPTION 'B9 FAIL: the nominating owner declined on the nominee''s behalf';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  IF (SELECT beneficiary_organization_id FROM tournaments WHERE id = v_t) IS DISTINCT FROM v_good THEN
    RAISE EXCEPTION 'B9 FAIL: a refused decline still cleared the nomination';
  END IF;

  v_res := decline_payout_nomination(v_t, v_good_owner);
  SELECT * INTO v_row FROM tournaments WHERE id = v_t;
  IF v_row.beneficiary_organization_id IS NOT NULL OR v_row.beneficiary_accepted_at IS NOT NULL
     OR (v_res->>'declined_organization_id')::uuid IS DISTINCT FROM v_good THEN
    RAISE EXCEPTION 'B9 FAIL: decline did not clear the nomination: % / org=%', v_res, v_row.beneficiary_organization_id;
  END IF;

  BEGIN
    PERFORM decline_payout_nomination(v_t, v_good_owner);
    RAISE EXCEPTION 'B9 FAIL: declined a nomination that no longer exists';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM NOT LIKE 'NOMINATION_NOT_FOUND%' THEN RAISE EXCEPTION 'B9 FAIL (repeat): %', SQLERRM; END IF;
  END;

  PERFORM nominate_payout_beneficiary(v_t, v_good, v_owner);
  PERFORM accept_payout_nomination(v_t, v_good_owner);
  BEGIN
    PERFORM decline_payout_nomination(v_t, v_good_owner);
    RAISE EXCEPTION 'B9 FAIL: an accepted nomination was declined';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'B9 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'NOMINATION_ACCEPTED%' THEN RAISE EXCEPTION 'B9 FAIL (accepted): %', SQLERRM; END IF;
  END;
  IF (SELECT beneficiary_accepted_at FROM tournaments WHERE id = v_t) IS NULL THEN
    RAISE EXCEPTION 'B9 FAIL: a refused decline undid the acceptance';
  END IF;
  PERFORM nominate_payout_beneficiary(v_t, NULL, v_owner);
  RAISE NOTICE 'B9 PASS — the nominee can decline a pending nomination, and only that';

  -- ===== B7: a user JWT cannot write the columns directly ===================
  -- This is the RLS "Org members can update tournaments" path: the policy would
  -- let this through, so the trigger is what stops it.
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_owner_auth, 'role', 'authenticated')::text, true);
  BEGIN
    UPDATE tournaments
      SET beneficiary_organization_id = v_good, beneficiary_accepted_at = now()
      WHERE id = v_t;
    RAISE EXCEPTION 'B7 FAIL: a client session redirected the payout';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'B7 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%cannot be set by a client session%' THEN RAISE EXCEPTION 'B7 FAIL (update): %', SQLERRM; END IF;
  END;
  BEGIN
    INSERT INTO tournaments (
      organization_id, name, venue_name, venue_state, venue_address,
      start_date, end_date, registration_deadline, format, time_control, entry_fees, max_participants,
      beneficiary_organization_id, beneficiary_accepted_at
    ) VALUES (
      v_org, 'BEN T2', 'Venue', 'Selangor', 'Address',
      current_date + 30, current_date + 31, now() + interval '20 days',
      '{"type":"classical"}', '{"base_minutes":90}', '{"standard": {"amount_cents": 10000}}', 100,
      v_good, now()
    ) RETURNING id INTO v_t2;
    RAISE EXCEPTION 'B7 FAIL: a client session inserted a pre-accepted beneficiary';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'B7 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%cannot be set by a client session%' THEN RAISE EXCEPTION 'B7 FAIL (insert): %', SQLERRM; END IF;
  END;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RAISE NOTICE 'B7 PASS — client sessions cannot write the beneficiary columns';

  -- ===== B8: the first paid registration freezes the nomination =============
  PERFORM nominate_payout_beneficiary(v_t, v_good, v_owner);
  v_res := create_registration_with_payment(v_player, v_t, 'standard', 10000);
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, true, 11000);

  BEGIN
    PERFORM accept_payout_nomination(v_t, v_good_owner);
    RAISE EXCEPTION 'B8 FAIL: a pending nomination was accepted after a player paid';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'B8 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%these fields are locked%' THEN RAISE EXCEPTION 'B8 FAIL (accept): %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM nominate_payout_beneficiary(v_t, v_other, v_owner);
    RAISE EXCEPTION 'B8 FAIL: the nomination changed after a player paid';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'B8 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%these fields are locked%' THEN RAISE EXCEPTION 'B8 FAIL (nominate): %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM decline_payout_nomination(v_t, v_good_owner);
    RAISE EXCEPTION 'B8 FAIL: the nomination was declined after a player paid';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'B8 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%these fields are locked%' THEN RAISE EXCEPTION 'B8 FAIL (decline): %', SQLERRM; END IF;
  END;
  RAISE NOTICE 'B8 PASS — nomination frozen at the first paid registration';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
