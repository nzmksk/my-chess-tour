-- =============================================
-- AUDIT organization_invitations (#470)
--
-- The table decides who is offered which organization role, but it had no
-- audit trigger: sending, re-sending, declining and revoking an invitation left
-- no trace, and accepting one showed up only as the organization_memberships
-- INSERT. It now sits with the other access-control tables.
--
-- Every write goes through a SECURITY DEFINER function the server calls with
-- the service role (create_organization_invitation, accept_/decline_
-- organization_invitation[_by_id], revoke_organization_invitation), so the
-- actor and context come from the x-audit-* headers
-- (20261120042837_audit_actor_and_context.sql). Expiry is derived from
-- expires_at, never stored, so it writes no row.
--
-- Three parts:
--   1. redact_audit_snapshot masks token_hash. It is the SHA-256 of a live
--      bearer token, and audit_logs outlives the invitation. The last 4
--      characters survive, which still shows a re-send rotated it.
--   2. audit_trigger_func reads organization_id from the row, so the
--      "Org admins can view org-scoped audit logs" policy shows these rows to
--      the organization's admins, who can already see the invitations.
--   3. The trigger.
-- =============================================

-- ---- 1. Redaction --------------------------------------------------------
-- The full list, as in 003, plus organization_invitations.token_hash.
--   player_profiles.bank_account_number (a column since moved to
--     player_bank_accounts, kept for rows written before), organization_bank_accounts.
--     account_number, player_bank_accounts.account_number: masked to the last 4 digits.
--   player_profiles.oku_document_path, organization_documents.storage_path:
--     capability-bearing; anyone holding one can be issued a signed URL to a
--     private-bucket document. Filename rule: only the extension survives.
--   organization_documents.original_filename: whatever the uploader called the
--     file, which for an identity document is often the IC number or full name
--     ("MyKad_880101-14-5678.pdf"). Filename rule.
--   organization_invitations.token_hash: the hash of the invitation link's
--     token. Masked to the last 4 characters.
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

-- ---- 2. organization_id scoping --------------------------------------------
-- audit_trigger_func as in 20261120042837_audit_actor_and_context.sql, with
-- organization_invitations added to the tables that carry organization_id.
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
  -- What to redact per table lives in redact_audit_snapshot. Unlisted tables
  -- pass through untouched.
  v_old := redact_audit_snapshot(TG_TABLE_NAME, v_old);
  v_new := redact_audit_snapshot(TG_TABLE_NAME, v_new);

  -- Resolve organization_id based on source table
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
  -- users, player_profiles, player_bank_accounts, user_global_roles → v_org_id stays NULL

  -- The server-asserted headers, only on a service-role request (see above).
  IF v_claims ->> 'role' = 'service_role' THEN
    v_headers := NULLIF(current_setting('request.headers', true), '')::jsonb;
  END IF;

  -- changed_by is a FK to users(id), but the JWT carries the AUTH id, so it has
  -- to be resolved through users.auth_user_id. Reading the claim directly would
  -- write an id that only coincidentally resolves while self-signup keeps the
  -- two equal, and would violate the FK the moment they diverge.
  -- Not app_user_id(): this trigger also fires under the service role and from
  -- SECURITY DEFINER functions, where auth.uid() is NULL — reading the claim
  -- keeps attribution working in those paths, and NULL means "no user acted".
  SELECT u.id INTO v_changed_by
  FROM public.users u
  WHERE u.auth_user_id = NULLIF(v_claims ->> 'sub', '')::uuid;

  -- No session of its own: the actor the server (or a runbook) named. This one
  -- is already a users.id, not an auth id.
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

-- ---- 3. The trigger ---------------------------------------------------------
CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON organization_invitations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();
