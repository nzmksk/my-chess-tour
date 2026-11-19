-- =============================================================================
-- Concurrency test for the prize pool sum guard (review_prize_award,
-- 006_payment_functions.sql): two admins approving two awards at the same time,
-- in two real sessions, when the pool can only cover one of them.
--
-- The guard reads the reservations committed before it and refuses an award
-- beyond what is left. That is only safe because every approval first locks the
-- tournament row: without the lock, both approvals could read the same
-- available balance and both commit, together exceeding the collected pool.
-- db/tests/prize_pool.sql can only run approvals one after the other; this runs
-- them at once.
--
-- Covers:
--   R1  the second approval waits for the first one's open transaction, then
--       counts its reservation and is refused with PRIZE_AWARD_EXCEEDS_POOL
--
-- HOW TO RUN: needs the dblink extension and a connection string dblink can use
-- to reach this same database. It COMMITS its fixtures (the second session
-- couldn't see them otherwise) and deletes them at the end, pass or fail, so run
-- it against a local or throwaway database, not production. From psql:
--
--   psql -d <db> \
--     -c "SET capacity_race.conninfo = 'host=localhost dbname=<db> user=postgres password=...'" \
--     -f db/tests/prize_award_review_race.sql
--
-- It reads the same setting as tournament_capacity_floor_race.sql. Without it,
-- it tries 'dbname=<current database>', which works when the server trusts local
-- connections. A failing assertion RAISEs; on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS dblink;

DO $$
DECLARE
  v_conn  text := COALESCE(
    NULLIF(current_setting('capacity_race.conninfo', true), ''),
    'dbname=' || current_database()
  );
  v_org    uuid;
  v_t      uuid;
  v_admin  uuid;
  v_users  uuid[];
  v_fund   uuid;
  v_award_a uuid;
  v_award_b uuid;
  v_err    text;
  v_state  text;
  -- Per-run names, so leftovers from an interrupted run never collide.
  v_tag    text := substr(md5(random()::text), 1, 8);
  v_cleanup text := $q$
    DELETE FROM prize_awards   WHERE tournament_id = %1$L;
    UPDATE prize_fundings SET payment_id = NULL, status = 'pending', paid_at = NULL
      WHERE tournament_id = %1$L;
    UPDATE registrations SET current_payment_id = NULL WHERE tournament_id = %1$L;
    DELETE FROM payments       WHERE tournament_id = %1$L;
    DELETE FROM prize_fundings WHERE tournament_id = %1$L;
    DELETE FROM registrations  WHERE tournament_id = %1$L;
    DELETE FROM tournaments    WHERE id = %1$L;
    DELETE FROM users          WHERE email LIKE 'prize-race-' || %3$L || '-%%';
    -- Soft delete: the audit trail keeps a foreign key to the organization.
    UPDATE organizations SET deleted_at = now() WHERE id = %2$L;
  $q$;
BEGIN
  PERFORM dblink_connect('race_a', v_conn);
  PERFORM dblink_connect('race_b', v_conn);

  BEGIN
    -- ---- committed fixtures ----------------------------------------------
    -- A finished, platform-distributed tournament with Open 2nd = RM150 split
    -- between two players (RM75 each), a fully funded RM500 pool, and RM400
    -- already paid out, so only RM100 is left: room for one RM75 award, not two.
    SELECT id INTO v_org FROM dblink('race_a', format(
      $q$INSERT INTO organizations (name, approval_status) VALUES (%L, 'approved') RETURNING id$q$,
      'PRIZE RACE ORG ' || v_tag)
    ) AS r(id uuid);

    SELECT array_agg(id ORDER BY id) INTO v_users FROM dblink('race_a', format(
      $q$INSERT INTO users (email, first_name, last_name)
         SELECT format('prize-race-%%s-%%s@test.local', %L, i), 'P' || i, 'T'
         FROM generate_series(1, 3) AS i
         RETURNING id$q$, v_tag)
    ) AS r(id uuid);
    v_admin := v_users[3];

    SELECT id INTO v_t FROM dblink('race_a', format(
      $q$INSERT INTO tournaments (
           organization_id, name, venue_name, venue_state, venue_address,
           start_date, end_date, registration_deadline,
           format, time_control, entry_fees, prizes, max_participants, status
         ) VALUES (
           %L, 'PRIZE RACE T', 'Venue', 'Selangor', 'Address',
           current_date - 3, current_date - 2, (current_date - 4)::timestamptz,
           '{"type":"classical","rounds":9,"system":"swiss"}',
           '{"base_minutes":90,"increment_seconds":30}',
           '{"standard": {"amount_cents": 4000}}',
           '{"categories": [{"name": "Open", "funding": {"source": "sponsor", "funder_name": "Acme"},
              "entries": [{"place": "1st", "amount_cents": 35000}, {"place": "2nd", "amount_cents": 15000}]}],
             "special": [], "distribution": "platform"}',
           10, 'published'
         ) RETURNING id$q$, v_org)
    ) AS r(id uuid);

    SELECT id INTO v_fund FROM dblink('race_a', format(
      $q$INSERT INTO prize_fundings (tournament_id, funder_name, funder_email, amount_cents, chip_transaction_id)
         VALUES (%L, 'Acme', 'acme@sponsor.test', 50000, %L) RETURNING id$q$,
      v_t, 'prize_race_' || v_tag)
    ) AS r(id uuid);
    PERFORM * FROM dblink('race_a', format(
      $q$SELECT settle_prize_funding(%L, true, 50000)::text$q$, v_fund)) AS r(res text);

    PERFORM * FROM dblink('race_a', format(
      $q$SELECT settle_registration_payment(
           (create_registration_with_payment(%L, %L, 'standard', 4000) ->> 'payment_id')::uuid, true, 4400)::text$q$,
      v_users[1], v_t)) AS r(res text);
    PERFORM * FROM dblink('race_a', format(
      $q$SELECT settle_registration_payment(
           (create_registration_with_payment(%L, %L, 'standard', 4000) ->> 'payment_id')::uuid, true, 4400)::text$q$,
      v_users[2], v_t)) AS r(res text);

    PERFORM dblink_exec('race_a', format(
      $q$INSERT INTO payments (type, tournament_id, organization_id, gross_amount_cents, net_amount_cents,
                               chip_transaction_id, status, paid_at)
         VALUES ('player_prize', %L, %L, 40000, 40000, %L, 'paid', now())$q$,
      v_t, v_org, 'send_prize_race_' || v_tag));

    SELECT id INTO v_award_a FROM dblink('race_a', format(
      $q$SELECT enter_prize_award(%L, %L, 'Open', '2nd', 7500, %L)$q$, v_t, v_users[1], v_admin)
    ) AS r(id uuid);
    SELECT id INTO v_award_b FROM dblink('race_a', format(
      $q$SELECT enter_prize_award(%L, %L, 'Open', '2nd', 7500, %L)$q$, v_t, v_users[2], v_admin)
    ) AS r(id uuid);

    -- ===== R1: two approvals at once ========================================
    -- Session A approves award A and keeps its transaction open.
    PERFORM dblink_exec('race_a', 'BEGIN');
    PERFORM * FROM dblink('race_a', format(
      $q$SELECT review_prize_award(%L, %L, 'approve', NULL)::text$q$, v_award_a, v_admin)
    ) AS r(res text);

    -- Session B approves award B. On its own it fits (RM75 of RM100 left); only
    -- A's uncommitted reservation makes it too much.
    PERFORM dblink_send_query('race_b', format(
      $q$SELECT review_prize_award(%L, %L, 'approve', NULL)::text$q$, v_award_b, v_admin));
    PERFORM pg_sleep(0.5);
    IF dblink_is_busy('race_b') = 0 THEN
      RAISE EXCEPTION 'R1 FAIL: the second approval did not wait for the first';
    END IF;

    PERFORM dblink_exec('race_a', 'COMMIT');

    v_err := NULL;
    BEGIN
      PERFORM * FROM dblink_get_result('race_b') AS r(res text);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    -- Drain the connection so it takes the next query.
    PERFORM * FROM dblink_get_result('race_b', false) AS r(res text);

    IF v_err IS NULL THEN
      RAISE EXCEPTION 'R1 FAIL: both awards were approved against a pool that covers one';
    END IF;
    IF v_err NOT LIKE '%PRIZE_AWARD_EXCEEDS_POOL: 7500 cents requested, 2500 cents of the collected pool is uncommitted%' THEN
      RAISE EXCEPTION 'R1 FAIL: unexpected error: %', v_err;
    END IF;
    SELECT s INTO v_state FROM dblink('race_a', format(
      $q$SELECT string_agg(approval::text, ',' ORDER BY id = %L DESC) FROM prize_awards WHERE id IN (%L, %L)$q$,
      v_award_a, v_award_a, v_award_b)) AS r(s text);
    IF v_state <> 'approved,pending' THEN
      RAISE EXCEPTION 'R1 FAIL: approvals ended as % (expected approved,pending)', v_state;
    END IF;
    RAISE NOTICE 'R1 PASS — a concurrent approval waits on the tournament lock, then counts the first reservation';

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
