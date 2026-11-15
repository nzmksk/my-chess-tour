-- =============================================================================
-- DB regression test for guard_tournament_seats_taken (003_functions_triggers.sql):
-- capacity may not drop below the seats already taken, meaning confirmed
-- registrations plus pending_payment holds inside the 10-minute window
-- (count_taken_seats, the same count assert_tournament_capacity uses).
--
-- Before #591, nothing stopped it before the first payment. Five players
-- mid-checkout, capacity lowered to 3, all five settle: five confirmed against a
-- capacity of three.
--
-- Covers:
--   C1  lowering below the live holds is refused, naming the count
--   C2  lowering to exactly the seats taken is allowed
--   C3  raising, or saving capacity unchanged, is always allowed
--   C4  a lapsed hold (older than 10 minutes) doesn't count
--   C5  cancelled and failed registrations don't count
--   C6  confirmed registrations count; once one is paid, a decrease reports
--       the paid lock rather than this one
--   C7  both orders of a hold and a decrease, one after the other: the hold
--       first refuses the decrease, the decrease first refuses the hold. (The
--       genuinely concurrent version, with two sessions, is
--       tournament_capacity_floor_race.sql.)
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it persists
-- NOTHING. A failing assertion RAISEs; on success it prints "ALL SCENARIOS PASSED"
-- via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org   uuid;
  v_t     uuid;
  v_users uuid[] := ARRAY[]::uuid[];
  v_user  uuid;
  v_res   jsonb;
  v_regs  uuid[] := ARRAY[]::uuid[];
  i       integer;
