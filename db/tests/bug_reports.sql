-- =============================================================================
-- Regression test for the bug_reports table (#616).
--
-- An in-app bug report is filed as an issue on the PUBLIC GitHub repo, so the
-- issue never names the reporter. This table is where the reporter is kept,
-- which makes it private by design: the row links a user to text they wrote.
--
-- Covers:
--   B1  a signed-in user can't read any report, including their own
--   B2  a signed-in user can't write one directly (only the server does)
--   B3  a platform admin reads every report
--   B4  the reporter link goes (SET NULL) when the account is deleted, and the
--       report itself stays
--   B5  chk_bug_report_filed: an issue number and filed_at come together
--   B6  chk_bug_report_description rejects a blank report
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it builds
-- throwaway fixtures and persists NOTHING. A failing assertion RAISEs (and rolls
-- back); on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_reporter_auth uuid := gen_random_uuid();
  v_admin_auth    uuid := gen_random_uuid();
  v_reporter      uuid;
  v_admin         uuid;
  v_admin_role    integer;
  v_manage        integer;
  v_report        uuid;
  v_count         integer;
  v_user_id       uuid;
BEGIN
  -- ---- fixtures -------------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_reporter_auth, 'bug-reporter@test.local', 'Bug', 'Reporter')
    RETURNING id INTO v_reporter;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_admin_auth, 'bug-admin@test.local', 'Bug', 'Admin')
    RETURNING id INTO v_admin;

  -- Seeded by 006, but this test must not depend on the seed having run.
  INSERT INTO roles (name, scope) VALUES ('platform_admin', 'global')
    ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_admin_role FROM roles WHERE name = 'platform_admin';
  INSERT INTO permissions (key) VALUES ('platform.manage')
    ON CONFLICT (key) DO NOTHING;
  SELECT id INTO v_manage FROM permissions WHERE key = 'platform.manage';
  INSERT INTO role_permissions (role_id, permission_id) VALUES (v_admin_role, v_manage)
    ON CONFLICT DO NOTHING;
  INSERT INTO user_global_roles (user_id, role_id) VALUES (v_admin, v_admin_role);

  -- What POST /api/v1/feedback writes, through the service role.
  INSERT INTO bug_reports (user_id, description, context)
    VALUES (v_reporter, 'The register button does nothing', '{"path": "/"}')
    RETURNING id INTO v_report;
  INSERT INTO bug_reports (user_id, description)
    VALUES (NULL, 'Signed-out report');

  -- ===== B1: a reporter can't read reports, not even their own ==============
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_reporter_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM bug_reports;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'B1 FAIL: a signed-in user sees % bug reports (expected 0)', v_count;
  END IF;
  RAISE NOTICE 'B1 PASS — a signed-in user reads no bug reports';

  -- ===== B2: no client writes ===============================================
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO bug_reports (user_id, description)
      VALUES (v_reporter, 'Written from the browser');
    RAISE EXCEPTION 'B2 FAIL: a signed-in user inserted a bug report directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE bug_reports SET github_issue_number = 1, filed_at = now()
      WHERE id = v_report;
    RAISE EXCEPTION 'B2 FAIL: a signed-in user updated a bug report';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    SET LOCAL ROLE anon;
    INSERT INTO bug_reports (description) VALUES ('Anonymous browser write');
    RAISE EXCEPTION 'B2 FAIL: anon inserted a bug report directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'B2 PASS — no client role can write bug reports';

  -- ===== B3: platform admins read everything ================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM bug_reports;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'B3 FAIL: a platform admin sees % bug reports (expected 2)', v_count;
  END IF;
  RAISE NOTICE 'B3 PASS — a platform admin reads every bug report';

  -- ===== B4: account deletion clears the link, keeps the report =============
  DELETE FROM users WHERE id = v_reporter;
  SELECT user_id INTO v_user_id FROM bug_reports WHERE id = v_report;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'B4 FAIL: deleting the reporter deleted the report';
  END IF;
  IF v_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'B4 FAIL: the report still names the deleted user';
  END IF;
  RAISE NOTICE 'B4 PASS — account deletion unlinks the reporter and keeps the report';

  -- ===== B5: an issue number and filed_at come together =====================
  BEGIN
    UPDATE bug_reports SET github_issue_number = 42 WHERE id = v_report;
    RAISE EXCEPTION 'B5 FAIL: an issue number was stored without filed_at';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  UPDATE bug_reports SET github_issue_number = 42, filed_at = now() WHERE id = v_report;
  RAISE NOTICE 'B5 PASS — a filed report records both the issue number and filed_at';

  -- ===== B6: a blank report is refused ======================================
  BEGIN
    INSERT INTO bug_reports (description) VALUES (E'  \n ');
    RAISE EXCEPTION 'B6 FAIL: a blank description was stored';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  RAISE NOTICE 'B6 PASS — a blank description is refused';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
