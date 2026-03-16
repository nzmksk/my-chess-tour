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
-- AUDIT TRAIL TRIGGER
-- Generic trigger for all audited tables.
-- TG_ARGV[0]: column name for record_id (defaults to 'id')
-- Resolves organization_id from source table for RLS scoping.
-- Reads app.audit_context session var for context tagging.
-- =============================================
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
  v_record_id  text;
  v_org_id     uuid;
  v_old        jsonb;
  v_new        jsonb;
  v_pk_col     text := COALESCE(TG_ARGV[0], 'id');
BEGIN
  -- Build row snapshots
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := row_to_json(OLD)::jsonb;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := row_to_json(NEW)::jsonb;
  END IF;

  -- Extract record_id from the appropriate column
  v_record_id := COALESCE(v_new, v_old) ->> v_pk_col;

  -- Resolve organization_id based on source table
  IF TG_TABLE_NAME = 'organizations' THEN
    v_org_id := v_record_id::uuid;
  ELSIF TG_TABLE_NAME IN ('organization_memberships', 'tournaments', 'payments') THEN
    v_org_id := (COALESCE(v_new, v_old) ->> 'organization_id')::uuid;
  ELSIF TG_TABLE_NAME = 'registrations' THEN
    SELECT t.organization_id INTO v_org_id
    FROM tournaments t
    WHERE t.id = (COALESCE(v_new, v_old) ->> 'tournament_id')::uuid;
  ELSIF TG_TABLE_NAME = 'refunds' THEN
    SELECT t.organization_id INTO v_org_id
    FROM registrations r JOIN tournaments t ON t.id = r.tournament_id
    WHERE r.id = (COALESCE(v_new, v_old) ->> 'registration_id')::uuid;
  END IF;
  -- users, player_profiles, user_global_roles → v_org_id stays NULL

  INSERT INTO audit_logs (table_name, record_id, action, changed_by, organization_id, context, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid,
    v_org_id,
    COALESCE(NULLIF(current_setting('app.audit_context', true), ''), 'trigger'),
    v_old,
    v_new
  );

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Strictly required: personal data, financial, access control
CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON player_profiles
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func('user_id');

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON organizations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON organization_memberships
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func('user_id');

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON user_global_roles
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func('user_id');

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Good practice: status transitions
CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON registrations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

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
