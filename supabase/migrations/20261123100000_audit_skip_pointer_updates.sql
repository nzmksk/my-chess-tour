-- =============================================
-- #507: a pointer-only registrations update writes no audit row.
--
-- create_registration_with_payment inserts the registration, inserts its first
-- payment attempt, then points registrations.current_payment_id at it. That
-- third write was audited as a full before/after snapshot of the registration
-- (about 0.9 KB, one of 5 rows per paid checkout) recording nothing the
-- payment's own insert row doesn't: which registration the attempt belongs to.
-- A registrations UPDATE whose snapshots differ only in current_payment_id is
-- now skipped. Every other registrations update, including retries and
-- settlement, which change status as well, is audited as before.
-- =============================================

-- As in 20261120120510_audit_organization_invitations.sql, plus the
-- pointer-only skip for registrations.
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
