-- =============================================================================
-- Regression test for audit attribution (#470).
--
-- audit_trigger_func resolves who made a change (changed_by) and why (context).
-- The server runs nearly every write through the service role, which carries no
-- JWT `sub`, so it names the actor and the context itself in two request
-- headers (x-audit-actor, x-audit-context). Those headers must be honoured on a
-- service-role request and ignored on any other: anyone can send a header.
--
-- PostgREST exposes the request as settings, which this suite sets directly:
-- request.jwt.claims (the JWT) and request.headers (lower-cased header names).
--
-- Covers:
--   A1  no session, no headers: changed_by NULL, context 'trigger' (as before)
--   A2  a user's own request: changed_by from the JWT sub, through
--       users.auth_user_id, so it is the users.id and not the auth id
--   A3  a service-role request with both headers: changed_by and context from
--       them
--   A4  the same headers on an authenticated or anon request are ignored
--   A5  an actor that isn't a uuid, or names no user, gives changed_by NULL and
--       the write still succeeds
--   A6  app.audit_context and app.audit_actor (SQL run by hand) win over the
--       headers; a context longer than the column is cut, not an error
--   A7  through a SECURITY DEFINER function the service role calls, the
--       headers still attribute every row it writes
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it builds
-- throwaway fixtures and persists NOTHING. A failing assertion RAISEs (and rolls
-- back); on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_auth_a  uuid := gen_random_uuid();
  v_auth_b  uuid := gen_random_uuid();
  v_a       uuid;
  v_b       uuid;
  v_org     uuid;
  v_row     audit_logs;
  v_id      bigint;
BEGIN
  -- ---- fixtures -------------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_auth_a, 'attr-a@test.local', 'Ana', 'Actor')
    RETURNING id INTO v_a;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_auth_b, 'attr-b@test.local', 'Ben', 'Bystander')
    RETURNING id INTO v_b;
  -- Prove the auth id → users.id resolution, not a lucky equality.
  IF v_a = v_auth_a THEN
    RAISE EXCEPTION 'fixture FAIL: users.id equals the auth id, A2 would pass vacuously';
  END IF;
  INSERT INTO organizations (name) VALUES ('ATTRIBUTION ORG') RETURNING id INTO v_org;

  -- ---- A1: nothing set --------------------------------------------------------
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  UPDATE organizations SET name = 'A1' WHERE id = v_org;
  SELECT * INTO v_row FROM audit_logs WHERE table_name = 'organizations' ORDER BY id DESC LIMIT 1;
  IF v_row.changed_by IS NOT NULL OR v_row.context <> 'trigger' THEN
    RAISE EXCEPTION 'A1 FAIL: changed_by=% context=% (expected NULL, trigger)', v_row.changed_by, v_row.context;
  END IF;
  RAISE NOTICE 'A1 PASS — no session, no headers: unattributed, context trigger';

  -- ---- A2: a user's own request ----------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_auth_a, 'role', 'authenticated')::text, true);
  UPDATE organizations SET name = 'A2' WHERE id = v_org;
  SELECT * INTO v_row FROM audit_logs WHERE table_name = 'organizations' ORDER BY id DESC LIMIT 1;
  IF v_row.changed_by IS DISTINCT FROM v_a OR v_row.context <> 'trigger' THEN
    RAISE EXCEPTION 'A2 FAIL: changed_by=% context=% (expected %, trigger)', v_row.changed_by, v_row.context, v_a;
  END IF;
  RAISE NOTICE 'A2 PASS — JWT sub resolves to the users.id';

  -- ---- A3: service role with both headers ------------------------------------
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.headers',
    json_build_object('x-audit-actor', v_b, 'x-audit-context', 'org.update')::text, true);
  UPDATE organizations SET name = 'A3' WHERE id = v_org;
  SELECT * INTO v_row FROM audit_logs WHERE table_name = 'organizations' ORDER BY id DESC LIMIT 1;
  IF v_row.changed_by IS DISTINCT FROM v_b OR v_row.context <> 'org.update' THEN
    RAISE EXCEPTION 'A3 FAIL: changed_by=% context=% (expected %, org.update)', v_row.changed_by, v_row.context, v_b;
  END IF;
  -- The context header alone, as a webhook or cron sends it.
  PERFORM set_config('request.headers', '{"x-audit-context":"webhook.chip"}', true);
  UPDATE organizations SET name = 'A3b' WHERE id = v_org;
  SELECT * INTO v_row FROM audit_logs WHERE table_name = 'organizations' ORDER BY id DESC LIMIT 1;
  IF v_row.changed_by IS NOT NULL OR v_row.context <> 'webhook.chip' THEN
    RAISE EXCEPTION 'A3 FAIL (context only): changed_by=% context=%', v_row.changed_by, v_row.context;
  END IF;
  RAISE NOTICE 'A3 PASS — service-role headers set changed_by and context';

  -- ---- A4: headers on a non-service request are ignored ---------------------
  PERFORM set_config('request.headers',
    json_build_object('x-audit-actor', v_b, 'x-audit-context', 'forged')::text, true);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_auth_a, 'role', 'authenticated')::text, true);
  UPDATE organizations SET name = 'A4a' WHERE id = v_org;
  SELECT * INTO v_row FROM audit_logs WHERE table_name = 'organizations' ORDER BY id DESC LIMIT 1;
  IF v_row.changed_by IS DISTINCT FROM v_a OR v_row.context <> 'trigger' THEN
    RAISE EXCEPTION 'A4 FAIL (authenticated): changed_by=% context=% (expected %, trigger)',
      v_row.changed_by, v_row.context, v_a;
  END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  UPDATE organizations SET name = 'A4b' WHERE id = v_org;
  SELECT * INTO v_row FROM audit_logs WHERE table_name = 'organizations' ORDER BY id DESC LIMIT 1;
  IF v_row.changed_by IS NOT NULL OR v_row.context <> 'trigger' THEN
    RAISE EXCEPTION 'A4 FAIL (anon): changed_by=% context=% (expected NULL, trigger)', v_row.changed_by, v_row.context;
  END IF;
  RAISE NOTICE 'A4 PASS — headers ignored without the service role';

  -- ---- A5: a bad actor never blocks the write --------------------------------
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM set_config('request.headers', '{"x-audit-actor":"not-a-uuid"}', true);
  UPDATE organizations SET name = 'A5a' WHERE id = v_org;
  SELECT * INTO v_row FROM audit_logs WHERE table_name = 'organizations' ORDER BY id DESC LIMIT 1;
  IF v_row.changed_by IS NOT NULL OR v_row.new_data ->> 'name' <> 'A5a' THEN
    RAISE EXCEPTION 'A5 FAIL (not a uuid): changed_by=% name=%', v_row.changed_by, v_row.new_data ->> 'name';
  END IF;

  PERFORM set_config('request.headers',
    json_build_object('x-audit-actor', gen_random_uuid())::text, true);
  UPDATE organizations SET name = 'A5b' WHERE id = v_org;
  SELECT * INTO v_row FROM audit_logs WHERE table_name = 'organizations' ORDER BY id DESC LIMIT 1;
  IF v_row.changed_by IS NOT NULL OR v_row.new_data ->> 'name' <> 'A5b' THEN
    RAISE EXCEPTION 'A5 FAIL (unknown user): changed_by=% name=%', v_row.changed_by, v_row.new_data ->> 'name';
  END IF;
  RAISE NOTICE 'A5 PASS — an unusable actor gives NULL, the write succeeds';

  -- ---- A6: settings win; long contexts are cut -------------------------------
  PERFORM set_config('request.headers',
    json_build_object('x-audit-actor', v_b, 'x-audit-context', 'from.header')::text, true);
  PERFORM set_config('app.audit_actor', v_a::text, true);
  PERFORM set_config('app.audit_context', 'runbook.manual', true);
  UPDATE organizations SET name = 'A6a' WHERE id = v_org;
  SELECT * INTO v_row FROM audit_logs WHERE table_name = 'organizations' ORDER BY id DESC LIMIT 1;
  IF v_row.changed_by IS DISTINCT FROM v_a OR v_row.context <> 'runbook.manual' THEN
    RAISE EXCEPTION 'A6 FAIL: changed_by=% context=% (expected %, runbook.manual)', v_row.changed_by, v_row.context, v_a;
  END IF;
  PERFORM set_config('app.audit_actor', '', true);
  PERFORM set_config('app.audit_context', '', true);

  PERFORM set_config('request.headers',
    json_build_object('x-audit-context', repeat('x', 150))::text, true);
  UPDATE organizations SET name = 'A6b' WHERE id = v_org;
  SELECT * INTO v_row FROM audit_logs WHERE table_name = 'organizations' ORDER BY id DESC LIMIT 1;
  IF length(v_row.context) <> 100 THEN
    RAISE EXCEPTION 'A6 FAIL: a 150-character context was stored as % characters', length(v_row.context);
  END IF;
  RAISE NOTICE 'A6 PASS — app.audit_* settings win; context cut to 100';

  -- ---- A7: through a SECURITY DEFINER function -------------------------------
  -- record_sensitive_data_consent is not audited, but set_player_bank_account
  -- (player_bank_accounts) is, and it is called exactly this way by the server.
  PERFORM set_config('request.headers',
    json_build_object('x-audit-actor', v_a, 'x-audit-context', 'profile.banking')::text, true);
  PERFORM record_sensitive_data_consent(v_a, 'financial', true, '2026-11-19');
  SELECT max(id) INTO v_id FROM audit_logs;
  PERFORM set_player_bank_account(v_a, 'MBBEMYKL', 'Maybank', 'Ana Actor', '514100001234');
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE id > v_id AND table_name = 'player_bank_accounts') THEN
    RAISE EXCEPTION 'A7 FAIL: set_player_bank_account wrote no audit row';
  END IF;
  IF EXISTS (
    SELECT 1 FROM audit_logs
     WHERE id > v_id
       AND (changed_by IS DISTINCT FROM v_a OR context <> 'profile.banking')
  ) THEN
    RAISE EXCEPTION 'A7 FAIL: a row written inside the function was not attributed';
  END IF;
  RAISE NOTICE 'A7 PASS — rows written inside a SECURITY DEFINER function are attributed';

  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.headers', '', true);
  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
