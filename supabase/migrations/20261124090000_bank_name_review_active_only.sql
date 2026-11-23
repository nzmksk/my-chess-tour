-- =============================================
-- #704: only the account an owner is using now can be name-reviewed.
--
-- Saving new bank details supersedes the active row (is_active = false) and
-- inserts a fresh one. A superseded row that was waiting for a name review
-- stayed 'name_mismatch', so the queue at /admin/bank-accounts showed one
-- review per save, and an admin could still confirm an account nothing would
-- ever pay: every payout and prize check reads the active row only.
--
-- The queue now lists active rows only (src/services/payouts/name-review.ts),
-- so an owner has at most one account waiting, and replacing it takes the old
-- one off the queue whatever the new one's verdict. review_bank_account_name
-- refuses a superseded row with SUPERSEDED, for an admin acting on a stale
-- page. The superseded row keeps 'name_mismatch': that is what CHIP said about
-- it, and its history stays as it was.
--
-- Otherwise unchanged from 20261122090200_bank_holder_name_match.sql.
--
-- Refuses with:
--   P0002            no such bank account
--   NOT_UNDER_REVIEW (P0001) the account isn't 'name_mismatch' (already
--                    decided, or never needed review)
--   SUPERSEDED       (P0001) the owner has replaced the account since
--   NOTE_REQUIRED    (P0001) a blank note
--   22023            an action other than 'confirm' or 'reject'
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

  IF NOT v_is_active THEN
    RAISE EXCEPTION 'SUPERSEDED: the owner has replaced this account since'
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

-- CREATE OR REPLACE keeps the existing grants; restated so this file reads
-- complete on its own.
REVOKE EXECUTE ON FUNCTION review_bank_account_name FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION review_bank_account_name TO service_role;
