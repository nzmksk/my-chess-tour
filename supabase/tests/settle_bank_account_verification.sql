-- =============================================================================
-- Regression test for settle_bank_account_verification (006_payment_functions.sql,
-- #519 / payout Phase 4).
--
-- The sync register response and the CHIP Send webhook can both settle the same
-- account, in either order, and the webhook can be redelivered. The invariant
-- under test: the FIRST verdict sticks, and nothing after it changes the row.
--
-- Covers:
--   V1  unknown bank account raises P0002
--   V2  verified: status, verified_at, chip id stamped; already_processed=false
--   V3  a repeat verified call is a no-op (already_processed=true)
--   V4  a LATER rejection cannot overwrite a verification
--   V5  rejected: status + reason recorded, verified_at stays NULL
--   V6  a blank reason falls back to a non-empty generic reason
--   V7  a NULL chip id never clears a stored one
--   V8  a superseded (inactive) row still settles and reports is_active=false
--   V9  verified but the bank's holder name didn't match: 'name_mismatch', not
--       payable, the bank's name stored (#374)
--   V10 p_name_matched defaults to false: a caller that doesn't say the name
--       matched never makes an account payable
--   V11 a 'name_mismatch' settled without a bank name is settled again by the
--       call that brings one; once it has a name it is terminal
--   V12 a verdict that stands still records a bank name it lacked
--   N1  review_bank_account_name confirm: 'verified', payable, reviewer and
--       note kept
--   N2  reject: 'rejected', the note is the owner-facing reason
--   N3  refusals: unknown id, not under review, blank note, unknown action
--   N4  a player account goes through the same review
--   N5  a superseded account can't be reviewed (SUPERSEDED, #704): the owner
--       replaced it, so nothing would pay it. It keeps 'name_mismatch'.
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it builds
-- throwaway fixtures and persists NOTHING. A failing assertion RAISEs (and rolls
-- back); on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org     uuid;
  v_bank    uuid;
  v_old     uuid;
  v_result  jsonb;
  v_row     organization_bank_accounts;
  v_user    uuid;
  v_player  uuid;
  v_action  text;
BEGIN
  INSERT INTO organizations (name) VALUES ('BANK VERIFY ORG') RETURNING id INTO v_org;

  -- ---- V1 -----------------------------------------------------------------
  BEGIN
    PERFORM settle_bank_account_verification(gen_random_uuid(), 1, true, NULL);
    RAISE EXCEPTION 'V1 FAIL: settled a non-existent bank account';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    NULL;
  END;

  -- ---- V2 -----------------------------------------------------------------
  v_result := set_organization_bank_account(v_org, 'MBBEMYKL', 'Maybank', 'Holder', '157380112229');
  v_bank := (v_result->>'id')::uuid;

  v_result := settle_bank_account_verification(v_bank, 84, true, NULL, 'HOLDER', true);
  IF (v_result->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'V2 FAIL: first settlement reported already_processed';
  END IF;
  IF NOT (v_result->>'verified')::boolean OR (v_result->>'organization_id')::uuid <> v_org THEN
    RAISE EXCEPTION 'V2 FAIL: unexpected result %', v_result;
  END IF;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_bank;
  IF v_row.status <> 'verified' OR v_row.verified_at IS NULL OR v_row.chip_bank_account_id <> 84
     OR v_row.bank_holder_name IS DISTINCT FROM 'HOLDER' THEN
    RAISE EXCEPTION 'V2 FAIL: row = (%, %, %, %)', v_row.status, v_row.verified_at,
      v_row.chip_bank_account_id, v_row.bank_holder_name;
  END IF;

  -- ---- V3 -----------------------------------------------------------------
  v_result := settle_bank_account_verification(v_bank, 84, true, NULL);
  IF NOT (v_result->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'V3 FAIL: a repeat verification was not a no-op';
  END IF;

  -- ---- V4 -----------------------------------------------------------------
  v_result := settle_bank_account_verification(v_bank, 84, false, 'late rejection');
  IF NOT (v_result->>'already_processed')::boolean OR NOT (v_result->>'verified')::boolean THEN
    RAISE EXCEPTION 'V4 FAIL: a late rejection was applied: %', v_result;
  END IF;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_bank;
  IF v_row.status <> 'verified' OR v_row.rejection_reason IS NOT NULL THEN
    RAISE EXCEPTION 'V4 FAIL: verification overwritten (%, %)', v_row.status, v_row.rejection_reason;
  END IF;

  -- ---- V5 -----------------------------------------------------------------
  -- A changed save supersedes the verified row with a fresh pending one.
  v_result := set_organization_bank_account(v_org, 'CIBBMYKL', 'CIMB Bank', 'Holder', '8001234567');
  v_old  := v_bank;
  v_bank := (v_result->>'id')::uuid;

  v_result := settle_bank_account_verification(v_bank, 85, false, 'Name does not match account');
  IF (v_result->>'verified')::boolean OR (v_result->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'V5 FAIL: unexpected result %', v_result;
  END IF;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_bank;
  IF v_row.status <> 'rejected' OR v_row.verified_at IS NOT NULL
     OR v_row.rejection_reason <> 'Name does not match account' THEN
    RAISE EXCEPTION 'V5 FAIL: row = (%, %, %)', v_row.status, v_row.verified_at, v_row.rejection_reason;
  END IF;

  -- ---- V6 -----------------------------------------------------------------
  -- Re-saving a rejected row supersedes it (that is the retry path).
  v_result := set_organization_bank_account(v_org, 'CIBBMYKL', 'CIMB Bank', 'Holder', '8001234567');
  v_bank := (v_result->>'id')::uuid;
  PERFORM settle_bank_account_verification(v_bank, NULL, false, '   ');
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_bank;
  IF v_row.status <> 'rejected' OR coalesce(btrim(v_row.rejection_reason), '') = '' THEN
    RAISE EXCEPTION 'V6 FAIL: blank reason stored as %', quote_nullable(v_row.rejection_reason);
  END IF;

  -- ---- V7 -----------------------------------------------------------------
  v_result := set_organization_bank_account(v_org, 'PBBEMYKL', 'Public Bank', 'Holder', '3123456789');
  v_bank := (v_result->>'id')::uuid;
  UPDATE organization_bank_accounts SET chip_bank_account_id = 99 WHERE id = v_bank;
  PERFORM settle_bank_account_verification(v_bank, NULL, true, NULL);
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_bank;
  IF v_row.chip_bank_account_id IS DISTINCT FROM 99 THEN
    RAISE EXCEPTION 'V7 FAIL: NULL chip id cleared the stored id (now %)', v_row.chip_bank_account_id;
  END IF;

  -- ---- V8 -----------------------------------------------------------------
  v_result := set_organization_bank_account(v_org, 'RHBBMYKL', 'RHB Bank', 'Holder', '2123456789');
  v_old  := (v_result->>'id')::uuid;
  PERFORM set_organization_bank_account(v_org, 'HLBBMYKL', 'Hong Leong Bank', 'Holder', '1123456789');
  v_result := settle_bank_account_verification(v_old, 100, true, NULL, 'HOLDER', true);
  IF (v_result->>'is_active')::boolean THEN
    RAISE EXCEPTION 'V8 FAIL: superseded row reported is_active=true';
  END IF;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_old;
  IF v_row.status <> 'verified' THEN
    RAISE EXCEPTION 'V8 FAIL: superseded row not settled (%)', v_row.status;
  END IF;

  -- ---- V9 -----------------------------------------------------------------
  UPDATE organizations
    SET approval_status = 'approved', entity_type = 'company',
        agreement_version = current_organizer_agreement_version(), agreement_accepted_at = now()
    WHERE id = v_org;
  v_result := set_organization_bank_account(v_org, 'AMMBMYKL', 'AmBank', 'Bank Verify Org', '4123456789');
  v_bank := (v_result->>'id')::uuid;
  v_result := settle_bank_account_verification(v_bank, 101, true, NULL, '  SOMEONE ELSE  ', false);
  IF (v_result->>'verified')::boolean OR v_result->>'status' <> 'name_mismatch'
     OR (v_result->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'V9 FAIL: unexpected result %', v_result;
  END IF;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_bank;
  IF v_row.status <> 'name_mismatch' OR v_row.verified_at IS NOT NULL
     OR v_row.rejection_reason IS NOT NULL OR v_row.bank_holder_name IS DISTINCT FROM 'SOMEONE ELSE'
     OR v_row.chip_bank_account_id IS DISTINCT FROM 101 THEN
    RAISE EXCEPTION 'V9 FAIL: row = (%, %, %, %)', v_row.status, v_row.verified_at,
      v_row.rejection_reason, v_row.bank_holder_name;
  END IF;
  IF payout_recipient_problem(v_org) IS DISTINCT FROM 'bank_account_not_verified' THEN
    RAISE EXCEPTION 'V9 FAIL: a name_mismatch account is payable (%)', payout_recipient_problem(v_org);
  END IF;
  -- A later matched call can't promote it: the bank's name is on record.
  v_result := settle_bank_account_verification(v_bank, 101, true, NULL, 'BANK VERIFY ORG', true);
  IF NOT (v_result->>'already_processed')::boolean
     OR (SELECT status FROM organization_bank_accounts WHERE id = v_bank) <> 'name_mismatch' THEN
    RAISE EXCEPTION 'V9 FAIL: a name_mismatch with a bank name was settled again: %', v_result;
  END IF;

  -- ---- V10 ----------------------------------------------------------------
  v_result := set_organization_bank_account(v_org, 'AMMBMYKL', 'AmBank', 'Bank Verify Org', '4123456780');
  v_old := (v_result->>'id')::uuid;
  v_result := settle_bank_account_verification(v_old, 102, true, NULL, 'BANK VERIFY ORG');
  IF v_result->>'status' <> 'name_mismatch' THEN
    RAISE EXCEPTION 'V10 FAIL: omitted p_name_matched gave %', v_result->>'status';
  END IF;
  v_result := set_organization_bank_account(v_org, 'AMMBMYKL', 'AmBank', 'Bank Verify Org', '4123456781');
  v_old := (v_result->>'id')::uuid;
  v_result := settle_bank_account_verification(v_old, 103, true);
  IF v_result->>'status' <> 'name_mismatch' THEN
    RAISE EXCEPTION 'V10 FAIL: a three-argument verified call gave %', v_result->>'status';
  END IF;

  -- ---- V11 ----------------------------------------------------------------
  -- The webhook arrived first, without a name; the sync response brings it.
  v_result := set_organization_bank_account(v_org, 'AMMBMYKL', 'AmBank', 'Bank Verify Org', '4123456782');
  v_old := (v_result->>'id')::uuid;
  v_result := settle_bank_account_verification(v_old, 104, true, NULL, NULL, false);
  IF v_result->>'status' <> 'name_mismatch' THEN
    RAISE EXCEPTION 'V11 FAIL: a nameless verified call gave %', v_result->>'status';
  END IF;
  -- A rejection can't overturn it.
  v_result := settle_bank_account_verification(v_old, 104, false, 'late');
  IF NOT (v_result->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'V11 FAIL: a rejection re-settled a name_mismatch: %', v_result;
  END IF;
  v_result := settle_bank_account_verification(v_old, 104, true, NULL, 'BANK VERIFY ORG', true);
  IF (v_result->>'already_processed')::boolean OR v_result->>'status' <> 'verified' THEN
    RAISE EXCEPTION 'V11 FAIL: the call bringing the name did not settle it: %', v_result;
  END IF;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_old;
  IF v_row.status <> 'verified' OR v_row.verified_at IS NULL
     OR v_row.bank_holder_name IS DISTINCT FROM 'BANK VERIFY ORG' THEN
    RAISE EXCEPTION 'V11 FAIL: row = (%, %, %)', v_row.status, v_row.verified_at, v_row.bank_holder_name;
  END IF;

  -- ---- V12 ----------------------------------------------------------------
  v_result := set_organization_bank_account(v_org, 'AMMBMYKL', 'AmBank', 'Bank Verify Org', '4123456784');
  v_old := (v_result->>'id')::uuid;
  UPDATE organization_bank_accounts SET status = 'verified', verified_at = now() WHERE id = v_old;
  v_result := settle_bank_account_verification(v_old, 106, true, NULL, 'FROM THE BANK', false);
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_old;
  IF NOT (v_result->>'already_processed')::boolean OR v_row.status <> 'verified'
     OR v_row.bank_holder_name IS DISTINCT FROM 'FROM THE BANK' THEN
    RAISE EXCEPTION 'V12 FAIL: (%, %, %)', v_result, v_row.status, v_row.bank_holder_name;
  END IF;

  -- A fresh active account under review for the N scenarios.
  v_result := set_organization_bank_account(v_org, 'AMMBMYKL', 'AmBank', 'Bank Verify Org', '4123456783');
  v_bank := (v_result->>'id')::uuid;
  PERFORM settle_bank_account_verification(v_bank, 105, true, NULL, 'SOMEONE ELSE', false);

  -- ---- N3 (first, while v_bank is still under review) ----------------------
  BEGIN
    PERFORM review_bank_account_name(gen_random_uuid(), NULL, 'confirm', 'ok');
    RAISE EXCEPTION 'N3 FAIL: reviewed a non-existent account';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL;
  END;
  BEGIN
    PERFORM review_bank_account_name(v_bank, NULL, 'confirm', '   ');
    RAISE EXCEPTION 'N3 FAIL: confirmed without a note';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'NOTE_REQUIRED%' THEN RAISE EXCEPTION 'N3 FAIL: got %', SQLERRM; END IF;
  END;
  BEGIN
    PERFORM review_bank_account_name(v_bank, NULL, 'approve', 'ok');
    RAISE EXCEPTION 'N3 FAIL: accepted an unknown action';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM review_bank_account_name(v_old, NULL, 'confirm', 'ok');
    RAISE EXCEPTION 'N3 FAIL: reviewed an account that is not under review';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM NOT LIKE 'NOT_UNDER_REVIEW%' THEN RAISE EXCEPTION 'N3 FAIL: got %', SQLERRM; END IF;
  END;
  IF (SELECT status FROM organization_bank_accounts WHERE id = v_bank) <> 'name_mismatch' THEN
    RAISE EXCEPTION 'N3 FAIL: a refused review changed the account';
  END IF;

  -- ---- N1 -----------------------------------------------------------------
  v_result := review_bank_account_name(v_bank, NULL, 'confirm', '  Bank shortened the company name  ');
  IF NOT (v_result->>'verified')::boolean OR v_result->>'owner' <> 'organization'
     OR (v_result->>'organization_id')::uuid <> v_org OR NOT (v_result->>'is_active')::boolean THEN
    RAISE EXCEPTION 'N1 FAIL: unexpected result %', v_result;
  END IF;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_bank;
  IF v_row.status <> 'verified' OR v_row.verified_at IS NULL OR v_row.name_reviewed_at IS NULL
     OR v_row.name_review_note IS DISTINCT FROM 'Bank shortened the company name'
     OR v_row.rejection_reason IS NOT NULL THEN
    RAISE EXCEPTION 'N1 FAIL: row = (%, %, %)', v_row.status, v_row.name_reviewed_at, v_row.name_review_note;
  END IF;
  IF payout_recipient_problem(v_org) IS NOT NULL THEN
    RAISE EXCEPTION 'N1 FAIL: a confirmed account is not payable (%)', payout_recipient_problem(v_org);
  END IF;
  BEGIN
    PERFORM review_bank_account_name(v_bank, NULL, 'reject', 'second thoughts');
    RAISE EXCEPTION 'N1 FAIL: a decided review was reviewed again';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
  END;

  -- ---- N2 -----------------------------------------------------------------
  v_result := set_organization_bank_account(v_org, 'AMMBMYKL', 'AmBank', 'Bank Verify Org', '4123456785');
  v_bank := (v_result->>'id')::uuid;
  PERFORM settle_bank_account_verification(v_bank, 107, true, NULL, 'SOMEONE ELSE', false);
  v_result := review_bank_account_name(v_bank, NULL, 'reject', 'This account is not in the name of the organization.');
  IF (v_result->>'verified')::boolean OR v_result->>'status' <> 'rejected' THEN
    RAISE EXCEPTION 'N2 FAIL: unexpected result %', v_result;
  END IF;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_bank;
  IF v_row.status <> 'rejected' OR v_row.verified_at IS NOT NULL
     OR v_row.rejection_reason IS DISTINCT FROM 'This account is not in the name of the organization.' THEN
    RAISE EXCEPTION 'N2 FAIL: row = (%, %)', v_row.status, v_row.rejection_reason;
  END IF;

  -- ---- N4 -----------------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'bank-review-player@test.local', 'Review', 'Player')
    RETURNING id INTO v_user;
  PERFORM record_sensitive_data_consent(v_user, 'financial', true, '2026-11-19');
  v_player := (set_player_bank_account(v_user, 'MBBEMYKL', 'Maybank', 'Review Player', '514199990001') ->> 'id')::uuid;
  v_result := settle_bank_account_verification(v_player, 108, true, NULL, 'NOT THE PLAYER', false);
  IF v_result->>'owner' <> 'player' OR v_result->>'status' <> 'name_mismatch' THEN
    RAISE EXCEPTION 'N4 FAIL: player settle %', v_result;
  END IF;
  v_result := review_bank_account_name(v_player, NULL, 'confirm', 'Checked with the player');
  IF NOT (v_result->>'verified')::boolean OR (v_result->>'user_id')::uuid <> v_user THEN
    RAISE EXCEPTION 'N4 FAIL: player review %', v_result;
  END IF;
  IF (SELECT status FROM player_bank_accounts WHERE id = v_player) <> 'verified' THEN
    RAISE EXCEPTION 'N4 FAIL: player account not verified after confirm';
  END IF;

  -- ---- N5 -----------------------------------------------------------------
  v_result := set_organization_bank_account(v_org, 'AMMBMYKL', 'AmBank', 'Bank Verify Org', '4123456786');
  v_old := (v_result->>'id')::uuid;
  PERFORM settle_bank_account_verification(v_old, 109, true, NULL, 'SOMEONE ELSE', false);
  v_result := set_organization_bank_account(v_org, 'AMMBMYKL', 'AmBank', 'Bank Verify Org', '4123456787');
  v_bank := (v_result->>'id')::uuid;
  PERFORM settle_bank_account_verification(v_bank, 110, true, NULL, 'BANK VERIFY ORG', true);
  FOREACH v_action IN ARRAY ARRAY['confirm', 'reject'] LOOP
    BEGIN
      PERFORM review_bank_account_name(v_old, NULL, v_action, 'stale page');
      RAISE EXCEPTION 'N5 FAIL: % reviewed a superseded account', v_action;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
      IF SQLERRM NOT LIKE 'SUPERSEDED%' THEN RAISE EXCEPTION 'N5 FAIL: got %', SQLERRM; END IF;
    END;
  END LOOP;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_old;
  IF v_row.status <> 'name_mismatch' OR v_row.is_active OR v_row.name_reviewed_at IS NOT NULL THEN
    RAISE EXCEPTION 'N5 FAIL: superseded row = (%, %, %)', v_row.status, v_row.is_active, v_row.name_reviewed_at;
  END IF;
  IF payout_recipient_problem(v_org) IS NOT NULL THEN
    RAISE EXCEPTION 'N5 FAIL: the replacement is not payable (%)', payout_recipient_problem(v_org);
  END IF;

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
