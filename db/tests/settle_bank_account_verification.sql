-- =============================================================================
-- Regression test for settle_bank_account_verification (007_payment_functions.sql,
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

  v_result := settle_bank_account_verification(v_bank, 84, true, NULL);
  IF (v_result->>'already_processed')::boolean THEN
    RAISE EXCEPTION 'V2 FAIL: first settlement reported already_processed';
  END IF;
  IF NOT (v_result->>'verified')::boolean OR (v_result->>'organization_id')::uuid <> v_org THEN
    RAISE EXCEPTION 'V2 FAIL: unexpected result %', v_result;
  END IF;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_bank;
  IF v_row.status <> 'verified' OR v_row.verified_at IS NULL OR v_row.chip_bank_account_id <> 84 THEN
    RAISE EXCEPTION 'V2 FAIL: row = (%, %, %)', v_row.status, v_row.verified_at, v_row.chip_bank_account_id;
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
  v_result := settle_bank_account_verification(v_old, 100, true, NULL);
  IF (v_result->>'is_active')::boolean THEN
    RAISE EXCEPTION 'V8 FAIL: superseded row reported is_active=true';
  END IF;
  SELECT * INTO v_row FROM organization_bank_accounts WHERE id = v_old;
  IF v_row.status <> 'verified' THEN
    RAISE EXCEPTION 'V8 FAIL: superseded row not settled (%)', v_row.status;
  END IF;

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
