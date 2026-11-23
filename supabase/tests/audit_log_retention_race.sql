-- =============================================================================
-- Concurrency test for prune_audit_logs (#507): a late paid settlement and a
-- prune running at the same time, in two real sessions.
--
-- An unpaid registration's audit rows are pruned 30 days after its
-- tournament's registration closed. A paid result can still arrive after that
-- (a purchase paid before it expired, whose webhooks were all lost, reconciled
-- later), and settle_registration_payment confirms the registration. The
-- prune's DELETE locks the registration rows it deletes for with
-- FOR UPDATE ... SKIP LOCKED, so it must skip a registration whose settlement
-- is still open, and once that settlement commits the registration is
-- confirmed and no longer eligible. audit_log_retention.sql runs in one
-- session and can't hold a lock against itself; this one can.
--
-- Covers:
--   P1  with a settlement open on one registration, a prune deletes the history
--       of an identical registration nobody is settling, and skips the locked
--       one
--   P2  after the settlement commits, the confirmed registration's history is
--       no longer eligible and a prune keeps it
--
-- Each prune runs in session A inside a transaction that is rolled back, so
-- the test deletes nothing outside its own fixtures.
--
-- HOW TO RUN: needs the dblink extension and a connection string dblink can
-- use to reach this same database. It COMMITS its fixtures (the second session
-- couldn't see them otherwise) and deletes them at the end, pass or fail, so
-- run it against a local or throwaway database, not production. From psql:
--
--   psql -d <db> \
--     -c "SET capacity_race.conninfo = 'host=localhost dbname=<db> user=postgres password=...'" \
--     -f supabase/tests/audit_log_retention_race.sql
--
-- Without the setting it tries 'dbname=<current database>', which works when the
-- server trusts local connections. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS dblink;

DO $$
DECLARE
  v_conn    text := COALESCE(
    NULLIF(current_setting('capacity_race.conninfo', true), ''),
    'dbname=' || current_database()
  );
  v_org     uuid;
  v_t       uuid;
  v_users   uuid[];
  v_regs    uuid[];
  v_pays    uuid[];
  v_res     jsonb;
  v_left    integer;
  v_tag     text := substr(md5(random()::text), 1, 8);
  v_count_q text := $q$
    SELECT count(*)::int FROM audit_logs
    WHERE table_name = 'registrations' AND record_id = %L
  $q$;
  v_cleanup text := $q$
    UPDATE registrations SET current_payment_id = NULL WHERE tournament_id = %1$L;
    DELETE FROM payments      WHERE tournament_id = %1$L;
    DELETE FROM registrations WHERE tournament_id = %1$L;
    DELETE FROM tournaments   WHERE id = %1$L;
    DELETE FROM users         WHERE email LIKE 'retention-race-' || %3$L || '-%%';
    UPDATE organizations SET deleted_at = now() WHERE id = %2$L;
  $q$;
BEGIN
  PERFORM dblink_connect('race_a', v_conn);
  PERFORM dblink_connect('race_b', v_conn);

  BEGIN
    -- ---- committed fixtures --------------------------------------------------
    -- Two players whose checkouts expired unpaid, on a tournament whose
    -- registration closed 40 days ago, with history 60 days old.
    SELECT id INTO v_org FROM dblink('race_a', format(
      $q$INSERT INTO organizations (name) VALUES (%L) RETURNING id$q$,
      'RETENTION RACE ORG ' || v_tag)
    ) AS r(id uuid);

    SELECT array_agg(id ORDER BY id) INTO v_users FROM dblink('race_a', format(
      $q$INSERT INTO users (email, first_name, last_name)
         SELECT format('retention-race-%%s-%%s@test.local', %L, i), 'P' || i, 'T'
         FROM generate_series(1, 2) AS i
         RETURNING id$q$, v_tag)
    ) AS r(id uuid);

    SELECT id INTO v_t FROM dblink('race_a', format(
      $q$INSERT INTO tournaments (
           organization_id, name, venue_name, venue_state, venue_address,
           start_date, end_date, registration_deadline,
           format, time_control, entry_fees, max_participants, status
         ) VALUES (
           %L, 'RETENTION RACE T', 'Venue', 'Selangor', 'Address',
           current_date + 30, current_date + 31, now() + interval '20 days',
           '{"type":"classical","rounds":9,"system":"swiss"}',
           '{"base_minutes":90,"increment_seconds":30}',
           '{"standard": {"amount_cents": 4000}}', 10, 'published'
         ) RETURNING id$q$, v_org)
    ) AS r(id uuid);

    FOR i IN 1..2 LOOP
      SELECT res::jsonb INTO v_res FROM dblink('race_a', format(
        $q$SELECT create_registration_with_payment(%L, %L, 'standard', 4000)::text$q$,
        v_users[i], v_t)) AS r(res text);
      v_regs := v_regs || (v_res ->> 'registration_id')::uuid;
      v_pays := v_pays || (v_res ->> 'payment_id')::uuid;
    END LOOP;

    PERFORM dblink_exec('race_a', format(
      $q$UPDATE registrations
         SET status = 'cancelled_payment', cancelled_at = now(),
             cancellation_reason = 'Payment window expired'
         WHERE tournament_id = %1$L;
         UPDATE tournaments SET registration_closed_at = now() - interval '40 days'
         WHERE id = %1$L;
         UPDATE audit_logs SET created_at = now() - interval '60 days'
         WHERE table_name = 'registrations'
           AND record_id IN (SELECT id::text FROM registrations WHERE tournament_id = %1$L)$q$,
      v_t));

    -- ===== P1: a settlement is open on registration 1 ========================
    PERFORM dblink_exec('race_b', 'BEGIN');
    PERFORM * FROM dblink('race_b', format(
      $q$SELECT settle_registration_payment(%L, true, NULL, 'fpx')::text$q$,
      v_pays[1])) AS r(res text);

    PERFORM dblink_exec('race_a', 'BEGIN');
    PERFORM * FROM dblink('race_a',
      'SELECT count(*)::text FROM prune_audit_logs(false, 1000000)') AS r(n text);

    SELECT n INTO v_left FROM dblink('race_a', format(v_count_q, v_regs[2])) AS r(n int);
    IF v_left <> 0 THEN
      RAISE EXCEPTION 'P1 FAIL: the unlocked expired registration kept % audit rows', v_left;
    END IF;
    SELECT n INTO v_left FROM dblink('race_a', format(v_count_q, v_regs[1])) AS r(n int);
    IF v_left = 0 THEN
      RAISE EXCEPTION 'P1 FAIL: the prune deleted the history of a registration being settled';
    END IF;
    PERFORM dblink_exec('race_a', 'ROLLBACK');
    RAISE NOTICE 'P1 PASS — the prune skips a registration whose settlement is open';

    -- ===== P2: the settlement commits ========================================
    PERFORM dblink_exec('race_b', 'COMMIT');

    PERFORM dblink_exec('race_a', 'BEGIN');
    PERFORM * FROM dblink('race_a',
      'SELECT count(*)::text FROM prune_audit_logs(false, 1000000)') AS r(n text);
    SELECT n INTO v_left FROM dblink('race_a', format(v_count_q, v_regs[1])) AS r(n int);
    IF v_left < 3 THEN
      RAISE EXCEPTION 'P2 FAIL: the confirmed registration has % audit rows, expected its whole history', v_left;
    END IF;
    PERFORM dblink_exec('race_a', 'ROLLBACK');
    RAISE NOTICE 'P2 PASS — once confirmed, the registration''s history is kept';

  EXCEPTION WHEN OTHERS THEN
    PERFORM dblink_cancel_query('race_a');
    PERFORM dblink_cancel_query('race_b');
    PERFORM dblink_disconnect('race_a');
    PERFORM dblink_disconnect('race_b');
    PERFORM dblink_connect('race_a', v_conn);
    PERFORM dblink_exec('race_a', format(v_cleanup, v_t, v_org, v_tag));
    PERFORM dblink_disconnect('race_a');
    RAISE;
  END;

  PERFORM dblink_exec('race_a', format(v_cleanup, v_t, v_org, v_tag));
  PERFORM dblink_disconnect('race_a');
  PERFORM dblink_disconnect('race_b');

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;
