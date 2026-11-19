-- =============================================================================
-- Concurrency test for the prize pool during checkout (#523): a checkout and a
-- prize raise on the same platform-distributed tournament at the same moment,
-- in two real sessions.
--
-- Both sides check the pool under the tournament row lock, so one always sees
-- the other:
--   * create_registration_with_payment / start_new_payment_attempt lock the
--     tournament BEFORE prize_pool_blocks_registration. Without that, a
--     checkout could read the old, funded prizes, then wait for the raise to
--     commit, then take a hold against a pool that no longer covers them.
--   * guard_tournament_prizes_in_checkout runs on the tournament UPDATE, which
--     holds the same lock, and counts the live holds.
-- supabase/tests/prize_pool_checkout_hold.sql covers the guard one statement at a
-- time; this runs the two at once.
--
-- Covers:
--   R1  a raise is open; a checkout waits for it, then is refused with
--       PRIZE_POOL_NOT_FUNDED
--   R2  a checkout is open; a raise waits for it, then is refused with
--       PRIZES_IN_CHECKOUT
--
-- HOW TO RUN: needs the dblink extension and a connection string dblink can use
-- to reach this same database. It COMMITS its fixtures (the second session
-- couldn't see them otherwise) and deletes them at the end, pass or fail, so run
-- it against a local or throwaway database, not production. From psql:
--
--   psql -d <db> \
--     -c "SET capacity_race.conninfo = 'host=localhost dbname=<db> user=postgres password=...'" \
--     -f supabase/tests/prize_pool_checkout_race.sql
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
  v_users  uuid[];
  v_fund   uuid;
  v_err    text;
  v_count  integer;
  v_first  text;
  -- Per-run names, so leftovers from an interrupted run never collide.
  v_tag    text := substr(md5(random()::text), 1, 8);
  v_raise  text := $q$UPDATE tournaments
    SET prizes = jsonb_set(prizes, '{categories,0,entries,0,amount_cents}', '40000')
    WHERE id = %L$q$;
  v_cleanup text := $q$
    UPDATE prize_fundings SET payment_id = NULL, status = 'pending', paid_at = NULL
      WHERE tournament_id = %1$L;
    UPDATE registrations SET current_payment_id = NULL WHERE tournament_id = %1$L;
    DELETE FROM payments       WHERE tournament_id = %1$L;
    DELETE FROM prize_fundings WHERE tournament_id = %1$L;
    DELETE FROM registrations  WHERE tournament_id = %1$L;
    DELETE FROM tournaments    WHERE id = %1$L;
    DELETE FROM users          WHERE email LIKE 'checkout-race-' || %3$L || '-%%';
    -- Soft delete: the audit trail keeps a foreign key to the organization.
    UPDATE organizations SET deleted_at = now() WHERE id = %2$L;
  $q$;
BEGIN
  PERFORM dblink_connect('race_a', v_conn);
  PERFORM dblink_connect('race_b', v_conn);

  BEGIN
    -- ---- committed fixtures ----------------------------------------------
    -- An upcoming platform-distributed tournament with RM500 of prizes, funded
    -- in full. Raising Open 1st to RM400 would leave it RM100 short.
    SELECT id INTO v_org FROM dblink('race_a', format(
      $q$INSERT INTO organizations (name, approval_status) VALUES (%L, 'approved') RETURNING id$q$,
      'CHECKOUT RACE ORG ' || v_tag)
    ) AS r(id uuid);

    SELECT array_agg(id ORDER BY id) INTO v_users FROM dblink('race_a', format(
      $q$INSERT INTO users (email, first_name, last_name)
         SELECT format('checkout-race-%%s-%%s@test.local', %L, i), 'P' || i, 'T'
         FROM generate_series(1, 2) AS i
         RETURNING id$q$, v_tag)
    ) AS r(id uuid);

    SELECT id INTO v_t FROM dblink('race_a', format(
      $q$INSERT INTO tournaments (
           organization_id, name, venue_name, venue_state, venue_address,
           start_date, end_date, registration_deadline,
           format, time_control, entry_fees, prizes, max_participants, status
         ) VALUES (
           %L, 'CHECKOUT RACE T', 'Venue', 'Selangor', 'Address',
           current_date + 20, current_date + 21, (current_date + 19)::timestamptz,
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
      v_t, 'checkout_race_' || v_tag)
    ) AS r(id uuid);
    PERFORM * FROM dblink('race_a', format(
      $q$SELECT settle_prize_funding(%L, true, 50000)::text$q$, v_fund)) AS r(res text);

    -- ===== R1: a raise is open while a checkout starts =======================
    PERFORM dblink_exec('race_a', 'BEGIN');
    PERFORM dblink_exec('race_a', format(v_raise, v_t));

    PERFORM dblink_send_query('race_b', format(
      $q$SELECT create_registration_with_payment(%L, %L, 'standard', 4000)::text$q$, v_users[1], v_t));
    PERFORM pg_sleep(0.5);
    IF dblink_is_busy('race_b') = 0 THEN
      RAISE EXCEPTION 'R1 FAIL: the checkout did not wait for the open prize edit';
    END IF;

    PERFORM dblink_exec('race_a', 'COMMIT');

    v_err := NULL;
    BEGIN
      PERFORM * FROM dblink_get_result('race_b') AS r(res text);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    PERFORM * FROM dblink_get_result('race_b', false) AS r(res text);

    IF v_err IS NULL THEN
      RAISE EXCEPTION 'R1 FAIL: the checkout took a hold against prizes the pool no longer covers';
    END IF;
    IF v_err NOT LIKE '%PRIZE_POOL_NOT_FUNDED:%' THEN
      RAISE EXCEPTION 'R1 FAIL: unexpected error: %', v_err;
    END IF;
    SELECT n INTO v_count FROM dblink('race_a', format(
      $q$SELECT count(*)::integer FROM registrations WHERE tournament_id = %L$q$, v_t)) AS r(n integer);
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'R1 FAIL: % registrations exist (expected none)', v_count;
    END IF;
    RAISE NOTICE 'R1 PASS — a checkout waits for an open raise, then sees the short pool';

    -- Put the prizes back to what the pool covers.
    PERFORM dblink_exec('race_a', format(
      $q$UPDATE tournaments
         SET prizes = jsonb_set(prizes, '{categories,0,entries,0,amount_cents}', '35000')
         WHERE id = %L$q$, v_t));

    -- ===== R2: a checkout is open while a raise is saved =====================
    PERFORM dblink_exec('race_a', 'BEGIN');
    PERFORM * FROM dblink('race_a', format(
      $q$SELECT create_registration_with_payment(%L, %L, 'standard', 4000)::text$q$, v_users[2], v_t)
    ) AS r(res text);

    PERFORM dblink_send_query('race_b', format(v_raise, v_t));
    PERFORM pg_sleep(0.5);
    IF dblink_is_busy('race_b') = 0 THEN
      RAISE EXCEPTION 'R2 FAIL: the prize edit did not wait for the open checkout';
    END IF;

    PERFORM dblink_exec('race_a', 'COMMIT');

    v_err := NULL;
    BEGIN
      PERFORM * FROM dblink_get_result('race_b') AS r(res text);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    PERFORM * FROM dblink_get_result('race_b', false) AS r(res text);

    IF v_err IS NULL THEN
      RAISE EXCEPTION 'R2 FAIL: the prizes were raised beyond the pool under a live checkout';
    END IF;
    IF v_err NOT LIKE '%PRIZES_IN_CHECKOUT: 1 checkouts are live%' THEN
      RAISE EXCEPTION 'R2 FAIL: unexpected error: %', v_err;
    END IF;
    SELECT f INTO v_first FROM dblink('race_a', format(
      $q$SELECT prizes #>> '{categories,0,entries,0,amount_cents}' FROM tournaments WHERE id = %L$q$, v_t)
    ) AS r(f text);
    IF v_first <> '35000' THEN
      RAISE EXCEPTION 'R2 FAIL: Open 1st is % (expected the unchanged 35000)', v_first;
    END IF;
    RAISE NOTICE 'R2 PASS — a raise waits for an open checkout, then counts its hold';

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
