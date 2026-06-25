-- =============================================
-- TOURNAMENT INSERT: REQUIRE APPROVED ORGANIZATION (L2)
-- Defense-in-depth: the API already rejects tournament creation for orgs that
-- aren't approved, but the RLS INSERT policy only checked the permission. Add an
-- organization-approval check so the database itself enforces it.
--
-- Uses a SECURITY DEFINER helper (like has_org_permission) so the check is not
-- limited by row-level security on the organizations table.
-- =============================================
CREATE OR REPLACE FUNCTION is_org_approved(p_org_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organizations
    WHERE id = p_org_id
      AND approval_status = 'approved'
      AND deleted_at IS NULL
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

ALTER POLICY "Org members can create tournaments"
ON tournaments
WITH CHECK (
  has_org_permission(auth.uid(), organization_id, 'tournament.create')
  AND is_org_approved(organization_id)
);
