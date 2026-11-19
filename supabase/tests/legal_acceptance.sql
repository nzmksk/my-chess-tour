-- =============================================================================
-- Regression test for versioned legal acceptance (#517 / payout Phase 2).
--
-- Acceptance of the Terms of Service and the Organizer Agreement is evidence
-- that a specific document version was agreed to, and the payout machinery
-- (Phases 5-6) refuses to move money when an organization's agreement_version
-- is not current. That makes the shape of these columns load-bearing: a version
-- without a timestamp, or a timestamp without a version, is not an acceptance
-- and must not be storable.
--
-- Covers:
--   L1  users.chk_terms_shape rejects a version with no timestamp
--   L2  users.chk_terms_shape rejects a timestamp with no version
--   L3  both NULL and both set are accepted
--   L4  organizations.chk_agreement_shape rejects half-written acceptances
--   L5  a full organization acceptance (version + timestamp + acceptor) stores
--   L6  agreement_accepted_by survives the acceptor being deleted (SET NULL) —
--       the acceptance itself must not vanish with the user record
--   L7  handle_new_user persists terms_version from auth metadata and stamps
--       terms_accepted_at itself
--   L8  handle_new_user leaves BOTH columns NULL when no version was supplied,
--       so rows created outside signup still satisfy chk_terms_shape
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it builds
-- throwaway fixtures and persists NOTHING. A failing assertion RAISEs (and rolls
-- back); on success it prints "ALL SCENARIOS PASSED" via NOTICE.
--
-- L7/L8 insert into auth.users directly to fire on_auth_user_created; that is
-- what the signup route does through the Auth API.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_user     uuid;
  v_acceptor uuid;
  v_org      uuid;
  v_auth     uuid := gen_random_uuid();
  v_auth2    uuid := gen_random_uuid();
  v_version  text;
  v_at       timestamptz;
  v_by       uuid;
BEGIN
  -- ---- L1: version without timestamp is not an acceptance -----------------
  BEGIN
    INSERT INTO users (auth_user_id, email, first_name, last_name, terms_version)
      VALUES (gen_random_uuid(), 'legal-l1@test.local', 'L', 'One', '2026-08-02');
    RAISE EXCEPTION 'L1 FAIL: users accepted a terms_version with no terms_accepted_at';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'L1 PASS — terms_version without a timestamp rejected';
  END;

  -- ---- L2: timestamp without version is not an acceptance either ----------
  BEGIN
    INSERT INTO users (auth_user_id, email, first_name, last_name, terms_accepted_at)
      VALUES (gen_random_uuid(), 'legal-l2@test.local', 'L', 'Two', now());
    RAISE EXCEPTION 'L2 FAIL: users accepted a terms_accepted_at with no terms_version';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'L2 PASS — terms_accepted_at without a version rejected';
  END;

  -- ---- L3: both NULL and both set are fine --------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'legal-l3a@test.local', 'L', 'ThreeA');

  INSERT INTO users (auth_user_id, email, first_name, last_name,
                     terms_version, terms_accepted_at)
    VALUES (gen_random_uuid(), 'legal-l3b@test.local', 'L', 'ThreeB',
            '2026-08-02', now())
    RETURNING id INTO v_acceptor;
  RAISE NOTICE 'L3 PASS — neither-or-both accepted';

  -- ---- L4: the same rule on organizations ---------------------------------
  BEGIN
    INSERT INTO organizations (name, agreement_version)
      VALUES ('LEGAL ORG L4', '2026-08-02');
    RAISE EXCEPTION 'L4 FAIL: organizations accepted an agreement_version with no timestamp';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
  END;

  BEGIN
    INSERT INTO organizations (name, agreement_accepted_at)
      VALUES ('LEGAL ORG L4b', now());
    RAISE EXCEPTION 'L4 FAIL: organizations accepted an agreement_accepted_at with no version';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'L4 PASS — half-written organization acceptances rejected';
  END;

  -- ---- L5: a complete acceptance stores -----------------------------------
  INSERT INTO organizations (name, agreement_version, agreement_accepted_at,
                             agreement_accepted_by)
    VALUES ('LEGAL ORG', '2026-08-02', now(), v_acceptor)
    RETURNING id INTO v_org;

  SELECT agreement_version, agreement_accepted_at, agreement_accepted_by
    INTO v_version, v_at, v_by
  FROM organizations WHERE id = v_org;

  IF v_version <> '2026-08-02' OR v_at IS NULL OR v_by <> v_acceptor THEN
    RAISE EXCEPTION 'L5 FAIL: stored acceptance = (%, %, %)', v_version, v_at, v_by;
  END IF;
  RAISE NOTICE 'L5 PASS — full acceptance stored';

  -- ---- L6: deleting the acceptor must not erase the acceptance ------------
  DELETE FROM users WHERE id = v_acceptor;

  SELECT agreement_version, agreement_accepted_at, agreement_accepted_by
    INTO v_version, v_at, v_by
  FROM organizations WHERE id = v_org;

  IF v_version IS NULL OR v_at IS NULL THEN
    RAISE EXCEPTION 'L6 FAIL: acceptance lost when the acceptor was deleted';
  END IF;
  IF v_by IS NOT NULL THEN
    RAISE EXCEPTION 'L6 FAIL: agreement_accepted_by=% (expected NULL after ON DELETE SET NULL)', v_by;
  END IF;
  RAISE NOTICE 'L6 PASS — acceptance survives acceptor deletion, FK nulled';

  -- ---- L7: handle_new_user carries the version through --------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_auth, 'legal-l7@test.local',
            '{"first_name":"L","last_name":"Seven","terms_version":"2026-08-02"}'::jsonb);

  SELECT id, terms_version, terms_accepted_at INTO v_user, v_version, v_at
  FROM users WHERE auth_user_id = v_auth;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'L7 FAIL: handle_new_user did not create a users row';
  END IF;
  IF v_version <> '2026-08-02' THEN
    RAISE EXCEPTION 'L7 FAIL: terms_version=% (expected 2026-08-02)', v_version;
  END IF;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'L7 FAIL: terms_accepted_at was not stamped';
  END IF;
  RAISE NOTICE 'L7 PASS — signup persists the accepted terms version';

  -- ---- L8: no version supplied leaves both NULL ---------------------------
  INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES (v_auth2, 'legal-l8@test.local',
            '{"first_name":"L","last_name":"Eight"}'::jsonb);

  SELECT terms_version, terms_accepted_at INTO v_version, v_at
  FROM users WHERE auth_user_id = v_auth2;

  IF v_version IS NOT NULL OR v_at IS NOT NULL THEN
    RAISE EXCEPTION 'L8 FAIL: expected both NULL, got (%, %)', v_version, v_at;
  END IF;
  RAISE NOTICE 'L8 PASS — no metadata version leaves both columns NULL';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
