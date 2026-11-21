-- =============================================================================
-- STAGING ONLY: the qa_readonly group role for external QA (#468)
--
-- QA connect to the staging database from a terminal (psql) to check what the
-- app wrote. This creates the role that holds what they may do there: read
-- every table and view in public, and nothing else. Each tester then logs in as
-- their own role, made with add_qa_tester.sql, which is a member of this one.
--
-- qa_readonly itself cannot log in. It gets:
--   - USAGE on schema public and SELECT on every table and view in it
--   - SELECT on every table postgres creates in public from now on (default
--     privileges), so a table added by a later migration
--     is readable without re-running this file
-- and nothing more: no INSERT/UPDATE/DELETE/TRUNCATE, no sequences, no CREATE
-- on the schema, and no access to the auth or storage schemas (password hashes,
-- sessions, refresh tokens and uploaded files stay out of reach).
--
-- Server-only SECURITY DEFINER functions are already revoked from PUBLIC (the
-- EXECUTE PRIVILEGES blocks in 003 and 006), so a member of this role cannot
-- write through them either. supabase/tests/qa_readonly_access.sql checks all of the
-- above; run it after committing this.
--
-- NOT for production. Roles are per database cluster and nothing here is in
-- the base migrations, so production never gets this role unless this file is
-- run there. Everything a member can read includes users' emails and bank
-- account numbers, so staging must only ever hold test data.
--
-- Idempotent: safe to re-run. supabase/staging/drop_all.sql does not drop roles, and the
-- default privileges survive a teardown, so after drop_all + a rebuild the new
-- tables are readable again without re-running this.
--
-- It ends in ROLLBACK, so it is a dry run until that line is changed to COMMIT.
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres), against STAGING only.
-- Then add testers with add_qa_tester.sql. See docs/wiki/staging-db-access.md.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qa_readonly') THEN
    CREATE ROLE qa_readonly NOLOGIN;
  END IF;
END $$;

COMMENT ON ROLE qa_readonly IS
  'Read-only access to public for external QA on staging (#468). Group role: testers log in as members made by supabase/staging/add_qa_tester.sql.';

GRANT USAGE ON SCHEMA public TO qa_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO qa_readonly;

-- Tables are created by postgres (SQL editor / psql), so that is whose new
-- objects get the grant.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT ON TABLES TO qa_readonly;

ROLLBACK;
