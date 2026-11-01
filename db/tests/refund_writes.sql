-- =============================================================================
-- Regression test: clients cannot write refunds directly.
--
-- The old "Players can request refund" INSERT policy checked only
-- can_act_for(requested_by): not that the registration was the caller's, and
-- not the amount, status or processed_at. A signed-in player could pre-insert
-- an inflated live refund on their own registration (kept by
-- review_tournament_cancellation's ON CONFLICT DO NOTHING and paid out by the
-- refund job), or a near-zero one on another player's registration to stand in
-- for their real refund. 004_rls.sql now revokes INSERT, UPDATE and DELETE from
-- anon and authenticated.
--
-- Covers:
--   F1  anon and authenticated hold no INSERT/UPDATE/DELETE on refunds, and
--       authenticated keeps SELECT
--   F2  a signed-in player inserting an inflated refund on their OWN paid
--       registration gets 42501
--   F3  a signed-in player inserting a refund on ANOTHER player's registration
--       gets 42501
--   F4  the service-role path still works: approving the cancellation queues
--       exactly one refund per paid registration, for the gross amount paid
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs, so it builds throwaway
-- fixtures and persists NOTHING. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org         uuid;
  v_tournament  uuid;
  v_admin       uuid;
  v_player      uuid;
  v_player_auth uuid := gen_random_uuid();
  v_other       uuid;
  v_res         jsonb;
  v_reg_player  uuid;
  v_reg_other   uuid;
  v_pay         uuid;
  v_gross       integer;
  v_request     uuid;
  v_count       integer;
  v_amount      integer;
  v_role        text;
  v_priv        text;
BEGIN
  -- ---- fixtures -----------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('REFWRITE ORG') RETURNING id INTO v_org;
  INSERT INTO users (email, first_name, last_name)
    VALUES ('refwrite-admin@test.local', 'Ref', 'Admin') RETURNING id INTO v_admin;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_player_auth, 'refwrite-player@test.local', 'Ref', 'Player')
    RETURNING id INTO v_player;
  INSERT INTO users (email, first_name, last_name)
    VALUES ('refwrite-other@test.local', 'Ref', 'Other') RETURNING id INTO v_other;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'REFWRITE T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  -- Both players registered and paid, the real way.
  v_res := create_registration_with_payment(v_player, v_tournament, 'standard', 10000);
  v_reg_player := (v_res->>'registration_id')::uuid;
  v_pay := (v_res->>'payment_id')::uuid;
  SELECT gross_amount_cents INTO v_gross FROM payments WHERE id = v_pay;
  PERFORM settle_registration_payment(v_pay, true, v_gross, 'fpx_b2c');

  v_res := create_registration_with_payment(v_other, v_tournament, 'standard', 10000);
  v_reg_other := (v_res->>'registration_id')::uuid;
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, true, v_gross, 'visa');

  -- ===== F1 ===============================================================
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    FOREACH v_priv IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE'] LOOP
      IF has_table_privilege(v_role, 'refunds', v_priv) THEN
        RAISE EXCEPTION 'F1 FAIL: % holds % on refunds', v_role, v_priv;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('authenticated', 'refunds', 'SELECT') THEN
    RAISE EXCEPTION 'F1 FAIL: authenticated lost SELECT on refunds';
  END IF;
  RAISE NOTICE 'F1 PASS — no client write privileges, SELECT kept';

  -- Act as the signed-in player for F2 and F3.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_player_auth, 'role', 'authenticated')::text, true);

  -- ===== F2 ===============================================================
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO refunds (registration_id, refund_amount_cents, reason, requested_by)
      VALUES (v_reg_player, v_gross * 100, 'tournament_cancelled', v_player);
    RAISE EXCEPTION 'F2 FAIL: player inserted an inflated refund on own registration';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'F2 PASS — inflated refund on own registration refused (42501)';

  -- ===== F3 ===============================================================
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO refunds (registration_id, refund_amount_cents, reason, requested_by)
      VALUES (v_reg_other, 1, 'tournament_cancelled', v_player);
    RAISE EXCEPTION 'F3 FAIL: player inserted a refund on another player''s registration';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
  RAISE NOTICE 'F3 PASS — refund on another player''s registration refused (42501)';

  PERFORM set_config('request.jwt.claims', '{}', true);

  IF EXISTS (SELECT 1 FROM refunds WHERE registration_id IN (v_reg_player, v_reg_other)) THEN
    RAISE EXCEPTION 'F2/F3 FAIL: a client-written refund row exists';
  END IF;

  -- ===== F4 ===============================================================
  INSERT INTO tournament_cancellation_requests (tournament_id, requested_by, reason)
    VALUES (v_tournament, v_admin, 'Venue fell through')
    RETURNING id INTO v_request;

  SET LOCAL ROLE service_role;
  PERFORM review_tournament_cancellation(v_request, v_admin, 'approve', NULL);
  RESET ROLE;

  SELECT count(*) INTO v_count
    FROM refunds WHERE registration_id IN (v_reg_player, v_reg_other);
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'F4 FAIL: % refunds queued (expected 2)', v_count;
  END IF;
  SELECT refund_amount_cents INTO v_amount FROM refunds WHERE registration_id = v_reg_player;
  IF v_amount <> v_gross THEN
    RAISE EXCEPTION 'F4 FAIL: refund amount % (expected the % paid)', v_amount, v_gross;
  END IF;
  RAISE NOTICE 'F4 PASS — service-role cancellation queues one refund per paid registration at the gross amount';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
