-- =============================================================================
-- DB regression test for guard_tournament_money_fields (003_functions_triggers.sql):
-- money fields stay editable until the first paid registration, then lock.
--
-- The trigger once built its list with `v_changed || 'entry_fees'`, which Postgres
-- reads as text[] || text[] and fails with "malformed array literal". Every change
-- to a money field raised that error, including on a draft nobody had paid for.
--
-- Covers:
--   M1  every money field can be changed while nothing is paid
--   M2  a pending (unpaid) registration does not lock anything
--   M3  after a paid registration a change is refused, naming the field
--   M4  re-saving the same value after payment is still allowed
--   M5  non-money fields stay editable after payment
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations. Runs inside a transaction that ROLLBACKs, so it persists
-- NOTHING. A failing assertion RAISEs; on success it prints "ALL SCENARIOS PASSED"
-- via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_org  uuid;
  v_t    uuid;
  v_a    uuid;
  v_b    uuid;
  v_res  jsonb;
BEGIN
  INSERT INTO organizations (name) VALUES ('FREEZE ORG') RETURNING id INTO v_org;
  INSERT INTO users (email, first_name, last_name) VALUES ('freeze-a@test.local', 'A', 'T') RETURNING id INTO v_a;
  INSERT INTO users (email, first_name, last_name) VALUES ('freeze-b@test.local', 'B', 'T') RETURNING id INTO v_b;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'FREEZE T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 10000}}', 100, 'published'
  ) RETURNING id INTO v_t;

  -- ===== M1: everything is editable while nothing is paid ===================
  UPDATE tournaments
    SET entry_fees = '{"standard": {"amount_cents": 12000}}',
        prizes = '{"categories": []}',
        max_participants = 120,
        commission_rate = 9,
        organizer_commission_pct = 1
    WHERE id = v_t;
  UPDATE tournaments
    SET entry_fees = '{"standard": {"amount_cents": 10000}}',
        commission_rate = 10,
        organizer_commission_pct = 0
    WHERE id = v_t;
  RAISE NOTICE 'M1 PASS — money fields editable before any payment';

  -- ===== M2: an unpaid registration locks nothing ===========================
  v_res := create_registration_with_payment(v_a, v_t, 'standard', 10000);
  UPDATE tournaments SET max_participants = 110 WHERE id = v_t;
  RAISE NOTICE 'M2 PASS — a pending payment does not freeze money fields';

  -- ===== M3: the first paid registration freezes them =======================
  PERFORM settle_registration_payment((v_res->>'payment_id')::uuid, true, 11000);
  BEGIN
    UPDATE tournaments SET max_participants = 90 WHERE id = v_t;
    RAISE EXCEPTION 'M3 FAIL: max_participants changed after a player paid';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'M3 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%these fields are locked: max_participants%' THEN
      RAISE EXCEPTION 'M3 FAIL: unexpected error: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'M3 PASS — locked after payment, naming the field';

  -- ===== M4: an unchanged value is not a change =============================
  UPDATE tournaments SET max_participants = 110 WHERE id = v_t;
  RAISE NOTICE 'M4 PASS — re-saving the same value is allowed';

  -- ===== M5: everything else stays editable =================================
  UPDATE tournaments SET description = 'Now with parking' WHERE id = v_t;
  RAISE NOTICE 'M5 PASS — non-money fields stay editable';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
