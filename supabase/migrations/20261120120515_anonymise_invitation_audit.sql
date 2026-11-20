-- =============================================
-- ACCOUNT DELETION: INVITATION AUDIT ROWS (#470)
--
-- organization_invitations is audited now
-- (20261120120510_audit_organization_invitations.sql), and every snapshot holds
-- the invitee's email address. The deletion runbook (wiki/account-deletion.md)
-- deletes the invitations addressed to the user, but deleting rows does not
-- reach audit_logs, so the address would outlive the account there.
--
-- anonymise_user_audit_logs now also anonymises the invitation snapshots
-- addressed to the user: every key except an allowlist of ids, the status and
-- timestamps becomes '[anonymised]', as for their other rows. The rows stay,
-- so an organization's history of who was invited when (by id) survives.
--
-- It finds them by address, and takes the addresses from the user's own users
-- audit snapshots (plus the users row, if a soft delete left it), read BEFORE
-- those snapshots are anonymised below. So it needs no extra argument, the
-- runbook's call doesn't change, and an invitation sent to an address the
-- account used before an email change is covered too. Re-running finds only
-- anonymised addresses and changes nothing.
--
-- The invitations a deleted user SENT are left alone: the address in them is
-- someone else's, and invited_by is an id, like changed_by on a financial row.
--
-- Otherwise the function is as in 003_functions_triggers.sql.
-- =============================================
CREATE OR REPLACE FUNCTION anonymise_user_audit_logs(p_user_id uuid)
RETURNS TABLE (snapshots_anonymised integer, changed_by_cleared integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  c_keep_users           constant text[] := ARRAY[
    'id', 'is_verified', 'verified_at', 'terms_version', 'terms_accepted_at',
    'created_at', 'updated_at', 'deleted_at'
  ];
  c_keep_player_profiles constant text[] := ARRAY['user_id', 'created_at', 'updated_at'];
  -- The account number is already masked to its last 4 on the way in; the
  -- holder's name and the bank are what is left to strip.
  c_keep_player_bank     constant text[] := ARRAY[
    'id', 'user_id', 'status', 'is_active', 'verified_at', 'created_at', 'updated_at'
  ];
  -- The address is what identifies the invitee; token_hash is already masked
  -- and goes too.
  c_keep_invitations     constant text[] := ARRAY[
    'id', 'organization_id', 'role_id', 'status', 'invited_by', 'created_at',
    'expires_at', 'responded_at', 'responded_by'
  ];
  c_financial            constant text[] := ARRAY[
    'payments', 'refunds', 'payouts', 'registrations', 'prize_awards', 'prize_fundings'
  ];
  v_bank_rows            integer;
  v_invitation_rows      integer;
  v_emails               text[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'USER_NOT_DELETED'
      USING ERRCODE = 'P0001',
            DETAIL  = 'Delete the users row, or set deleted_at, before anonymising its audit history.';
  END IF;

  -- Every address the account has had, while the users snapshots still say.
  SELECT array_agg(DISTINCT lower(e.email)) INTO v_emails
  FROM (
    SELECT a.old_data ->> 'email' AS email
      FROM audit_logs a WHERE a.table_name = 'users' AND a.record_id = p_user_id::text
    UNION ALL
    SELECT a.new_data ->> 'email'
      FROM audit_logs a WHERE a.table_name = 'users' AND a.record_id = p_user_id::text
    UNION ALL
    SELECT u.email FROM users u WHERE u.id = p_user_id
  ) e
  WHERE e.email IS NOT NULL AND e.email <> '[anonymised]';

  UPDATE audit_logs a
  SET old_data = anonymise_jsonb_except(a.old_data, k.keep),
      new_data = anonymise_jsonb_except(a.new_data, k.keep)
  FROM (VALUES ('users', c_keep_users), ('player_profiles', c_keep_player_profiles)) AS k(table_name, keep)
  WHERE a.table_name = k.table_name
    AND a.record_id  = p_user_id::text
    AND (   a.old_data IS DISTINCT FROM anonymise_jsonb_except(a.old_data, k.keep)
         OR a.new_data IS DISTINCT FROM anonymise_jsonb_except(a.new_data, k.keep));
  GET DIAGNOSTICS snapshots_anonymised = ROW_COUNT;

  -- A player bank account's audit rows are keyed by the account's own id, so
  -- they are found by the owner recorded inside the snapshot.
  UPDATE audit_logs a
  SET old_data = anonymise_jsonb_except(a.old_data, c_keep_player_bank),
      new_data = anonymise_jsonb_except(a.new_data, c_keep_player_bank)
  WHERE a.table_name = 'player_bank_accounts'
    AND COALESCE(a.new_data, a.old_data) ->> 'user_id' = p_user_id::text
    AND (   a.old_data IS DISTINCT FROM anonymise_jsonb_except(a.old_data, c_keep_player_bank)
         OR a.new_data IS DISTINCT FROM anonymise_jsonb_except(a.new_data, c_keep_player_bank));
  GET DIAGNOSTICS v_bank_rows = ROW_COUNT;
  snapshots_anonymised := snapshots_anonymised + v_bank_rows;

  -- Invitations addressed to the user, found by address (the email never
  -- changes on an invitation row, so either snapshot carries it).
  UPDATE audit_logs a
  SET old_data = anonymise_jsonb_except(a.old_data, c_keep_invitations),
      new_data = anonymise_jsonb_except(a.new_data, c_keep_invitations)
  WHERE a.table_name = 'organization_invitations'
    AND lower(COALESCE(a.new_data, a.old_data) ->> 'email') = ANY (v_emails)
    AND (   a.old_data IS DISTINCT FROM anonymise_jsonb_except(a.old_data, c_keep_invitations)
         OR a.new_data IS DISTINCT FROM anonymise_jsonb_except(a.new_data, c_keep_invitations));
  GET DIAGNOSTICS v_invitation_rows = ROW_COUNT;
  snapshots_anonymised := snapshots_anonymised + v_invitation_rows;

  UPDATE audit_logs
  SET changed_by = NULL
  WHERE changed_by = p_user_id
    AND table_name <> ALL (c_financial);
  GET DIAGNOSTICS changed_by_cleared = ROW_COUNT;

  RETURN NEXT;
END;
$$;
