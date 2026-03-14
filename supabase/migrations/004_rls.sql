-- =============================================
-- ENABLE RLS
-- =============================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

-- =============================================
-- HELPER FUNCTIONS
-- =============================================

-- Check if the current user is a platform admin
CREATE OR REPLACE FUNCTION is_admin(user_id uuid)
RETURNS boolean AS $$
  SELECT 'admin' = ANY(role) FROM users WHERE id = user_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Get the current user's role in an organization
CREATE OR REPLACE FUNCTION get_org_role(p_user_id uuid, p_org_id uuid)
RETURNS organization_role AS $$
  SELECT role FROM organization_members
  WHERE user_id = p_user_id AND organization_id = p_org_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- =============================================
-- USERS
-- =============================================

-- Users can read and update their own row
CREATE POLICY "Users can view own profile"
ON users FOR SELECT
USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
ON users FOR UPDATE
USING (auth.uid() = id);

-- Admins can view all users
CREATE POLICY "Admins can view all users"
ON users FOR SELECT
USING (is_admin(auth.uid()));

-- =============================================
-- PLAYER PROFILES
-- =============================================

-- Players can read and update their own profile
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
-- Excludes sensitive fields (bank, is_oku, dob) — handle via column-level security or app layer
CREATE POLICY "Org members can view player profiles"
ON player_profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organization_members WHERE user_id = auth.uid()
  )
);

-- Admins have full access
CREATE POLICY "Admins full access to player profiles"
ON player_profiles FOR ALL
USING (is_admin(auth.uid()));

-- =============================================
-- ORGANIZATIONS
-- =============================================

-- Anyone can view approved organizations
CREATE POLICY "Public can view approved organizations"
ON organizations FOR SELECT
USING (approval_status = 'approved');

-- Org members can view their own org (even if pending/rejected)
CREATE POLICY "Members can view own org"
ON organizations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = organizations.id AND user_id = auth.uid()
  )
);

-- Authenticated users can apply (create an organization)
CREATE POLICY "Authenticated users can apply as organizer"
ON organizations FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Org owners can update their organization
CREATE POLICY "Owners can update org"
ON organizations FOR UPDATE
USING (get_org_role(auth.uid(), id) = 'owner');

-- Admins have full access
CREATE POLICY "Admins full access to organizations"
ON organizations FOR ALL
USING (is_admin(auth.uid()));

-- =============================================
-- ORGANIZATION MEMBERS
-- =============================================

-- Members can view all members of their own org
-- Uses get_org_role() (SECURITY DEFINER) to avoid infinite recursion
CREATE POLICY "Members can view org members"
ON organization_members FOR SELECT
USING (get_org_role(auth.uid(), organization_id) IS NOT NULL);

-- Users can insert their own owner row when creating an org
CREATE POLICY "Users can create own membership"
ON organization_members FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Owners can manage members (add/update/delete)
CREATE POLICY "Owners can manage members"
ON organization_members FOR ALL
USING (get_org_role(auth.uid(), organization_id) = 'owner');

-- =============================================
-- TOURNAMENTS
-- =============================================

-- Anyone can view published tournaments
CREATE POLICY "Public can view published tournaments"
ON tournaments FOR SELECT
USING (status = 'published');

-- Org members can view all their org's tournaments (including drafts)
CREATE POLICY "Org members can view own tournaments"
ON tournaments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organization_members
    WHERE organization_id = tournaments.organization_id
      AND user_id = auth.uid()
  )
);

-- Org admins/owners can create and update tournaments
CREATE POLICY "Org admins can create tournaments"
ON tournaments FOR INSERT
WITH CHECK (
  get_org_role(auth.uid(), organization_id) IN ('admin', 'owner')
);

CREATE POLICY "Org admins can update tournaments"
ON tournaments FOR UPDATE
USING (
  get_org_role(auth.uid(), organization_id) IN ('admin', 'owner')
);

-- Admins have full access
CREATE POLICY "Admins full access to tournaments"
ON tournaments FOR ALL
USING (is_admin(auth.uid()));

-- =============================================
-- REGISTRATIONS
-- =============================================

-- Players can view and create their own registrations
CREATE POLICY "Players can view own registrations"
ON registrations FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Players can register"
ON registrations FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Players can cancel their own registration
CREATE POLICY "Players can cancel own registration"
ON registrations FOR UPDATE
USING (auth.uid() = user_id);

-- Org members can view registrations for their tournaments
CREATE POLICY "Org members can view tournament registrations"
ON registrations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tournaments t
    JOIN organization_members om ON om.organization_id = t.organization_id
    WHERE t.id = registrations.tournament_id
      AND om.user_id = auth.uid()
  )
);

-- Admins have full access
CREATE POLICY "Admins full access to registrations"
ON registrations FOR ALL
USING (is_admin(auth.uid()));

-- =============================================
-- PAYMENTS
-- Note: creation and status updates happen server-side
-- via service_role key through API routes and Chip webhooks.
-- RLS policies here are primarily for reads.
-- =============================================

-- Players can view their own payments
CREATE POLICY "Players can view own payments"
ON payments FOR SELECT
USING (auth.uid() = user_id);

-- Org members can view payments for their tournaments
CREATE POLICY "Org members can view tournament payments"
ON payments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organization_members om
    WHERE om.organization_id = payments.organization_id
      AND om.user_id = auth.uid()
  )
);

-- Admins have full access
CREATE POLICY "Admins full access to payments"
ON payments FOR ALL
USING (is_admin(auth.uid()));

-- =============================================
-- REFUNDS
-- =============================================

-- Players can view their own refund requests
CREATE POLICY "Players can view own refunds"
ON refunds FOR SELECT
USING (auth.uid() = requested_by);

-- Players can request a refund
CREATE POLICY "Players can request refund"
ON refunds FOR INSERT
WITH CHECK (auth.uid() = requested_by);

-- Org admins/owners can view refunds for their tournaments
CREATE POLICY "Org admins can view tournament refunds"
ON refunds FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM registrations r
    JOIN tournaments t ON t.id = r.tournament_id
    JOIN organization_members om ON om.organization_id = t.organization_id
    WHERE r.id = refunds.registration_id
      AND om.user_id = auth.uid()
      AND om.role IN ('admin', 'owner')
  )
);

-- Admins have full access
CREATE POLICY "Admins full access to refunds"
ON refunds FOR ALL
USING (is_admin(auth.uid()));
