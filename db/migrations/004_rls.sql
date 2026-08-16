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
ALTER TABLE organization_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_cancellation_requests ENABLE ROW LEVEL SECURITY;
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
USING (has_global_permission(app_user_id(), 'platform.manage'));

CREATE POLICY "Platform admins manage permissions"
ON permissions FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

CREATE POLICY "Platform admins manage role_permissions"
ON role_permissions FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- USER GLOBAL ROLES
-- =============================================
-- SELF-ONLY BY DESIGN. Must never become can_act_for(): acting on someone's
-- behalf must not expose or confer their platform-admin role.
CREATE POLICY "Users can view own global roles"
ON user_global_roles FOR SELECT
USING (app_user_id() = user_id);

CREATE POLICY "Platform admins manage global roles"
ON user_global_roles FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- USERS
-- =============================================
-- SELF-ONLY BY DESIGN. The account record itself (email, name, verification)
-- belongs to the login that owns it, not to anyone acting on its behalf.
-- Managed-record access, when it exists, goes through player_profiles.
CREATE POLICY "Users can view own profile"
ON users FOR SELECT
USING (app_user_id() = id);

-- DELIBERATELY NO CLIENT UPDATE POLICY.
--
-- There used to be a blanket "Users can update own profile" UPDATE policy here
-- with USING (app_user_id() = id) and no column restriction. Postgres reuses the
-- USING expression as the WITH CHECK when none is given, and app_user_id() is
-- STABLE (so it resolves against the pre-update snapshot) — which meant the
-- check only ever verified that `id` was unchanged. Every other column was
-- freely writable by anyone holding that user's JWT, straight through PostgREST:
--
--   PATCH /rest/v1/users?id=eq.<self>  {"auth_user_id": null}   -> orphans the
--     record; app_user_id() then returns NULL for that session forever, breaking
--     the only bridge between Supabase Auth and this table.
--   PATCH /rest/v1/users?id=eq.<self>  {"is_verified": true}    -> self-verify,
--     bypassing the emailed code entirely.
--
-- No application code needs the policy: every write to `users` in the codebase
-- goes through the service-role client (signup, verification, profile PATCH,
-- rollback), which bypasses RLS. Removing the capability is therefore strictly
-- safer than trying to constrain it column by column.
REVOKE UPDATE, INSERT, DELETE ON users FROM anon, authenticated;

CREATE POLICY "Platform admins can view all users"
ON users FOR SELECT
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- PLAYER PROFILES
-- =============================================
-- can_act_for() is currently the self check, so these are unchanged in effect.
-- They widen deliberately when guardianships land (#504).
CREATE POLICY "Players can view own profile"
ON player_profiles FOR SELECT
USING (can_act_for(user_id));

CREATE POLICY "Players can insert own profile"
ON player_profiles FOR INSERT
WITH CHECK (can_act_for(user_id));

CREATE POLICY "Players can update own profile"
ON player_profiles FOR UPDATE
USING (can_act_for(user_id));

-- Org members can view player profiles (for participant lists)
CREATE POLICY "Org members can view player profiles"
ON player_profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organization_memberships WHERE user_id = app_user_id()
  )
);

CREATE POLICY "Platform admins full access to player profiles"
ON player_profiles FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- ORGANIZATIONS
-- =============================================
CREATE POLICY "Public can view approved organizations"
ON organizations FOR SELECT
USING (approval_status = 'approved');

-- Org members can view their own org (even if pending/rejected)
CREATE POLICY "Members can view own org"
ON organizations FOR SELECT
USING (is_org_member(app_user_id(), id));

CREATE POLICY "Authenticated users can apply as organizer"
ON organizations FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Org managers can update their organization
CREATE POLICY "Org managers can update org"
ON organizations FOR UPDATE
USING (has_org_permission(app_user_id(), id, 'org.manage'));

