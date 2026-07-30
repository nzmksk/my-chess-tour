-- =============================================================================
-- RLS regression test for the identity indirection (#501):
--   * app_user_id()  (003_functions_triggers.sql) resolving a JWT sub to a
--     public.users.id through users.auth_user_id
--   * can_act_for()  currently the self check, and the policies that must NOT
--     use it (user_global_roles, users, organization_memberships, audit_logs)
--   * per-user isolation on player_profiles / registrations / payments / refunds
--     surviving the switch from "auth.uid() = user_id" to can_act_for()
--   * the identity bridge itself being immune to client writes — users.id,
--     users.auth_user_id and users.is_verified (004_rls.sql revokes client
--     UPDATE on users; 003 adds guard_users_identity_columns as a backstop)
--
-- WHY THE FIXTURES USE DIVERGENT IDS: self-signup writes users.id = auth_user_id,
-- so a test using equal ids would pass identically against the OLD auth.uid()
-- policies and prove nothing. Every user here is created with a users.id that
-- deliberately differs from its auth_user_id, so any policy still comparing
-- auth.uid() to a user_id column fails loudly.
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. The whole thing runs inside a transaction that
-- ROLLBACKs at the end, so it builds throwaway fixtures and persists NOTHING.
-- A failing assertion RAISEs an exception (and rolls back); on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org        uuid;
  v_tournament uuid;
  -- roles.id is `integer GENERATED ALWAYS AS IDENTITY`, not a uuid like most
  -- other PKs in this schema.
  v_admin_role integer;

  -- users.id (application identity)
  v_a_app  uuid; v_b_app  uuid;
  -- auth.users.id (the JWT sub) — deliberately different values
  v_a_auth uuid := gen_random_uuid();
  v_b_auth uuid := gen_random_uuid();

  v_res     jsonb;
  v_reg_a   uuid; v_reg_b uuid;
  v_pay_a   uuid; v_pay_b uuid;
  v_gross   integer;
  v_count   integer;
  v_got     uuid;
  v_bool    boolean;
BEGIN
  -- ---- fixtures (service role: RLS not enforced) --------------------------
  INSERT INTO organizations (name) VALUES ('IDENTITY ORG') RETURNING id INTO v_org;

  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_a_auth, 'identity-a@test.local', 'A', 'T') RETURNING id INTO v_a_app;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_b_auth, 'identity-b@test.local', 'B', 'T') RETURNING id INTO v_b_app;

  -- Guard the premise of the whole test.
  IF v_a_app = v_a_auth OR v_b_app = v_b_auth THEN
    RAISE EXCEPTION 'SETUP FAIL: users.id collided with auth_user_id — fixtures must diverge';
  END IF;

  INSERT INTO player_profiles (user_id) VALUES (v_a_app), (v_b_app);

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'IDENTITY T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  v_res := create_registration_with_payment(v_a_app, v_tournament, 'standard', 10000);
  v_reg_a := (v_res->>'registration_id')::uuid;
  v_pay_a := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay_a;
  PERFORM settle_registration_payment(v_pay_a, true, v_gross, 'fpx_b2c');

  v_res := create_registration_with_payment(v_b_app, v_tournament, 'standard', 10000);
  v_reg_b := (v_res->>'registration_id')::uuid;
  v_pay_b := (v_res->>'payment_id')::uuid;
  PERFORM settle_registration_payment(v_pay_b, true, v_gross, 'visa');

  INSERT INTO refunds (registration_id, refund_amount_cents, reason, status, requested_by)
    VALUES (v_reg_a, v_gross, 'test', 'pending', v_a_app);
  INSERT INTO refunds (registration_id, refund_amount_cents, reason, status, requested_by)
    VALUES (v_reg_b, v_gross, 'test', 'pending', v_b_app);

  -- Give B a global role, so I5's self-only check has something to not-see.
  -- Seeded by 006, but this test must not depend on the seed having run: with no
  -- role on B there is no row to leak and I5 would pass vacuously.
  INSERT INTO roles (name, scope) VALUES ('platform_admin', 'global')
    ON CONFLICT (name) DO NOTHING;
  SELECT id INTO v_admin_role FROM roles WHERE name = 'platform_admin';
  INSERT INTO user_global_roles (user_id, role_id) VALUES (v_b_app, v_admin_role);

  -- ---- act as user A ------------------------------------------------------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_a_auth)::text, true);
  SET LOCAL ROLE authenticated;

  -- ===== I1: app_user_id() resolves the JWT sub to the users.id ============
  SELECT app_user_id() INTO v_got;
  IF v_got IS DISTINCT FROM v_a_app THEN
    RAISE EXCEPTION 'I1 FAIL: app_user_id()=% (expected %, the users.id — got the auth id?)', v_got, v_a_app;
  END IF;
  RAISE NOTICE 'I1 PASS — app_user_id() resolved auth id to users.id through auth_user_id';

  -- ===== I2: can_act_for() is the self check, and only the self check ======
  IF NOT can_act_for(v_a_app) THEN
    RAISE EXCEPTION 'I2 FAIL: can_act_for(self) was false';
  END IF;
  IF can_act_for(v_b_app) THEN
    RAISE EXCEPTION 'I2 FAIL: can_act_for(other) was true — it must widen only via #504';
  END IF;
  -- Passing the AUTH id must never authorise anything.
  IF can_act_for(v_a_auth) THEN
    RAISE EXCEPTION 'I2 FAIL: can_act_for(auth id) was true — identity spaces are being conflated';
  END IF;
  RAISE NOTICE 'I2 PASS — can_act_for() authorises self only, and rejects the auth id';

  -- ===== I3: per-user isolation on the can_act_for() tables ================
  SELECT count(*) INTO v_count FROM player_profiles;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'I3 FAIL: player_profiles visible=% (expected 1 — own only)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM player_profiles WHERE user_id = v_b_app;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'I3 FAIL: another user''s player_profiles row was readable';
  END IF;

  SELECT count(*) INTO v_count FROM registrations;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'I3 FAIL: registrations visible=% (expected 1 — own only)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM registrations WHERE id = v_reg_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'I3 FAIL: another user''s registration was readable';
  END IF;

  SELECT count(*) INTO v_count FROM payments WHERE id = v_pay_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'I3 FAIL: another user''s payment was readable';
  END IF;
  SELECT count(*) INTO v_count FROM payments WHERE id = v_pay_a;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'I3 FAIL: own payment was NOT readable (count=%)', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM refunds WHERE requested_by = v_b_app;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'I3 FAIL: another user''s refund was readable';
  END IF;
  SELECT count(*) INTO v_count FROM refunds WHERE requested_by = v_a_app;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'I3 FAIL: own refund was NOT readable (count=%)', v_count;
  END IF;
  RAISE NOTICE 'I3 PASS — player_profiles/registrations/payments/refunds scoped to the caller';

  -- ===== I4: users — own row visible, others not ===========================
  SELECT count(*) INTO v_count FROM users WHERE id = v_a_app;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'I4 FAIL: own users row was NOT readable — app_user_id() likely mis-resolves';
  END IF;
  SELECT count(*) INTO v_count FROM users WHERE id = v_b_app;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'I4 FAIL: another user''s users row was readable';
  END IF;
  RAISE NOTICE 'I4 PASS — users row scoped to the caller';

  -- ===== I5: the deliberately self-only policies did not widen =============
  -- Regression guard for the day can_act_for() grows an OR (#504): if any of
  -- these ever start using it, a guardian would silently inherit a dependent's
  -- platform-admin role or org membership.
  SELECT count(*) INTO v_count FROM user_global_roles WHERE user_id = v_b_app;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'I5 FAIL: another user''s global role was readable';
  END IF;
  SELECT count(*) INTO v_count FROM audit_logs
   WHERE table_name IN ('users','player_profiles') AND record_id = v_b_app::text;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'I5 FAIL: another user''s account audit logs were readable';
  END IF;
  RAISE NOTICE 'I5 PASS — user_global_roles and audit_logs remain self-only';

  -- ===== I6: the identity bridge cannot be rewritten by a client session ===
  -- Regression guard: `users` had a blanket UPDATE policy with no column
  -- restriction. Postgres reuses a UPDATE policy's USING clause as its WITH
  -- CHECK, and app_user_id() is STABLE (resolved against the pre-update
  -- snapshot), so the check only ever verified that `id` was unchanged —
  -- leaving every other column writable through PostgREST by anyone holding
  -- that user's JWT. Nulling auth_user_id orphans the record permanently;
  -- repointing it is an account-takeover primitive once managed records exist
  -- (#504/#505); is_verified let an account skip the emailed code entirely.
  --
  -- These assert on the DATA, not on which layer refused the write: the grant
  -- raises insufficient_privilege, a policy would silently match zero rows, and
  -- the trigger raises P0001. All three are acceptable; a changed row is not.
  -- (Asserting on the exception would also swallow this block's own FAIL raise,
  -- which is P0001 too — a test that cannot fail.)
  BEGIN
    UPDATE users SET auth_user_id = NULL WHERE id = v_a_app;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SELECT auth_user_id INTO v_got FROM users WHERE id = v_a_app;
  IF v_got IS DISTINCT FROM v_a_auth THEN
    RAISE EXCEPTION 'I6 FAIL: a client session changed its own auth_user_id (now %)', v_got;
  END IF;

  -- id is what every other table's FK points at.
  BEGIN
    UPDATE users SET id = gen_random_uuid() WHERE id = v_a_app;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SELECT count(*) INTO v_count FROM users WHERE id = v_a_app;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'I6 FAIL: a client session rewrote its own users.id';
  END IF;

  BEGIN
    UPDATE users SET is_verified = true WHERE id = v_a_app;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  SELECT is_verified INTO v_bool FROM users WHERE id = v_a_app;
  IF v_bool THEN
    RAISE EXCEPTION 'I6 FAIL: a client session self-verified its own account';
  END IF;
  RAISE NOTICE 'I6 PASS — id, auth_user_id and is_verified are not client-writable';

  -- ===== I7: an unlinked session resolves to NULL and sees nothing =========
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  IF app_user_id() IS NOT NULL THEN
    RAISE EXCEPTION 'I7 FAIL: app_user_id() returned non-NULL for an unlinked auth id';
  END IF;
  SELECT count(*) INTO v_count FROM registrations;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'I7 FAIL: an unlinked session read % registrations (must fail closed)', v_count;
  END IF;
  RAISE NOTICE 'I7 PASS — unlinked session resolves NULL and every policy fails closed';

  RESET ROLE;
  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
