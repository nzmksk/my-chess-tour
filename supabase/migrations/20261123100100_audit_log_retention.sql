-- =============================================
-- #507: audit-log retention and pruning.
--
-- audit_logs keeps two snapshots per write on every audited table and nothing
-- ever removed them. Measured on a scratch database, one paid checkout writes 4
-- rows (about 3.8 KB of heap) once 20261123100000 drops the pointer-only
-- update: registration and payment inserts, then the paid payment and the
-- confirmed registration at settlement.
--
-- 1. Retention, in audit_log_retention(), the single source of truth (the
--    wiki and /privacy describe it):
--      never pruned  payments, refunds, payouts, prize_awards, prize_fundings,
--                    organization_bank_accounts, player_bank_accounts,
--                    tournaments, tournament_cancellation_requests, and
--                    registrations that were ever paid or confirmed. These are
--                    financial records or the evidence for one, kept for the
--                    7-year obligation. Disposal after 7 years is not
--                    automated.
--      1 year        users, player_profiles, organizations,
--                    organization_memberships, organization_documents,
--                    organization_invitations, user_global_roles
--      30 days       registrations that were never paid: abandoned, failed
--                    and expired checkouts, the bulk of the churn
--    A table not listed is never pruned, so a newly audited table is kept until
--    someone decides otherwise.
--
-- 2. prune_audit_logs(p_dry_run DEFAULT true, p_limit) reports, per policy
--    table, how many rows are past retention, and deletes at most p_limit of
--    them per call, oldest first. The caller (/api/v1/cron/audit-logs) repeats
--    the call, so no single statement deletes millions of rows. The tables
--    never pruned are refused twice: the policy may not name one, and the
--    DELETE excludes them whatever the policy says.
--
-- 3. idx_audit_logs_table_created makes the per-table cutoff scan an index
--    range scan.
--
-- 4. audit_logs_storage() reports the table's size for monitoring.
-- =============================================

CREATE INDEX IF NOT EXISTS idx_audit_logs_table_created
  ON audit_logs (table_name, created_at);

-- ---- 1. Retention policy ----------------------------------------------------
-- scope 'all': every row of the table past keep_for.
-- scope 'never_paid': registrations only; rows of a registration that still
-- exists, isn't confirmed or forfeited, and has no paid payment.
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

-- ---- 2. Pruning -------------------------------------------------------------
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
      WHERE a.table_name = 'registrations'
        AND a.created_at < v_cutoff
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
          WHERE a.table_name = 'registrations'
            AND a.table_name <> ALL (c_never_pruned)
            AND a.created_at < v_cutoff
            AND r.status NOT IN ('confirmed', 'forfeited')
            AND NOT EXISTS (
              SELECT 1 FROM payments p
              WHERE p.registration_id = r.id AND p.status = 'paid'
            )
          ORDER BY a.created_at
          LIMIT v_budget
        );
        GET DIAGNOSTICS deleted = ROW_COUNT;
      END IF;
    END IF;

    v_budget := v_budget - deleted;

    RETURN NEXT;
  END LOOP;
END;
$$;

-- ---- 4. Storage -------------------------------------------------------------
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

REVOKE EXECUTE ON FUNCTION audit_log_retention()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION prune_audit_logs(boolean, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION audit_logs_storage()               FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION audit_log_retention()              TO service_role;
GRANT  EXECUTE ON FUNCTION prune_audit_logs(boolean, integer) TO service_role;
GRANT  EXECUTE ON FUNCTION audit_logs_storage()               TO service_role;
