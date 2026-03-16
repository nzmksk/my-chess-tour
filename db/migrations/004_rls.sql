-- =============================================
-- ENABLE RLS
-- =============================================
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_global_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- =============================================
-- RBAC REFERENCE TABLES (read-only for all authenticated)
-- =============================================
CREATE POLICY "Anyone can read roles"
ON roles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Anyone can read permissions"
ON permissions FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Anyone can read role_permissions"
ON role_permissions FOR SELECT
TO authenticated
USING (true);

-- Only platform admins can modify RBAC reference data
CREATE POLICY "Platform admins manage roles"
ON roles FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

CREATE POLICY "Platform admins manage permissions"
ON permissions FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

CREATE POLICY "Platform admins manage role_permissions"
ON role_permissions FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

-- =============================================
-- USER GLOBAL ROLES
-- =============================================
CREATE POLICY "Users can view own global roles"
ON user_global_roles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Platform admins manage global roles"
ON user_global_roles FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

-- =============================================
-- USERS
-- =============================================
CREATE POLICY "Users can view own profile"
ON users FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON users FOR UPDATE
USING (auth.uid() = id);

CREATE POLICY "Platform admins can view all users"
ON users FOR SELECT
USING (has_global_permission(auth.uid(), 'platform.manage'));

-- =============================================
-- PLAYER PROFILES
-- =============================================
CREATE POLICY "Players can view own profile"
ON player_profiles FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Players can insert own profile"
ON player_profiles FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Players can update own profile"
ON player_profiles FOR UPDATE
USING (auth.uid() = user_id);

-- Org members can view player profiles (for participant lists)
CREATE POLICY "Org members can view player profiles"
ON player_profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organization_memberships WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Platform admins full access to player profiles"
ON player_profiles FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

-- =============================================
-- ORGANIZATIONS
-- =============================================
CREATE POLICY "Public can view approved organizations"
ON organizations FOR SELECT
USING (approval_status = 'approved');

-- Org members can view their own org (even if pending/rejected)
CREATE POLICY "Members can view own org"
ON organizations FOR SELECT
USING (is_org_member(auth.uid(), id));

CREATE POLICY "Authenticated users can apply as organizer"
ON organizations FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Org managers can update their organization
CREATE POLICY "Org managers can update org"
ON organizations FOR UPDATE
USING (has_org_permission(auth.uid(), id, 'org.manage'));

CREATE POLICY "Platform admins full access to organizations"
ON organizations FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

-- =============================================
-- ORGANIZATION MEMBERSHIPS
-- =============================================

-- Members can view all members of their own org
-- Uses is_org_member() (SECURITY DEFINER) to avoid infinite recursion
CREATE POLICY "Members can view org memberships"
ON organization_memberships FOR SELECT
USING (is_org_member(auth.uid(), organization_id));

-- Users can insert their own membership when creating an org
CREATE POLICY "Users can create own membership"
ON organization_memberships FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Org inviters can manage members
CREATE POLICY "Org inviters can manage memberships"
ON organization_memberships FOR ALL
USING (has_org_permission(auth.uid(), organization_id, 'org.invite'));

CREATE POLICY "Platform admins full access to memberships"
ON organization_memberships FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

-- =============================================
-- TOURNAMENTS
-- =============================================
CREATE POLICY "Public can view published tournaments"
ON tournaments FOR SELECT
USING (status = 'published');

-- Org members with tournament.view can see drafts
CREATE POLICY "Org members can view own tournaments"
ON tournaments FOR SELECT
USING (has_org_permission(auth.uid(), organization_id, 'tournament.view'));

CREATE POLICY "Org members can create tournaments"
ON tournaments FOR INSERT
WITH CHECK (has_org_permission(auth.uid(), organization_id, 'tournament.create'));

CREATE POLICY "Org members can update tournaments"
ON tournaments FOR UPDATE
USING (has_org_permission(auth.uid(), organization_id, 'tournament.edit'));

CREATE POLICY "Platform admins full access to tournaments"
ON tournaments FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

-- =============================================
-- REGISTRATIONS
-- =============================================
CREATE POLICY "Players can view own registrations"
ON registrations FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Players can register"
ON registrations FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Players can cancel own registration"
ON registrations FOR UPDATE
USING (auth.uid() = user_id);

-- Org members with registration.view can see their tournament's registrations
CREATE POLICY "Org members can view tournament registrations"
ON registrations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tournaments t
    WHERE t.id = registrations.tournament_id
      AND has_org_permission(auth.uid(), t.organization_id, 'registration.view')
  )
);

CREATE POLICY "Platform admins full access to registrations"
ON registrations FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

-- =============================================
-- PAYMENTS
-- Note: creation and status updates happen server-side
-- via service_role key through API routes and Chip webhooks.
-- =============================================
CREATE POLICY "Players can view own payments"
ON payments FOR SELECT
USING (auth.uid() = user_id);

-- Org members with payment.view can see their tournament's payments
CREATE POLICY "Org members can view tournament payments"
ON payments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tournaments t
    WHERE t.id = payments.tournament_id
      AND has_org_permission(auth.uid(), t.organization_id, 'payment.view')
  )
);

CREATE POLICY "Platform admins full access to payments"
ON payments FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

-- =============================================
-- REFUNDS
-- =============================================
CREATE POLICY "Players can view own refunds"
ON refunds FOR SELECT
USING (auth.uid() = requested_by);

CREATE POLICY "Players can request refund"
ON refunds FOR INSERT
WITH CHECK (auth.uid() = requested_by);

-- Org members with refund.manage can view/manage refunds for their tournaments
CREATE POLICY "Org refund managers can view tournament refunds"
ON refunds FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM registrations r
    JOIN tournaments t ON t.id = r.tournament_id
    WHERE r.id = refunds.registration_id
      AND has_org_permission(auth.uid(), t.organization_id, 'refund.manage')
  )
);

CREATE POLICY "Platform admins full access to refunds"
ON refunds FOR ALL
USING (has_global_permission(auth.uid(), 'platform.manage'));

-- =============================================
-- AUDIT LOGS
-- Read-only. Only triggers write to this table.
-- Tiered visibility: platform admins > org admins > individual users.
-- =============================================
CREATE POLICY "Platform admins can view all audit logs"
ON audit_logs FOR SELECT
USING (has_global_permission(auth.uid(), 'platform.manage'));

CREATE POLICY "Org admins can view org-scoped audit logs"
ON audit_logs FOR SELECT
USING (
  organization_id IS NOT NULL
  AND has_org_permission(auth.uid(), organization_id, 'org.manage')
);

CREATE POLICY "Users can view own account audit logs"
ON audit_logs FOR SELECT
USING (
  table_name IN ('users', 'player_profiles')
  AND record_id = auth.uid()::text
);

-- =============================================
-- TOURNAMENT PAYOUT SUMMARY VIEW
-- Views don't support RLS directly. security_invoker makes the view
-- run with the caller's identity, so the RLS policies on the underlying
-- payments and tournaments tables apply automatically.
-- Access is therefore governed by the existing "payment.view" permission:
--   - Org members with payment.view see only their own tournaments.
--   - Platform admins see all rows (via their unrestricted payments policy).
-- =============================================
ALTER VIEW tournament_payout_summary SET (security_invoker = true);

GRANT SELECT ON tournament_payout_summary TO authenticated;
