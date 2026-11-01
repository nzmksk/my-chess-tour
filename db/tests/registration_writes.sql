-- =============================================================================
-- Regression test: clients cannot write registrations directly.
--
-- registrations.status and current_payment_id ARE the payment state. The old
-- "Players can register" (INSERT) and "Players can cancel own registration"
-- (UPDATE) policies only checked can_act_for(user_id), so a signed-in player
-- could insert or patch their own row straight to 'confirmed' through
-- PostgREST and hold a seat without paying. 004_rls.sql now revokes INSERT,
-- UPDATE and DELETE from anon and authenticated; every write goes through the
-- service-role SECURITY DEFINER functions in 007_payment_functions.sql.
--
-- Covers:
--   R1  anon and authenticated hold no INSERT/UPDATE/DELETE on registrations,
--       and authenticated keeps SELECT
--   R2  a signed-in player INSERTing their own 'confirmed' row gets 42501
--   R3  a signed-in player UPDATEing their own pending row to 'confirmed'
--       gets 42501, and the row is unchanged
--   R4  the player can still read their own registration
--   R5  the service-role path still works end to end, including the capacity
--       trigger (assert_tournament_capacity is revoked from clients and must
--       still run inside the SECURITY DEFINER functions)
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs, so it builds throwaway
-- fixtures and persists NOTHING. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org        uuid;
  v_tournament uuid;
  v_player     uuid;
  v_player_auth uuid := gen_random_uuid();
  v_other      uuid;
  v_res        jsonb;
  v_reg        uuid;
  v_pay        uuid;
  v_gross      integer;
  v_status     text;
  v_seen       integer;
  v_role       text;
  v_priv       text;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('REGWRITE ORG') RETURNING id INTO v_org;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_player_auth, 'regwrite-player@test.local', 'Reg', 'Player')
    RETURNING id INTO v_player;
  INSERT INTO users (email, first_name, last_name)
    VALUES ('regwrite-other@test.local', 'Reg', 'Other')
    RETURNING id INTO v_other;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'REGWRITE T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  -- A legitimate pending registration for the player, made the real way.
  v_res := create_registration_with_payment(v_player, v_tournament, 'standard', 4000);
  v_reg := (v_res->>'registration_id')::uuid;

  -- ===== R1 ===============================================================
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(v_role, 'registrations', v_priv) THEN
        RAISE EXCEPTION 'R1 FAIL: % holds % on registrations', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'registrations', 'SELECT') THEN
    RAISE EXCEPTION 'R1 FAIL: authenticated lost SELECT on registrations';
  END IF;
  RAISE NOTICE 'R1 PASS — no client write privileges, SELECT kept';

  -- Act as the signed-in player from here until R4.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_player_auth, 'role', 'authenticated')::text, true);

  -- ===== R2 ===============================================================
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO registrations (user_id, tournament_id, fee_tier, status)
      VALUES (v_player, v_tournament, 'standard', 'confirmed');
    RAISE EXCEPTION 'R2 FAIL: player inserted a confirmed registration directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'R2 PASS — direct INSERT refused (42501)';

  -- ===== R3 ===============================================================
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE registrations SET status = 'confirmed' WHERE id = v_reg;
    RAISE EXCEPTION 'R3 FAIL: player updated own registration directly';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  SELECT status INTO v_status FROM registrations WHERE id = v_reg;
  IF v_status <> 'pending_payment' THEN
    RAISE EXCEPTION 'R3 FAIL: registration status is % (expected pending_payment)', v_status;
  END IF;
  RAISE NOTICE 'R3 PASS — direct UPDATE refused (42501), row unchanged';

  -- ===== R4 ===============================================================
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_seen FROM registrations WHERE id = v_reg;
  RESET ROLE;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'R4 FAIL: player sees % of their own registrations (expected 1)', v_seen;
  END IF;
  RAISE NOTICE 'R4 PASS — player can still read own registration';

  PERFORM set_config('request.jwt.claims', '{}', true);

  -- ===== R5 ===============================================================
  SET LOCAL ROLE service_role;
  v_res := create_registration_with_payment(v_other, v_tournament, 'standard', 4000);
  v_pay := (v_res->>'payment_id')::uuid;
  RESET ROLE;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay;

  SET LOCAL ROLE service_role;
  PERFORM settle_registration_payment(v_pay, true, v_gross, 'fpx_b2c');
  RESET ROLE;

  SELECT status INTO v_status FROM registrations
    WHERE id = (v_res->>'registration_id')::uuid;
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'R5 FAIL: service-role registration is % (expected confirmed)', v_status;
  END IF;
  RAISE NOTICE 'R5 PASS — service-role create + settle still confirms, capacity trigger ran';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
