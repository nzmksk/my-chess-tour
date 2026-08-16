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

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organization_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tournament_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- AUTH SIGNUP TRIGGER
-- Creates user + player_profile on auth signup.
-- SECURITY DEFINER to bypass RLS.
-- =============================================
-- Self-signup keeps users.id = auth.users.id so no existing id changes meaning;
-- auth_user_id is written explicitly and is what every lookup goes through.
-- The two being equal here is an implementation detail of self-signup, NOT an
-- invariant — a record created for someone without a login (see #504) will have
-- a generated id and a NULL auth_user_id until it is claimed.
-- terms_version comes through raw_user_meta_data the same way the names do, but
-- the signup route puts it there from a server constant (src/lib/legal.ts), not
-- from the request body. Writing it here rather than in a follow-up UPDATE keeps
-- the acceptance in the same statement that creates the account, so there is no
-- window in which a user exists with no record of what they agreed to.
-- The timestamp is derived, never taken from metadata, and stays NULL when no
-- version was supplied so chk_terms_shape holds for rows created outside signup.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_terms_version varchar(20) := NULLIF(NEW.raw_user_meta_data->>'terms_version', '');
BEGIN
  INSERT INTO public.users (
    id, auth_user_id, email, first_name, last_name,
    terms_version, terms_accepted_at
  )
  VALUES (
    NEW.id,
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    v_terms_version,
    CASE WHEN v_terms_version IS NULL THEN NULL ELSE now() END
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

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- =============================================
-- IDENTITY RESOLUTION
-- The single bridge between Supabase Auth and public.users. Every RLS policy
-- and every helper below takes a public.users.id — auth.uid() must not be
-- passed to any of them directly.
-- =============================================

-- Resolve the caller's public.users.id from their auth session.
-- STABLE so Postgres evaluates it once per statement rather than once per row;
-- that is what keeps the added lookup off the hot path in policies that scan
-- registrations/payments.
-- Returns NULL when unauthenticated or when no users row is linked yet, which
-- makes every "= app_user_id()" comparison fail closed.
CREATE OR REPLACE FUNCTION app_user_id()
RETURNS uuid AS $$
  SELECT id FROM public.users WHERE auth_user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Can the caller act on behalf of p_user_id?
--
-- Today this is exactly the self check, so it is a pure rename of
-- "app_user_id() = user_id" with no behaviour change. It exists as a seam: when
-- guardianships arrive (#504) this function body grows an OR and every policy
-- using it widens at once, instead of another sweep across every policy.
--
-- DO NOT use this for organization_memberships, user_global_roles, or any
-- admin-scoped policy. Those are deliberately self-only and must NOT widen when
-- this body changes — see the comments at each of those policies in 004_rls.sql.
CREATE OR REPLACE FUNCTION can_act_for(p_user_id uuid)
RETURNS boolean AS $$
  SELECT p_user_id = app_user_id();
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- =============================================
-- IDENTITY COLUMN GUARD
--
-- auth_user_id is the only bridge between Supabase Auth and this schema, and id
-- is the value every other table's FK points at. Neither may be rewritten by an
-- end-user session: nulling auth_user_id orphans the record (app_user_id() then
-- resolves to NULL forever), and repointing it is an account-takeover primitive
-- the moment managed records exist (#504/#505).
--
-- 004_rls.sql already revokes client UPDATE on users, so this is defence in
-- depth — it holds even if a policy or grant is re-added carelessly later. RLS
-- and grants are the door; this is the lock on the specific thing that matters.
--
-- auth.uid() IS NOT NULL means a user JWT is driving the statement. The
-- service-role client and SECURITY DEFINER functions (handle_new_user, and the
-- future claim flow) have no `sub`, so legitimate server-side writes pass.
-- =============================================
CREATE OR REPLACE FUNCTION guard_users_identity_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'users.id is immutable'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'users.auth_user_id cannot be changed by a client session'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER guard_identity_columns
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION guard_users_identity_columns();

-- =============================================
-- RBAC HELPER FUNCTIONS
-- All SECURITY DEFINER to bypass RLS when called from policies.
-- All take a public.users.id — pass app_user_id(), never auth.uid().
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
-- AUDIT SNAPSHOT REDACTION
-- audit_logs stores full row snapshots, so any sensitive column is copied
-- verbatim into a table that outlives the row it came from. This masks the
-- listed keys down to a last-4 suffix, keeping the snapshot useful for
-- "did this value change?" without retaining the secret itself.
-- Keys absent from the row are ignored; NULL values stay NULL so the audit
-- trail still distinguishes "cleared" from "set to something".
-- =============================================
CREATE OR REPLACE FUNCTION redact_jsonb_columns(p_data jsonb, p_cols text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_data IS NULL THEN NULL
    ELSE (
      SELECT jsonb_object_agg(
        e.key,
        CASE
          WHEN e.key = ANY(p_cols) AND jsonb_typeof(e.value) = 'string'
            THEN to_jsonb('****' || right(e.value #>> '{}', 4))
          ELSE e.value
        END
      )
      FROM jsonb_each(p_data) AS e(key, value)
    )
  END;
$$;

-- =============================================
-- AUDIT TRAIL TRIGGER
-- Generic trigger for all audited tables.
-- TG_ARGV[0]: column name for record_id (defaults to 'id')
-- Resolves organization_id from source table for RLS scoping.
-- Reads app.audit_context session var for context tagging.
-- Sensitive columns are redacted per-table before the snapshot is written.
-- =============================================
CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
  v_record_id  text;
  v_org_id     uuid;
  v_old        jsonb;
  v_new        jsonb;
  v_changed_by uuid;
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

  -- Redact sensitive columns before the snapshot is persisted. Done after
  -- record_id extraction so a redacted column can never be the PK. Without this
  -- every bank-account write is copied verbatim into audit_logs, which is
  -- retained far longer than the row itself.
  IF TG_TABLE_NAME = 'player_profiles' THEN
    v_old := redact_jsonb_columns(v_old, ARRAY['bank_account_number', 'oku_document_path']);
    v_new := redact_jsonb_columns(v_new, ARRAY['bank_account_number', 'oku_document_path']);
  ELSIF TG_TABLE_NAME = 'organization_bank_accounts' THEN
    v_old := redact_jsonb_columns(v_old, ARRAY['account_number']);
    v_new := redact_jsonb_columns(v_new, ARRAY['account_number']);
  ELSIF TG_TABLE_NAME = 'organization_documents' THEN
    -- storage_path is capability-bearing: anyone holding it can be issued a
    -- signed URL to a private-bucket identity document. The last-4 suffix that
    -- survives redaction is the file extension, which reveals nothing.
    v_old := redact_jsonb_columns(v_old, ARRAY['storage_path']);
    v_new := redact_jsonb_columns(v_new, ARRAY['storage_path']);
  END IF;

  -- Resolve organization_id based on source table
  IF TG_TABLE_NAME = 'organizations' THEN
    v_org_id := v_record_id::uuid;
  ELSIF TG_TABLE_NAME IN (
    'organization_memberships', 'tournaments', 'payments',
    'organization_bank_accounts', 'organization_documents'
  ) THEN
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

  -- changed_by is a FK to users(id), but the JWT carries the AUTH id, so it has
  -- to be resolved through users.auth_user_id. Reading the claim directly would
  -- write an id that only coincidentally resolves while self-signup keeps the
  -- two equal, and would violate the FK the moment they diverge.
  -- Not app_user_id(): this trigger also fires under the service role and from
  -- SECURITY DEFINER functions, where auth.uid() is NULL — reading the claim
  -- keeps attribution working in those paths, and NULL means "no user acted".
  SELECT u.id INTO v_changed_by
  FROM public.users u
  WHERE u.auth_user_id =
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;

  INSERT INTO public.audit_logs (table_name, record_id, action, changed_by, organization_id, context, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    v_changed_by,
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

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON organization_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON organization_documents
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

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

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON tournament_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- =============================================
-- TOURNAMENT EDIT FREEZE (money fields)
-- entry_fees/prizes/max_participants and the commission split define what a
-- player is buying. Once anyone has paid, changing them rewrites a concluded
-- transaction — and moving `prizes` also shifts the payout holdback under a
-- tournament that is already selling.
--
-- The PATCH route returns the readable 409 (naming the rejected fields); this
-- trigger is the authority, so the rule holds for any writer including the
-- service role and the SQL editor. Same belt-and-braces posture as
-- settle_registration_payment's amount guard.
--
-- The "tournament has started" half of the freeze is NOT enforced here: it
-- depends on today-in-the-venue-timezone, and pinning that in the DB would
-- duplicate getTodayInTimeZone() with a second, drifting definition. It lives
-- in the route only.
--
-- Deliberately allows the write when the value is unchanged, so a client that
-- re-submits the whole form without touching money fields still succeeds.
-- =============================================
CREATE OR REPLACE FUNCTION guard_tournament_money_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed text[] := ARRAY[]::text[];
BEGIN
  IF NEW.entry_fees IS DISTINCT FROM OLD.entry_fees THEN
    v_changed := v_changed || 'entry_fees';
  END IF;
  IF NEW.prizes IS DISTINCT FROM OLD.prizes THEN
    v_changed := v_changed || 'prizes';
  END IF;
  IF NEW.max_participants IS DISTINCT FROM OLD.max_participants THEN
    v_changed := v_changed || 'max_participants';
  END IF;
  IF NEW.commission_rate IS DISTINCT FROM OLD.commission_rate THEN
    v_changed := v_changed || 'commission_rate';
  END IF;
  IF NEW.organizer_commission_pct IS DISTINCT FROM OLD.organizer_commission_pct THEN
    v_changed := v_changed || 'organizer_commission_pct';
  END IF;

  IF array_length(v_changed, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM payments p
    WHERE p.tournament_id = NEW.id
      AND p.type = 'registration'
      AND p.status = 'paid'
  ) THEN
    RAISE EXCEPTION
      'tournament % has paid registrations; these fields are locked: %',
      NEW.id, array_to_string(v_changed, ', ')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_money_fields BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION guard_tournament_money_fields();

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
-- SET ORGANIZATION BANK ACCOUNT
-- The ONLY write path for organization_bank_accounts (004_rls.sql revokes
-- INSERT/UPDATE/DELETE from anon and authenticated).
--
-- Changing payout details must force re-verification, so this SUPERSEDES rather
-- than updates: the current active row is deactivated and a fresh 'pending' row
-- is inserted, in one transaction under a lock on the organization row. That
-- pairing is what guarantees uniq_active_bank_account_per_org (002_indexes.sql)
-- never sees two active rows, and it leaves the superseded row intact so a
-- payout can still name the account it was actually sent to.
--
-- A re-save that changes nothing is a no-op, returning {"changed": false} and
-- the existing row. Two states qualify:
--   'verified' — re-inserting would destroy a completed verification.
--   'pending'  — the row's own id is the CHIP Send `reference` for an
--                in-flight registration; superseding it orphans that attempt.
-- 'rejected' deliberately does NOT qualify: an unchanged re-save there is an
-- organizer retrying after fixing something at their bank, and they need a new
-- row (and therefore a new CHIP reference) to retry against.
--
-- A uniq_active_bank_destination collision raises 23505 uncaught, on purpose —
-- callers translate it, because "this account is already another organization's
-- payout destination" is a 409, not a failure of this function.
-- =============================================
CREATE OR REPLACE FUNCTION set_organization_bank_account(
  p_org_id         uuid,
  p_bank_code      varchar(11),
  p_bank_name      varchar(100),
  p_account_holder varchar(255),
  p_account_number varchar(50),
  p_actor_id       uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current organization_bank_accounts;
  v_row     organization_bank_accounts;
  v_changed boolean := true;
BEGIN
  -- Lock the organization so concurrent saves serialize; without it two
  -- requests could both deactivate and both insert.
  PERFORM 1 FROM organizations
    WHERE id = p_org_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_current
    FROM organization_bank_accounts
    WHERE organization_id = p_org_id AND is_active;

  IF FOUND
     AND v_current.bank_code      = p_bank_code
     AND v_current.bank_name      = p_bank_name
     AND v_current.account_holder = p_account_holder
     AND v_current.account_number = p_account_number
     AND v_current.status <> 'rejected'
  THEN
    v_changed := false;
    v_row     := v_current;
  ELSE
    UPDATE organization_bank_accounts
      SET is_active = false
      WHERE organization_id = p_org_id AND is_active;

    INSERT INTO organization_bank_accounts (
      organization_id, bank_name, bank_code, account_holder, account_number, created_by
    ) VALUES (
      p_org_id, p_bank_name, p_bank_code, p_account_holder, p_account_number, p_actor_id
    )
    RETURNING * INTO v_row;
  END IF;

  -- Masked, like every other surface that touches this value. The full account
  -- number does not leave the table.
  RETURN jsonb_build_object(
    'changed',              v_changed,
    'id',                   v_row.id,
    'bank_name',            v_row.bank_name,
    'bank_code',            v_row.bank_code,
    'account_holder',       v_row.account_holder,
    'account_number_last4', right(v_row.account_number, 4),
    'status',               v_row.status,
    'rejection_reason',     v_row.rejection_reason,
    'verified_at',          v_row.verified_at
  );
END;
$$;

-- =============================================
-- CREATE ORGANIZATION APPLICATION
-- Creates the organization, its payout bank account, its KYB document rows and
-- its agreement stamp in ONE transaction.
--
-- This replaced a read-then-insert in the API route. Two things were wrong with
-- that: the ILIKE name pre-check lost a concurrent race, and once bank details
-- and documents were added, a failure partway through would leave the
-- organization created — and its name taken — with no way for the applicant to
-- retry. All or nothing is the only correct shape here.
--
-- The entity rule is enforced HERE, not only in the route, so it cannot be
-- bypassed by calling the RPC directly.
--
-- Failures RAISE with a stable sentinel prefix so the route can map them to
-- distinct HTTP codes; same approach as the "Tournament is full" message the
-- checkout route matches on.
-- =============================================
CREATE OR REPLACE FUNCTION create_organization_application(
  p_created_by          uuid,
  p_name                varchar(255),
  p_email               varchar(255),
  p_entity_type         org_entity_type,
  p_agreement_version   varchar(20),
  p_bank_code           varchar(11),
  p_bank_name           varchar(100),
  p_account_holder      varchar(255),
  p_account_number      varchar(50),
  p_documents           jsonb,
  p_description         text    DEFAULT NULL,
  p_links               jsonb   DEFAULT NULL,
  p_phone               varchar(20) DEFAULT NULL,
  p_past_tournament_refs text   DEFAULT NULL,
  p_registration_number varchar(100) DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id    uuid;
  v_docs      jsonb := COALESCE(p_documents, '[]'::jsonb);
  v_reg_no    varchar(100);
  v_accepted  timestamptz := now();
BEGIN
  IF p_entity_type IS NULL THEN
    RAISE EXCEPTION 'ENTITY_DOCS_REQUIRED: an entity type is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_entity_type IN ('company', 'society') THEN
    v_reg_no := NULLIF(btrim(p_registration_number), '');

    IF v_reg_no IS NULL THEN
      RAISE EXCEPTION 'ENTITY_DOCS_REQUIRED: a % must supply its registration number', p_entity_type
        USING ERRCODE = 'P0001';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_docs) d
      WHERE d->>'doc_type' IN ('ssm', 'ros')
    ) THEN
      RAISE EXCEPTION 'ENTITY_DOCS_REQUIRED: a % must supply an SSM or ROS document', p_entity_type
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- An individual has no registry entry to cite. Normalised to NULL rather
    -- than rejected, so the column means exactly one thing.
    v_reg_no := NULL;

    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_docs) d
      WHERE d->>'doc_type' IN ('identity_document', 'authorization_letter')
    ) THEN
      RAISE EXCEPTION 'ENTITY_DOCS_REQUIRED: an individual organizer must supply an identity document or authorization letter'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  BEGIN
    INSERT INTO organizations (
      name, description, links, email, phone, past_tournament_refs,
      entity_type, registration_number, created_by,
      agreement_version, agreement_accepted_at, agreement_accepted_by
    ) VALUES (
      p_name, p_description, p_links, p_email, p_phone, p_past_tournament_refs,
      p_entity_type, v_reg_no, p_created_by,
      p_agreement_version, v_accepted, p_created_by
    )
    RETURNING id INTO v_org_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- idx_organizations_name_active (002_indexes.sql). Catching the index
      -- rather than pre-checking is what makes this race-free.
      RAISE EXCEPTION 'NAME_TAKEN: an organization with this name already exists'
        USING ERRCODE = 'P0001';
  END;

  BEGIN
    PERFORM set_organization_bank_account(
      v_org_id, p_bank_code, p_bank_name, p_account_holder, p_account_number, p_created_by
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- uniq_active_bank_destination (002_indexes.sql).
      RAISE EXCEPTION 'BANK_ACCOUNT_IN_USE: this bank account is already the payout destination for another organization'
        USING ERRCODE = 'P0001';
  END;

  INSERT INTO organization_documents (
    organization_id, doc_type, storage_path, original_filename, uploaded_by
  )
  SELECT
    v_org_id,
    (d->>'doc_type')::org_document_type,
    d->>'storage_path',
    NULLIF(d->>'original_filename', ''),
    p_created_by
  FROM jsonb_array_elements(v_docs) d;

  RETURN jsonb_build_object(
    'id',                    v_org_id,
    'name',                  p_name,
    'approval_status',       'pending',
    'entity_type',           p_entity_type,
    'registration_number',   v_reg_no,
    'agreement_version',     p_agreement_version,
    'agreement_accepted_at', v_accepted
  );
END;
$$;

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

-- =============================================
-- REVIEW TOURNAMENT CANCELLATION
-- Platform admin approves/rejects an organizer's request to cancel a published
-- tournament. Approve → the request is marked 'approved', the tournament is
-- flipped to 'cancelled', AND a pending refund row is created for every confirmed
-- (paid) registration — all atomically, so the refund to-do list is durable the
-- instant the cancellation commits. Reject → the request is marked 'rejected'
-- with a reason and the tournament stays published. The refund rows are only
-- created here; the actual CHIP refund + type='refund' ledger row are executed
-- afterwards by the app (see initiateCancellationRefunds) and settled by
-- settle_refund (007_payment_functions.sql) — a network call can't run in this
-- transaction.
-- =============================================
CREATE OR REPLACE FUNCTION review_tournament_cancellation(
  p_request_id        uuid,
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
  v_request      tournament_cancellation_requests;
  v_new_status   approval_status;
  v_reviewed_at  timestamptz := now();
BEGIN
  -- Lock the request row so concurrent reviews serialize.
  SELECT * INTO v_request
    FROM tournament_cancellation_requests
    WHERE id = p_request_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancellation request % not found', p_request_id USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'cancellation request % already reviewed', p_request_id USING ERRCODE = 'P0001';
  END IF;

  v_new_status := CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END;

  UPDATE tournament_cancellation_requests
    SET status           = v_new_status,
        reviewed_by      = p_reviewer_id,
        reviewed_at      = v_reviewed_at,
        rejection_reason = CASE WHEN p_action = 'reject' THEN p_rejection_reason ELSE NULL END
    WHERE id = p_request_id;

  IF p_action = 'approve' THEN
    UPDATE tournaments
      SET status = 'cancelled'
      WHERE id = v_request.tournament_id;

    -- Queue a full refund for every confirmed (paid) player. The amount is the
    -- gross the player actually paid, sourced from their current (paid)
    -- registration payment. pending_payment/failed/cancelled players never paid,
    -- and forfeited players explicitly get no refund — so they're excluded.
    -- ON CONFLICT makes this idempotent against uniq_active_refund_per_registration
    -- (002_indexes.sql): a live refund already exists → leave it untouched.
    INSERT INTO refunds (
      registration_id, refund_amount_cents, reason, status, requested_by, requested_at
    )
    SELECT r.id, p.gross_amount_cents, 'tournament_cancelled', 'pending', p_reviewer_id, v_reviewed_at
    FROM registrations r
    JOIN payments p ON p.id = r.current_payment_id
    WHERE r.tournament_id = v_request.tournament_id
      AND r.status = 'confirmed'
      AND p.type = 'registration'
      AND p.status = 'paid'
    ON CONFLICT (registration_id) WHERE (status <> 'rejected') DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'id', v_request.id,
    'tournament_id', v_request.tournament_id,
    'status', v_new_status,
    'reviewed_at', v_reviewed_at
  );
END;
$$;
