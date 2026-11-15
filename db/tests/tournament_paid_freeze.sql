-- =============================================================================
-- DB regression test for guard_tournament_paid_fields (003_functions_triggers.sql):
-- what a player paid for stays editable until the first paid registration, then
-- locks. The column list mirrors the "paid" stage of src/lib/tournaments/edit-policy.ts.
--
-- The trigger once built its list with `v_changed || 'entry_fees'`, which Postgres
-- reads as text[] || text[] and fails with "malformed array literal". Every change
-- to a money field raised that error, including on a draft nobody had paid for.
--
-- Covers:
--   M1  every money field can be changed while nothing is paid
--   M2  a pending (unpaid) registration does not lock anything
--   M3  after a paid registration a change is refused, naming the field
--       (here a capacity decrease)
--   M4  re-saving the same value after payment is still allowed
--   M5  non-money fields stay editable after payment
--   M6  dates, region, format, time control, ratings and restrictions lock too
--   M7  name, venue name/address and the registration deadline stay editable
--   M8  capacity can still be raised after payment (but M3: not lowered)
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
    IF SQLERRM NOT LIKE '%these fields are locked: max_participants (can only increase)%' THEN
      RAISE EXCEPTION 'M3 FAIL: unexpected error: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'M3 PASS — capacity decrease refused after payment, naming the field';

  -- ===== M4: an unchanged value is not a change =============================
  UPDATE tournaments SET max_participants = 110 WHERE id = v_t;
  RAISE NOTICE 'M4 PASS — re-saving the same value is allowed';

  -- ===== M5: everything else stays editable =================================
  UPDATE tournaments SET description = 'Now with parking' WHERE id = v_t;
  RAISE NOTICE 'M5 PASS — non-money fields stay editable';

  -- ===== M6: when, where, what and who also lock ============================
  DECLARE
    v_case record;
  BEGIN
    FOR v_case IN
      SELECT * FROM (VALUES
        ('start_date',    'UPDATE tournaments SET start_date = start_date + 1 WHERE id = $1'),
        ('end_date',      'UPDATE tournaments SET end_date = end_date + 1 WHERE id = $1'),
        ('venue_country', 'UPDATE tournaments SET venue_country = ''SG'' WHERE id = $1'),
        ('venue_state',   'UPDATE tournaments SET venue_state = ''Johor'' WHERE id = $1'),
        ('timezone',      'UPDATE tournaments SET timezone = ''Asia/Jakarta'' WHERE id = $1'),
        ('format',        'UPDATE tournaments SET format = ''{"type":"rapid","rounds":7,"system":"swiss"}'' WHERE id = $1'),
        ('time_control',  'UPDATE tournaments SET time_control = ''{"base_minutes":15}'' WHERE id = $1'),
        ('is_fide_rated', 'UPDATE tournaments SET is_fide_rated = NOT is_fide_rated WHERE id = $1'),
        ('is_mcf_rated',  'UPDATE tournaments SET is_mcf_rated = NOT is_mcf_rated WHERE id = $1'),
        ('restrictions',  'UPDATE tournaments SET restrictions = ''[{"type":"rating","max":1600}]'' WHERE id = $1')
      ) AS c(field, stmt)
    LOOP
      BEGIN
        EXECUTE v_case.stmt USING v_t;
        RAISE EXCEPTION 'M6 FAIL: % changed after a player paid', v_case.field;
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'M6 FAIL%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%these fields are locked: ' || v_case.field || '%' THEN
          RAISE EXCEPTION 'M6 FAIL (%): unexpected error: %', v_case.field, SQLERRM;
        END IF;
      END;
    END LOOP;
  END;
  RAISE NOTICE 'M6 PASS — dates, region, format, ratings and eligibility locked after payment';

  -- ===== M7: cosmetic fields and the deadline stay editable =================
  UPDATE tournaments
    SET name = 'FREEZE T (renamed)',
        venue_name = 'Hall B',
        venue_address = 'New Address',
        registration_deadline = now() + interval '19 days'
    WHERE id = v_t;
  RAISE NOTICE 'M7 PASS — cosmetic fields and the deadline stay editable';

  -- ===== M8: capacity can still grow ========================================
  UPDATE tournaments SET max_participants = 150 WHERE id = v_t;
  IF (SELECT max_participants FROM tournaments WHERE id = v_t) <> 150 THEN
    RAISE EXCEPTION 'M8 FAIL: capacity raise did not land';
  END IF;
  -- ...and the raise is the new floor.
  BEGIN
    UPDATE tournaments SET max_participants = 140 WHERE id = v_t;
    RAISE EXCEPTION 'M8 FAIL: capacity lowered after a raise';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'M8 FAIL%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%max_participants (can only increase)%' THEN
      RAISE EXCEPTION 'M8 FAIL: unexpected error: %', SQLERRM;
    END IF;
  END;
  RAISE NOTICE 'M8 PASS — capacity can be raised after payment, never lowered';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
