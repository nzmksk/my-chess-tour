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

CREATE TRIGGER set_updated_at BEFORE UPDATE ON payouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON player_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON prize_fundings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON prize_funder_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON prize_awards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organization_registered_names
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- AUTH SIGNUP TRIGGER
-- Creates user + player_profile on auth signup.
-- SECURITY DEFINER to bypass RLS.
-- =============================================
-- Self-signup keeps users.id = auth.users.id so no existing id changes meaning;
-- auth_user_id is written explicitly and is what every lookup goes through.
-- The two being equal here is an implementation detail of self-signup, NOT an
-- invariant — a record created for someone without a login (a dependent, #712)
-- has a generated id and a NULL auth_user_id until it is claimed.
-- date_of_birth (#710) comes through the metadata too and lands in
-- player_profiles in the same statement; an under-18 date is refused here as
-- well as in the signup route (UNDER_18), so an account created another way (a
-- direct Auth API call) can't carry one either.
-- Account claims (#720): a new auth user whose metadata carries
-- claim_token_hash never gets a users row of its own. The INSERT is refused
-- unless the hash names a pending, unexpired claim for the same mailbox
-- (CLAIM_INVALID, CLAIM_EMAIL_MISMATCH), and if the user is created already
-- confirmed, link_claimed_account binds the dependent's existing row instead.
-- terms_version comes through raw_user_meta_data the same way the names do, but
-- the signup route puts it there from a server constant (src/lib/reference/legal.ts), not
-- from the request body. Writing it here rather than in a follow-up UPDATE keeps
-- the acceptance in the same statement that creates the account, so there is no
-- window in which a user exists with no record of what they agreed to.
-- The timestamp is derived, never taken from metadata, and stays NULL when no
-- version was supplied so chk_terms_shape holds for rows created outside signup.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_terms_version varchar(20) := NULLIF(NEW.raw_user_meta_data->>'terms_version', '');
  v_date_of_birth date        := NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '')::date;
  v_claim_hash    text        := NULLIF(NEW.raw_user_meta_data->>'claim_token_hash', '');
  v_claim_email   text;
BEGIN
  IF v_claim_hash IS NOT NULL THEN
    SELECT email INTO v_claim_email
      FROM account_claims
      WHERE token_hash = v_claim_hash
        AND status = 'pending'
        AND expires_at > now();
    IF NOT FOUND THEN
      RAISE EXCEPTION 'CLAIM_INVALID: this handover link is no longer valid'
        USING ERRCODE = 'P0001';
    END IF;
    IF canonical_email(NEW.email) IS DISTINCT FROM canonical_email(v_claim_email) THEN
      RAISE EXCEPTION 'CLAIM_EMAIL_MISMATCH: the account must use the address the link was sent to'
        USING ERRCODE = 'P0001';
    END IF;

    IF NEW.email_confirmed_at IS NOT NULL THEN
      PERFORM link_claimed_account(NEW.id, NEW.email, NEW.email_confirmed_at,
                                   v_claim_hash, v_terms_version);
    END IF;
    RETURN NEW;
  END IF;

  IF v_date_of_birth >
     ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date THEN
    RAISE EXCEPTION 'UNDER_18: an account holder must be 18 or over; under-18s take part through a parent or guardian''s account'
      USING ERRCODE = 'P0001';
  END IF;

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

  INSERT INTO public.player_profiles (user_id, date_of_birth)
  VALUES (NEW.id, v_date_of_birth);

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
-- CANONICAL EMAIL
-- =============================================
-- The mailbox an address reaches (#286), so test@gmail.com, test+123@gmail.com
-- and t.e.s.t@googlemail.com count as one:
--   - lower-cased and trimmed
--   - a "+tag" sub-address dropped, on every domain (Gmail, Outlook, iCloud,
--     Fastmail, Proton and Google Workspace all deliver it to the base address)
--   - for gmail.com / googlemail.com only: dots dropped, and googlemail.com
--     read as gmail.com
CREATE OR REPLACE FUNCTION canonical_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  v_email  text := lower(btrim(p_email));
  v_at     int;
  v_local  text;
  v_domain text;
BEGIN
  IF strpos(v_email, '@') = 0 THEN
    RETURN v_email;
  END IF;

  v_at     := length(v_email) - strpos(reverse(v_email), '@') + 1;
  v_local  := left(v_email, v_at - 1);
  v_domain := substr(v_email, v_at + 1);

  IF strpos(v_local, '+') > 1 THEN
    v_local := split_part(v_local, '+', 1);
  END IF;

  IF v_domain IN ('gmail.com', 'googlemail.com') THEN
    v_local  := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  END IF;

  RETURN v_local || '@' || v_domain;
END;
$$;

-- =============================================
-- SET USERS EMAIL CANONICAL
-- =============================================
-- Keeps users.email_canonical in step with users.email. Fires on INSERT and on
-- UPDATE OF email only. email_canonical is personal data like email, and
-- anonymise_user_audit_logs strips it from audit history.
CREATE OR REPLACE FUNCTION set_users_email_canonical()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email_canonical := canonical_email(NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_email_canonical
  BEFORE INSERT OR UPDATE OF email ON users
  FOR EACH ROW EXECUTE FUNCTION set_users_email_canonical();

-- =============================================
-- EMAIL REGISTERED
-- =============================================
-- Whether an active account already uses the mailbox p_email reaches. The
-- signup route asks before creating the auth user, so a variant gets the usual
-- "already exists" answer instead of failing inside handle_new_user.
CREATE OR REPLACE FUNCTION email_registered(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users
    WHERE email_canonical = canonical_email(p_email)
      AND deleted_at IS NULL
  );
$$;

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

-- Can the caller act on behalf of p_user_id? Yes for themselves, and for a
-- dependent they hold an 'active' guardianship of (#707). A revoked or claimed
-- guardianship stops counting the moment its status changes. Every policy that
-- calls it widens at once: a guardian reads a dependent's player_profiles
-- (and writes them), registrations, payments, refunds, player_bank_accounts,
-- sensitive_data_consents, prize_awards and OKU documents.
--
-- One direction only: a dependent with a login of their own doesn't gain sight
-- of the guardian's data. SECURITY DEFINER, so it reads guardianships without
-- that table's RLS, which compares app_user_id() directly so a guardian can't
-- see other guardians' rows for the same dependent.
--
-- DO NOT use this for organization_memberships, user_global_roles, or any
-- admin-scoped policy. Those are deliberately self-only and must NOT widen when
-- this body changes — see the comments at each of those policies in 004_rls.sql.
CREATE OR REPLACE FUNCTION can_act_for(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p_user_id = app_user_id()
      OR EXISTS (SELECT 1 FROM guardianships g
                 WHERE g.guardian_user_id = app_user_id()
                   AND g.dependent_user_id = p_user_id
                   AND g.status = 'active');
$$;

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

-- Who to alert when something needs a platform admin (an early payout to review,
-- a payout parked on CHIP Send budget): every live account holding the given
-- global permission. Server-only, see the privileges block at the end.
CREATE OR REPLACE FUNCTION list_global_permission_holders(p_permission varchar(50))
RETURNS TABLE (user_id uuid, email varchar(255), first_name varchar(255)) AS $$
  SELECT DISTINCT u.id, u.email, u.first_name
  FROM user_global_roles ugr
  JOIN role_permissions rp ON rp.role_id = ugr.role_id
  JOIN permissions p ON p.id = rp.permission_id
  JOIN users u ON u.id = ugr.user_id
  WHERE p.key = p_permission
    AND u.deleted_at IS NULL;
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
--
-- Idempotent: a value already in masked form ('****' plus at most 4 characters)
-- is left alone, so re-applying it to rows that are already redacted changes
-- nothing. Without that, a short value would gain stars on every pass
-- ('****ab' -> '******ab').
-- The shape test cannot be used to smuggle a raw value past redaction: anything
-- that passes it already shows no more than the 4 characters masking would keep.
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
               AND (e.value #>> '{}') !~ '^\*{4}.{0,4}$'
            THEN to_jsonb('****' || right(e.value #>> '{}', 4))
          ELSE e.value
        END
      )
      FROM jsonb_each(p_data) AS e(key, value)
    )
  END;
$$;

-- Filenames and storage paths need their own rule. Keeping the last 4
-- characters is only "just the extension" when the name ends in one: an upload
-- called "MyKad 880101-14-5678" would keep the last four IC digits, and
-- everything after the users/<id>/ prefix of a path is chosen by the client.
-- So the only thing that survives is an extension the buckets actually accept
-- (png/jpg/jpeg/webp/pdf, the allowed_mime_types in 005), lower-cased;
-- anything else masks to a bare '****'.
-- Idempotent by construction: the output depends only on that extension, and
-- the masked value still carries it.
CREATE OR REPLACE FUNCTION redact_jsonb_filenames(p_data jsonb, p_cols text[])
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
            THEN to_jsonb('****' || COALESCE(
              '.' || substring(lower(e.value #>> '{}') FROM '\.(png|jpe?g|webp|pdf)$'),
              ''))
          ELSE e.value
        END
      )
      FROM jsonb_each(p_data) AS e(key, value)
    )
  END;
$$;

-- What gets redacted in each audited table's snapshot: the one place that
-- decides it, called by audit_trigger_func on the way in. Tables not listed come
-- back unchanged. Any new sensitive column belongs here in the same PR that
-- adds the column.
--   player_profiles.bank_account_number (a column since moved to
--     player_bank_accounts, kept for rows written before), organization_bank_accounts.
--     account_number, player_bank_accounts.account_number: masked to the last 4 digits.
--   player_profiles.oku_document_path, organization_documents.storage_path:
--     capability-bearing; anyone holding one can be issued a signed URL to a
--     private-bucket document. Filename rule: only the extension survives.
--   organization_documents.original_filename: whatever the uploader called the
--     file, which for an identity document is often the IC number or full name
--     ("MyKad_880101-14-5678.pdf"). Filename rule.
CREATE OR REPLACE FUNCTION redact_audit_snapshot(p_table_name text, p_data jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_table_name
    WHEN 'player_profiles' THEN
      redact_jsonb_filenames(
        redact_jsonb_columns(p_data, ARRAY['bank_account_number']),
        ARRAY['oku_document_path'])
    WHEN 'organization_bank_accounts' THEN
      redact_jsonb_columns(p_data, ARRAY['account_number'])
    WHEN 'player_bank_accounts' THEN
      redact_jsonb_columns(p_data, ARRAY['account_number'])
    WHEN 'organization_documents' THEN
      redact_jsonb_filenames(p_data, ARRAY['storage_path', 'original_filename'])
    WHEN 'organization_invitations' THEN
      redact_jsonb_columns(p_data, ARRAY['token_hash'])
    ELSE p_data
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
  v_claims     jsonb := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  v_headers    jsonb;
  v_actor      text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := row_to_json(OLD)::jsonb;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := row_to_json(NEW)::jsonb;
  END IF;

  IF TG_OP = 'UPDATE'
     AND TG_TABLE_NAME = 'registrations'
     AND (v_old - 'current_payment_id') = (v_new - 'current_payment_id') THEN
    RETURN NEW;
  END IF;

  v_record_id := COALESCE(v_new, v_old) ->> v_pk_col;

  v_old := redact_audit_snapshot(TG_TABLE_NAME, v_old);
  v_new := redact_audit_snapshot(TG_TABLE_NAME, v_new);

  IF TG_TABLE_NAME = 'organizations' THEN
    v_org_id := v_record_id::uuid;
  ELSIF TG_TABLE_NAME IN (
    'organization_memberships', 'tournaments', 'payments', 'payouts',
    'organization_bank_accounts', 'organization_documents', 'prize_awards',
    'organization_invitations'
  ) THEN
    v_org_id := (COALESCE(v_new, v_old) ->> 'organization_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('registrations', 'prize_fundings') THEN
    SELECT t.organization_id INTO v_org_id
    FROM tournaments t
    WHERE t.id = (COALESCE(v_new, v_old) ->> 'tournament_id')::uuid;
  ELSIF TG_TABLE_NAME = 'refunds' THEN
    SELECT t.organization_id INTO v_org_id
    FROM registrations r JOIN tournaments t ON t.id = r.tournament_id
    WHERE r.id = (COALESCE(v_new, v_old) ->> 'registration_id')::uuid;
  END IF;

  IF v_claims ->> 'role' = 'service_role' THEN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  END IF;

  SELECT u.id INTO v_changed_by
  FROM public.users u
  WHERE u.auth_user_id = NULLIF(v_claims ->> 'sub', '')::uuid;

  IF v_changed_by IS NULL THEN
    v_actor := COALESCE(
      NULLIF(current_setting('app.audit_actor', true), ''),
      v_headers ->> 'x-audit-actor'
    );
    IF v_actor ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT u.id INTO v_changed_by FROM public.users u WHERE u.id = v_actor::uuid;
    END IF;
  END IF;

  INSERT INTO public.audit_logs (table_name, record_id, action, changed_by, organization_id, context, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    v_changed_by,
    v_org_id,
    left(COALESCE(
      NULLIF(current_setting('app.audit_context', true), ''),
      NULLIF(v_headers ->> 'x-audit-context', ''),
      'trigger'
    ), 100),
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

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON payouts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON player_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON prize_fundings
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON prize_awards
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Good practice: status transitions
CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON registrations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON tournament_cancellation_requests
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON organization_invitations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- Guardianships, helper invitations and account claims are the record of who
-- was allowed to act, and pay, for whom: audited, and never pruned
-- (audit_log_retention leaves them out).
CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON guardianships
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON helper_invitations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON account_claims
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- =============================================
-- ACCOUNT DELETION: AUDIT-LOG ANONYMISATION (#503)
--
-- Deleting or anonymising a users / player_profiles row does not reach
-- audit_logs: every write to those tables left a full snapshot behind (email,
-- name, DOB, gender, nationality, FIDE/MCF ids, bank holder, OKU status and the
-- admin's free-text rejection reason). /privacy promises personal data is gone
-- within 30 days of a deletion request, so the deletion runbook
-- (wiki/account-deletion.md) ends by calling this.
--
-- What it does, for one user:
--   1. In that user's own users / player_profiles / player_bank_accounts audit
--      rows, every snapshot key
--      except an allowlist of ids, flags and timestamps becomes '[anonymised]'.
--      The rows stay, so the history of WHEN the account changed survives.
--      An allowlist rather than a list of PII columns: a column added later is
--      anonymised by default instead of leaking until someone remembers it.
--   2. Rows the user authored (changed_by) keep everything except the
--      reference, which is set to NULL. The FK is ON DELETE SET NULL, so a
--      hard delete of the users row does this by itself; this covers a soft
--      delete, where the row survives.
--
-- What it deliberately leaves alone: payments, refunds, payouts, prize awards,
-- prize fundings and registrations audit rows, including their changed_by. They are financial
-- records under the 7-year obligation, which overrides the deletion request.
-- Their snapshots hold ids and amounts, not profile data, and once the account
-- is deleted a changed_by there resolves to nothing personal.
--
-- Run it LAST, in the same transaction as the delete/anonymise. Any later write
-- to the user's rows writes a fresh snapshot, and the delete itself writes one
-- carrying the full pre-delete row. It refuses an account that still has
-- deleted_at NULL, so it cannot strip the history of a live account by mistake.
-- Re-running it is safe; a second call reports zero rows.
-- =============================================
CREATE OR REPLACE FUNCTION anonymise_jsonb_except(p_data jsonb, p_keep text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_data IS NULL THEN NULL
    ELSE (
      SELECT jsonb_object_agg(
        e.key,
        CASE WHEN e.key = ANY(p_keep) THEN e.value ELSE to_jsonb('[anonymised]'::text) END
      )
      FROM jsonb_each(p_data) AS e(key, value)
    )
  END;
$$;

CREATE OR REPLACE FUNCTION anonymise_user_audit_logs(p_user_id uuid)
RETURNS TABLE (snapshots_anonymised integer, changed_by_cleared integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  c_keep_users           constant text[] := ARRAY[
    'id', 'is_verified', 'verified_at', 'terms_version', 'terms_accepted_at',
    'created_at', 'updated_at', 'deleted_at'
  ];
  c_keep_player_profiles constant text[] := ARRAY['user_id', 'created_at', 'updated_at'];
  -- The account number is already masked to its last 4 on the way in; the
  -- holder's name and the bank are what is left to strip.
  c_keep_player_bank     constant text[] := ARRAY[
    'id', 'user_id', 'status', 'is_active', 'verified_at', 'created_at', 'updated_at'
  ];
  -- The address is what identifies the invitee; token_hash is already masked
  -- and goes too.
  c_keep_invitations     constant text[] := ARRAY[
    'id', 'organization_id', 'role_id', 'status', 'invited_by', 'created_at',
    'expires_at', 'responded_at', 'responded_by'
  ];
  c_financial            constant text[] := ARRAY[
    'payments', 'refunds', 'payouts', 'registrations', 'prize_awards', 'prize_fundings'
  ];
  v_bank_rows            integer;
  v_invitation_rows      integer;
  v_emails               text[];
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'USER_NOT_DELETED'
      USING ERRCODE = 'P0001',
            DETAIL  = 'Delete the users row, or set deleted_at, before anonymising its audit history.';
  END IF;

  -- Every address the account has had, while the users snapshots still say.
  SELECT array_agg(DISTINCT lower(e.email)) INTO v_emails
  FROM (
    SELECT a.old_data ->> 'email' AS email
      FROM audit_logs a WHERE a.table_name = 'users' AND a.record_id = p_user_id::text
    UNION ALL
    SELECT a.new_data ->> 'email'
      FROM audit_logs a WHERE a.table_name = 'users' AND a.record_id = p_user_id::text
    UNION ALL
    SELECT u.email FROM users u WHERE u.id = p_user_id
  ) e
  WHERE e.email IS NOT NULL AND e.email <> '[anonymised]';

  UPDATE audit_logs a
  SET old_data = anonymise_jsonb_except(a.old_data, k.keep),
      new_data = anonymise_jsonb_except(a.new_data, k.keep)
  FROM (VALUES ('users', c_keep_users), ('player_profiles', c_keep_player_profiles)) AS k(table_name, keep)
  WHERE a.table_name = k.table_name
    AND a.record_id  = p_user_id::text
    AND (   a.old_data IS DISTINCT FROM anonymise_jsonb_except(a.old_data, k.keep)
         OR a.new_data IS DISTINCT FROM anonymise_jsonb_except(a.new_data, k.keep));
  GET DIAGNOSTICS snapshots_anonymised = ROW_COUNT;

  -- A player bank account's audit rows are keyed by the account's own id, so
  -- they are found by the owner recorded inside the snapshot.
  UPDATE audit_logs a
  SET old_data = anonymise_jsonb_except(a.old_data, c_keep_player_bank),
      new_data = anonymise_jsonb_except(a.new_data, c_keep_player_bank)
  WHERE a.table_name = 'player_bank_accounts'
    AND COALESCE(a.new_data, a.old_data) ->> 'user_id' = p_user_id::text
    AND (   a.old_data IS DISTINCT FROM anonymise_jsonb_except(a.old_data, c_keep_player_bank)
         OR a.new_data IS DISTINCT FROM anonymise_jsonb_except(a.new_data, c_keep_player_bank));
  GET DIAGNOSTICS v_bank_rows = ROW_COUNT;
  snapshots_anonymised := snapshots_anonymised + v_bank_rows;

  -- Invitations addressed to the user, found by address (the email never
  -- changes on an invitation row, so either snapshot carries it).
  UPDATE audit_logs a
  SET old_data = anonymise_jsonb_except(a.old_data, c_keep_invitations),
      new_data = anonymise_jsonb_except(a.new_data, c_keep_invitations)
  WHERE a.table_name = 'organization_invitations'
    AND lower(COALESCE(a.new_data, a.old_data) ->> 'email') = ANY (v_emails)
    AND (   a.old_data IS DISTINCT FROM anonymise_jsonb_except(a.old_data, c_keep_invitations)
         OR a.new_data IS DISTINCT FROM anonymise_jsonb_except(a.new_data, c_keep_invitations));
  GET DIAGNOSTICS v_invitation_rows = ROW_COUNT;
  snapshots_anonymised := snapshots_anonymised + v_invitation_rows;

  UPDATE audit_logs
  SET changed_by = NULL
  WHERE changed_by = p_user_id
    AND table_name <> ALL (c_financial);
  GET DIAGNOSTICS changed_by_cleared = ROW_COUNT;

  RETURN NEXT;
END;
$$;

-- =============================================
-- AUDIT LOG RETENTION AND PRUNING (#507)
-- audit_log_retention() is the single source of truth for how long audit rows
-- are kept (the wiki and /privacy describe it):
--   never pruned  payments, refunds, payouts, prize_awards, prize_fundings,
--                 organization_bank_accounts, player_bank_accounts,
--                 tournaments, tournament_cancellation_requests, and
--                 registrations that were ever paid or confirmed: financial
--                 records or the evidence for one, kept for the 7-year
--                 obligation. Disposal after 7 years is not automated.
--   1 year        users, player_profiles, organizations,
--                 organization_memberships, organization_documents,
--                 organization_invitations, user_global_roles
--   30 days       registrations that were never paid (abandoned, failed and
--                 expired checkouts), counted from the day their tournament's
--                 registration closed
-- A table not listed is never pruned, so a newly audited table (guardianships,
-- helper_invitations, account_claims) is kept until someone decides otherwise.
--
-- An unpaid registration isn't dead while registration is open: checkout
-- reuses a failed or cancelled row (start_new_payment_attempt), so counting
-- from the close means a registration that can still be paid keeps all its
-- history.
--
-- scope 'all': every row of the table past keep_for.
-- scope 'never_paid': registrations only; rows of a registration that still
-- exists, isn't confirmed or forfeited, has no paid payment, and whose
-- tournament closed registration more than keep_for ago.
-- =============================================
CREATE OR REPLACE FUNCTION audit_log_retention()
RETURNS TABLE (audited_table text, keep_for interval, scope text)
LANGUAGE sql
IMMUTABLE
AS $$
  VALUES
    ('organization_documents',   interval '1 year',  'all'),
    ('organization_invitations', interval '1 year',  'all'),
    ('organization_memberships', interval '1 year',  'all'),
    ('organizations',            interval '1 year',  'all'),
    ('player_profiles',          interval '1 year',  'all'),
    ('registrations',            interval '30 days', 'never_paid'),
    ('user_global_roles',        interval '1 year',  'all'),
    ('users',                    interval '1 year',  'all');
$$;

-- =============================================
-- PRUNE AUDIT LOGS
-- =============================================
-- Reports, per policy table, how many rows are past retention, and deletes at
-- most p_limit of them per call, oldest first (dry run by default). The caller
-- (/api/v1/cron/audit-logs) repeats the call, so no single statement deletes
-- millions of rows. The tables never pruned are refused twice: the policy may
-- not name one, and the DELETE excludes them whatever the policy says. The
-- registration rows it deletes for are locked FOR UPDATE SKIP LOCKED, so a
-- settlement in flight is skipped.
CREATE OR REPLACE FUNCTION prune_audit_logs(
  p_dry_run boolean DEFAULT true,
  p_limit   integer DEFAULT 5000
)
RETURNS TABLE (audited_table text, eligible bigint, deleted bigint)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  c_never_pruned constant text[] := ARRAY[
    'payments', 'refunds', 'payouts', 'prize_awards', 'prize_fundings',
    'organization_bank_accounts', 'player_bank_accounts',
    'tournaments', 'tournament_cancellation_requests'
  ];
  v_policy  record;
  v_cutoff  timestamptz;
  v_budget  integer;
BEGIN
  IF p_dry_run IS NULL THEN
    RAISE EXCEPTION 'DRY_RUN_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 THEN
    RAISE EXCEPTION 'LIMIT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  v_budget := p_limit;

  FOR v_policy IN SELECT * FROM audit_log_retention() ORDER BY 1 LOOP
    IF v_policy.audited_table = ANY (c_never_pruned) THEN
      RAISE EXCEPTION 'RETENTION_POLICY_COVERS_FINANCIAL_TABLE'
        USING ERRCODE = 'P0001', DETAIL = v_policy.audited_table;
    END IF;
    IF v_policy.scope NOT IN ('all', 'never_paid')
       OR (v_policy.scope = 'never_paid' AND v_policy.audited_table <> 'registrations') THEN
      RAISE EXCEPTION 'UNKNOWN_RETENTION_SCOPE'
        USING ERRCODE = 'P0001', DETAIL = v_policy.audited_table || ': ' || v_policy.scope;
    END IF;

    v_cutoff := now() - v_policy.keep_for;
    audited_table := v_policy.audited_table;
    deleted := 0;

    IF v_policy.scope = 'all' THEN
      SELECT count(*) INTO eligible
      FROM audit_logs a
      WHERE a.table_name = v_policy.audited_table
        AND a.created_at < v_cutoff;

      IF NOT p_dry_run AND v_budget > 0 AND eligible > 0 THEN
        DELETE FROM audit_logs d
        WHERE d.id IN (
          SELECT a.id
          FROM audit_logs a
          WHERE a.table_name = v_policy.audited_table
            AND a.table_name <> ALL (c_never_pruned)
            AND a.created_at < v_cutoff
          ORDER BY a.created_at
          LIMIT v_budget
        );
        GET DIAGNOSTICS deleted = ROW_COUNT;
      END IF;
    ELSE
      SELECT count(*) INTO eligible
      FROM audit_logs a
      JOIN registrations r ON r.id::text = a.record_id
      JOIN tournaments t ON t.id = r.tournament_id
      WHERE a.table_name = 'registrations'
        AND a.created_at < v_cutoff
        AND COALESCE(t.registration_closed_at, t.registration_deadline) < v_cutoff
        AND r.status NOT IN ('confirmed', 'forfeited')
        AND NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.registration_id = r.id AND p.status = 'paid'
        );

      IF NOT p_dry_run AND v_budget > 0 AND eligible > 0 THEN
        DELETE FROM audit_logs d
        WHERE d.id IN (
          SELECT a.id
          FROM audit_logs a
          JOIN registrations r ON r.id::text = a.record_id
          JOIN tournaments t ON t.id = r.tournament_id
          WHERE a.table_name = 'registrations'
            AND a.table_name <> ALL (c_never_pruned)
            AND a.created_at < v_cutoff
            AND COALESCE(t.registration_closed_at, t.registration_deadline) < v_cutoff
            AND r.status NOT IN ('confirmed', 'forfeited')
            AND NOT EXISTS (
              SELECT 1 FROM payments p
              WHERE p.registration_id = r.id AND p.status = 'paid'
            )
          ORDER BY a.created_at
          LIMIT v_budget
          FOR UPDATE OF r SKIP LOCKED
        );
        GET DIAGNOSTICS deleted = ROW_COUNT;
      END IF;
    END IF;

    v_budget := v_budget - deleted;

    RETURN NEXT;
  END LOOP;
END;
$$;

-- =============================================
-- AUDIT LOGS STORAGE
-- =============================================
-- The audit_logs table's size, for monitoring.
CREATE OR REPLACE FUNCTION audit_logs_storage()
RETURNS TABLE (total_bytes bigint, estimated_rows bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT pg_total_relation_size('public.audit_logs'::regclass),
         GREATEST(c.reltuples, 0)::bigint
  FROM pg_class c
  WHERE c.oid = 'public.audit_logs'::regclass;
$$;

-- =============================================
-- TOURNAMENT EDIT FREEZE (paid-registration stage)
-- Once anyone has paid, the fields that define what they paid for lock:
-- what it costs and what can be won (entry_fees, prizes, the commission
-- split), who receives the money (the beneficiary pair), when and
-- where it runs (dates, venue country/state and the timezone derived from
-- them), and what kind of event it is and who may enter (format, time_control,
-- rating flags, restrictions). Changing any of them rewrites a concluded
-- transaction. max_participants is the exception: it may still go up (more
-- places harms nobody who paid), but not down (fewer could leave a paid player
-- without a seat). src/lib/tournaments/edit-policy.ts is the full policy, and
-- this column list is its "paid" stage.
--
-- The PATCH route returns the readable 409 (naming the rejected fields); this
-- trigger is the authority, so the rule holds for any writer including the
-- service role and the SQL editor. Same belt-and-braces posture as
-- settle_registration_payment's amount guard.
--
-- The date-based stages (started, ended) are NOT enforced here: they depend
-- on today-in-the-venue-timezone, and pinning that in the DB would duplicate
-- getTodayInTimeZone() with a second, drifting definition. They live in the
-- route only.
--
-- Deliberately allows the write when the value is unchanged, so a client that
-- re-submits the whole form without touching these fields still succeeds.
-- =============================================
CREATE OR REPLACE FUNCTION guard_tournament_paid_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_changed text[] := ARRAY[]::text[];
BEGIN
  -- What it costs and what can be won.
  IF NEW.entry_fees IS DISTINCT FROM OLD.entry_fees THEN
    v_changed := array_append(v_changed, 'entry_fees');
  END IF;
  IF NEW.prizes IS DISTINCT FROM OLD.prizes THEN
    v_changed := array_append(v_changed, 'prizes');
  END IF;
  -- Increase-only: a raise opens more places and is allowed. (NOT NULL, so a
  -- plain comparison is enough.)
  IF NEW.max_participants < OLD.max_participants THEN
    v_changed := array_append(v_changed, 'max_participants (can only increase)');
  END IF;
  IF NEW.commission_rate IS DISTINCT FROM OLD.commission_rate THEN
    v_changed := array_append(v_changed, 'commission_rate');
  END IF;
  IF NEW.organizer_commission_pct IS DISTINCT FROM OLD.organizer_commission_pct THEN
    v_changed := array_append(v_changed, 'organizer_commission_pct');
  END IF;
  -- Who the money goes to. Players who paid did so knowing who was running the
  -- event, so a nomination still unaccepted at the first payment simply lapses:
  -- the payout stays with the organizing org.
  IF NEW.beneficiary_organization_id IS DISTINCT FROM OLD.beneficiary_organization_id THEN
    v_changed := array_append(v_changed, 'beneficiary_organization_id');
  END IF;
  IF NEW.beneficiary_accepted_at IS DISTINCT FROM OLD.beneficiary_accepted_at THEN
    v_changed := array_append(v_changed, 'beneficiary_accepted_at');
  END IF;
  -- When and where. A tournament that has to move after taking payment is a
  -- cancellation with refunds, not an edit.
  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    v_changed := array_append(v_changed, 'start_date');
  END IF;
  IF NEW.end_date IS DISTINCT FROM OLD.end_date THEN
    v_changed := array_append(v_changed, 'end_date');
  END IF;
  IF NEW.venue_country IS DISTINCT FROM OLD.venue_country THEN
    v_changed := array_append(v_changed, 'venue_country');
  END IF;
  IF NEW.venue_state IS DISTINCT FROM OLD.venue_state THEN
    v_changed := array_append(v_changed, 'venue_state');
  END IF;
  IF NEW.timezone IS DISTINCT FROM OLD.timezone THEN
    v_changed := array_append(v_changed, 'timezone');
  END IF;
  -- What kind of event, and who may enter.
  IF NEW.format IS DISTINCT FROM OLD.format THEN
    v_changed := array_append(v_changed, 'format');
  END IF;
  IF NEW.time_control IS DISTINCT FROM OLD.time_control THEN
    v_changed := array_append(v_changed, 'time_control');
  END IF;
  IF NEW.is_fide_rated IS DISTINCT FROM OLD.is_fide_rated THEN
    v_changed := array_append(v_changed, 'is_fide_rated');
  END IF;
  IF NEW.is_mcf_rated IS DISTINCT FROM OLD.is_mcf_rated THEN
    v_changed := array_append(v_changed, 'is_mcf_rated');
  END IF;
  IF NEW.restrictions IS DISTINCT FROM OLD.restrictions THEN
    v_changed := array_append(v_changed, 'restrictions');
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

CREATE TRIGGER guard_paid_fields BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION guard_tournament_paid_fields();

-- =============================================
-- TOURNAMENT BENEFICIARY GUARD
-- 004_rls.sql lets anyone with tournament.edit update a tournament row through
-- PostgREST, with no column restriction. Without this, an org admin could
--   PATCH /rest/v1/tournaments?id=eq.<own>
--     {"beneficiary_organization_id": <any org>, "beneficiary_accepted_at": "now"}
-- and redirect the payout with no acceptance, past both functions below.
--
-- Same test as guard_users_identity_columns: auth.uid() IS NOT NULL means a user
-- JWT is driving the statement. nominate_payout_beneficiary,
-- accept_payout_nomination and decline_payout_nomination run through the
-- service role, which has no `sub`.
-- =============================================
CREATE OR REPLACE FUNCTION guard_tournament_beneficiary_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.beneficiary_organization_id IS NOT NULL OR NEW.beneficiary_accepted_at IS NOT NULL THEN
      RAISE EXCEPTION 'tournaments.beneficiary_* cannot be set by a client session'
        USING ERRCODE = 'P0001';
    END IF;
  ELSIF NEW.beneficiary_organization_id IS DISTINCT FROM OLD.beneficiary_organization_id
     OR NEW.beneficiary_accepted_at IS DISTINCT FROM OLD.beneficiary_accepted_at THEN
    RAISE EXCEPTION 'tournaments.beneficiary_* cannot be set by a client session'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_beneficiary_columns BEFORE INSERT OR UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION guard_tournament_beneficiary_columns();

-- =============================================
-- TOURNAMENT CAPACITY ENFORCEMENT
-- Prevents over-registration via a row-level lock. A pending_payment seat is
-- only held for a limited window (the payment timeout); after it lapses the seat
-- stops counting toward capacity, so abandoned checkouts free their slot without
-- a scheduler. Enforced purely in Postgres so the lock guarantee holds.
-- =============================================

-- The seats a tournament has given out: confirmed registrations plus
-- pending_payment holds still inside the 10-minute window. The one definition
-- of "taken", shared by the capacity guard below and the capacity floor
-- (guard_tournament_seats_taken). p_exclude_registration_id lets a resume
-- ignore its own row.
--
-- Counts without locking: callers must hold the tournament row lock first, or
-- a hold can land between the count and whatever they decide from it.
CREATE OR REPLACE FUNCTION count_taken_seats(
  p_tournament_id           uuid,
  p_exclude_registration_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
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
$$;

-- Shared capacity guard. Locks the tournament row, counts the seats taken, and
-- raises if at capacity. p_exclude_registration_id lets a resume ignore its own
-- row.
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

  v_current := count_taken_seats(p_tournament_id, p_exclude_registration_id);

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
-- CAPACITY FLOOR
-- Capacity may not drop below the seats already taken. Settlement doesn't
-- re-check capacity (a player mid-checkout was promised the seat when the hold
-- was taken), so without this an organizer could lower capacity under live
-- holds and every one of them would still settle: 5 confirmed against a
-- capacity of 3. Once anyone has paid, guard_tournament_paid_fields makes
-- capacity increase-only anyway; this covers the window before that.
--
-- Race with a hold: the UPDATE has already locked this tournament row (FOR NO
-- KEY UPDATE) by the time a BEFORE ROW trigger fires, and that conflicts with
-- the FOR UPDATE in assert_tournament_capacity. Whichever comes second waits
-- for the first to commit, then sees its result: a hold that got in first is
-- counted here (each statement in this function takes a fresh snapshot), and a
-- hold that comes after reads the lowered capacity. No separate lock needed.
--
-- Only a decrease is checked. Raising capacity, or saving it unchanged, is
-- always allowed, even on a row that is somehow already over capacity.
--
-- SECURITY DEFINER so the count isn't filtered by the caller's RLS: an org
-- admin updating through PostgREST can't see other players' registrations, and
-- would otherwise get a floor of zero.
--
-- The PATCH route turns the CAPACITY_BELOW_TAKEN sentinel into a readable 422.
-- Named to fire after guard_paid_fields (same-event triggers run in name
-- order), so a decrease after payment reports the paid lock, not this.
-- =============================================
CREATE OR REPLACE FUNCTION guard_tournament_seats_taken()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_taken integer;
BEGIN
  IF NEW.max_participants >= OLD.max_participants THEN
    RETURN NEW;
  END IF;

  v_taken := count_taken_seats(NEW.id);

  IF NEW.max_participants < v_taken THEN
    RAISE EXCEPTION
      'CAPACITY_BELOW_TAKEN: % places are already taken; tournament % cannot drop to %',
      v_taken, NEW.id, NEW.max_participants
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_seats_taken BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION guard_tournament_seats_taken();

-- =============================================
-- PRIZE POOL HELD FOR LIVE CHECKOUTS (#523)
-- A platform-distributed prize pool must be fully funded before anyone can
-- enter. The checkout RPCs check that under the tournament row lock, but prizes
-- only freeze at the first PAID registration (guard_tournament_paid_fields). A
-- player who has a live CHIP link and then pays would otherwise be confirmed
-- against prizes raised while they were paying, which the pool no longer
-- covers: settle_registration_payment never re-checks the pool, and can't
-- refuse money already taken.
--
-- So while any checkout hold is live (the same 10-minute window as
-- count_taken_seats, which is also when CHIP's due_strict makes the link
-- unpayable), a prize change that would leave the pool short is refused. A
-- change the money already paid in still covers is allowed, as is any change on
-- an organizer-paid tournament. The organizer can retry once the checkouts
-- finish.
--
-- Not covered: a payment made just before the link lapsed whose webhook lands
-- after a raise saved once the window had passed. That player paid while the
-- pool covered the prizes; the raise still asks the funders for the top-up and
-- pauses further registration.
--
-- Runs under the tournament row lock (BEFORE UPDATE), which the checkout RPCs
-- take before their own pool check, so the two serialize. SECURITY DEFINER so
-- the hold count isn't filtered by the caller's RLS. declared_prize_total_cents
-- lives in 006; plpgsql resolves it at call time.
--
-- The PATCH route turns the PRIZES_IN_CHECKOUT sentinel into a readable 409.
-- Named to fire after guard_paid_fields, so a change after payment reports the
-- paid lock instead.
-- =============================================
CREATE OR REPLACE FUNCTION guard_tournament_prizes_in_checkout()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live integer;
BEGIN
  IF NEW.prizes IS NOT DISTINCT FROM OLD.prizes
     OR COALESCE(NEW.prizes->>'distribution', 'organizer') <> 'platform' THEN
    RETURN NEW;
  END IF;

  IF declared_prize_total_cents(NEW.prizes) <= COALESCE((
       SELECT SUM(s.total_prize_funding_cents)
       FROM tournament_payout_summary s
       WHERE s.tournament_id = NEW.id
     ), 0) THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::integer INTO v_live
  FROM registrations
  WHERE tournament_id = NEW.id
    AND status = 'pending_payment'
    AND registered_at > now() - interval '10 minutes';

  IF v_live > 0 THEN
    RAISE EXCEPTION
      'PRIZES_IN_CHECKOUT: % checkouts are live; tournament % cannot raise its prizes beyond the funded pool',
      v_live, NEW.id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_prizes_in_checkout BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION guard_tournament_prizes_in_checkout();

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
-- SENSITIVE DATA CONSENT (#451)
-- has_sensitive_data_consent answers "may we hold this kind of data for this
-- user right now?": true only when their newest row for the category is a
-- grant. Deliberately NOT SECURITY DEFINER, so it sees only what the caller's
-- RLS allows: the storage policy on oku-documents calls it as the uploading
-- user, who can read their own rows (004), and the service-role functions
-- bypass RLS. As a definer function anyone could ask it about anyone, and
-- whether a stranger has agreed to share health data is itself health data.
--
-- record_sensitive_data_consent is the only write path for the log. A guardian
-- or helper may record it for the player they act for (p_recorded_by, #717),
-- under an active guardianship whose basis names the wording; a guardian whose
-- minor-basis authority has aged out may still withdraw but not grant
-- (AGED_OUT, #721). It locks the users row (as set_player_bank_account does, so
-- a save and a withdrawal cannot interleave) and writes a row only when the
-- position changes:
-- re-granting the same wording, or withdrawing what was never granted, is a
-- no-op that returns false. A grant of NEWER wording is written, so the log
-- shows the user agreed to it. p_version must come from legal.ts on the
-- server, never the request.
-- =============================================
CREATE OR REPLACE FUNCTION has_sensitive_data_consent(
  p_user_id  uuid,
  p_category sensitive_data_category
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT granted
      FROM sensitive_data_consents
      WHERE user_id = p_user_id AND category = p_category
      ORDER BY id DESC
      LIMIT 1
  ), false);
$$;

CREATE OR REPLACE FUNCTION record_sensitive_data_consent(
  p_user_id     uuid,
  p_category    sensitive_data_category,
  p_granted     boolean,
  p_version     varchar(20) DEFAULT NULL,
  p_recorded_by uuid        DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest      sensitive_data_consents;
  v_recorded_by uuid := NULLIF(p_recorded_by, p_user_id);
  v_basis       guardianship_basis;
BEGIN
  IF p_granted IS NULL THEN
    RAISE EXCEPTION 'p_granted is required' USING ERRCODE = '22023';
  END IF;

  IF p_granted AND p_version IS NULL THEN
    RAISE EXCEPTION 'a consent grant must name the version agreed to'
      USING ERRCODE = '22023';
  END IF;

  IF v_recorded_by IS NOT NULL THEN
    SELECT basis INTO v_basis
      FROM guardianships
      WHERE guardian_user_id = v_recorded_by
        AND dependent_user_id = p_user_id
        AND status = 'active'
      FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_GUARDIAN: only the player or someone acting for them can record their consent'
        USING ERRCODE = '42501';
    END IF;

    IF p_granted AND minor_guardianship_aged_out(
         v_basis,
         (SELECT date_of_birth FROM player_profiles WHERE user_id = p_user_id)
       ) THEN
      RAISE EXCEPTION 'AGED_OUT: the player has turned 18 and gives their own consent'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM 1 FROM users
    WHERE id = p_user_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_latest
    FROM sensitive_data_consents
    WHERE user_id = p_user_id AND category = p_category
    ORDER BY id DESC
    LIMIT 1;

  IF p_granted THEN
    IF FOUND AND v_latest.granted AND v_latest.version = p_version
       AND v_latest.granted_by IS NOT DISTINCT FROM v_recorded_by
       AND v_latest.on_behalf_basis IS NOT DISTINCT FROM v_basis THEN
      RETURN false;
    END IF;
  ELSIF NOT FOUND OR NOT v_latest.granted THEN
    RETURN false;
  END IF;

  INSERT INTO sensitive_data_consents
      (user_id, category, granted, version, granted_by, on_behalf_basis)
    VALUES (p_user_id, p_category, p_granted,
            CASE WHEN p_granted THEN p_version END,
            v_recorded_by, v_basis);

  RETURN true;
END;
$$;

-- A consent row is evidence. Correcting one would rewrite what the user agreed
-- to; a change of mind is a new row. ON DELETE CASCADE from users still works:
-- this guards UPDATE only.
CREATE OR REPLACE FUNCTION guard_consent_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'sensitive_data_consents rows are immutable; record a new grant or withdrawal instead'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER guard_consent_immutable
  BEFORE UPDATE ON sensitive_data_consents
  FOR EACH ROW EXECUTE FUNCTION guard_consent_immutable();

-- =============================================
-- SET PLAYER BANK ACCOUNT
-- The ONLY write path for player_bank_accounts (004_rls.sql revokes client
-- writes), and set_organization_bank_account for a person: supersede rather
-- than update, under a lock on the users row, with the same no-op rule for an
-- unchanged 'verified' or 'pending' row and the same masked return.
--
-- Clearing (all-NULL details) deactivates the active row and inserts nothing,
-- returning {"changed": true, "id": null}. A prize award that already
-- snapshotted the old account keeps it; one not yet sent waits for a new one.
--
-- Bank details are held only with the player's financial-data consent (#451),
-- so saving them without a current grant is refused with CONSENT_REQUIRED.
-- The route records the grant first, from the checkbox the player ticked.
-- Clearing is how a player withdraws that consent, so it erases the details
-- and records the withdrawal in the same transaction: there is no moment
-- where the log says withdrawn while the details are still held, or the
-- reverse. Erasing covers EVERY row the player has, active and superseded:
--   * a row no prize award names is deleted;
--   * a row a prize award names is kept as the record of where that money
--     went (or is going: an award in flight sends by chip_bank_account_id, not
--     the number), but its number is cut to '****' plus the last 4 digits and
--     redacted_at is stamped. Bank and holder stay.
-- Nothing reads a full number off an inactive row: CHIP registration skips
-- them, and emails show the last 4 only.
-- =============================================
CREATE FUNCTION set_player_bank_account(
  p_user_id        uuid,
  p_bank_code      varchar(11),
  p_bank_name      varchar(100),
  p_account_holder varchar(255),
  p_account_number varchar(50),
  p_entered_by     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current    player_bank_accounts;
  v_row        player_bank_accounts;
  v_changed    boolean := true;
  v_entered_by uuid := NULLIF(p_entered_by, p_user_id);
  v_clear      boolean := p_bank_code IS NULL AND p_bank_name IS NULL
                          AND p_account_holder IS NULL AND p_account_number IS NULL;
BEGIN
  IF v_entered_by IS NOT NULL THEN
    PERFORM 1 FROM guardianships
      WHERE guardian_user_id = v_entered_by
        AND dependent_user_id = p_user_id
        AND status = 'active'
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_GUARDIAN: only the player or someone acting for them can set their bank details'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM 1 FROM users
    WHERE id = p_user_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_current
    FROM player_bank_accounts
    WHERE user_id = p_user_id AND is_active;

  IF v_clear THEN
    UPDATE player_bank_accounts
      SET is_active = false
      WHERE user_id = p_user_id AND is_active;
    v_changed := FOUND;

    DELETE FROM player_bank_accounts b
      WHERE b.user_id = p_user_id
        AND NOT EXISTS (SELECT 1 FROM prize_awards a WHERE a.bank_account_id = b.id);

    UPDATE player_bank_accounts
      SET account_number = '****' || right(account_number, 4),
          redacted_at    = now()
      WHERE user_id = p_user_id AND redacted_at IS NULL;

    PERFORM record_sensitive_data_consent(p_user_id, 'financial', false, NULL, v_entered_by);
    RETURN jsonb_build_object('changed', v_changed, 'id', NULL);
  END IF;

  IF EXISTS (
    SELECT 1 FROM guardianships
    WHERE dependent_user_id = p_user_id AND status = 'active' AND basis = 'minor'
  ) THEN
    RAISE EXCEPTION 'MINOR_DEPENDENT: a minor''s prizes are paid to their guardian''s bank account'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_sensitive_data_consent(p_user_id, 'financial') THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED: bank details need the player''s financial data consent'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_current.id IS NOT NULL
     AND v_current.bank_code      = p_bank_code
     AND v_current.bank_name      = p_bank_name
     AND v_current.account_holder = p_account_holder
     AND v_current.account_number = p_account_number
     AND v_current.entered_by IS NOT DISTINCT FROM v_entered_by
     AND v_current.status <> 'rejected'
  THEN
    v_changed := false;
    v_row     := v_current;
  ELSE
    UPDATE player_bank_accounts
      SET is_active = false
      WHERE user_id = p_user_id AND is_active;

    INSERT INTO player_bank_accounts (
      user_id, bank_name, bank_code, account_holder, account_number, entered_by
    ) VALUES (
      p_user_id, p_bank_name, p_bank_code, p_account_holder, p_account_number, v_entered_by
    )
    RETURNING * INTO v_row;
  END IF;

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
-- ASSERT ORG NAME AVAILABLE
-- =============================================
-- Raises NAME_TAKEN if an approved organization other than p_except_org_id
-- already uses p_name (case-insensitive). A pending or rejected one doesn't
-- count. Not a race guard on its own: two approvals of the same name are
-- stopped by idx_organizations_name_active.
CREATE OR REPLACE FUNCTION assert_org_name_available(
  p_name          varchar(255),
  p_except_org_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM organizations
     WHERE lower(name) = lower(p_name)
       AND approval_status = 'approved'
       AND deleted_at IS NULL
       AND id IS DISTINCT FROM p_except_org_id
  ) THEN
    RAISE EXCEPTION 'NAME_TAKEN: an approved organization already uses this name'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- =============================================
-- ASSERT ORG ENTITY DOCUMENTS
-- =============================================
-- Normalises the registration number and checks the documents match the
-- entity, raising ENTITY_DOCS_REQUIRED otherwise. p_doc_types is the full set
-- of document types the application will hold.
CREATE OR REPLACE FUNCTION assert_org_entity_documents(
  p_entity_type         org_entity_type,
  p_registration_number varchar(100),
  p_doc_types           text[]
)
RETURNS varchar(100)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_no varchar(100);
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

    -- The registry that matches the entity, not either one: a company is
    -- registered with SSM and a society with ROS.
    IF NOT (CASE p_entity_type WHEN 'company' THEN 'ssm' ELSE 'ros' END = ANY (COALESCE(p_doc_types, '{}'))) THEN
      RAISE EXCEPTION 'ENTITY_DOCS_REQUIRED: a % must supply an % document',
        p_entity_type,
        CASE p_entity_type WHEN 'company' THEN 'SSM' ELSE 'ROS' END
        USING ERRCODE = 'P0001';
    END IF;
  ELSE
    -- An individual has no registry entry to cite. Normalised to NULL rather
    -- than rejected, so the column means exactly one thing.
    v_reg_no := NULL;

    IF NOT (COALESCE(p_doc_types, '{}') && ARRAY['identity_document', 'authorization_letter']) THEN
      RAISE EXCEPTION 'ENTITY_DOCS_REQUIRED: an individual organizer must supply an identity document or authorization letter'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN v_reg_no;
END;
$$;

-- =============================================
-- SET ORGANIZATION REGISTERED NAME
-- =============================================
-- Records p_name as the organization's registered name, or leaves it untouched
-- when p_name is blank.
CREATE OR REPLACE FUNCTION set_organization_registered_name(
  p_org_id uuid,
  p_name   varchar(255)
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name varchar(255) := NULLIF(btrim(p_name), '');
BEGIN
  IF v_name IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO organization_registered_names (organization_id, registered_name)
    VALUES (p_org_id, v_name)
    ON CONFLICT (organization_id) DO UPDATE SET registered_name = EXCLUDED.registered_name;
END;
$$;

-- =============================================
-- CREATE ORGANIZATION APPLICATION
-- Creates the organization, its registered name, its KYB document rows and its
-- agreement stamp in ONE transaction. No bank account (#671): an approved
-- organization adds its payout account in its settings.
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
CREATE FUNCTION create_organization_application(
  p_created_by          uuid,
  p_name                varchar(255),
  p_email               varchar(255),
  p_entity_type         org_entity_type,
  p_agreement_version   varchar(20),
  p_documents           jsonb,
  p_description         text    DEFAULT NULL,
  p_links               jsonb   DEFAULT NULL,
  p_phone               varchar(20) DEFAULT NULL,
  p_past_tournament_refs text   DEFAULT NULL,
  p_registration_number varchar(100) DEFAULT NULL,
  p_registered_name     varchar(255) DEFAULT NULL,
  p_bank_code           varchar(11)  DEFAULT NULL,
  p_bank_name           varchar(100) DEFAULT NULL,
  p_account_holder      varchar(255) DEFAULT NULL,
  p_account_number      varchar(50)  DEFAULT NULL
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
  v_reg_no := assert_org_entity_documents(
    p_entity_type,
    p_registration_number,
    ARRAY(SELECT d->>'doc_type' FROM jsonb_array_elements(v_docs) d)
  );

  PERFORM assert_org_name_available(p_name);

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

  PERFORM set_organization_registered_name(v_org_id, p_registered_name);

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

  INSERT INTO organization_application_events (organization_id, event, actor_id, created_at)
    VALUES (v_org_id, 'submitted', p_created_by, v_accepted);

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
-- RESUBMIT ORGANIZATION APPLICATION
-- =============================================
CREATE FUNCTION resubmit_organization_application(
  p_org_id              uuid,
  p_user_id             uuid,
  p_name                varchar(255),
  p_email               varchar(255),
  p_entity_type         org_entity_type,
  p_agreement_version   varchar(20),
  p_keep_document_ids   uuid[],
  p_new_documents       jsonb,
  p_description         text    DEFAULT NULL,
  p_links               jsonb   DEFAULT NULL,
  p_phone               varchar(20) DEFAULT NULL,
  p_past_tournament_refs text   DEFAULT NULL,
  p_registration_number varchar(100) DEFAULT NULL,
  p_registered_name     varchar(255) DEFAULT NULL,
  p_keep_bank_account   boolean      DEFAULT NULL,
  p_bank_code           varchar(11)  DEFAULT NULL,
  p_bank_name           varchar(100) DEFAULT NULL,
  p_account_holder      varchar(255) DEFAULT NULL,
  p_account_number      varchar(50)  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org        organizations;
  v_keep       uuid[] := COALESCE(p_keep_document_ids, '{}');
  v_new_docs   jsonb  := COALESCE(p_new_documents, '[]'::jsonb);
  v_doc_types  text[];
  v_doc_count  integer;
  v_reg_no     varchar(100);
  v_removed    text[];
  v_now        timestamptz := now();
BEGIN
  SELECT * INTO v_org
    FROM organizations
    WHERE id = p_org_id AND created_by = p_user_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPLICATION_NOT_FOUND: no such application' USING ERRCODE = 'P0002';
  END IF;

  IF v_org.approval_status <> 'rejected' THEN
    RAISE EXCEPTION 'APPLICATION_NOT_REJECTED: only a rejected application can be amended'
      USING ERRCODE = 'P0001';
  END IF;

  -- Kept documents must be this application's own. Anything else in the list
  -- is ignored rather than adopted from another application.
  SELECT COALESCE(array_agg(doc_type::text), '{}'), count(*)
    INTO v_doc_types, v_doc_count
    FROM organization_documents
    WHERE organization_id = p_org_id AND id = ANY (v_keep);

  v_doc_types := v_doc_types
    || ARRAY(SELECT d->>'doc_type' FROM jsonb_array_elements(v_new_docs) d);
  v_doc_count := v_doc_count + jsonb_array_length(v_new_docs);

  IF v_doc_count > 10 THEN
    RAISE EXCEPTION 'TOO_MANY_DOCUMENTS: at most 10 documents can be submitted'
      USING ERRCODE = 'P0001';
  END IF;

  v_reg_no := assert_org_entity_documents(p_entity_type, p_registration_number, v_doc_types);

  PERFORM assert_org_name_available(p_name, p_org_id);

  UPDATE organizations
    SET name                  = p_name,
        description           = p_description,
        links                 = p_links,
        email                 = p_email,
        phone                 = p_phone,
        past_tournament_refs  = p_past_tournament_refs,
        entity_type           = p_entity_type,
        registration_number   = v_reg_no,
        agreement_version     = p_agreement_version,
        agreement_accepted_at = v_now,
        agreement_accepted_by = p_user_id,
        approval_status       = 'pending',
        rejection_reason      = NULL,
        reviewed_by           = NULL,
        reviewed_at           = NULL
    WHERE id = p_org_id;

  PERFORM set_organization_registered_name(p_org_id, p_registered_name);

  WITH removed AS (
    DELETE FROM organization_documents
      WHERE organization_id = p_org_id AND NOT (id = ANY (v_keep))
      RETURNING storage_path
  )
  SELECT COALESCE(array_agg(storage_path), '{}') INTO v_removed FROM removed;

  INSERT INTO organization_documents (
    organization_id, doc_type, storage_path, original_filename, uploaded_by
  )
  SELECT
    p_org_id,
    (d->>'doc_type')::org_document_type,
    d->>'storage_path',
    NULLIF(d->>'original_filename', ''),
    p_user_id
  FROM jsonb_array_elements(v_new_docs) d;

  INSERT INTO organization_application_events (organization_id, event, actor_id, created_at)
    VALUES (p_org_id, 'resubmitted', p_user_id, v_now);

  RETURN jsonb_build_object(
    'id',                    p_org_id,
    'name',                  p_name,
    'approval_status',       'pending',
    'entity_type',           p_entity_type,
    'registration_number',   v_reg_no,
    'agreement_version',     p_agreement_version,
    'agreement_accepted_at', v_now,
    'removed_storage_paths', to_jsonb(v_removed)
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

  -- Its payout account was released when it was rejected, and the applicant
  -- may be part-way through amending it.
  IF p_action = 'approve' AND v_org.approval_status = 'rejected' THEN
    RAISE EXCEPTION 'APPLICATION_REJECTED: a rejected application cannot be approved; the applicant must amend and resubmit it'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_status := CASE p_action WHEN 'approve' THEN 'approved' ELSE 'rejected' END;

  BEGIN
    UPDATE organizations
      SET approval_status  = v_new_status,
          reviewed_by      = p_reviewer_id,
          reviewed_at      = v_reviewed_at,
          rejection_reason = CASE WHEN p_action = 'reject' THEN p_rejection_reason ELSE NULL END
      WHERE id = p_org_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- idx_organizations_name_active: another organization with this name
      -- was approved first.
      RAISE EXCEPTION 'NAME_TAKEN: an approved organization already uses this name'
        USING ERRCODE = 'P0001';
  END;

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
    -- Frees the destination while the application is out of review
    -- (uniq_active_bank_destination). Never registered with CHIP Send: that
    -- only happens on approval. A resubmission registers it again.
    UPDATE organization_bank_accounts
      SET is_active = false
      WHERE organization_id = p_org_id AND is_active;
  END IF;

  INSERT INTO organization_application_events (organization_id, event, reason, actor_id, created_at)
    VALUES (
      p_org_id,
      v_new_status::text::org_application_event,
      CASE WHEN p_action = 'reject' THEN p_rejection_reason END,
      p_reviewer_id,
      v_reviewed_at
    );

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
-- afterwards by the app (the refund sweep, src/services/refunds/sweep.ts) and settled by
-- settle_refund (006_payment_functions.sql) — a network call can't run in this
-- transaction.
--
-- Approve is refused (P0001, CANCELLATION_BLOCKED_BY_PAYOUT) once an organizer
-- payout has been paid or is being sent: see the guard in the body.
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
  v_paid_out     bigint;
  v_refunds_due  bigint;
  v_held         bigint;
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

  -- Money already sent to the organizer makes the refunds unfundable: every
  -- confirmed player gets their full GROSS back from the Collect balance, but the
  -- organizer's NET has left through CHIP Send, and there is no automated
  -- claw-back. So approval is refused, with the shortfall, until ops have
  -- recovered it (a payment_type='adjustment' row). A payout still being sent
  -- may complete at any moment, so it blocks too. Locking the tournament
  -- serializes this with queue_payout, request_early_payout and
  -- claim_payout_send, which marks a payout 'processing' before CHIP is called.
  IF p_action = 'approve' THEN
    PERFORM 1 FROM tournaments WHERE id = v_request.tournament_id FOR UPDATE;

    SELECT COALESCE(SUM(p.gross_amount_cents), 0) INTO v_paid_out
      FROM payments p
      WHERE p.tournament_id = v_request.tournament_id
        AND p.type = 'organizer_payout'
        AND p.status = 'paid';

    IF v_paid_out > 0 THEN
      -- Shortfall = refunds this approval would queue - what the platform still
      -- holds for the tournament (gross collected, net of refunds and payouts).
      SELECT COALESCE(SUM(p.gross_amount_cents), 0) INTO v_refunds_due
        FROM registrations r
        JOIN payments p ON p.id = r.current_payment_id
        WHERE r.tournament_id = v_request.tournament_id
          AND r.status = 'confirmed'
          AND p.type = 'registration'
          AND p.status = 'paid';
      SELECT COALESCE(SUM(s.net_collected_cents), 0) - v_paid_out INTO v_held
        FROM tournament_payout_summary s
        WHERE s.tournament_id = v_request.tournament_id;

      RAISE EXCEPTION 'CANCELLATION_BLOCKED_BY_PAYOUT: % cents paid out, % cents short of the refunds',
        v_paid_out, GREATEST(v_refunds_due - v_held, 0)
        USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
      SELECT 1 FROM payouts po
      WHERE po.tournament_id = v_request.tournament_id AND po.status = 'processing'
    ) THEN
      RAISE EXCEPTION 'CANCELLATION_BLOCKED_BY_PAYOUT: a payout is being sent'
        USING ERRCODE = 'P0001';
    END IF;
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

-- =============================================
-- CURRENT ORGANIZER AGREEMENT VERSION
-- The database has to refuse a stale agreement itself, even if a route is
-- bypassed, and the money functions take no version argument to trust. This is
-- the SQL twin of ORGANIZER_AGREEMENT_VERSION in src/lib/reference/legal.ts; bumping that
-- constant means changing this too, and src/lib/__tests__/legal.test.ts fails
-- until the two match.
-- =============================================
CREATE OR REPLACE FUNCTION current_organizer_agreement_version()
RETURNS varchar(20)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '2026-11-20'::varchar(20);
$$;

-- =============================================
-- PAYOUT RECIPIENT ELIGIBILITY
-- Why money cannot be sent to this organization right now, or NULL if it can.
-- One definition shared by nomination and queue_payout, and returned to the
-- dashboards so a lapsed recipient is shown rather than failing silently.
-- A chip_bank_account_id is part of the check: without it there is nothing to
-- put in a send instruction.
-- =============================================
CREATE OR REPLACE FUNCTION payout_recipient_problem(p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org organizations;
BEGIN
  SELECT * INTO v_org FROM organizations WHERE id = p_org_id AND deleted_at IS NULL;

  IF NOT FOUND OR v_org.approval_status <> 'approved' THEN
    RETURN 'organization_not_approved';
  END IF;
  IF v_org.entity_type IS NULL THEN
    RETURN 'entity_type_missing';
  END IF;
  IF v_org.agreement_version IS DISTINCT FROM current_organizer_agreement_version() THEN
    RETURN 'agreement_not_current';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM organization_bank_accounts b
    WHERE b.organization_id = p_org_id
      AND b.is_active
      AND b.status = 'verified'
      AND b.chip_bank_account_id IS NOT NULL
  ) THEN
    RETURN 'bank_account_not_verified';
  END IF;

  RETURN NULL;
END;
$$;

-- =============================================
-- PAYOUT BENEFICIARY NOMINATION
-- A tournament may nominate another approved organization to receive its payout.
-- Money is never wired to an unvetted party: the nominee must already pass
-- payout_recipient_problem, and it takes an acceptance from someone holding
-- payout.request on the NOMINEE, so a one-sided nomination cannot redirect money.
-- The organizing org stays liable for any claw-back regardless of who is paid.
--
-- p_beneficiary_org_id NULL withdraws the nomination. Nominating again resets any
-- earlier acceptance, because that acceptance was for a different organization.
--
-- Both functions check the actor themselves, unlike the review functions above:
-- the permission is on an org the route can't otherwise infer. The paid-registration
-- freeze is left to guard_tournament_paid_fields, the single authority on it.
-- Failures RAISE with a stable sentinel prefix for the route to map.
-- =============================================
CREATE OR REPLACE FUNCTION nominate_payout_beneficiary(
  p_tournament_id      uuid,
  p_beneficiary_org_id uuid,
  p_user_id            uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament tournaments;
  v_problem    text;
BEGIN
  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % not found', p_tournament_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT has_org_permission(p_user_id, v_tournament.organization_id, 'payout.request') THEN
    RAISE EXCEPTION 'NOMINATION_FORBIDDEN: payout.request is required on the organizing organization'
      USING ERRCODE = '42501';
  END IF;

  IF v_tournament.status = 'cancelled' THEN
    RAISE EXCEPTION 'NOMINATION_CLOSED: this tournament is cancelled' USING ERRCODE = 'P0001';
  END IF;

  IF p_beneficiary_org_id IS NOT NULL THEN
    IF p_beneficiary_org_id = v_tournament.organization_id THEN
      RAISE EXCEPTION 'NOMINATION_SELF: an organization cannot nominate itself' USING ERRCODE = 'P0001';
    END IF;

    v_problem := payout_recipient_problem(p_beneficiary_org_id);
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION 'NOMINEE_INELIGIBLE: %', v_problem USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE tournaments
    SET beneficiary_organization_id = p_beneficiary_org_id,
        beneficiary_accepted_at     = NULL
    WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'tournament_id',               p_tournament_id,
    'beneficiary_organization_id', p_beneficiary_org_id,
    'beneficiary_accepted_at',     NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION accept_payout_nomination(
  p_tournament_id uuid,
  p_user_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament tournaments;
  v_problem    text;
  v_accepted   timestamptz := now();
BEGIN
  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % not found', p_tournament_id USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament.beneficiary_organization_id IS NULL THEN
    RAISE EXCEPTION 'NOMINATION_NOT_FOUND: this tournament has no pending nomination' USING ERRCODE = 'P0002';
  END IF;

  IF NOT has_org_permission(p_user_id, v_tournament.beneficiary_organization_id, 'payout.request') THEN
    RAISE EXCEPTION 'NOMINATION_FORBIDDEN: payout.request is required on the nominated organization'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotent: a double-click or a retried request is not an error.
  IF v_tournament.beneficiary_accepted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'tournament_id',               p_tournament_id,
      'beneficiary_organization_id', v_tournament.beneficiary_organization_id,
      'beneficiary_accepted_at',     v_tournament.beneficiary_accepted_at,
      'already_accepted',            true
    );
  END IF;

  IF v_tournament.status = 'cancelled' THEN
    RAISE EXCEPTION 'NOMINATION_CLOSED: this tournament is cancelled' USING ERRCODE = 'P0001';
  END IF;

  -- Re-checked: the nominee may have lapsed since it was nominated.
  v_problem := payout_recipient_problem(v_tournament.beneficiary_organization_id);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'NOMINEE_INELIGIBLE: %', v_problem USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournaments SET beneficiary_accepted_at = v_accepted WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'tournament_id',               p_tournament_id,
    'beneficiary_organization_id', v_tournament.beneficiary_organization_id,
    'beneficiary_accepted_at',     v_accepted,
    'already_accepted',            false
  );
END;
$$;

-- The nominee turning a pending nomination down. Clears it, so the payout stays
-- with the organizing org exactly as if it had never been made. Only a pending
-- nomination can be declined: once accepted the organizer is relying on it, and
-- unwinding it is the organizer's call (nominate NULL). Same actor check as
-- accept_payout_nomination, and the paid-registration freeze still applies.
CREATE OR REPLACE FUNCTION decline_payout_nomination(
  p_tournament_id uuid,
  p_user_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament tournaments;
BEGIN
  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % not found', p_tournament_id USING ERRCODE = 'P0002';
  END IF;

  IF v_tournament.beneficiary_organization_id IS NULL THEN
    RAISE EXCEPTION 'NOMINATION_NOT_FOUND: this tournament has no pending nomination' USING ERRCODE = 'P0002';
  END IF;

  IF NOT has_org_permission(p_user_id, v_tournament.beneficiary_organization_id, 'payout.request') THEN
    RAISE EXCEPTION 'NOMINATION_FORBIDDEN: payout.request is required on the nominated organization'
      USING ERRCODE = '42501';
  END IF;

  IF v_tournament.beneficiary_accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'NOMINATION_ACCEPTED: an accepted nomination can only be withdrawn by the organizer'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE tournaments
    SET beneficiary_organization_id = NULL,
        beneficiary_accepted_at     = NULL
    WHERE id = p_tournament_id;

  RETURN jsonb_build_object(
    'tournament_id',            p_tournament_id,
    'declined_organization_id', v_tournament.beneficiary_organization_id
  );
END;
$$;

-- =============================================
-- ORGANIZATION INVITATIONS
-- See the table comment in 001. Each function locks the row it changes, so an
-- accept racing a revoke (or a second accept) settles one way, and each takes
-- the expiry from expires_at at the moment it runs.
-- =============================================

-- Invites p_email to p_org_id as p_role, or refreshes the pending invitation the
-- address already has there: new token, role and inviter, and a fresh 30 days.
-- Refuses an address that already belongs to a member. p_token_hash is the
-- SHA-256 of the token the caller will email; the token itself never arrives.
CREATE OR REPLACE FUNCTION create_organization_invitation(
  p_org_id     uuid,
  p_email      text,
  p_role       text,
  p_invited_by uuid,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email   text := lower(btrim(p_email));
  v_role_id integer;
  v_id      uuid;
  v_created timestamptz;
  v_expires timestamptz;
  v_resent  boolean;
BEGIN
  IF NOT has_org_permission(p_invited_by, p_org_id, 'org.invite') THEN
    RAISE EXCEPTION 'INVITATION_FORBIDDEN: org.invite is required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organizations
     WHERE id = p_org_id AND approval_status = 'approved' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'INVITATION_ORG_UNAVAILABLE: organization % is not approved', p_org_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Owner is never offered by invitation.
  SELECT id INTO v_role_id FROM roles
   WHERE name = p_role AND scope = 'organization' AND name IN ('admin', 'member');
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'INVITATION_INVALID_ROLE: % cannot be offered by invitation', p_role
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_memberships m
      JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = p_org_id
       AND u.email = v_email
       AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'INVITATION_ALREADY_MEMBER: % is already a member', v_email
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO organization_invitations AS i
    (organization_id, email, role_id, token_hash, invited_by, expires_at)
  VALUES
    (p_org_id, v_email, v_role_id, p_token_hash, p_invited_by, now() + interval '30 days')
  ON CONFLICT (organization_id, email) WHERE status = 'pending'
  DO UPDATE SET
    role_id    = EXCLUDED.role_id,
    token_hash = EXCLUDED.token_hash,
    invited_by = EXCLUDED.invited_by,
    created_at = now(),
    expires_at = EXCLUDED.expires_at
  -- xmax is non-zero on the row an ON CONFLICT update rewrote, zero on a fresh insert.
  RETURNING i.id, i.created_at, i.expires_at, (i.xmax <> 0)
    INTO v_id, v_created, v_expires, v_resent;

  RETURN jsonb_build_object(
    'id',         v_id,
    'email',      v_email,
    'role',       p_role,
    'created_at', v_created,
    'expires_at', v_expires,
    'resent',     v_resent
  );
END;
$$;

-- The invitee accepting. p_user_id must be signed in with the invited address:
-- whoever reached the invitation (by the emailed link, or from their own list
-- of invitations), the address match proves it is the person it was sent to, so
-- a forwarded link is not enough. Inserts the membership with the offered role.
-- Accepting twice is not an error, and an invitee who has meanwhile become a
-- member keeps the role they already hold.
CREATE OR REPLACE FUNCTION accept_organization_invitation_by_id(
  p_invitation_id uuid,
  p_user_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv    organization_invitations;
  v_email  text;
  v_joined boolean;
BEGIN
  SELECT * INTO v_inv FROM organization_invitations
   WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: invitation % not found', p_invitation_id
      USING ERRCODE = 'P0002';
  END IF;

  SELECT email INTO v_email FROM users WHERE id = p_user_id AND deleted_at IS NULL;
  IF v_email IS NULL OR lower(v_email) <> v_inv.email THEN
    RAISE EXCEPTION 'INVITATION_WRONG_ACCOUNT: this invitation was sent to a different address'
      USING ERRCODE = '42501';
  END IF;

  IF v_inv.status = 'accepted' THEN
    RETURN jsonb_build_object(
      'invitation_id',    v_inv.id,
      'organization_id',  v_inv.organization_id,
      'already_accepted', true
    );
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: this invitation expired at %', v_inv.expires_at
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organizations
     WHERE id = v_inv.organization_id AND approval_status = 'approved' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'INVITATION_ORG_UNAVAILABLE: the organization is no longer available'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO organization_memberships (organization_id, user_id, role_id)
  VALUES (v_inv.organization_id, p_user_id, v_inv.role_id)
  ON CONFLICT (organization_id, user_id) DO NOTHING;
  v_joined := FOUND;

  UPDATE organization_invitations
     SET status = 'accepted', responded_at = now(), responded_by = p_user_id
   WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'invitation_id',    v_inv.id,
    'organization_id',  v_inv.organization_id,
    'already_accepted', false,
    'already_member',   NOT v_joined
  );
END;
$$;

-- Accepting from the emailed link: the token finds the invitation, and
-- accept_organization_invitation_by_id does the rest (including the address check).
CREATE OR REPLACE FUNCTION accept_organization_invitation(
  p_token_hash text,
  p_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM organization_invitations WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: no invitation for this link' USING ERRCODE = 'P0002';
  END IF;
  RETURN accept_organization_invitation_by_id(v_id, p_user_id);
END;
$$;

-- The invitee turning it down. From their own list of invitations
-- (p_require_invitee, the default) p_user_id must be signed in with the invited
-- address. From the emailed link (decline_organization_invitation) holding the
-- token is enough: declining grants nothing, and someone who never wants an
-- account should not need one to say no. p_user_id records who declined when
-- they were signed in (NULL otherwise). Declining twice is not an error.
CREATE OR REPLACE FUNCTION decline_organization_invitation_by_id(
  p_invitation_id   uuid,
  p_user_id         uuid,
  p_require_invitee boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv   organization_invitations;
  v_email text;
BEGIN
  SELECT * INTO v_inv FROM organization_invitations
   WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: invitation % not found', p_invitation_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_require_invitee THEN
    SELECT email INTO v_email FROM users WHERE id = p_user_id AND deleted_at IS NULL;
    IF v_email IS NULL OR lower(v_email) <> v_inv.email THEN
      RAISE EXCEPTION 'INVITATION_WRONG_ACCOUNT: this invitation was sent to a different address'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_inv.status = 'declined' THEN
    RETURN jsonb_build_object(
      'invitation_id',    v_inv.id,
      'organization_id',  v_inv.organization_id,
      'already_declined', true
    );
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: this invitation expired at %', v_inv.expires_at
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE organization_invitations
     SET status = 'declined', responded_at = now(), responded_by = p_user_id
   WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'invitation_id',    v_inv.id,
    'organization_id',  v_inv.organization_id,
    'already_declined', false
  );
END;
$$;

-- Declining from the emailed link: the token is the proof, so no address check.
CREATE OR REPLACE FUNCTION decline_organization_invitation(
  p_token_hash text,
  p_user_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM organization_invitations WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: no invitation for this link' USING ERRCODE = 'P0002';
  END IF;
  RETURN decline_organization_invitation_by_id(v_id, p_user_id, false);
END;
$$;

-- An inviter withdrawing a pending invitation (expired or not), so its link stops
-- working at once rather than at expiry, e.g. one sent to a mistyped address.
CREATE OR REPLACE FUNCTION revoke_organization_invitation(
  p_invitation_id uuid,
  p_org_id        uuid,
  p_user_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv organization_invitations;
BEGIN
  SELECT * INTO v_inv FROM organization_invitations
   WHERE id = p_invitation_id AND organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: invitation % not found', p_invitation_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT has_org_permission(p_user_id, p_org_id, 'org.invite') THEN
    RAISE EXCEPTION 'INVITATION_FORBIDDEN: org.invite is required' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE organization_invitations
     SET status = 'revoked', responded_at = now(), responded_by = p_user_id
   WHERE id = v_inv.id;

  RETURN jsonb_build_object('id', v_inv.id, 'email', v_inv.email);
END;
$$;

-- =============================================
-- EXECUTE PRIVILEGES — SERVER-ONLY FUNCTIONS
-- Postgres grants EXECUTE on every new function to PUBLIC, and Supabase's
-- default privileges grant it to anon and authenticated as well. With the
-- public schema exposed through PostgREST, that makes every function above
-- callable as POST /rest/v1/rpc/<name> by any client, and a SECURITY DEFINER
-- function then runs with the owner's rights.
--
-- The functions below take the acting user, organization or reviewer as plain
-- arguments and check none of it themselves; the API routes do that before
-- calling them through the service role. Left callable, a client could replace
-- any organization's payout account, file an application as someone else, or
-- approve its own organization. So EXECUTE is revoked from every client role
-- (PUBLIC alone is not enough: anon and authenticated hold their own grants)
-- and granted to service_role only.
--
-- Nested calls are unaffected: create_organization_application calls
-- set_organization_bank_account as the function owner, not as the client.
--
-- Deliberately still callable by clients: app_user_id, can_act_for,
-- has_global_permission, has_org_permission, is_org_member, is_org_approved
-- (RLS policies and the user-session permission checks depend on them) and
-- get_participant_counts (read-only, public counts).
--
-- anonymise_user_audit_logs is not SECURITY DEFINER, and audit_logs has no
-- UPDATE policy, so a client call would change nothing. It is revoked anyway:
-- it is an operator tool for the deletion runbook, not something a client has
-- any reason to reach.
--
-- assert_tournament_capacity is revoked too. The enforce_tournament_capacity
-- trigger calls it with the inserting role's rights, but clients can no longer
-- insert registrations (004_rls.sql), so it only ever fires inside the
-- SECURITY DEFINER functions in 006, which run as the owner. count_taken_seats
-- is not SECURITY DEFINER (a client call would only count what RLS shows it),
-- but its callers are, so it is revoked with them.
--
-- supabase/tests/function_privileges.sql fails if a SECURITY DEFINER function is
-- executable by anon or authenticated without being on that list.
-- =============================================
-- =============================================
-- GUARDIANSHIPS
-- =============================================

-- =============================================
-- ENFORCE GUARDIANSHIP LIMIT
-- =============================================
-- A guardian may hold at most 10 active guardianships. Locks the guardian's
-- users row first, so two concurrent inserts for one guardian can't both see 9
-- and end on 11.
CREATE OR REPLACE FUNCTION enforce_guardianship_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  c_limit  constant integer := 10;
  v_active integer;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'active'
     AND OLD.guardian_user_id = NEW.guardian_user_id THEN
    RETURN NEW;
  END IF;

  -- Serializes cap checks per guardian. NO KEY UPDATE doesn't conflict with
  -- the KEY SHARE locks foreign keys take, so other rows referencing the
  -- guardian aren't held up.
  PERFORM 1 FROM users WHERE id = NEW.guardian_user_id FOR NO KEY UPDATE;

  SELECT count(*) INTO v_active
  FROM guardianships
  WHERE guardian_user_id = NEW.guardian_user_id
    AND status = 'active'
    AND id <> NEW.id;

  IF v_active >= c_limit THEN
    RAISE EXCEPTION 'GUARDIANSHIP_LIMIT_REACHED: a guardian may act for at most % players', c_limit
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_guardianship_limit
  BEFORE INSERT OR UPDATE OF status, guardian_user_id ON guardianships
  FOR EACH ROW EXECUTE FUNCTION enforce_guardianship_limit();

-- =============================================
-- HELPER INVITATIONS (#719)
-- All called by the API with the service role. Errors are RAISEd with a CODE:
-- prefix, which the routes map to responses.
--
-- create_helper_invitation: the player invites. Only a live self-managed
-- account with a login that isn't under 18 can (HELPER_INVITE_NOT_ALLOWED);
-- not to their own mailbox (HELPER_SELF); not to someone already helping them
-- (HELPER_ALREADY_ACTIVE). Inviting the same address again replaces the token
-- and restarts the 72 hours.
-- =============================================
CREATE FUNCTION create_helper_invitation(
  p_player_user_id uuid,
  p_email          text,
  p_relationship   guardianship_relationship,
  p_token_hash     text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email      text := lower(btrim(p_email));
  v_expires_at timestamptz := now() + interval '72 hours';
  v_player     users;
  v_id         uuid;
BEGIN
  SELECT * INTO v_player
  FROM users
  WHERE id = p_player_user_id
  FOR NO KEY UPDATE;

  IF NOT FOUND
     OR v_player.account_type <> 'self'
     OR v_player.auth_user_id IS NULL
     OR v_player.deleted_at IS NOT NULL
     OR self_managed_minor(p_player_user_id) THEN
    RAISE EXCEPTION 'HELPER_INVITE_NOT_ALLOWED: only a self-managed account aged 18 or over can invite a helper'
      USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(v_email, '') = '' OR strpos(v_email, '@') < 2 THEN
    RAISE EXCEPTION 'INVALID_HELPER_INVITATION: a valid email address is required'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_relationship = 'legal_guardian' THEN
    RAISE EXCEPTION 'INVALID_HELPER_INVITATION: a helper can''t be invited as a legal guardian'
      USING ERRCODE = 'P0001';
  END IF;

  IF canonical_email(v_email) = canonical_email(v_player.email) THEN
    RAISE EXCEPTION 'HELPER_SELF: you can''t invite yourself as your own helper'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM guardianships g
    JOIN users h ON h.id = g.guardian_user_id
    WHERE g.dependent_user_id = p_player_user_id
      AND g.status = 'active'
      AND h.deleted_at IS NULL
      AND h.email_canonical = canonical_email(v_email)
  ) THEN
    RAISE EXCEPTION 'HELPER_ALREADY_ACTIVE: this person already helps you'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE helper_invitations
  SET token_hash   = p_token_hash,
      relationship = p_relationship,
      created_at   = now(),
      expires_at   = v_expires_at
  WHERE player_user_id = p_player_user_id
    AND email = v_email
    AND status = 'pending'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO helper_invitations (
      player_user_id, email, relationship, token_hash, expires_at
    ) VALUES (
      p_player_user_id, v_email, p_relationship, p_token_hash, v_expires_at
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object(
    'invitation_id', v_id,
    'email', v_email,
    'expires_at', v_expires_at
  );
END;
$$;

-- =============================================
-- ACCEPT HELPER INVITATION
-- =============================================
-- The helper accepts with the emailed token. They must be signed in as the
-- invited mailbox (INVITATION_WRONG_ACCOUNT) and be a live self-managed adult
-- with a login (HELPER_NOT_ELIGIBLE). Inserts the guardianship, or reactivates
-- an earlier revoked or claimed row for the same pair. The helper accepts the
-- Terms version the server passes in. The cap of 10 active guardianships per
-- helper still applies. A second accept is refused (INVITATION_CLOSED).
CREATE FUNCTION accept_helper_invitation(
  p_token_hash     text,
  p_helper_user_id uuid,
  p_terms_version  text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inv          helper_invitations;
  v_helper       users;
  v_player       users;
  v_existing     guardianships;
  v_guardianship uuid;
BEGIN
  SELECT * INTO v_inv
  FROM helper_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: no invitation for this link'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: this invitation expired at %', v_inv.expires_at
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_helper FROM users WHERE id = p_helper_user_id;
  IF NOT FOUND
     OR v_helper.deleted_at IS NOT NULL
     OR v_helper.email IS NULL
     OR canonical_email(v_helper.email) <> canonical_email(v_inv.email) THEN
    RAISE EXCEPTION 'INVITATION_WRONG_ACCOUNT: this invitation was sent to a different address'
      USING ERRCODE = '42501';
  END IF;

  IF v_helper.id = v_inv.player_user_id THEN
    RAISE EXCEPTION 'HELPER_SELF: you can''t be your own helper'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_helper.account_type <> 'self'
     OR v_helper.auth_user_id IS NULL
     OR self_managed_minor(v_helper.id) THEN
    RAISE EXCEPTION 'HELPER_NOT_ELIGIBLE: a helper must hold their own account and be 18 or over'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_player FROM users WHERE id = v_inv.player_user_id;
  IF v_player.deleted_at IS NOT NULL
     OR v_player.account_type <> 'self'
     OR v_player.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'HELPER_INVITE_NOT_ALLOWED: this player can no longer be helped through an invitation'
      USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(btrim(p_terms_version), '') = '' THEN
    RAISE EXCEPTION 'INVALID_HELPER_INVITATION: the helper must accept the Terms'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing
  FROM guardianships
  WHERE guardian_user_id = v_helper.id
    AND dependent_user_id = v_inv.player_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'active' THEN
      RAISE EXCEPTION 'HELPER_ALREADY_ACTIVE: you already help this player'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE guardianships
    SET status               = 'active',
        revoked_at           = NULL,
        relationship         = v_inv.relationship,
        basis                = 'authorised',
        authorisation_method = 'player_invite',
        terms_version        = p_terms_version,
        terms_accepted_at    = now()
    WHERE id = v_existing.id;
    v_guardianship := v_existing.id;
  ELSE
    INSERT INTO guardianships (
      guardian_user_id, dependent_user_id, relationship, basis,
      authorisation_method, terms_version, terms_accepted_at
    ) VALUES (
      v_helper.id, v_inv.player_user_id, v_inv.relationship, 'authorised',
      'player_invite', p_terms_version, now()
    )
    RETURNING id INTO v_guardianship;
  END IF;

  UPDATE helper_invitations
  SET status          = 'accepted',
      responded_at    = now(),
      responded_by    = v_helper.id,
      guardianship_id = v_guardianship
  WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'invitation_id', v_inv.id,
    'guardianship_id', v_guardianship,
    'player_user_id', v_inv.player_user_id
  );
END;
$$;

-- =============================================
-- DECLINE HELPER INVITATION
-- =============================================
-- Anyone holding the token can say no, with or without an account; declining
-- grants nothing.
CREATE FUNCTION decline_helper_invitation(
  p_token_hash text,
  p_user_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inv helper_invitations;
BEGIN
  SELECT * INTO v_inv
  FROM helper_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: no invitation for this link'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status = 'declined' THEN
    RETURN jsonb_build_object('invitation_id', v_inv.id, 'already_declined', true);
  END IF;
  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: this invitation expired at %', v_inv.expires_at
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE helper_invitations
  SET status = 'declined', responded_at = now(), responded_by = p_user_id
  WHERE id = v_inv.id;

  RETURN jsonb_build_object('invitation_id', v_inv.id, 'already_declined', false);
END;
$$;

-- =============================================
-- REVOKE HELPER INVITATION
-- =============================================
-- The player withdraws a pending invitation.
CREATE FUNCTION revoke_helper_invitation(
  p_player_user_id uuid,
  p_invitation_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inv helper_invitations;
BEGIN
  SELECT * INTO v_inv
  FROM helper_invitations
  WHERE id = p_invitation_id
    AND player_user_id = p_player_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: invitation % not found', p_invitation_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status = 'revoked' THEN
    RETURN jsonb_build_object('invitation_id', v_inv.id, 'already_revoked', true);
  END IF;
  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE helper_invitations
  SET status = 'revoked', responded_at = now(), responded_by = p_player_user_id
  WHERE id = v_inv.id;

  RETURN jsonb_build_object('invitation_id', v_inv.id, 'already_revoked', false);
END;
$$;

-- =============================================
-- END HELPER GUARDIANSHIP
-- =============================================
-- The player revokes a helper, or the helper steps down. Either side, at any
-- time; nothing else changes, so registrations and payments the helper made
-- stay as they are. The player can end any active guardianship over their own
-- self-managed account, not only invited ones: an adult with capacity decides
-- who acts for them.
CREATE FUNCTION end_helper_guardianship(
  p_user_id         uuid,
  p_guardianship_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_g     guardianships;
  v_ended text;
BEGIN
  SELECT g.* INTO v_g
  FROM guardianships g
  JOIN users d ON d.id = g.dependent_user_id
  WHERE g.id = p_guardianship_id
    AND g.status = 'active'
    AND (
      g.guardian_user_id = p_user_id
      OR (g.dependent_user_id = p_user_id AND d.account_type = 'self')
    )
  FOR UPDATE OF g;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HELPER_NOT_FOUND: no active helper relationship with that id for this account'
      USING ERRCODE = 'P0002';
  END IF;

  v_ended := CASE WHEN v_g.guardian_user_id = p_user_id THEN 'helper' ELSE 'player' END;

  UPDATE guardianships
  SET status = 'revoked', revoked_at = now()
  WHERE id = v_g.id;

  RETURN jsonb_build_object(
    'guardianship_id', v_g.id,
    'ended_by', v_ended,
    'guardian_user_id', v_g.guardian_user_id,
    'dependent_user_id', v_g.dependent_user_id
  );
END;
$$;

-- =============================================
-- DEPENDENTS (#712)
-- A dependent is a player record with no login: a parent's child, or an
-- assisted adult whose carer acts for them. Both are a users row
-- (account_type 'managed', no auth_user_id), a player_profiles row and a
-- guardianships row. Called by the API with the service role. Errors are
-- RAISEd with a CODE: prefix and SQLSTATE P0001.
--
-- create_dependent inserts the three rows in one transaction and returns
-- {dependent_id, guardianship_id, reactivated}.
--   - The guardian must be a live self-managed account with a login.
--   - basis 'minor' needs a date of birth under 18 today in Malaysia
--     (Asia/Kuala_Lumpur), the same rule as self_managed_minor; 'authorised'
--     needs 18 or over, and records authorisation_method =
--     'guardian_attestation': the guardian confirms the player authorised them.
--   - 'appointed' is refused (BASIS_NOT_SUPPORTED): an appointed guardian
--     needs proof, and there is no document upload or admin review for it yet.
--   - Adding the same dependent again (same first name, last name and date of
--     birth, case-insensitively, among this guardian's managed dependents)
--     never creates a second player record. A revoked guardianship is
--     reactivated; an active one raises DEPENDENT_EXISTS.
--   - The guardian's users row is locked first, so two concurrent adds of the
--     same child can't both miss each other.
-- =============================================
CREATE FUNCTION create_dependent(
  p_guardian_user_id uuid,
  p_first_name       text,
  p_last_name        text,
  p_date_of_birth    date,
  p_relationship     guardianship_relationship,
  p_basis            guardianship_basis,
  p_terms_version    text,
  p_gender           gender DEFAULT NULL,
  p_nationality      text DEFAULT NULL,
  p_contact_email    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today         date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_adult_cutoff  date := (v_today - interval '18 years')::date;
  v_first_name    text := btrim(p_first_name);
  v_last_name     text := btrim(p_last_name);
  v_nationality   text := NULLIF(btrim(p_nationality), '');
  v_contact_email text := NULLIF(lower(btrim(p_contact_email)), '');
  v_method        guardianship_authorisation_method;
  v_existing      record;
  v_dependent_id  uuid;
  v_guardianship  uuid;
BEGIN
  PERFORM 1
  FROM users
  WHERE id = p_guardian_user_id
    AND account_type = 'self'
    AND auth_user_id IS NOT NULL
    AND deleted_at IS NULL
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: only a self-managed account can add dependents'
      USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(v_first_name, '') = '' OR coalesce(v_last_name, '') = '' THEN
    RAISE EXCEPTION 'INVALID_DEPENDENT: first and last name are required'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_date_of_birth IS NULL OR p_date_of_birth > v_today THEN
    RAISE EXCEPTION 'INVALID_DEPENDENT: a date of birth on or before today is required'
      USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(btrim(p_terms_version), '') = '' THEN
    RAISE EXCEPTION 'INVALID_DEPENDENT: the guardian must accept the Terms'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_basis = 'appointed' THEN
    RAISE EXCEPTION 'BASIS_NOT_SUPPORTED: an appointed guardianship needs proof and admin review, which isn''t available yet'
      USING ERRCODE = 'P0001';
  ELSIF p_basis = 'minor' THEN
    IF p_date_of_birth <= v_adult_cutoff THEN
      RAISE EXCEPTION 'BASIS_AGE_MISMATCH: basis minor needs a dependent under 18'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_contact_email IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_DEPENDENT: only an adult dependent may have a contact email'
        USING ERRCODE = 'P0001';
    END IF;
    v_method := NULL;
  ELSE
    IF p_date_of_birth > v_adult_cutoff THEN
      RAISE EXCEPTION 'BASIS_AGE_MISMATCH: basis % needs a dependent aged 18 or over', p_basis
        USING ERRCODE = 'P0001';
    END IF;
    v_method := 'guardian_attestation';
  END IF;

  SELECT g.id AS guardianship_id, g.status, u.id AS dependent_id
  INTO v_existing
  FROM guardianships g
  JOIN users u ON u.id = g.dependent_user_id
  JOIN player_profiles p ON p.user_id = u.id
  WHERE g.guardian_user_id = p_guardian_user_id
    AND u.account_type = 'managed'
    AND u.deleted_at IS NULL
    AND lower(u.first_name) = lower(v_first_name)
    AND lower(u.last_name) = lower(v_last_name)
    AND p.date_of_birth = p_date_of_birth
    AND g.status IN ('active', 'revoked')
  ORDER BY (g.status = 'active') DESC, g.created_at
  LIMIT 1
  FOR UPDATE OF g;

  IF FOUND THEN
    IF v_existing.status = 'active' THEN
      RAISE EXCEPTION 'DEPENDENT_EXISTS: this dependent is already on your account'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE guardianships
    SET status               = 'active',
        revoked_at           = NULL,
        relationship         = p_relationship,
        basis                = p_basis,
        authorisation_method = v_method,
        terms_version        = p_terms_version,
        terms_accepted_at    = now()
    WHERE id = v_existing.guardianship_id;

    UPDATE users
    SET contact_email = v_contact_email
    WHERE id = v_existing.dependent_id
      AND contact_email IS DISTINCT FROM v_contact_email;

    RETURN jsonb_build_object(
      'dependent_id', v_existing.dependent_id,
      'guardianship_id', v_existing.guardianship_id,
      'reactivated', true
    );
  END IF;

  INSERT INTO users (email, first_name, last_name, account_type, contact_email)
  VALUES (NULL, v_first_name, v_last_name, 'managed', v_contact_email)
  RETURNING id INTO v_dependent_id;

  INSERT INTO player_profiles (user_id, date_of_birth, gender, nationality)
  VALUES (v_dependent_id, p_date_of_birth, p_gender, v_nationality);

  INSERT INTO guardianships (
    guardian_user_id, dependent_user_id, relationship, basis,
    terms_version, terms_accepted_at, authorisation_method
  ) VALUES (
    p_guardian_user_id, v_dependent_id, p_relationship, p_basis,
    p_terms_version, now(), v_method
  )
  RETURNING id INTO v_guardianship;

  RETURN jsonb_build_object(
    'dependent_id', v_dependent_id,
    'guardianship_id', v_guardianship,
    'reactivated', false
  );
END;
$$;

-- =============================================
-- REVOKE DEPENDENT
-- =============================================
-- Sets the guardianship to 'revoked'. Nothing else changes: the dependent's
-- records, registrations and payments stay as they are.
--   - No active guardianship of that dependent by this guardian raises
--     DEPENDENT_NOT_FOUND, so a stranger learns nothing.
--   - A pending_payment registration for the dependent raises
--     DEPENDENT_HAS_PENDING_PAYMENT: the checkout in flight should be finished
--     or abandoned first.
--   - Confirmed registrations for tournaments that haven't ended are not
--     cancelled; they are returned so the API can warn about them.
CREATE FUNCTION revoke_dependent(
  p_guardian_user_id  uuid,
  p_dependent_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today        date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_guardianship uuid;
  v_upcoming     jsonb;
BEGIN
  SELECT id INTO v_guardianship
  FROM guardianships
  WHERE guardian_user_id = p_guardian_user_id
    AND dependent_user_id = p_dependent_user_id
    AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPENDENT_NOT_FOUND: no active dependent with that id on this account'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE user_id = p_dependent_user_id
      AND status = 'pending_payment'
  ) THEN
    RAISE EXCEPTION 'DEPENDENT_HAS_PENDING_PAYMENT: finish or abandon the dependent''s pending checkout first'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'registration_id', r.id,
           'tournament_id', t.id,
           'tournament_name', t.name,
           'start_date', t.start_date
         ) ORDER BY t.start_date, t.name), '[]'::jsonb)
  INTO v_upcoming
  FROM registrations r
  JOIN tournaments t ON t.id = r.tournament_id
  WHERE r.user_id = p_dependent_user_id
    AND r.status = 'confirmed'
    AND t.status <> 'cancelled'
    AND t.end_date >= v_today;

  UPDATE guardianships
  SET status = 'revoked',
      revoked_at = now()
  WHERE id = v_guardianship;

  RETURN jsonb_build_object(
    'guardianship_id', v_guardianship,
    'upcoming_registrations', v_upcoming
  );
END;
$$;

-- =============================================
-- ACCOUNT CLAIMS (#720)
-- Called by the API with the service role. Errors are RAISEd with a CODE:
-- prefix. Locks, in one order everywhere: the dependent's pending claim, then
-- the guardianship, then the dependent's users row, so a resend racing an
-- acceptance waits instead of deadlocking. Guardianship before users is also
-- the order checkout and consent recording use.
--
-- create_account_claim: the guardian starts a handover. Needs an active
-- guardianship (DEPENDENT_NOT_FOUND), a managed dependent (CLAIM_NOT_ALLOWED),
-- a date of birth that makes them 18 or over (UNDER_18), and an address that
-- no account uses yet (EMAIL_TAKEN: we don't merge automatically, the player
-- contacts support). Starting another claim cancels the pending one.
-- =============================================
CREATE FUNCTION create_account_claim(
  p_guardian_user_id  uuid,
  p_dependent_user_id uuid,
  p_email             text,
  p_token_hash        text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email   text := lower(btrim(p_email));
  v_user    users;
  v_dob     date;
  v_claim   account_claims;
BEGIN
  PERFORM 1 FROM account_claims
    WHERE dependent_user_id = p_dependent_user_id
      AND status = 'pending'
    FOR UPDATE;

  PERFORM 1 FROM guardianships
    WHERE guardian_user_id = p_guardian_user_id
      AND dependent_user_id = p_dependent_user_id
      AND status = 'active'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPENDENT_NOT_FOUND: no active dependent with that id on this account'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = p_dependent_user_id FOR UPDATE;
  IF v_user.account_type <> 'managed' OR v_user.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_NOT_ALLOWED: only a dependent with no login of their own can be handed over'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT date_of_birth INTO v_dob FROM player_profiles WHERE user_id = p_dependent_user_id;
  IF v_dob IS NULL
     OR v_dob > ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date THEN
    RAISE EXCEPTION 'UNDER_18: a player must be 18 or over to hold their own account'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_email = '' OR strpos(v_email, '@') = 0 THEN
    RAISE EXCEPTION 'INVALID_EMAIL: an email address is required' USING ERRCODE = '22023';
  END IF;

  IF email_registered(v_email) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN: an account already uses this email'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE account_claims
    SET status = 'cancelled', cancelled_at = now()
    WHERE dependent_user_id = p_dependent_user_id
      AND status = 'pending';

  INSERT INTO account_claims (dependent_user_id, guardian_user_id, email, token_hash, expires_at)
    VALUES (p_dependent_user_id, p_guardian_user_id, v_email, p_token_hash, now() + interval '72 hours')
    RETURNING * INTO v_claim;

  RETURN jsonb_build_object(
    'claim_id',   v_claim.id,
    'email',      v_claim.email,
    'expires_at', v_claim.expires_at
  );
END;
$$;

-- =============================================
-- CANCEL ACCOUNT CLAIM
-- =============================================
-- The guardian withdraws a pending claim.
CREATE FUNCTION cancel_account_claim(
  p_guardian_user_id  uuid,
  p_dependent_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM guardianships
    WHERE guardian_user_id = p_guardian_user_id
      AND dependent_user_id = p_dependent_user_id
      AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPENDENT_NOT_FOUND: no active dependent with that id on this account'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE account_claims
    SET status = 'cancelled', cancelled_at = now()
    WHERE dependent_user_id = p_dependent_user_id
      AND status = 'pending';
  RETURN FOUND;
END;
$$;

-- =============================================
-- LINK CLAIMED ACCOUNT
-- =============================================
-- The link step, bound to the player's VERIFIED email, so it runs when the auth
-- user's email is confirmed, inside the auth.users write that confirms it:
-- from handle_new_user when the auth user is created already confirmed, else
-- from handle_claimed_user_confirmed. Refuses (CLAIM_INVALID) a claim that
-- isn't pending, has expired, or whose guardianship is no longer active; an
-- auth user that isn't confirmed (CLAIM_EMAIL_UNVERIFIED) or doesn't reach the
-- claim's mailbox (CLAIM_EMAIL_MISMATCH); EMAIL_TAKEN, in case an account
-- appeared since; and UNDER_18 on the profile's date of birth. Then it:
--   - points the users row at the new login: auth_user_id, email,
--     account_type 'self', contact_email cleared, and the Terms the player
--     accepted;
--   - sets every active guardianship of the player to 'claimed', so each
--     guardian's access ends at that moment;
--   - marks the claim accepted.
-- Payments stay with whoever paid: payments.user_id is the payer.
CREATE FUNCTION link_claimed_account(
  p_auth_user_id       uuid,
  p_email              text,
  p_email_confirmed_at timestamptz,
  p_token_hash         text,
  p_terms_version      varchar(20)
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim account_claims;
  v_user  users;
  v_dob   date;
BEGIN
  SELECT * INTO v_claim FROM account_claims WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'pending' OR v_claim.expires_at <= now() THEN
    RAISE EXCEPTION 'CLAIM_INVALID: this handover link is no longer valid'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'CLAIM_EMAIL_UNVERIFIED: the account''s email must be verified'
      USING ERRCODE = 'P0001';
  END IF;
  IF canonical_email(p_email) IS DISTINCT FROM canonical_email(v_claim.email) THEN
    RAISE EXCEPTION 'CLAIM_EMAIL_MISMATCH: the account must use the address the link was sent to'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM guardianships
    WHERE guardian_user_id = v_claim.guardian_user_id
      AND dependent_user_id = v_claim.dependent_user_id
      AND status = 'active'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_INVALID: the guardian who started this handover no longer acts for this player'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_claim.dependent_user_id FOR UPDATE;
  IF v_user.account_type <> 'managed' OR v_user.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_INVALID: this record can''t be handed over any more'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT date_of_birth INTO v_dob FROM player_profiles WHERE user_id = v_user.id;
  IF v_dob IS NULL
     OR v_dob > ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date THEN
    RAISE EXCEPTION 'UNDER_18: a player must be 18 or over to hold their own account'
      USING ERRCODE = 'P0001';
  END IF;

  IF email_registered(p_email) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN: an account already uses this email'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE users
    SET auth_user_id      = p_auth_user_id,
        email             = p_email,
        account_type      = 'self',
        contact_email     = NULL,
        terms_version     = p_terms_version,
        terms_accepted_at = CASE WHEN p_terms_version IS NULL THEN NULL ELSE now() END
    WHERE id = v_user.id;

  UPDATE guardianships
    SET status = 'claimed'
    WHERE dependent_user_id = v_user.id
      AND status = 'active';

  UPDATE account_claims
    SET status = 'accepted', accepted_at = now(), auth_user_id = p_auth_user_id
    WHERE id = v_claim.id;

  RETURN v_user.id;
END;
$$;

-- =============================================
-- HANDLE CLAIMED USER CONFIRMED
-- =============================================
-- Runs link_claimed_account in the UPDATE that confirms a claiming auth user's
-- email. Admin createUser(email_confirm) reaches this or handle_new_user in the
-- same transaction, so creating the login and accepting the claim commit or
-- fail together.
CREATE FUNCTION handle_claimed_user_confirmed()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE auth_user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  PERFORM link_claimed_account(
    NEW.id, NEW.email, NEW.email_confirmed_at,
    NEW.raw_user_meta_data->>'claim_token_hash',
    NULLIF(NEW.raw_user_meta_data->>'terms_version', '')
  );
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'handle_claimed_user_confirmed failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE
      USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL
        AND NEW.email_confirmed_at IS NOT NULL
        AND NEW.raw_user_meta_data ? 'claim_token_hash')
  EXECUTE FUNCTION handle_claimed_user_confirmed();

-- =============================================
-- MINOR TURNS 18 (#721)
-- A guardian's authority on the 'minor' basis ends at 18. From the 18th
-- birthday (Asia/Kuala_Lumpur) the guardian can only view the record, start or
-- resend the handover, or end the guardianship: assert_payer_acts_for (006) and
-- record_sensitive_data_consent refuse with AGED_OUT. That lasts for a grace
-- period the scheduled job passes in (src/lib/guardianship/age-out.ts), after
-- which the guardianship is revoked, unless a pending, unexpired handover
-- claim is in flight.
--
-- minor_guardianship_aged_out: the one test, true when a 'minor'-basis
-- guardianship's dependent is 18 or over today.
-- =============================================
CREATE OR REPLACE FUNCTION minor_guardianship_aged_out(
  p_basis         guardianship_basis,
  p_date_of_birth date
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_basis = 'minor'
     AND p_date_of_birth IS NOT NULL
     AND p_date_of_birth <=
         ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date;
$$;

-- =============================================
-- CLAIM GUARDIANSHIP AGE OUT NOTICES
-- =============================================
-- Records and returns the upcoming / turned_18 notices due today, in one
-- INSERT ... ON CONFLICT DO NOTHING, so two overlapping runs can't both send
-- one.
CREATE OR REPLACE FUNCTION claim_guardianship_age_out_notices(
  p_notice_days integer,
  p_grace_days  integer
)
RETURNS TABLE (
  stage             guardianship_age_out_stage,
  guardianship_id   uuid,
  guardian_user_id  uuid,
  dependent_user_id uuid,
  turns_18_on       date,
  access_ends_on    date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
BEGIN
  IF p_notice_days IS NULL OR p_notice_days < 0 OR p_grace_days IS NULL OR p_grace_days < 0 THEN
    RAISE EXCEPTION 'notice and grace days must be zero or more' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT g.id,
           g.guardian_user_id,
           g.dependent_user_id,
           (p.date_of_birth + interval '18 years')::date AS turns_18_on
      FROM guardianships g
      JOIN player_profiles p ON p.user_id = g.dependent_user_id
     WHERE g.status = 'active'
       AND g.basis = 'minor'
       AND p.date_of_birth IS NOT NULL
       AND (p.date_of_birth + interval '18 years')::date <= v_today + p_notice_days
  ),
  staged AS (
    SELECT d.*,
           CASE WHEN d.turns_18_on <= v_today THEN 'turned_18'
                ELSE 'upcoming' END::guardianship_age_out_stage AS stage
      FROM due d
  ),
  recorded AS (
    INSERT INTO guardianship_age_out_notices (guardianship_id, stage)
    SELECT s.id, s.stage FROM staged s
    ON CONFLICT DO NOTHING
    RETURNING guardianship_age_out_notices.guardianship_id,
              guardianship_age_out_notices.stage
  )
  SELECT r.stage, s.id, s.guardian_user_id, s.dependent_user_id, s.turns_18_on,
         s.turns_18_on + p_grace_days
    FROM recorded r
    JOIN staged s ON s.id = r.guardianship_id AND s.stage = r.stage;
END;
$$;

-- =============================================
-- END AGED OUT MINOR GUARDIANSHIPS
-- =============================================
-- Revokes the guardianships whose grace period is over and returns them, with
-- their 'ended' notice recorded. Locks follow the established order: the
-- dependent's pending claim, then the guardianship.
CREATE OR REPLACE FUNCTION end_aged_out_minor_guardianships(p_grace_days integer)
RETURNS TABLE (
  guardianship_id   uuid,
  guardian_user_id  uuid,
  dependent_user_id uuid,
  turns_18_on       date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_row   record;
BEGIN
  IF p_grace_days IS NULL OR p_grace_days < 0 THEN
    RAISE EXCEPTION 'grace days must be zero or more' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT g.id, g.guardian_user_id, g.dependent_user_id,
           (p.date_of_birth + interval '18 years')::date AS turns_18_on
      FROM guardianships g
      JOIN player_profiles p ON p.user_id = g.dependent_user_id
     WHERE g.status = 'active'
       AND g.basis = 'minor'
       AND p.date_of_birth IS NOT NULL
       AND (p.date_of_birth + interval '18 years')::date + p_grace_days <= v_today
     ORDER BY g.id
  LOOP
    PERFORM 1 FROM account_claims c
      WHERE c.dependent_user_id = v_row.dependent_user_id
        AND c.status = 'pending'
        AND c.expires_at > now()
      FOR UPDATE;
    CONTINUE WHEN FOUND;

    UPDATE guardianships g
       SET status = 'revoked', revoked_at = now()
     WHERE g.id = v_row.id AND g.status = 'active';
    CONTINUE WHEN NOT FOUND;

    INSERT INTO guardianship_age_out_notices (guardianship_id, stage)
      VALUES (v_row.id, 'ended')
      ON CONFLICT DO NOTHING;

    guardianship_id   := v_row.id;
    guardian_user_id  := v_row.guardian_user_id;
    dependent_user_id := v_row.dependent_user_id;
    turns_18_on       := v_row.turns_18_on;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION set_organization_bank_account   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION set_player_bank_account         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_sensitive_data_consent   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_organization_application FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION review_organization_application FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION review_tournament_cancellation  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION assert_tournament_capacity      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION count_taken_seats               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION payout_recipient_problem        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION nominate_payout_beneficiary     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION accept_payout_nomination        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decline_payout_nomination       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_organization_invitation  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION accept_organization_invitation  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION accept_organization_invitation_by_id  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decline_organization_invitation FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decline_organization_invitation_by_id FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION revoke_organization_invitation  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION anonymise_user_audit_logs       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_global_permission_holders  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION assert_org_name_available FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION assert_org_entity_documents FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION resubmit_organization_application FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION set_organization_registered_name FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION email_registered(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION audit_log_retention() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION prune_audit_logs(boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION audit_logs_storage() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION enforce_guardianship_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_helper_invitation(uuid, text, guardianship_relationship, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION accept_helper_invitation(text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decline_helper_invitation(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION revoke_helper_invitation(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION end_helper_guardianship(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_dependent(uuid, text, text, date, guardianship_relationship, guardianship_basis, text, gender, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION revoke_dependent(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_account_claim FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION cancel_account_claim FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION link_claimed_account FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION handle_claimed_user_confirmed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION minor_guardianship_aged_out FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_guardianship_age_out_notices FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION end_aged_out_minor_guardianships FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION set_organization_bank_account   TO service_role;
GRANT EXECUTE ON FUNCTION set_player_bank_account         TO service_role;
GRANT EXECUTE ON FUNCTION record_sensitive_data_consent   TO service_role;
GRANT EXECUTE ON FUNCTION create_organization_application TO service_role;
GRANT EXECUTE ON FUNCTION review_organization_application TO service_role;
GRANT EXECUTE ON FUNCTION review_tournament_cancellation  TO service_role;
GRANT EXECUTE ON FUNCTION assert_tournament_capacity      TO service_role;
GRANT EXECUTE ON FUNCTION count_taken_seats               TO service_role;
GRANT EXECUTE ON FUNCTION payout_recipient_problem        TO service_role;
GRANT EXECUTE ON FUNCTION nominate_payout_beneficiary     TO service_role;
GRANT EXECUTE ON FUNCTION accept_payout_nomination        TO service_role;
GRANT EXECUTE ON FUNCTION decline_payout_nomination       TO service_role;
GRANT EXECUTE ON FUNCTION create_organization_invitation  TO service_role;
GRANT EXECUTE ON FUNCTION accept_organization_invitation  TO service_role;
GRANT EXECUTE ON FUNCTION accept_organization_invitation_by_id  TO service_role;
GRANT EXECUTE ON FUNCTION decline_organization_invitation TO service_role;
GRANT EXECUTE ON FUNCTION decline_organization_invitation_by_id TO service_role;
GRANT EXECUTE ON FUNCTION revoke_organization_invitation  TO service_role;
GRANT EXECUTE ON FUNCTION anonymise_user_audit_logs       TO service_role;
GRANT EXECUTE ON FUNCTION list_global_permission_holders  TO service_role;
GRANT EXECUTE ON FUNCTION assert_org_name_available TO service_role;
GRANT EXECUTE ON FUNCTION assert_org_entity_documents TO service_role;
GRANT EXECUTE ON FUNCTION resubmit_organization_application TO service_role;
GRANT EXECUTE ON FUNCTION set_organization_registered_name TO service_role;
GRANT EXECUTE ON FUNCTION email_registered(text) TO service_role;
GRANT EXECUTE ON FUNCTION audit_log_retention() TO service_role;
GRANT EXECUTE ON FUNCTION prune_audit_logs(boolean, integer) TO service_role;
GRANT EXECUTE ON FUNCTION audit_logs_storage() TO service_role;
GRANT EXECUTE ON FUNCTION create_helper_invitation(uuid, text, guardianship_relationship, text) TO service_role;
GRANT EXECUTE ON FUNCTION accept_helper_invitation(text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION decline_helper_invitation(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION revoke_helper_invitation(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION end_helper_guardianship(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION create_dependent(uuid, text, text, date, guardianship_relationship, guardianship_basis, text, gender, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION revoke_dependent(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION create_account_claim TO service_role;
GRANT EXECUTE ON FUNCTION cancel_account_claim TO service_role;
GRANT EXECUTE ON FUNCTION link_claimed_account TO service_role;
GRANT EXECUTE ON FUNCTION minor_guardianship_aged_out TO service_role;
GRANT EXECUTE ON FUNCTION claim_guardianship_age_out_notices TO service_role;
GRANT EXECUTE ON FUNCTION end_aged_out_minor_guardianships TO service_role;
