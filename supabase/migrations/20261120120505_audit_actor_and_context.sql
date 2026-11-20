-- =============================================
-- AUDIT ATTRIBUTION: WHO ACTED, AND WHY (#470)
--
-- audit_trigger_func resolved changed_by only from the JWT `sub`, and context
-- only from the app.audit_context setting. Almost every write reaches the
-- database through the service-role client (directly, or through a SECURITY
-- DEFINER function it calls), and a service-role request carries no `sub`. So
-- changed_by was NULL on nearly every row, and context was always 'trigger'
-- (or 'seed').
--
-- The server now states both on the request itself, as two headers PostgREST
-- exposes in request.headers:
--   x-audit-actor    the public.users.id of the signed-in user whose request
--                    caused the write
--   x-audit-context  a short label for what was done ('tournament.publish',
--                    'webhook.chip', 'cron.refunds', ...)
-- (src/services/supabase/audit-context.ts sets them.)
--
-- They are trusted ONLY on a service-role request. Anyone can send a header,
-- but only the server holds the secret key, so an anon or authenticated client
-- that sends x-audit-actor is ignored and its writes are attributed exactly as
-- before: to its own `sub`, or to nobody.
--
-- Resolution order:
--   changed_by: the JWT `sub` (a user's own request) → the app.audit_actor
--               setting (SQL run by hand, e.g. a runbook) → x-audit-actor.
--               A value that isn't a uuid, or names no user, gives NULL rather
--               than failing the write: changed_by is a FK, and a bad
--               attribution must never block the business write it describes.
--   context:    app.audit_context (the seed, a runbook) → x-audit-context →
--               'trigger'. Cut to the column's 100 characters for the same
--               reason.
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
    'organization_bank_accounts', 'organization_documents', 'prize_awards'
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
