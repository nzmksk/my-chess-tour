-- =============================================================================
-- STAGING ONLY: add one QA tester login (#468)
--
-- Creates a login role for one person, as a member of qa_readonly (made by
-- apply_qa_readonly_role.sql, which must have been committed first). One login
-- per tester, so access can be revoked from one person without touching
-- anyone else's, and pg_stat_activity shows who is connected.
--
-- The login gets, on top of qa_readonly's SELECT grants:
--   BYPASSRLS   Every table in public has RLS on, and no policy matches a QA
--               login (they all go through auth.uid()), so without it every
--               query returns zero rows. It only lifts row filtering: the
--               login still has no write privilege on any table.
--               It is set here and not on qa_readonly because role attributes
--               are not inherited through membership.
--   default_transaction_read_only = on
--               A second guard on top of the missing grants. The tester can
--               turn it off in their own session, so it is not the
--               boundary — the grants are — but it stops an accidental write.
--   statement_timeout / idle_in_transaction_session_timeout
--               So a heavy query or a forgotten open transaction cannot hold
--               up the app on the shared staging database.
--   CONNECTION LIMIT 3 and VALID UNTIL (v_valid_days from today)
--
-- It is created WITHOUT a password, so nobody can log in as it yet. Set one
-- afterwards from psql, so the password is sent hashed and never lands in the
-- SQL editor's history:
--     \password qa_<name>
--
-- Set v_login (and v_valid_days if 90 is wrong) below. It ends in ROLLBACK, so
-- it is a dry run until that line is changed to COMMIT.
--
-- To remove a tester:  DROP ROLE qa_<name>;
-- To extend access:    ALTER ROLE qa_<name> VALID UNTIL '<date>';
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres), against STAGING only.
-- See docs/wiki/staging-db-access.md for how the tester then connects.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_login      text    := 'qa_CHANGE_ME';  -- qa_ + lowercase letters, digits, _
  v_valid_days integer := 90;
BEGIN
  IF v_login !~ '^qa_[a-z0-9_]+$' OR v_login IN ('qa_readonly', 'qa_change_me') THEN
    RAISE EXCEPTION 'Set v_login to qa_<name> (lowercase letters, digits, _), got %', v_login;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qa_readonly') THEN
    RAISE EXCEPTION 'qa_readonly does not exist: commit apply_qa_readonly_role.sql first';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_login) THEN
    RAISE EXCEPTION 'Role % already exists', v_login;
  END IF;

  EXECUTE format(
    'CREATE ROLE %I LOGIN INHERIT BYPASSRLS CONNECTION LIMIT 3 VALID UNTIL %L IN ROLE qa_readonly',
    v_login, (current_date + v_valid_days)::timestamptz
  );
  EXECUTE format('ALTER ROLE %I SET default_transaction_read_only = on', v_login);
  EXECUTE format('ALTER ROLE %I SET statement_timeout = %L', v_login, '30s');
  EXECUTE format('ALTER ROLE %I SET idle_in_transaction_session_timeout = %L', v_login, '60s');
  EXECUTE format(
    'COMMENT ON ROLE %I IS %L', v_login,
    format('QA tester login (#468), member of qa_readonly. Added %s.', current_date)
  );

  RAISE NOTICE 'Created %, valid until %. Now set its password from psql: \password %',
    v_login, current_date + v_valid_days, v_login;
END $$;

ROLLBACK;
