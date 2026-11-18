-- =============================================================================
-- Regression test for the staging QA read-only role (#468).
--
-- qa_readonly (db/maintenance/apply_qa_readonly_role.sql) must let QA read
-- everything in public and change nothing. The grants are the boundary: a
-- tester can switch off default_transaction_read_only in their own session.
--
-- Covers:
--   Q1  qa_readonly exists, cannot log in, and belongs to no other role (so it
--       picks up no privileges from anon, authenticated, service_role, ...)
--   Q2  it can SELECT every table, view and materialized view in public
--   Q3  it holds no write privilege on any relation in public, no USAGE or
--       UPDATE on any sequence, and no CREATE on the schema. This is the guard
--       for FUTURE objects: a table granted to PUBLIC fails here.
--   Q4  it can EXECUTE no SECURITY DEFINER function in public outside the
--       client-callable allowlist. Those run as their owner, so one granted to
--       PUBLIC would be a way to write with the owner's privileges.
--   Q5  a tester login made the way add_qa_tester.sql makes one sees rows
--       through RLS, and gets 42501 on INSERT / UPDATE / DELETE / TRUNCATE,
--       on a server-only function, and on CREATE TABLE
--
-- HOW TO RUN: paste into the Supabase SQL editor (or psql as postgres) on a
-- database where apply_qa_readonly_role.sql has been COMMITTED — staging, or a
-- local build. Runs inside a transaction that ROLLBACKs; the throwaway tester
-- login Q5 creates is rolled back with it. A failing assertion RAISEs; on
-- success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  -- Same list as v_client_callable in function_privileges.sql: read-only
  -- helpers that RLS policies call. Keep the two in sync.
  v_client_callable text[] := ARRAY[
    'app_user_id',
    'can_act_for',
    'has_global_permission',
    'has_org_permission',
    'is_org_member',
    'is_org_approved',
    'get_participant_counts'
  ];
  v_bad        text;
  v_count      bigint;
  v_qa_count   bigint;
BEGIN
  -- Q1 ---------------------------------------------------------------------
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qa_readonly') THEN
    RAISE EXCEPTION 'Q1 FAIL: role qa_readonly not found — commit db/maintenance/apply_qa_readonly_role.sql first';
  END IF;
  IF (SELECT rolcanlogin OR rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls
        FROM pg_roles WHERE rolname = 'qa_readonly') THEN
    RAISE EXCEPTION 'Q1 FAIL: qa_readonly must be a plain NOLOGIN group role (no LOGIN, SUPERUSER, CREATEROLE, CREATEDB or BYPASSRLS)';
  END IF;

  SELECT string_agg(g.rolname, ', ') INTO v_bad
    FROM pg_auth_members m
    JOIN pg_roles g ON g.oid = m.roleid
    WHERE m.member = 'qa_readonly'::regrole;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Q1 FAIL: qa_readonly is a member of %, and inherits its privileges', v_bad;
  END IF;
  RAISE NOTICE 'Q1 PASS — qa_readonly is a NOLOGIN role with no memberships';

  -- Q2 ---------------------------------------------------------------------
  SELECT string_agg(format('%I', c.relname), ', ') INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm')
      AND NOT has_table_privilege('qa_readonly', c.oid, 'SELECT');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Q2 FAIL: qa_readonly cannot read %. Re-run apply_qa_readonly_role.sql, or check the object was created by postgres (the default privileges are FOR ROLE postgres)', v_bad;
  END IF;
  RAISE NOTICE 'Q2 PASS — qa_readonly can read every table and view in public';

  -- Q3 ---------------------------------------------------------------------
  SELECT string_agg(format('%I (%s)', c.relname, p.priv), ', ') INTO v_bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
                       ('REFERENCES'), ('TRIGGER')) AS p(priv)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND has_table_privilege('qa_readonly', c.oid, p.priv);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Q3 FAIL: qa_readonly can write to %', v_bad;
  END IF;

  SELECT string_agg(format('%I', c.relname), ', ') INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'S'
      AND (has_sequence_privilege('qa_readonly', c.oid, 'USAGE')
           OR has_sequence_privilege('qa_readonly', c.oid, 'UPDATE'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Q3 FAIL: qa_readonly can advance sequences %', v_bad;
  END IF;

  IF has_schema_privilege('qa_readonly', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Q3 FAIL: qa_readonly can CREATE in schema public';
  END IF;
  RAISE NOTICE 'Q3 PASS — qa_readonly has no write, sequence or CREATE privilege in public';

  -- Q4 ---------------------------------------------------------------------
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO v_bad
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype   -- cannot be called directly
      AND p.proname <> ALL (v_client_callable)
      AND has_function_privilege('qa_readonly', p.oid, 'EXECUTE');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Q4 FAIL: qa_readonly can execute SECURITY DEFINER functions %. Revoke EXECUTE FROM PUBLIC (see 003 EXECUTE PRIVILEGES).', v_bad;
  END IF;
  RAISE NOTICE 'Q4 PASS — no server-only SECURITY DEFINER function is executable by qa_readonly';

  -- Q5 ---------------------------------------------------------------------
  -- Mirrors add_qa_tester.sql. Rolled back with the transaction.
  CREATE ROLE qa_readonly_test_468 LOGIN INHERIT BYPASSRLS IN ROLE qa_readonly;
  -- On Supabase postgres is not a superuser, and since Postgres 16 creating a
  -- role does not let its creator SET ROLE to it until it grants itself
  -- membership.
  GRANT qa_readonly_test_468 TO CURRENT_USER;

  SELECT count(*) INTO v_count FROM users;
  SET LOCAL ROLE qa_readonly_test_468;
  SELECT count(*) INTO v_qa_count FROM users;
  RESET ROLE;
  IF v_qa_count <> v_count THEN
    RAISE EXCEPTION 'Q5 FAIL: tester login sees % of % users — RLS is filtering it', v_qa_count, v_count;
  END IF;

  BEGIN
    SET LOCAL ROLE qa_readonly_test_468;
    INSERT INTO waitlist (email) VALUES ('qa-468@example.com');
    RAISE EXCEPTION 'Q5 FAIL: tester login could INSERT into waitlist';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    SET LOCAL ROLE qa_readonly_test_468;
    UPDATE tournaments SET name = name;
    RAISE EXCEPTION 'Q5 FAIL: tester login could UPDATE tournaments';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    SET LOCAL ROLE qa_readonly_test_468;
    DELETE FROM payments;
    RAISE EXCEPTION 'Q5 FAIL: tester login could DELETE from payments';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    SET LOCAL ROLE qa_readonly_test_468;
    TRUNCATE audit_logs;
    RAISE EXCEPTION 'Q5 FAIL: tester login could TRUNCATE audit_logs';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    SET LOCAL ROLE qa_readonly_test_468;
    PERFORM settle_registration_payment(NULL, true);
    RAISE EXCEPTION 'Q5 FAIL: tester login could call settle_registration_payment';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    SET LOCAL ROLE qa_readonly_test_468;
    CREATE TABLE public.qa_readonly_test_468 (x int);
    RAISE EXCEPTION 'Q5 FAIL: tester login could CREATE TABLE in public';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;
  RAISE NOTICE 'Q5 PASS — tester login reads through RLS (% users) and every write is refused', v_qa_count;

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
