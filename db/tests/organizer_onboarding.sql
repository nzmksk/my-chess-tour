-- =============================================================================
-- Regression test for organizer onboarding (#518 / payout Phase 3).
--
-- This phase produces the verified recipient every later payout phase depends
-- on, so two invariants are load-bearing:
--
--   1. An organization has AT MOST ONE active bank account, and changing any
--      detail supersedes the old row rather than editing it. Editing in place
--      would leave a 'verified' stamp attached to details nobody verified —
--      money would then move to an unchecked account.
--   2. Creating an application is ALL OR NOTHING. A partial failure that left
--      the organization row behind would take its name with it, and the
--      applicant could never retry.
--
-- Covers:
--   B1  set_organization_bank_account raises P0002 for an unknown organization
--   B2  a first save inserts one active 'pending' row
--   B3  an unchanged re-save of a VERIFIED row is a no-op (same id, verification
--       intact)
--   B4  an unchanged re-save of a PENDING row is a no-op (its id is the
--       in-flight CHIP reference)
--   B5  an unchanged re-save of a REJECTED row DOES supersede — that is a retry
--   B6  a changed save supersedes: exactly one active row, back to 'pending',
--       old row retained with is_active = false
--   B7  one account cannot be the active destination for two organizations
--   B8  the same account IS reusable once the other org's row is superseded
--   C1  create_organization_application creates org + bank + documents together
--   C2  a company with no SSM/ROS document raises P0001 and rolls back WHOLLY —
--       the name stays free
--   C3  a duplicate name raises NAME_TAKEN, not a raw unique violation
--   C4  an individual's registration_number is normalised to NULL
--   A1  audit snapshots redact account_number and storage_path, and carry the
--       organization_id
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it builds
-- throwaway fixtures and persists NOTHING. A failing assertion RAISEs (and rolls
-- back); on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_user        uuid;
  v_org         uuid;
  v_org2        uuid;
  v_result      jsonb;
  v_first_id    uuid;
  v_id          uuid;
  v_count       integer;
  v_status      text;
  v_verified_at timestamptz;
  v_reg_no      text;
  v_snapshot    jsonb;
  v_audit_org   uuid;
BEGIN
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'onboarding@test.local', 'On', 'Boarding')
    RETURNING id INTO v_user;

  INSERT INTO organizations (name, created_by)
    VALUES ('ONBOARDING ORG', v_user)
    RETURNING id INTO v_org;

  -- ---- B1: unknown organization -------------------------------------------
  BEGIN
    PERFORM set_organization_bank_account(
      gen_random_uuid(), 'MBBEMYKL', 'Maybank', 'Nobody', '1234567890', v_user);
    RAISE EXCEPTION 'B1 FAIL: accepted a bank account for a non-existent organization';
  EXCEPTION
    WHEN sqlstate 'P0002' THEN
      RAISE NOTICE 'B1 PASS — unknown organization rejected with P0002';
  END;

  -- ---- B2: first save ------------------------------------------------------
  v_result := set_organization_bank_account(
    v_org, 'MBBEMYKL', 'Maybank', 'Onboarding Org', '1234567890', v_user);

  IF (v_result->>'changed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'B2 FAIL: first save reported changed=false';
  END IF;
  IF v_result->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'B2 FAIL: first save landed as %', v_result->>'status';
  END IF;
  IF v_result->>'account_number_last4' <> '7890' THEN
    RAISE EXCEPTION 'B2 FAIL: last4 = %', v_result->>'account_number_last4';
  END IF;
  IF v_result ? 'account_number' THEN
    RAISE EXCEPTION 'B2 FAIL: the RPC returned the full account number';
  END IF;

  v_first_id := (v_result->>'id')::uuid;

  SELECT count(*) INTO v_count
    FROM organization_bank_accounts WHERE organization_id = v_org AND is_active;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'B2 FAIL: % active rows after the first save', v_count;
  END IF;
  RAISE NOTICE 'B2 PASS — first save inserts one active pending row';

  -- ---- B3: unchanged re-save of a VERIFIED row is a no-op ------------------
  -- Phase 4 (#519) is what sets this; forced here so the rule can be tested.
  UPDATE organization_bank_accounts
    SET status = 'verified', verified_at = now()
    WHERE id = v_first_id;

  v_result := set_organization_bank_account(
    v_org, 'MBBEMYKL', 'Maybank', 'Onboarding Org', '1234567890', v_user);

  IF (v_result->>'changed')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'B3 FAIL: an unchanged re-save reported changed=true';
  END IF;
  IF (v_result->>'id')::uuid <> v_first_id THEN
    RAISE EXCEPTION 'B3 FAIL: the verified row was replaced';
  END IF;

  SELECT status::text, verified_at INTO v_status, v_verified_at
    FROM organization_bank_accounts WHERE id = v_first_id;
  IF v_status <> 'verified' OR v_verified_at IS NULL THEN
    RAISE EXCEPTION 'B3 FAIL: verification destroyed by a cosmetic re-save (%, %)',
      v_status, v_verified_at;
  END IF;
  RAISE NOTICE 'B3 PASS — unchanged re-save keeps an existing verification';

  -- ---- B4: unchanged re-save of a PENDING row is also a no-op --------------
  -- The row id IS the CHIP Send `reference` for an in-flight registration;
  -- superseding it would orphan that attempt for no gain.
  UPDATE organization_bank_accounts
    SET status = 'pending', verified_at = NULL
    WHERE id = v_first_id;

  v_result := set_organization_bank_account(
    v_org, 'MBBEMYKL', 'Maybank', 'Onboarding Org', '1234567890', v_user);

  IF (v_result->>'changed')::boolean IS NOT FALSE
     OR (v_result->>'id')::uuid <> v_first_id THEN
    RAISE EXCEPTION 'B4 FAIL: an unchanged pending row was superseded';
  END IF;
  RAISE NOTICE 'B4 PASS — unchanged re-save leaves an in-flight verification alone';

  -- ---- B5: unchanged re-save of a REJECTED row DOES supersede -------------
  UPDATE organization_bank_accounts
    SET status = 'rejected', rejection_reason = 'name mismatch'
    WHERE id = v_first_id;

  v_result := set_organization_bank_account(
    v_org, 'MBBEMYKL', 'Maybank', 'Onboarding Org', '1234567890', v_user);

  IF (v_result->>'changed')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'B5 FAIL: a rejected account could not be retried';
  END IF;
  IF (v_result->>'id')::uuid = v_first_id THEN
    RAISE EXCEPTION 'B5 FAIL: the retry reused the rejected row (and its CHIP reference)';
  END IF;

  v_first_id := (v_result->>'id')::uuid;
  RAISE NOTICE 'B5 PASS — an unchanged retry after rejection gets a fresh row';

  -- ---- B6: a changed save supersedes --------------------------------------
  v_result := set_organization_bank_account(
    v_org, 'CIBBMYKL', 'CIMB Bank', 'Onboarding Org', '9998887776', v_user);

  v_id := (v_result->>'id')::uuid;
  IF v_id = v_first_id THEN
    RAISE EXCEPTION 'B6 FAIL: changed details were written into the existing row';
  END IF;
  IF v_result->>'status' <> 'pending' THEN
    RAISE EXCEPTION 'B6 FAIL: changed details did not reset the status (%)',
      v_result->>'status';
  END IF;

  SELECT count(*) INTO v_count
    FROM organization_bank_accounts WHERE organization_id = v_org AND is_active;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'B6 FAIL: % active rows after a change (expected exactly 1)', v_count;
  END IF;

  -- History is the point: a payout must be able to name the account it went to.
  SELECT count(*) INTO v_count
    FROM organization_bank_accounts WHERE organization_id = v_org AND NOT is_active;
  IF v_count < 1 THEN
    RAISE EXCEPTION 'B6 FAIL: the superseded row was not retained';
  END IF;
  RAISE NOTICE 'B6 PASS — a change supersedes, resets to pending, and keeps history';

  -- ---- B7: one account, one active destination ----------------------------
  INSERT INTO organizations (name, created_by)
    VALUES ('ONBOARDING ORG TWO', v_user)
    RETURNING id INTO v_org2;

  BEGIN
    PERFORM set_organization_bank_account(
      v_org2, 'CIBBMYKL', 'CIMB Bank', 'Someone Else', '9998887776', v_user);
    RAISE EXCEPTION 'B7 FAIL: two organizations share one active payout destination';
  EXCEPTION
    WHEN unique_violation THEN
      RAISE NOTICE 'B7 PASS — payout redirection blocked by uniq_active_bank_destination';
  END;

  -- ---- B8: reusable once the first org supersedes it ----------------------
  PERFORM set_organization_bank_account(
    v_org, 'PBBEMYKL', 'Public Bank', 'Onboarding Org', '5554443332', v_user);

  PERFORM set_organization_bank_account(
    v_org2, 'CIBBMYKL', 'CIMB Bank', 'Someone Else', '9998887776', v_user);
  RAISE NOTICE 'B8 PASS — a released account can be claimed by another organization';

  -- ---- C1: the application transaction ------------------------------------
  v_result := create_organization_application(
    p_created_by          => v_user,
    p_name                => 'ONBOARDING APPLICANT',
    p_email               => 'applicant@test.local',
    p_entity_type         => 'society',
    p_agreement_version   => '2026-08-02',
    p_bank_code           => 'RHBBMYKL',
    p_bank_name           => 'RHB Bank',
    p_account_holder      => 'Onboarding Applicant',
    p_account_number      => '1112223334',
    p_documents           => '[{"doc_type":"ros","storage_path":"users/x/org-kyb/ros.pdf","original_filename":"ros.pdf"}]'::jsonb,
    p_registration_number => 'PPM-001-14-01012020'
  );

  v_id := (v_result->>'id')::uuid;

  SELECT count(*) INTO v_count
    FROM organization_bank_accounts WHERE organization_id = v_id AND is_active;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'C1 FAIL: application created % bank accounts', v_count;
  END IF;

  SELECT count(*) INTO v_count
    FROM organization_documents WHERE organization_id = v_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'C1 FAIL: application created % documents', v_count;
  END IF;

  SELECT agreement_version INTO v_status FROM organizations WHERE id = v_id;
  IF v_status <> '2026-08-02' THEN
    RAISE EXCEPTION 'C1 FAIL: agreement not stamped (%)', v_status;
  END IF;
  RAISE NOTICE 'C1 PASS — org, bank account, documents and agreement in one transaction';

  -- ---- C2: entity rule, and total rollback --------------------------------
  BEGIN
    PERFORM create_organization_application(
      p_created_by        => v_user,
      p_name              => 'ROLLBACK ORG',
      p_email             => 'rollback@test.local',
      p_entity_type       => 'company',
      p_agreement_version => '2026-08-02',
      p_bank_code         => 'HLBBMYKL',
      p_bank_name         => 'Hong Leong Bank',
      p_account_holder    => 'Rollback Org',
      p_account_number    => '4445556667',
      -- A company must supply an SSM/ROS document; this is neither.
      p_documents         => '[{"doc_type":"other","storage_path":"users/x/org-kyb/misc.pdf"}]'::jsonb,
      p_registration_number => '202001234567'
    );
    -- assert_failure (P0004), NOT the default P0001: the handler below catches
    -- P0001, and a FAIL raised with that code would be swallowed by the very
    -- assertion it is reporting on.
    RAISE EXCEPTION 'C2 FAIL: a company was accepted with no SSM/ROS document'
      USING ERRCODE = 'assert_failure';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      IF SQLERRM NOT LIKE 'ENTITY_DOCS_REQUIRED%' THEN
        RAISE EXCEPTION 'C2 FAIL: unexpected P0001 — %', SQLERRM;
      END IF;
  END;

  -- The whole point: the name must still be available for the retry.
  SELECT count(*) INTO v_count
    FROM organizations WHERE lower(name) = 'rollback org' AND deleted_at IS NULL;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'C2 FAIL: the failed application left an organization behind';
  END IF;
  RAISE NOTICE 'C2 PASS — a rejected application rolls back wholly, name stays free';

  -- ---- C3: duplicate name --------------------------------------------------
  BEGIN
    PERFORM create_organization_application(
      p_created_by        => v_user,
      -- Case-insensitive: idx_organizations_name_active is on lower(name).
      p_name              => 'onboarding applicant',
      p_email             => 'dupe@test.local',
      p_entity_type       => 'individual',
      p_agreement_version => '2026-08-02',
      p_bank_code         => 'HLBBMYKL',
      p_bank_name         => 'Hong Leong Bank',
      p_account_holder    => 'Dupe',
      p_account_number    => '7778889990',
      p_documents         => '[{"doc_type":"identity_document","storage_path":"users/x/org-kyb/id.pdf"}]'::jsonb
    );
    RAISE EXCEPTION 'C3 FAIL: a duplicate organization name was accepted'
      USING ERRCODE = 'assert_failure';
  EXCEPTION
    WHEN sqlstate 'P0001' THEN
      IF SQLERRM NOT LIKE 'NAME_TAKEN%' THEN
        RAISE EXCEPTION 'C3 FAIL: expected NAME_TAKEN, got — %', SQLERRM;
      END IF;
      RAISE NOTICE 'C3 PASS — duplicate name surfaces as NAME_TAKEN, not a raw 23505';
  END;

  -- ---- C4: an individual has no registration number ------------------------
  v_result := create_organization_application(
    p_created_by          => v_user,
    p_name                => 'SOLE ORGANIZER',
    p_email               => 'sole@test.local',
    p_entity_type         => 'individual',
    p_agreement_version   => '2026-08-02',
    p_bank_code           => 'HLBBMYKL',
    p_bank_name           => 'Hong Leong Bank',
    p_account_holder      => 'Sole Organizer',
    p_account_number      => '7778889990',
    p_documents           => '[{"doc_type":"identity_document","storage_path":"users/x/org-kyb/id.pdf"}]'::jsonb,
    -- Supplied but meaningless for an individual; must not be stored.
    p_registration_number => 'PPM-999'
  );

  SELECT registration_number INTO v_reg_no
    FROM organizations WHERE id = (v_result->>'id')::uuid;
  IF v_reg_no IS NOT NULL THEN
    RAISE EXCEPTION 'C4 FAIL: an individual stored registration_number = %', v_reg_no;
  END IF;
  RAISE NOTICE 'C4 PASS — an individual organizer has no registration number';

  -- ---- A1: audit snapshots are redacted and org-scoped ---------------------
  -- audit_logs outlives the row it copied, so an unredacted snapshot is a
  -- retained bank number and a retained capability string.
  SELECT new_data, organization_id INTO v_snapshot, v_audit_org
    FROM audit_logs
    WHERE table_name = 'organization_bank_accounts'
    ORDER BY id DESC LIMIT 1;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'A1 FAIL: no audit row written for organization_bank_accounts';
  END IF;
  IF v_snapshot->>'account_number' NOT LIKE '****%' THEN
    RAISE EXCEPTION 'A1 FAIL: account_number stored verbatim in audit_logs (%)',
      v_snapshot->>'account_number';
  END IF;
  IF v_audit_org IS NULL THEN
    RAISE EXCEPTION 'A1 FAIL: bank account audit row has no organization_id';
  END IF;

  SELECT new_data, organization_id INTO v_snapshot, v_audit_org
    FROM audit_logs
    WHERE table_name = 'organization_documents'
    ORDER BY id DESC LIMIT 1;

  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'A1 FAIL: no audit row written for organization_documents';
  END IF;
  IF v_snapshot->>'storage_path' NOT LIKE '****%' THEN
    RAISE EXCEPTION 'A1 FAIL: storage_path stored verbatim in audit_logs (%)',
      v_snapshot->>'storage_path';
  END IF;
  IF v_audit_org IS NULL THEN
    RAISE EXCEPTION 'A1 FAIL: document audit row has no organization_id';
  END IF;
  RAISE NOTICE 'A1 PASS — account_number and storage_path redacted, org-scoped';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
