-- =============================================
-- UPDATED_AT TRIGGER
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON player_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- AUTH SIGNUP TRIGGER
-- Creates user + player_profile on auth signup.
-- SECURITY DEFINER to bypass RLS.
-- =============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, password, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'password_hash', ''),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );

  INSERT INTO public.player_profiles (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================
-- RBAC HELPER FUNCTIONS
-- All SECURITY DEFINER to bypass RLS when called from policies.
-- =============================================

-- Check if user has a global-scope permission (e.g. platform admin)
CREATE OR REPLACE FUNCTION has_global_permission(p_user_id uuid, p_permission varchar(50))
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_global_roles ugr
    JOIN role_permissions rp ON rp.role_id = ugr.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE ugr.user_id = p_user_id
      AND p.key = p_permission
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user has permission within a specific organization
CREATE OR REPLACE FUNCTION has_org_permission(p_user_id uuid, p_org_id uuid, p_permission text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_memberships om
    JOIN role_permissions rp ON rp.role_id = om.role_id
    JOIN permissions p ON p.id = rp.permission_id
    WHERE om.user_id = p_user_id
      AND om.organization_id = p_org_id
      AND p.key = p_permission
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Check if user is a member of an organization (any role).
-- Used for RLS on organization_memberships to avoid infinite recursion.
CREATE OR REPLACE FUNCTION is_org_member(p_user_id uuid, p_org_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE user_id = p_user_id AND organization_id = p_org_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- =============================================
-- TOURNAMENT CAPACITY ENFORCEMENT
-- Prevents over-registration via row-level lock.
-- =============================================
CREATE OR REPLACE FUNCTION check_tournament_capacity()
RETURNS TRIGGER AS $$
DECLARE
  v_max  integer;
  v_current integer;
BEGIN
  SELECT max_participants INTO v_max
  FROM tournaments
  WHERE id = NEW.tournament_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_current
  FROM registrations
  WHERE tournament_id = NEW.tournament_id
    AND status IN ('pending_payment', 'confirmed');

  IF v_current >= v_max THEN
    RAISE EXCEPTION 'Tournament is full (% / % participants)', v_current, v_max
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_tournament_capacity
  BEFORE INSERT ON registrations
  FOR EACH ROW EXECUTE FUNCTION check_tournament_capacity();

-- =============================================
-- BULK PARTICIPANT COUNTS
-- Used by the tournaments list API.
-- =============================================
CREATE OR REPLACE FUNCTION get_participant_counts(tournament_ids uuid[])
RETURNS TABLE(tournament_id uuid, count bigint) AS $$
  SELECT tournament_id, COUNT(*)
  FROM registrations
  WHERE tournament_id = ANY(tournament_ids)
    AND status = 'confirmed'
  GROUP BY tournament_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
