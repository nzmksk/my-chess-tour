-- =============================================================================
-- Concurrency test for the capacity floor (guard_tournament_seats_taken,
-- 003_functions_triggers.sql): a seat hold and a capacity decrease running at the
-- same time, in two real sessions.
--
-- The floor counts seats without taking a lock of its own. It relies on the
-- UPDATE having locked the tournament row before BEFORE ROW triggers fire,
-- which conflicts with the FOR UPDATE in assert_tournament_capacity. If that
-- ever stopped holding, a hold could land between the floor's count and the
-- update, and both would succeed. tournament_capacity_floor.sql can only run the
-- two one after the other; this runs them at once.
--
-- Covers:
--   R1  hold first, decrease waits: the decrease blocks on the open hold, and
--       once the hold commits it is counted, so the decrease is refused
--   R2  decrease first, hold waits: the hold blocks on the open decrease, and
--       once that commits it reads the lowered capacity, so the hold is refused
--
-- HOW TO RUN: needs the dblink extension and a connection string dblink can
-- use to reach this same database. It COMMITS its fixtures (the second session
-- couldn't see them otherwise) and deletes them at the end, pass or fail, so
-- run it against a local or throwaway database, not production. From psql:
--
--   psql -d <db> \
--     -c "SET capacity_race.conninfo = 'host=localhost dbname=<db> user=postgres password=...'" \
--     -f db/tests/tournament_capacity_floor_race.sql
--
-- Without the setting it tries 'dbname=<current database>', which works when the
-- server trusts local connections. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS dblink;

DO $$
DECLARE
  v_conn  text := COALESCE(
    NULLIF(current_setting('capacity_race.conninfo', true), ''),
    'dbname=' || current_database()
  );
  v_org   uuid;
  v_t     uuid;
  v_users uuid[];
  v_cap   integer;
  v_err   text;
  -- Per-run names, so leftovers from an interrupted run never collide.
  v_tag   text := substr(md5(random()::text), 1, 8);
  v_cleanup text := $q$
    UPDATE registrations SET current_payment_id = NULL WHERE tournament_id = %1$L;
    DELETE FROM payments      WHERE tournament_id = %1$L;
    DELETE FROM registrations WHERE tournament_id = %1$L;
    DELETE FROM tournaments   WHERE id = %1$L;
    DELETE FROM users         WHERE email LIKE 'capacity-race-' || %3$L || '-%%';
    -- Soft delete: the audit trail keeps a foreign key to the organization.
    UPDATE organizations SET deleted_at = now() WHERE id = %2$L;
  $q$;
BEGIN
  PERFORM dblink_connect('race_a', v_conn);
  PERFORM dblink_connect('race_b', v_conn);

  BEGIN
    -- ---- committed fixtures: capacity 4, two live holds, nobody paid ---------
    SELECT id INTO v_org FROM dblink('race_a', format(
      $q$INSERT INTO organizations (name) VALUES (%L) RETURNING id$q$,
      'RACE ORG ' || v_tag)
    ) AS r(id uuid);

    SELECT array_agg(id ORDER BY id) INTO v_users FROM dblink('race_a', format(
      $q$INSERT INTO users (email, first_name, last_name)
         SELECT format('capacity-race-%%s-%%s@test.local', %L, i), 'P' || i, 'T'
         FROM generate_series(1, 4) AS i
         RETURNING id$q$, v_tag)
    ) AS r(id uuid);

    SELECT id INTO v_t FROM dblink('race_a', format(
      $q$INSERT INTO tournaments (
           organization_id, name, venue_name, venue_state, venue_address,
           start_date, end_date, registration_deadline,
           format, time_control, entry_fees, max_participants, status
         ) VALUES (
           %L, 'RACE T', 'Venue', 'Selangor', 'Address',
           current_date + 30, current_date + 31, now() + interval '20 days',
           '{"type":"classical","rounds":9,"system":"swiss"}',
           '{"base_minutes":90,"increment_seconds":30}',
           '{"standard": {"amount_cents": 4000}}', 4, 'published'
         ) RETURNING id$q$, v_org)
    ) AS r(id uuid);

    PERFORM * FROM dblink('race_a', format(
      $q$SELECT create_registration_with_payment(%L, %L, 'standard', 4000)::text$q$,
      v_users[1], v_t)) AS r(res text);
    PERFORM * FROM dblink('race_a', format(
      $q$SELECT create_registration_with_payment(%L, %L, 'standard', 4000)::text$q$,
      v_users[2], v_t)) AS r(res text);

    -- ===== R1: hold first, the decrease waits for it ========================
    -- Session A takes a third hold and keeps its transaction open.
    PERFORM dblink_exec('race_a', 'BEGIN');
    PERFORM * FROM dblink('race_a', format(
      $q$SELECT create_registration_with_payment(%L, %L, 'standard', 4000)::text$q$,
      v_users[3], v_t)) AS r(res text);

    -- Session B lowers capacity to 2. The two committed holds alone would
    -- allow that; only the uncommitted third one makes it wrong.
    PERFORM dblink_send_query('race_b', format(
      'UPDATE tournaments SET max_participants = 2 WHERE id = %L', v_t));
    PERFORM pg_sleep(0.5);
    IF dblink_is_busy('race_b') = 0 THEN
      RAISE EXCEPTION 'R1 FAIL: the decrease did not wait for the open hold';
    END IF;

    PERFORM dblink_exec('race_a', 'COMMIT');

    v_err := NULL;
    BEGIN
      PERFORM * FROM dblink_get_result('race_b') AS r(status text);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    -- Drain the connection so it takes the next query.
    PERFORM * FROM dblink_get_result('race_b', false) AS r(status text);

    IF v_err IS NULL THEN
      RAISE EXCEPTION 'R1 FAIL: capacity dropped to 2 under 3 holds';
    END IF;
    IF v_err NOT LIKE '%CAPACITY_BELOW_TAKEN: 3 places are already taken%' THEN
      RAISE EXCEPTION 'R1 FAIL: unexpected error: %', v_err;
    END IF;
    SELECT cap INTO v_cap FROM dblink('race_a', format(
      'SELECT max_participants FROM tournaments WHERE id = %L', v_t)) AS r(cap integer);
    IF v_cap <> 4 THEN
      RAISE EXCEPTION 'R1 FAIL: capacity is %, expected it to stay 4', v_cap;
    END IF;
    RAISE NOTICE 'R1 PASS — a decrease racing an open hold waits for it, then counts it';

    -- ===== R2: decrease first, the hold waits for it ========================
    -- Session B lowers capacity to the 3 taken and keeps its transaction open.
    PERFORM dblink_exec('race_b', 'BEGIN');
    PERFORM dblink_exec('race_b', format(
      'UPDATE tournaments SET max_participants = 3 WHERE id = %L', v_t));

    -- Session A tries a fourth hold. Under the old capacity of 4 it would fit.
    PERFORM dblink_send_query('race_a', format(
      $q$SELECT create_registration_with_payment(%L, %L, 'standard', 4000)::text$q$,
      v_users[4], v_t));
    PERFORM pg_sleep(0.5);
    IF dblink_is_busy('race_a') = 0 THEN
      RAISE EXCEPTION 'R2 FAIL: the hold did not wait for the open decrease';
    END IF;

    PERFORM dblink_exec('race_b', 'COMMIT');

    v_err := NULL;
    BEGIN
      PERFORM * FROM dblink_get_result('race_a') AS r(res text);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    PERFORM * FROM dblink_get_result('race_a', false) AS r(res text);

    IF v_err IS NULL THEN
      RAISE EXCEPTION 'R2 FAIL: a fourth hold got in after capacity dropped to 3';
    END IF;
    IF v_err NOT LIKE '%Tournament is full (3 / 3 participants)%' THEN
      RAISE EXCEPTION 'R2 FAIL: unexpected error: %', v_err;
    END IF;
    RAISE NOTICE 'R2 PASS — a hold racing an open decrease waits for it, then reads the new capacity';

  EXCEPTION WHEN OTHERS THEN
    -- Leave nothing behind, then fail with the original error. Cancel first,
    -- so a statement still waiting on a lock can't commit after the cleanup.
    PERFORM dblink_cancel_query('race_a');
    PERFORM dblink_cancel_query('race_b');
    PERFORM dblink_disconnect('race_a');
    PERFORM dblink_disconnect('race_b');
    PERFORM dblink_connect('race_a', v_conn);
    PERFORM dblink_exec('race_a', format(v_cleanup, v_t, v_org, v_tag));
    PERFORM dblink_disconnect('race_a');
    RAISE;
  END;

  -- ---- cleanup -------------------------------------------------------------
  PERFORM dblink_exec('race_a', format(v_cleanup, v_t, v_org, v_tag));
  PERFORM dblink_disconnect('race_a');
  PERFORM dblink_disconnect('race_b');

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;
