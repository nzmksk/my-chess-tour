-- =============================================
-- #582: a rejected organizer applicant can re-apply under the same name.
--
-- A rejected application stays in organizations for audit, but it no longer
-- holds anything a fresh application needs:
--   1. its name: idx_organizations_name_active now ignores rejected rows;
--   2. its payout account: rejecting deactivates the application's bank account,
--      so uniq_active_bank_destination (002_indexes.sql) doesn't turn the
--      re-application away with BANK_ACCOUNT_IN_USE either.
-- Both only hold if a rejection is final, so review_organization_application
-- now refuses to approve a rejected application: approving it could collide
-- with a re-application that took the name, and it would have no payout
-- account. The applicant re-applies instead, which is what the rejection email
-- (#120, #577) tells them to do.
-- =============================================

-- 1. Name uniqueness among pending and approved organizations only.
DROP INDEX idx_organizations_name_active;
CREATE UNIQUE INDEX idx_organizations_name_active ON organizations (lower(name))
  WHERE deleted_at IS NULL AND approval_status <> 'rejected';

-- 2. Free the payout accounts of applications already rejected. They were never
--    registered with CHIP Send (that happens on approval), so there is nothing
--    to undo there. Superseded rows keep is_active = false the same way.
UPDATE organization_bank_accounts b
   SET is_active = false
  FROM organizations o
 WHERE b.organization_id = o.id
   AND b.is_active
   AND o.approval_status = 'rejected';

-- =============================================
-- REVIEW ORGANIZATION APPLICATION
-- Called by the admin applications handler (service_role) to approve or reject
-- an organization application. Performs the status update and, on approval, the
-- creation of the applicant's owner membership atomically in one transaction:
--   p_action = 'approve' -> approval_status 'approved' + owner membership row
--   p_action = 'reject'  -> approval_status 'rejected' + rejection_reason set,
--                           and the application's bank account deactivated
-- Re-approving is idempotent: the owner membership is created at most once.
-- Approving a rejected application raises P0001 APPLICATION_REJECTED: a
-- rejection is final, and the applicant re-applies (#582).
-- =============================================
CREATE OR REPLACE FUNCTION review_organization_application(
  p_org_id            uuid,
  p_reviewer_id       uuid,
  p_action            text,
  p_rejection_reason  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org           organizations;
  v_owner_role_id integer;
  v_new_status    approval_status;
  v_reviewed_at   timestamptz := now();
BEGIN
  -- Lock the organization row so concurrent reviews serialize.
  SELECT * INTO v_org
    FROM organizations
    WHERE id = p_org_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  -- Its name and payout account were released when it was rejected (see the
  -- header), so approving it now could collide with the re-application that
  -- took them.
  IF p_action = 'approve' AND v_org.approval_status = 'rejected' THEN
    RAISE EXCEPTION 'APPLICATION_REJECTED: a rejected application cannot be approved; the applicant must re-apply'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_status := CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END;

  UPDATE organizations
    SET approval_status  = v_new_status,
        reviewed_by      = p_reviewer_id,
        reviewed_at      = v_reviewed_at,
        rejection_reason = CASE WHEN p_action = 'reject' THEN p_rejection_reason ELSE NULL END
    WHERE id = p_org_id;

  IF p_action = 'approve' THEN
    SELECT id INTO v_owner_role_id
      FROM roles
      WHERE name = 'owner' AND scope = 'organization';

    IF v_owner_role_id IS NULL THEN
      RAISE EXCEPTION 'owner role not found';
    END IF;

    INSERT INTO organization_memberships (organization_id, user_id, role_id)
      VALUES (p_org_id, v_org.created_by, v_owner_role_id)
      ON CONFLICT (organization_id, user_id) DO NOTHING;
  ELSE
    -- Frees the destination for a re-application (uniq_active_bank_destination).
    -- Never registered with CHIP Send: that only happens on approval.
    UPDATE organization_bank_accounts
      SET is_active = false
      WHERE organization_id = p_org_id AND is_active;
  END IF;

  RETURN jsonb_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'approval_status', v_new_status,
    'reviewed_at', v_reviewed_at
  );
END;
$$;