CREATE POLICY "Platform admins full access to organizations"
ON organizations FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- ORGANIZATION BANK ACCOUNTS
-- Payout destination. Deliberately NO general org-member SELECT: a `member` or
-- `admin` of an organization has no business reading where its money goes, and
-- the last-4 an organizer needs to recognise their own account is served by the
-- API, not by table access.
-- =============================================
CREATE POLICY "Org bank managers can view own bank accounts"
ON organization_bank_accounts FOR SELECT
USING (has_org_permission(app_user_id(), organization_id, 'bank_account.manage'));

CREATE POLICY "Platform admins full access to bank accounts"
ON organization_bank_accounts FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- Following the `users` precedent above: no client write capability at all.
-- Every write goes through set_organization_bank_account (which supersedes
-- rather than updates, so verification can't go stale) or the service role. A
-- column-scoped UPDATE policy could not express that rule, and a blanket one
-- would let a JWT holder set status='verified' on their own row.
REVOKE UPDATE, INSERT, DELETE ON organization_bank_accounts FROM anon, authenticated;

-- =============================================
-- ORGANIZATION DOCUMENTS (KYB)
-- Paths into a private bucket, so reading a row is close to reading the file.
-- =============================================
CREATE POLICY "Org managers can view own documents"
ON organization_documents FOR SELECT
USING (has_org_permission(app_user_id(), organization_id, 'org.manage'));

CREATE POLICY "Platform admins full access to org documents"
ON organization_documents FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

REVOKE UPDATE, INSERT, DELETE ON organization_documents FROM anon, authenticated;

-- =============================================
-- ORGANIZATION MEMBERSHIPS
-- =============================================

-- Members can view all members of their own org
-- Uses is_org_member() (SECURITY DEFINER) to avoid infinite recursion
CREATE POLICY "Members can view org memberships"
ON organization_memberships FOR SELECT
USING (is_org_member(app_user_id(), organization_id));

-- Users can insert their own membership when creating an org.
-- SELF-ONLY BY DESIGN. Must never become can_act_for(): acting on someone's
-- behalf must not let you enrol them in — or inherit — an organization.
CREATE POLICY "Users can create own membership"
ON organization_memberships FOR INSERT
WITH CHECK (app_user_id() = user_id);

-- Org inviters can manage members
CREATE POLICY "Org inviters can manage memberships"
ON organization_memberships FOR ALL
USING (has_org_permission(app_user_id(), organization_id, 'org.invite'));

CREATE POLICY "Platform admins full access to memberships"
ON organization_memberships FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- TOURNAMENTS
-- =============================================
CREATE POLICY "Public can view published tournaments"
ON tournaments FOR SELECT
USING (status = 'published');

-- Org members with tournament.view can see drafts
CREATE POLICY "Org members can view own tournaments"
ON tournaments FOR SELECT
USING (has_org_permission(app_user_id(), organization_id, 'tournament.view'));

-- Defense-in-depth: requires both the permission and an approved organization,
-- so the database enforces approval, not just the API.
CREATE POLICY "Org members can create tournaments"
ON tournaments FOR INSERT
WITH CHECK (
  has_org_permission(app_user_id(), organization_id, 'tournament.create')
  AND is_org_approved(organization_id)
);

CREATE POLICY "Org members can update tournaments"
ON tournaments FOR UPDATE
USING (has_org_permission(app_user_id(), organization_id, 'tournament.edit'));

CREATE POLICY "Platform admins full access to tournaments"
ON tournaments FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- REGISTRATIONS
-- =============================================
-- registrations.user_id is the PARTICIPANT. can_act_for() is the self check
-- today; when guardianships land (#504) these widen to the guardian without
-- touching the policies.
CREATE POLICY "Players can view own registrations"
ON registrations FOR SELECT
USING (can_act_for(user_id));

CREATE POLICY "Players can register"
ON registrations FOR INSERT
WITH CHECK (can_act_for(user_id));

CREATE POLICY "Players can cancel own registration"
ON registrations FOR UPDATE
USING (can_act_for(user_id));

-- Org members with registration.view can see their tournament's registrations
CREATE POLICY "Org members can view tournament registrations"
ON registrations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tournaments t
    WHERE t.id = registrations.tournament_id
      AND has_org_permission(app_user_id(), t.organization_id, 'registration.view')
  )
);