BEGIN
  INSERT INTO organizations (name) VALUES ('FLOOR ORG') RETURNING id INTO v_org;
  FOR i IN 1..8 LOOP
    INSERT INTO users (email, first_name, last_name)
      VALUES (format('floor-%s@test.local', i), 'P' || i, 'T')
      RETURNING id INTO v_user;
    v_users := v_users || v_user;
  END LOOP;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'FLOOR T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}', 32, 'published'
  ) RETURNING id INTO v_t;

  -- Five players mid-checkout: five live holds, nobody paid.
  FOR i IN 1..5 LOOP
    v_res := create_registration_with_payment(v_users[i], v_t, 'standard', 4000);
    v_regs := v_regs || (v_res->>'registration_id')::uuid;
  END LOOP;

  -- ===== C1: below the live holds is refused ================================
  BEGIN
    UPDATE tournaments SET max_participants = 3 WHERE id = v_t;
    RAISE EXCEPTION 'C1 FAIL: capacity dropped to 3 under 5 live holds';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'C1 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'CAPACITY_BELOW_TAKEN: 5 places are already taken%' THEN
      RAISE EXCEPTION 'C1 FAIL: unexpected error: %', SQLERRM;
    END IF;
  END;
  IF (SELECT max_participants FROM tournaments WHERE id = v_t) <> 32 THEN
    RAISE EXCEPTION 'C1 FAIL: the refused decrease still landed';
  END IF;
  RAISE NOTICE 'C1 PASS — capacity below the live holds refused, naming the count';

  -- ===== C2: exactly the seats taken is fine ================================
  UPDATE tournaments SET max_participants = 5 WHERE id = v_t;
  IF (SELECT max_participants FROM tournaments WHERE id = v_t) <> 5 THEN
    RAISE EXCEPTION 'C2 FAIL: capacity did not drop to the seats taken';
  END IF;
  RAISE NOTICE 'C2 PASS — capacity can drop to exactly the seats taken';

  -- ===== C3: raising and re-saving are never refused ========================
  UPDATE tournaments SET max_participants = 5, name = 'FLOOR T (renamed)' WHERE id = v_t;
  UPDATE tournaments SET max_participants = 40 WHERE id = v_t;
  UPDATE tournaments SET max_participants = 6 WHERE id = v_t;  -- above 5, still a decrease
  RAISE NOTICE 'C3 PASS — raises, unchanged saves and decreases above the floor allowed';

  -- ===== C4: a lapsed hold frees its seat ===================================
  UPDATE registrations SET registered_at = now() - interval '11 minutes'
    WHERE id = v_regs[1];
  UPDATE tournaments SET max_participants = 4 WHERE id = v_t;
  RAISE NOTICE 'C4 PASS — a hold older than 10 minutes does not count';

  -- ===== C5: cancelled and failed registrations don't count =================
  UPDATE registrations SET status = 'cancelled_payment', cancelled_at = now() WHERE id = v_regs[2];
  UPDATE registrations SET status = 'failed_payment'    WHERE id = v_regs[3];
  UPDATE tournaments SET max_participants = 2 WHERE id = v_t;
  IF count_taken_seats(v_t) <> 2 THEN
    RAISE EXCEPTION 'C5 FAIL: expected 2 seats taken, counted %', count_taken_seats(v_t);
  END IF;
  RAISE NOTICE 'C5 PASS — cancelled and failed registrations free their seats';

  -- ===== C6: a confirmed seat counts, and payment owns the error ============
  -- Back to a clean slate: raise, then settle one of the live holds.
  UPDATE tournaments SET max_participants = 10 WHERE id = v_t;
  PERFORM settle_registration_payment(
    (SELECT current_payment_id FROM registrations WHERE id = v_regs[4]), true
  );
  IF (SELECT status FROM registrations WHERE id = v_regs[4]) <> 'confirmed' THEN
    RAISE EXCEPTION 'C6 FAIL: fixture did not confirm';
  END IF;
  IF count_taken_seats(v_t) <> 2 THEN
    RAISE EXCEPTION 'C6 FAIL: a confirmed seat should still count (got %)', count_taken_seats(v_t);
  END IF;
  BEGIN
    UPDATE tournaments SET max_participants = 1 WHERE id = v_t;
    RAISE EXCEPTION 'C6 FAIL: capacity dropped below a confirmed seat';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'C6 FAIL%' THEN RAISE; END IF;
    -- guard_paid_fields fires first, so a paid tournament says "can only
    -- increase", which is the rule the organizer is actually up against.
    IF SQLERRM NOT LIKE '%max_participants (can only increase)%' THEN
      RAISE EXCEPTION 'C6 FAIL: expected the paid lock, got: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'C6 PASS — confirmed seats count; after payment the paid lock answers';

  -- ===== C7: a hold and a decrease, in either order =========================
  -- A fresh, unpaid tournament with capacity 4 and two live holds.
  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'FLOOR T2', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}', 4, 'published'
  ) RETURNING id INTO v_t;
  PERFORM create_registration_with_payment(v_users[5], v_t, 'standard', 4000);
  PERFORM create_registration_with_payment(v_users[6], v_t, 'standard', 4000);

  -- Hold first: the third hold makes 3 the floor, so 2 is refused.
  PERFORM create_registration_with_payment(v_users[7], v_t, 'standard', 4000);
  BEGIN
    UPDATE tournaments SET max_participants = 2 WHERE id = v_t;
    RAISE EXCEPTION 'C7 FAIL: capacity dropped below a hold taken just before';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'C7 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'CAPACITY_BELOW_TAKEN: 3 places%' THEN
      RAISE EXCEPTION 'C7 FAIL: unexpected error: %', SQLERRM;
    END IF;
  END;

  -- Decrease first: down to the 3 taken, and the next hold finds it full.
  UPDATE tournaments SET max_participants = 3 WHERE id = v_t;
  BEGIN
    PERFORM create_registration_with_payment(v_users[8], v_t, 'standard', 4000);
    RAISE EXCEPTION 'C7 FAIL: a hold got in after capacity dropped to the seats taken';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'C7 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'Tournament is full (3 / 3 participants)%' THEN
      RAISE EXCEPTION 'C7 FAIL: unexpected error: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'C7 PASS — hold-then-decrease refuses the decrease; decrease-then-hold refuses the hold';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
