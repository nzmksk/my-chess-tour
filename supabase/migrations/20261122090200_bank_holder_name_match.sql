-- =============================================
-- #374: verify who a payout account belongs to, not just that it exists.
--
-- CHIP Send's verification only checks that the account number exists at the
-- bank (#551). It doesn't compare the holder name we send; it replaces it with
-- the holder name the bank has. So:
--
--   1. bank_holder_name records the name CHIP returned, on both bank-account
--      tables.
--   2. settle_bank_account_verification takes that name and whether it matched
--      who the money is for (the app does the matching:
--      src/services/payouts/holder-name.ts). A verified account whose name
--      didn't match becomes 'name_mismatch' instead of 'verified'. Every payout
--      and prize check already requires status = 'verified', so it isn't
--      payable.
--   3. review_bank_account_name lets an admin confirm a mismatched account
--      ('verified') or reject it ('rejected'), with a note either way. Who
--      decided and why stays on the row (name_reviewed_by / _at / _note) and
--      in its audit trail.
--
-- Accounts already 'verified' before this keep their status, with no
-- bank_holder_name. The admin pages show that as "not recorded".
-- =============================================

ALTER TABLE organization_bank_accounts
  ADD COLUMN bank_holder_name varchar(255),
  ADD COLUMN name_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN name_reviewed_at timestamptz,
  ADD COLUMN name_review_note text,
  ADD CONSTRAINT chk_bank_name_review_shape
    CHECK ((name_reviewed_at IS NULL) = (name_review_note IS NULL));

ALTER TABLE player_bank_accounts
  ADD COLUMN bank_holder_name varchar(255),
  ADD COLUMN name_reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN name_reviewed_at timestamptz,
  ADD COLUMN name_review_note text,
  ADD CONSTRAINT chk_player_bank_name_review_shape
    CHECK ((name_reviewed_at IS NULL) = (name_review_note IS NULL));

-- =============================================
-- SETTLE BANK ACCOUNT VERIFICATION
-- Records CHIP Send's verdict on a registered payout recipient (#519). Called by
-- two paths that must agree, both classifying through chipBankAccountOutcome:
--   * registerBankAccount, when POST /send/bank_accounts already answers
--     synchronously;
--   * the CHIP Send webhook, on a bank-account status event.
-- Either may arrive first, or both, or the webhook twice. So:
--   * the row is locked FOR UPDATE, serializing the two paths;
--   * a row that is no longer 'pending' is terminal and the call is a no-op
--     ({"already_processed": true}): a verdict is never overwritten. A changed
--     account gets a NEW row (set_organization_bank_account supersedes), so
--     there is never a legitimate reason to flip a verdict in place.
--     One exception: a 'name_mismatch' settled with NO bank name (CHIP didn't
--     send one) and not yet reviewed is settled again by a call that brings
--     the name, so whichever path arrives second can still clear it.
--
--   p_verified = true, p_name_matched = true  → 'verified', verified_at stamped.
--   p_verified = true, otherwise              → 'name_mismatch': CHIP found
--                        the account but in someone else's name (or sent no
--                        name). Waits for review_bank_account_name.
--   p_verified = false → 'rejected' with p_reason (or a generic reason;
--                        the owner is shown it, so it must not be blank).
-- p_name_matched defaults to false, so a caller that doesn't say the name
-- matched never makes an account payable.
-- p_bank_holder_name is the holder name CHIP returned. It and
-- p_chip_bank_account_id are recorded when given and never cleared by a NULL.
--
-- Superseded rows (is_active = false) are still settled (the verdict is history
-- worth keeping), but `is_active` is returned so the caller can skip telling the
-- owner about an account they have already replaced.
--
-- Player prize accounts (player_bank_accounts, #523) settle here too. The id is
-- looked up in the organization table first and the player table second; the
-- ids are uuids, so one can't be in both. `owner` says which it was:
-- 'organization' (organization_id set) or 'player' (user_id set). `status` is
-- the row's status after the call.
-- =============================================
DROP FUNCTION settle_bank_account_verification(uuid, bigint, boolean, text);

CREATE FUNCTION settle_bank_account_verification(
  p_bank_account_id      uuid,
  p_chip_bank_account_id bigint,
  p_verified             boolean,
  p_reason               text    DEFAULT NULL,
  p_bank_holder_name     text    DEFAULT NULL,
  p_name_matched         boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_default_reason CONSTANT text := 'The bank could not verify these account details.';
  v_owner       text;
  v_org_id      uuid;
  v_user_id     uuid;
  v_status      bank_account_status;
  v_is_active   boolean;
  v_bank_name   varchar(255);
  v_reviewed_at timestamptz;
  v_new_name    varchar(255) := left(NULLIF(btrim(p_bank_holder_name), ''), 255);
  v_reason      text := COALESCE(NULLIF(btrim(p_reason), ''), c_default_reason);
  v_new_status  bank_account_status;
BEGIN
  SELECT 'organization', organization_id, NULL::uuid, status, is_active,
         bank_holder_name, name_reviewed_at
    INTO v_owner, v_org_id, v_user_id, v_status, v_is_active, v_bank_name, v_reviewed_at
    FROM organization_bank_accounts
    WHERE id = p_bank_account_id
    FOR UPDATE;

  IF NOT FOUND THEN
    SELECT 'player', NULL::uuid, user_id, status, is_active,
           bank_holder_name, name_reviewed_at
      INTO v_owner, v_org_id, v_user_id, v_status, v_is_active, v_bank_name, v_reviewed_at
      FROM player_bank_accounts
      WHERE id = p_bank_account_id
      FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank account % not found', p_bank_account_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_status = 'pending'
    OR (v_status = 'name_mismatch' AND v_bank_name IS NULL AND v_reviewed_at IS NULL
        AND p_verified AND v_new_name IS NOT NULL)
  ) THEN
    -- The verdict stands, but a holder name it was settled without is still
    -- worth keeping.
    IF v_bank_name IS NULL AND v_new_name IS NOT NULL THEN
      IF v_owner = 'organization' THEN
        UPDATE organization_bank_accounts SET bank_holder_name = v_new_name WHERE id = p_bank_account_id;
      ELSE
        UPDATE player_bank_accounts SET bank_holder_name = v_new_name WHERE id = p_bank_account_id;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'bank_account_id',   p_bank_account_id,
      'owner',             v_owner,
      'organization_id',   v_org_id,
      'user_id',           v_user_id,
      'already_processed', true,
      'verified',          v_status = 'verified',
      'status',            v_status,
      'is_active',         v_is_active
    );
  END IF;

  v_new_status := CASE
    WHEN NOT p_verified THEN 'rejected'
    WHEN p_name_matched THEN 'verified'
    ELSE 'name_mismatch'
  END::bank_account_status;

  IF v_owner = 'organization' THEN
    UPDATE organization_bank_accounts
      SET status               = v_new_status,
          verified_at          = CASE WHEN v_new_status = 'verified' THEN now() END,
          rejection_reason     = CASE WHEN v_new_status = 'rejected' THEN v_reason END,
          bank_holder_name     = COALESCE(v_new_name, bank_holder_name),
          chip_bank_account_id = COALESCE(p_chip_bank_account_id, chip_bank_account_id)
      WHERE id = p_bank_account_id;
  ELSE
    UPDATE player_bank_accounts
      SET status               = v_new_status,
          verified_at          = CASE WHEN v_new_status = 'verified' THEN now() END,
          rejection_reason     = CASE WHEN v_new_status = 'rejected' THEN v_reason END,
          bank_holder_name     = COALESCE(v_new_name, bank_holder_name),
          chip_bank_account_id = COALESCE(p_chip_bank_account_id, chip_bank_account_id)
      WHERE id = p_bank_account_id;
  END IF;

  RETURN jsonb_build_object(
    'bank_account_id',   p_bank_account_id,
    'owner',             v_owner,
    'organization_id',   v_org_id,
    'user_id',           v_user_id,
    'already_processed', false,
    'verified',          v_new_status = 'verified',
    'status',            v_new_status,
    'is_active',         v_is_active
  );
