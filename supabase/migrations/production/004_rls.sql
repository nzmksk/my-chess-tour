ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizer_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizer_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- Check if a user is a platform admin
CREATE OR REPLACE FUNCTION is_admin(user_id uuid)
RETURNS boolean AS $$
  SELECT 'admin' = ANY(role) FROM users WHERE id = user_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check user's role in an organization
CREATE OR REPLACE FUNCTION get_org_role(p_user_id uuid, p_org_id uuid)
RETURNS varchar AS $$
  SELECT role FROM organizer_members
  WHERE user_id = p_user_id AND organizer_id = p_org_id;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Users can read their own row
CREATE POLICY "Users can view own profile"
ON users FOR SELECT
USING (auth.uid() = id);

-- Users can update their own row
CREATE POLICY "Users can update own profile"
ON users FOR UPDATE
USING (auth.uid() = id);

-- Admins can view all users
CREATE POLICY "Admins can view all users"
ON users FOR SELECT
USING (is_admin(auth.uid()));

-- Players can read their own profile
CREATE POLICY "Players can view own profile"
ON player_profiles FOR SELECT
USING (auth.uid() = user_id);

-- Players can update their own profile
CREATE POLICY "Players can update own profile"
ON player_profiles FOR UPDATE
USING (auth.uid() = user_id);

-- Organizer members can view player profiles (for participant lists)
CREATE POLICY "Org members can view player profiles"
ON player_profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organizer_members WHERE user_id = auth.uid()
  )
);

-- Anyone can view approved organizers (public tournament pages show organizer info)
CREATE POLICY "Public can view approved organizers"
ON organizer_profiles FOR SELECT
USING (approval_status = 'approved');

-- Org members can view their own organization (even if pending)
CREATE POLICY "Members can view own org"
ON organizer_profiles FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organizer_members
    WHERE organizer_id = id AND user_id = auth.uid()
  )
);

-- Authenticated users can insert (apply as organizer)
CREATE POLICY "Authenticated users can apply"
ON organizer_profiles FOR INSERT
WITH CHECK (auth.role() = 'authenticated');

-- Org owners can update their organization
CREATE POLICY "Owners can update org"
ON organizer_profiles FOR UPDATE
USING (
  get_org_role(auth.uid(), id) = 'owner'
);

-- Admins have full access
CREATE POLICY "Admins full access to orgs"
ON organizer_profiles FOR ALL
USING (is_admin(auth.uid()));

-- Members can view their own org's members.
-- Uses get_org_role() (SECURITY DEFINER) to avoid infinite recursion:
-- a self-referential subquery here would trigger this policy again.
CREATE POLICY "Members can view org members"
ON organizer_members FOR SELECT
USING (
  get_org_role(auth.uid(), organizer_id) IS NOT NULL
);

-- Owners can manage members
CREATE POLICY "Owners can manage members"
ON organizer_members FOR ALL
USING (
  get_org_role(auth.uid(), organizer_id) = 'owner'
);

-- Allow insert for new applications (user creates their own owner row)
CREATE POLICY "Users can create own membership"
ON organizer_members FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Anyone can view published tournaments
CREATE POLICY "Public can view published tournaments"
ON tournaments FOR SELECT
USING (status = 'published');

-- Org members can view all their org's tournaments (including drafts)
CREATE POLICY "Org members can view own tournaments"
ON tournaments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organizer_members
    WHERE organizer_id = tournaments.organizer_id
    AND user_id = auth.uid()
  )
);

-- Org admins/owners can create tournaments
CREATE POLICY "Org admins can create tournaments"
ON tournaments FOR INSERT
WITH CHECK (
  get_org_role(auth.uid(), organizer_id) IN ('admin', 'owner')
);

-- Org admins/owners can update tournaments
CREATE POLICY "Org admins can update tournaments"
ON tournaments FOR UPDATE
USING (
  get_org_role(auth.uid(), organizer_id) IN ('admin', 'owner')
);

-- Admins have full access
CREATE POLICY "Admins full access to tournaments"
ON tournaments FOR ALL
USING (is_admin(auth.uid()));

-- Players can view their own registrations
CREATE POLICY "Players can view own registrations"
ON registrations FOR SELECT
USING (auth.uid() = user_id);

-- Players can create registrations
CREATE POLICY "Players can register"
ON registrations FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Players can cancel their own registrations
CREATE POLICY "Players can cancel own registration"
ON registrations FOR UPDATE
USING (auth.uid() = user_id);

-- Org members can view registrations for their tournaments
CREATE POLICY "Org members can view tournament registrations"
ON registrations FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tournaments t
    JOIN organizer_members om ON om.organizer_id = t.organizer_id
    WHERE t.id = registrations.tournament_id
    AND om.user_id = auth.uid()
  )
);

-- Admins full access
CREATE POLICY "Admins full access to registrations"
ON registrations FOR ALL
USING (is_admin(auth.uid()));

-- Players can view their own payments
CREATE POLICY "Players can view own payments"
ON payments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM registrations r
    WHERE r.id = payments.registration_id
    AND r.user_id = auth.uid()
  )
);

-- Org members can view payments for their tournaments
CREATE POLICY "Org members can view tournament payments"
ON payments FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM registrations r
    JOIN tournaments t ON t.id = r.tournament_id
    JOIN organizer_members om ON om.organizer_id = t.organizer_id
    WHERE r.id = payments.registration_id
    AND om.user_id = auth.uid()
  )
);

-- Admins full access
CREATE POLICY "Admins full access to payments"
ON payments FOR ALL
USING (is_admin(auth.uid()));

-- Note: Payment creation and status updates
-- should happen server-side (via service_role key)
-- through your API routes and CHIP webhooks,
-- not directly from the client.
-- The RLS policies below are primarily for reads.
-- Similar patterns — admins and relevant org members can view
CREATE POLICY "Admins full access to refunds"
ON refunds FOR ALL
USING (is_admin(auth.uid()));

CREATE POLICY "Admins full access to payouts"
ON payouts FOR ALL
USING (is_admin(auth.uid()));

-- Org admins/owners can view payouts for their org
CREATE POLICY "Org members can view own payouts"
ON payouts FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM organizer_members
    WHERE organizer_id = payouts.organizer_id
    AND user_id = auth.uid()
  )
);
