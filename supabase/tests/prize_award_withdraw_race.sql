-- =============================================================================
-- Concurrency test for withdrawing a prize award (withdraw_prize_award,
-- 20261124200000_withdraw_prize_award.sql, #611): an organizer withdrawing an
-- award while an admin approves it, in two real sessions.
--
-- Both functions lock the tournament row, then the award, so they serialise:
-- whichever runs second must see the first one's outcome, never overwrite it.
-- Without the locks an approval could reserve pool money for an award the
-- organizer had just withdrawn, or a withdrawal could undo an approval whose
-- send was already under way.
--
-- Covers:
--   W1  approve first: the withdrawal waits, then is refused with
--       PRIZE_AWARD_NOT_WITHDRAWABLE: approved, and the award stays approved
--   W2  withdraw first: the approval waits, then is refused with
--       PRIZE_AWARD_WITHDRAWN, and the award stays withdrawn
--
-- HOW TO RUN: as supabase/tests/prize_award_review_race.sql. It needs the
-- dblink extension and the capacity_race.conninfo setting, COMMITS its
-- fixtures and deletes them at the end, pass or fail, so run it against a
-- local or throwaway database, never production:
--
--   psql -d <db> --     -c "SET capacity_race.conninfo = 'host=localhost dbname=<db> user=postgres password=...'" --     -f supabase/tests/prize_award_withdraw_race.sql
--
-- A failing assertion RAISEs; on success it prints "ALL SCENARIOS PASSED" via
-- NOTICE.
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
    DELETE FROM users          WHERE email LIKE 'prize-wd-race-' || %3$L || '-%%';
    -- Soft delete: the audit trail keeps a foreign key to the organization.
    UPDATE organizations SET deleted_at = now() WHERE id = %2$L;
  $q$;
BEGIN
  PERFORM dblink_connect('race_a', v_conn);
  PERFORM dblink_connect('race_b', v_conn);

  BEGIN
    -- ---- committed fixtures ----------------------------------------------
    -- A finished, platform-distributed tournament with a fully funded RM500
    -- pool and two awards awaiting review: Open 1st (RM350) for W1, Open 2nd
    -- (RM150) for W2.
    SELECT id INTO v_org FROM dblink('race_a', format(
      $q$INSERT INTO organizations (name, approval_status) VALUES (%L, 'approved') RETURNING id$q$,
      'PRIZE WD RACE ORG ' || v_tag)
    ) AS r(id uuid);

    SELECT array_agg(id ORDER BY id) INTO v_users FROM dblink('race_a', format(
      $q$INSERT INTO users (email, first_name, last_name)
         SELECT format('prize-wd-race-%%s-%%s@test.local', %L, i), 'P' || i, 'T'
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
           %L, 'PRIZE WD RACE T', 'Venue', 'Selangor', 'Address',
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
      v_t, 'prize_wd_race_' || v_tag)
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

    SELECT id INTO v_award_a FROM dblink('race_a', format(
      $q$SELECT enter_prize_award(%L, %L, 'Open', '1st', 35000, %L)$q$, v_t, v_users[1], v_admin)
    ) AS r(id uuid);
    SELECT id INTO v_award_b FROM dblink('race_a', format(
      $q$SELECT enter_prize_award(%L, %L, 'Open', '2nd', 15000, %L)$q$, v_t, v_users[2], v_admin)
    ) AS r(id uuid);

    -- ===== W1: approve first, then withdraw ===================================
    PERFORM dblink_exec('race_a', 'BEGIN');
    PERFORM * FROM dblink('race_a', format(
      $q$SELECT review_prize_award(%L, %L, 'approve', NULL)::text$q$, v_award_a, v_admin)
    ) AS r(res text);

    PERFORM dblink_send_query('race_b', format(
      $q$SELECT withdraw_prize_award(%L, %L, %L)::text$q$, v_t, v_award_a, v_admin));
    PERFORM pg_sleep(0.5);
    IF dblink_is_busy('race_b') = 0 THEN
      RAISE EXCEPTION 'W1 FAIL: the withdrawal did not wait for the approval';
    END IF;

    PERFORM dblink_exec('race_a', 'COMMIT');

    v_err := NULL;
    BEGIN
      PERFORM * FROM dblink_get_result('race_b') AS r(res text);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    PERFORM * FROM dblink_get_result('race_b', false) AS r(res text);

    IF v_err IS NULL OR v_err NOT LIKE '%PRIZE_AWARD_NOT_WITHDRAWABLE: approved%' THEN
      RAISE EXCEPTION 'W1 FAIL: withdrawing after the approval gave %', COALESCE(v_err, 'no error');
    END IF;
    SELECT s INTO v_state FROM dblink('race_a', format(
      $q$SELECT approval::text || '/' || (withdrawn_at IS NULL)::text FROM prize_awards WHERE id = %L$q$,
      v_award_a)) AS r(s text);
    IF v_state <> 'approved/true' THEN
      RAISE EXCEPTION 'W1 FAIL: the award ended as % (expected approved/true)', v_state;
    END IF;
    RAISE NOTICE 'W1 PASS — a withdrawal waits on the tournament lock and is refused once approved';

    -- ===== W2: withdraw first, then approve ===================================
    PERFORM dblink_exec('race_a', 'BEGIN');
    PERFORM * FROM dblink('race_a', format(
      $q$SELECT withdraw_prize_award(%L, %L, %L)::text$q$, v_t, v_award_b, v_admin)
    ) AS r(res text);

    PERFORM dblink_send_query('race_b', format(
      $q$SELECT review_prize_award(%L, %L, 'approve', NULL)::text$q$, v_award_b, v_admin));
    PERFORM pg_sleep(0.5);
    IF dblink_is_busy('race_b') = 0 THEN
      RAISE EXCEPTION 'W2 FAIL: the approval did not wait for the withdrawal';
    END IF;

    PERFORM dblink_exec('race_a', 'COMMIT');

    v_err := NULL;
    BEGIN
      PERFORM * FROM dblink_get_result('race_b') AS r(res text);
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
    END;
    PERFORM * FROM dblink_get_result('race_b', false) AS r(res text);

    IF v_err IS NULL OR v_err NOT LIKE '%PRIZE_AWARD_WITHDRAWN%' THEN
      RAISE EXCEPTION 'W2 FAIL: approving after the withdrawal gave %', COALESCE(v_err, 'no error');
    END IF;
    SELECT s INTO v_state FROM dblink('race_a', format(
      $q$SELECT approval::text || '/' || (withdrawn_at IS NULL)::text FROM prize_awards WHERE id = %L$q$,
      v_award_b)) AS r(s text);
    IF v_state <> 'rejected/false' THEN
      RAISE EXCEPTION 'W2 FAIL: the award ended as % (expected rejected/false)', v_state;
    END IF;
    RAISE NOTICE 'W2 PASS — an approval waits on the tournament lock and is refused once withdrawn';

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