END;
$$;

-- =============================================
-- REVIEW BANK ACCOUNT NAME
-- An admin's decision on a 'name_mismatch' account: CHIP verified the account,
-- but the bank's holder name doesn't match who the money is for.
--   p_action = 'confirm' → 'verified' (payable), e.g. the bank shortened the
--                          name in a way the matcher didn't recognise;
--   p_action = 'reject'  → 'rejected'. p_note becomes the rejection_reason the
--                          owner is emailed, so write it for them.
-- p_note is required either way and kept in name_review_note, with the
-- reviewer and the time.
--
-- Refuses with:
--   P0002            no such bank account
--   NOT_UNDER_REVIEW (P0001) the account isn't 'name_mismatch' (already
--                    decided, or never needed review)
--   NOTE_REQUIRED    (P0001) a blank note
--   22023            an action other than 'confirm' or 'reject'
-- Returns what settle_bank_account_verification does, so the caller can send
-- the same notifications.
-- =============================================
CREATE OR REPLACE FUNCTION review_bank_account_name(
  p_bank_account_id uuid,
  p_reviewer_id     uuid,
  p_action          text,
  p_note            text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner      text;
  v_org_id     uuid;
  v_user_id    uuid;
  v_status     bank_account_status;
  v_is_active  boolean;
  v_note       text := NULLIF(btrim(p_note), '');
  v_new_status bank_account_status;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('confirm', 'reject') THEN
    RAISE EXCEPTION 'action must be confirm or reject, got %', p_action USING ERRCODE = '22023';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'NOTE_REQUIRED: say why the account is confirmed or rejected'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT 'organization', organization_id, NULL::uuid, status, is_active
    INTO v_owner, v_org_id, v_user_id, v_status, v_is_active
    FROM organization_bank_accounts
    WHERE id = p_bank_account_id
    FOR UPDATE;

  IF NOT FOUND THEN
    SELECT 'player', NULL::uuid, user_id, status, is_active
      INTO v_owner, v_org_id, v_user_id, v_status, v_is_active
      FROM player_bank_accounts
      WHERE id = p_bank_account_id
      FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank account % not found', p_bank_account_id USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'name_mismatch' THEN
    RAISE EXCEPTION 'NOT_UNDER_REVIEW: this account is %, not awaiting a name review', v_status
      USING ERRCODE = 'P0001';
  END IF;

  v_new_status := CASE p_action WHEN 'confirm' THEN 'verified' ELSE 'rejected' END::bank_account_status;

  IF v_owner = 'organization' THEN
    UPDATE organization_bank_accounts
      SET status           = v_new_status,
          verified_at      = CASE WHEN v_new_status = 'verified' THEN now() END,
          rejection_reason = CASE WHEN v_new_status = 'rejected' THEN v_note END,
          name_reviewed_by = p_reviewer_id,
          name_reviewed_at = now(),
          name_review_note = v_note
      WHERE id = p_bank_account_id;
  ELSE
    UPDATE player_bank_accounts
      SET status           = v_new_status,
          verified_at      = CASE WHEN v_new_status = 'verified' THEN now() END,
          rejection_reason = CASE WHEN v_new_status = 'rejected' THEN v_note END,
          name_reviewed_by = p_reviewer_id,
          name_reviewed_at = now(),
          name_review_note = v_note
      WHERE id = p_bank_account_id;
  END IF;

  RETURN jsonb_build_object(
    'bank_account_id',   p_bank_account_id,
    'owner',             v_owner,
    'organization_id',   v_org_id,
    'user_id',           v_user_id,
    'already_processed', false,
    'verified',          v_new_status = 'verified',
    'status',            v_new_status,
    'is_active',         v_is_active
  );
END;
$$;

-- =============================================
-- EXECUTE PRIVILEGES (see the block at the end of 003_functions_triggers.sql)
-- =============================================
REVOKE EXECUTE ON FUNCTION settle_bank_account_verification FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION review_bank_account_name         FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION settle_bank_account_verification TO service_role;
GRANT EXECUTE ON FUNCTION review_bank_account_name         TO service_role;