CREATE POLICY "Platform admins full access to registrations"
ON registrations FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- PAYMENTS
-- Note: creation and status updates happen server-side
-- via service_role key through API routes and Chip webhooks.
-- =============================================
-- payments.user_id is whoever was charged. Identical to the participant today;
-- #504 settles it as the PAYER, at which point can_act_for() keeps a guardian
-- seeing the payments they made.
CREATE POLICY "Players can view own payments"
ON payments FOR SELECT
USING (can_act_for(user_id));

-- Org members with payment.view can see their tournament's payments
CREATE POLICY "Org members can view tournament payments"
ON payments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tournaments t
    WHERE t.id = payments.tournament_id
      AND has_org_permission(app_user_id(), t.organization_id, 'payment.view')
  )
);

CREATE POLICY "Platform admins full access to payments"
ON payments FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- REFUNDS
-- =============================================
-- NOTE: these scope on requested_by, not on the registration's owner, so a
-- cancellation refund (requested_by = the reviewing admin) is invisible to the
-- player it belongs to. Pre-existing behaviour, unchanged here — tracked in #511.
CREATE POLICY "Players can view own refunds"
ON refunds FOR SELECT
USING (can_act_for(requested_by));

CREATE POLICY "Players can request refund"
ON refunds FOR INSERT
WITH CHECK (can_act_for(requested_by));

-- Org members with refund.manage can view/manage refunds for their tournaments
CREATE POLICY "Org refund managers can view tournament refunds"
ON refunds FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM registrations r
    JOIN tournaments t ON t.id = r.tournament_id
    WHERE r.id = refunds.registration_id
      AND has_org_permission(app_user_id(), t.organization_id, 'refund.manage')
  )
);

CREATE POLICY "Platform admins full access to refunds"
ON refunds FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- TOURNAMENT CANCELLATION REQUESTS
-- Org members with tournament.delete (owner) can file and view their org's
-- requests; platform admins review them. Writes in the app go through the
-- service-role client (bypasses RLS), so these are defense-in-depth.
-- =============================================
CREATE POLICY "Org members can file cancellation requests"
ON tournament_cancellation_requests FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM tournaments t
    WHERE t.id = tournament_cancellation_requests.tournament_id
      AND has_org_permission(app_user_id(), t.organization_id, 'tournament.delete')
  )
);

CREATE POLICY "Org members can view own cancellation requests"
ON tournament_cancellation_requests FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tournaments t
    WHERE t.id = tournament_cancellation_requests.tournament_id
      AND has_org_permission(app_user_id(), t.organization_id, 'tournament.view')
  )
);

CREATE POLICY "Platform admins full access to cancellation requests"
ON tournament_cancellation_requests FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

-- =============================================
-- AUDIT LOGS
-- Read-only. Only triggers write to this table.
-- Tiered visibility: platform admins > org admins > individual users.
-- =============================================
CREATE POLICY "Platform admins can view all audit logs"
ON audit_logs FOR SELECT
USING (has_global_permission(app_user_id(), 'platform.manage'));

CREATE POLICY "Org admins can view org-scoped audit logs"
ON audit_logs FOR SELECT
USING (
  organization_id IS NOT NULL
  AND has_org_permission(app_user_id(), organization_id, 'org.manage')
);

-- SELF-ONLY BY DESIGN. record_id here is a users.id, so it resolves through
-- app_user_id(). Deliberately not can_act_for(): change history on a record is
-- not automatically visible to someone acting on its behalf.
CREATE POLICY "Users can view own account audit logs"
ON audit_logs FOR SELECT
USING (
  table_name IN ('users', 'player_profiles')
  AND record_id = app_user_id()::text
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
