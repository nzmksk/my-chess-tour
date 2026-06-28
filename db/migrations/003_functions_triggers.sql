-- =============================================
-- UPDATED_AT TRIGGER
-- =============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'update_updated_at_column failed on %: % (SQLSTATE: %)', TG_TABLE_NAME, SQLERRM, SQLSTATE
      USING ERRCODE = 'P0001';
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
  INSERT INTO public.users (id, email, first_name, last_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  );

  INSERT INTO public.player_profiles (user_id)
  VALUES (NEW.id);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'handle_new_user failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE
      USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

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
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Check if user is a member of an organization (any role).
-- Used for RLS on organization_memberships to avoid infinite recursion.
CREATE OR REPLACE FUNCTION is_org_member(p_user_id uuid, p_org_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_memberships
    WHERE user_id = p_user_id AND organization_id = p_org_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Check if an organization is approved (and not soft-deleted). Used by the
-- tournament INSERT policy so the database enforces approval, not just the API.
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

  INSERT INTO public.audit_logs (table_name, record_id, action, changed_by, organization_id, context, old_data, new_data)
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
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'audit_trigger_func failed on % (%): % (SQLSTATE: %)', TG_TABLE_NAME, TG_OP, SQLERRM, SQLSTATE
      USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

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
-- Prevents over-registration via a row-level lock. A pending_payment seat is
-- only held for a limited window (the payment timeout); after it lapses the seat
-- stops counting toward capacity, so abandoned checkouts free their slot without
-- a scheduler. Enforced purely in Postgres so the lock guarantee holds.
-- =============================================

-- Shared capacity guard. Locks the tournament row, counts confirmed seats plus
-- pending_payment seats still inside the 10-minute hold window, and raises if at
-- capacity. p_exclude_registration_id lets a resume ignore its own row.
CREATE OR REPLACE FUNCTION assert_tournament_capacity(
  p_tournament_id           uuid,
  p_exclude_registration_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max     integer;
  v_current integer;
BEGIN
  SELECT max_participants INTO v_max
  FROM tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_current
  FROM registrations
  WHERE tournament_id = p_tournament_id
    AND (
      status = 'confirmed'
      OR (
        status = 'pending_payment'
        AND registered_at > now() - interval '10 minutes'
      )
    )
    AND (p_exclude_registration_id IS NULL OR id <> p_exclude_registration_id);

  IF v_current >= v_max THEN
    RAISE EXCEPTION 'Tournament is full (% / % participants)', v_current, v_max
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- INSERT-time capacity trigger delegates to the shared guard.
CREATE OR REPLACE FUNCTION check_tournament_capacity()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM assert_tournament_capacity(NEW.tournament_id);
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
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- =============================================
-- REVIEW ORGANIZATION APPLICATION
-- Called by the admin applications handler (service_role) to approve or reject
-- an organization application. Performs the status update and, on approval, the
-- creation of the applicant's owner membership atomically in one transaction:
--   p_action = 'approve' -> approval_status 'approved' + owner membership row
--   p_action = 'reject'  -> approval_status 'rejected' + rejection_reason set
-- Re-approving is idempotent: the owner membership is created at most once.
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
  END IF;

  RETURN jsonb_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'approval_status', v_new_status,
    'reviewed_at', v_reviewed_at
  );
END;
$$;

