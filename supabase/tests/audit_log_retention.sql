-- =============================================================================
-- Regression test for audit-log retention and pruning (#507).
--
-- Covers:
--   R1  a pointer-only registrations update (current_payment_id) writes no
--       audit row; the checkout writes the registration and payment inserts
--       only; any other registrations update is still audited
--   R2  the policy names no financial table, and every table it names is one
--       that is actually audited
--   R3  dry run reports per-table counts and deletes nothing
--   R4  a real run deletes rows past retention: 1-year tables, and unpaid
--       registrations after 30 days. It keeps recent rows, paid and confirmed
--       registrations however old, and every financial table's rows however
--       old, even with an unbounded limit
--   R5  p_limit caps the rows deleted per call
--   R6  bad arguments are refused, and only service_role may execute the
--       functions
--   R7  audit_logs_storage() reports a size
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs. A failing assertion
-- RAISEs; on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  c_financial constant text[] := ARRAY[
    'payments', 'refunds', 'payouts', 'prize_awards', 'prize_fundings',
    'organization_bank_accounts', 'player_bank_accounts',
    'tournaments', 'tournament_cancellation_requests'
  ];
  v_org          uuid;
  v_tournament   uuid;
  v_paid_user    uuid;
  v_unpaid_user  uuid;
  v_recent_user  uuid;
  v_old_user     uuid;
  v_res          jsonb;
  v_paid_reg     uuid;
  v_paid_pay     uuid;
  v_unpaid_reg   uuid;
  v_unpaid_pay   uuid;
  v_recent_reg   uuid;
  v_n            bigint;
  v_m            bigint;
  v_fin_ids      bigint[];
  v_eligible     bigint;
  v_raised       boolean;
  v_row          record;
BEGIN
  -- ---- fixtures -------------------------------------------------------------
  INSERT INTO organizations (name) VALUES ('RETENTION ORG') RETURNING id INTO v_org;
  INSERT INTO users (email, first_name, last_name) VALUES ('ret-paid@test.local','P','T')   RETURNING id INTO v_paid_user;
  INSERT INTO users (email, first_name, last_name) VALUES ('ret-unpaid@test.local','U','T') RETURNING id INTO v_unpaid_user;
  INSERT INTO users (email, first_name, last_name) VALUES ('ret-recent@test.local','R','T') RETURNING id INTO v_recent_user;
  INSERT INTO users (email, first_name, last_name) VALUES ('ret-old@test.local','O','T')    RETURNING id INTO v_old_user;

  INSERT INTO tournaments (
    organization_id, name, venue_name, venue_state, venue_address,
    start_date, end_date, registration_deadline,
    format, time_control, entry_fees, max_participants, status
  ) VALUES (
    v_org, 'RETENTION T', 'Venue', 'Selangor', 'Address',
    current_date + 30, current_date + 31, now() + interval '20 days',
    '{"type":"classical","rounds":9,"system":"swiss"}',
    '{"base_minutes":90,"increment_seconds":30}',
    '{"standard": {"amount_cents": 4000}}',
    100, 'published'
  ) RETURNING id INTO v_tournament;

  -- ===== R1 ==================================================================
  v_res        := create_registration_with_payment(v_paid_user, v_tournament, 'standard', 4000);
  v_paid_reg   := (v_res ->> 'registration_id')::uuid;
  v_paid_pay   := (v_res ->> 'payment_id')::uuid;

  SELECT count(*) INTO v_n FROM audit_logs
    WHERE table_name = 'registrations' AND record_id = v_paid_reg::text;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R1 FAILED: checkout wrote % registrations audit rows, expected only the insert', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs
                 WHERE table_name = 'payments' AND record_id = v_paid_pay::text AND action = 'INSERT') THEN
    RAISE EXCEPTION 'R1 FAILED: the payment insert was not audited';
  END IF;

  UPDATE registrations SET current_payment_id = NULL WHERE id = v_paid_reg;
  UPDATE registrations SET current_payment_id = v_paid_pay WHERE id = v_paid_reg;
  SELECT count(*) INTO v_n FROM audit_logs
    WHERE table_name = 'registrations' AND record_id = v_paid_reg::text;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R1 FAILED: a pointer-only update was audited';
  END IF;

  PERFORM settle_registration_payment(v_paid_pay, true, NULL, 'fpx');
  SELECT count(*) INTO v_n FROM audit_logs
    WHERE table_name = 'registrations' AND record_id = v_paid_reg::text AND action = 'UPDATE';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R1 FAILED: confirming the registration was not audited (got % updates)', v_n;
  END IF;

  v_res        := create_registration_with_payment(v_unpaid_user, v_tournament, 'standard', 4000);
  v_unpaid_reg := (v_res ->> 'registration_id')::uuid;
  v_unpaid_pay := (v_res ->> 'payment_id')::uuid;
  PERFORM settle_registration_payment(v_unpaid_pay, false);
  IF (SELECT status FROM registrations WHERE id = v_unpaid_reg) <> 'failed_payment' THEN
    RAISE EXCEPTION 'R1 FAILED: fixture registration did not fail';
  END IF;

  v_res        := create_registration_with_payment(v_recent_user, v_tournament, 'standard', 4000);
  v_recent_reg := (v_res ->> 'registration_id')::uuid;

  -- ===== R2 ==================================================================
  IF EXISTS (SELECT 1 FROM audit_log_retention() WHERE audited_table = ANY (c_financial)) THEN
    RAISE EXCEPTION 'R2 FAILED: the retention policy names a financial table';
  END IF;
  FOR v_row IN SELECT audited_table FROM audit_log_retention() LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname = 'audit_trail' AND c.relname = v_row.audited_table
    ) THEN
      RAISE EXCEPTION 'R2 FAILED: policy names %, which is not audited', v_row.audited_table;
    END IF;
  END LOOP;

  -- ---- age the fixtures' history -------------------------------------------
  UPDATE audit_logs SET created_at = now() - interval '2 years'
    WHERE table_name = 'users' AND record_id = v_old_user::text;
  UPDATE audit_logs SET created_at = now() - interval '10 years'
    WHERE (table_name = 'registrations' AND record_id = v_paid_reg::text)
       OR (table_name = 'payments' AND record_id IN (v_paid_pay::text, v_unpaid_pay::text))
       OR (table_name = 'tournaments' AND record_id = v_tournament::text);
  UPDATE audit_logs SET created_at = now() - interval '60 days'
    WHERE table_name = 'registrations' AND record_id = v_unpaid_reg::text;
  UPDATE audit_logs SET created_at = now() - interval '10 days'
    WHERE table_name = 'registrations' AND record_id = v_recent_reg::text;

  WITH ins AS (
    INSERT INTO audit_logs (table_name, record_id, action, new_data, created_at)
    SELECT t, gen_random_uuid()::text, 'INSERT', '{}'::jsonb, now() - interval '10 years'
    FROM unnest(c_financial) AS t
    RETURNING id
  )
  SELECT array_agg(id) INTO v_fin_ids FROM ins;

  -- ===== R3 ==================================================================
  SELECT count(*) INTO v_m FROM audit_logs;
  SELECT eligible INTO v_n FROM prune_audit_logs() WHERE audited_table = 'users';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'R3 FAILED: dry run reports no users rows past retention';
  END IF;
  SELECT eligible INTO v_n FROM prune_audit_logs(true) WHERE audited_table = 'registrations';
  IF v_n < 1 THEN
    RAISE EXCEPTION 'R3 FAILED: dry run reports no unpaid registration rows past retention';
  END IF;
  IF EXISTS (SELECT 1 FROM prune_audit_logs(true) WHERE deleted <> 0) THEN
    RAISE EXCEPTION 'R3 FAILED: dry run reports deletions';
  END IF;
  IF (SELECT count(*) FROM audit_logs) <> v_m THEN
    RAISE EXCEPTION 'R3 FAILED: dry run deleted rows';
  END IF;

  -- ===== R5 (before R4 empties the queue) ====================================
  SELECT count(*) INTO v_m FROM audit_logs;
  SELECT sum(eligible) INTO v_eligible FROM prune_audit_logs(true);
  SELECT sum(deleted) INTO v_n FROM prune_audit_logs(false, 1);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'R5 FAILED: p_limit 1 deleted % rows', v_n;
  END IF;
  IF (SELECT count(*) FROM audit_logs) <> v_m - 1 THEN
    RAISE EXCEPTION 'R5 FAILED: the reported deletion does not match the table';
  END IF;
  IF (SELECT sum(eligible) FROM prune_audit_logs(true)) <> v_eligible - 1 THEN
    RAISE EXCEPTION 'R5 FAILED: the deleted row was not one past retention';
  END IF;

  -- ===== R4 ==================================================================
  PERFORM prune_audit_logs(false, 2147483647);

  IF EXISTS (SELECT 1 FROM audit_logs WHERE table_name = 'users' AND record_id = v_old_user::text) THEN
    RAISE EXCEPTION 'R4 FAILED: a 2-year-old users row survived';
  END IF;
  IF EXISTS (SELECT 1 FROM audit_logs WHERE table_name = 'registrations' AND record_id = v_unpaid_reg::text) THEN
    RAISE EXCEPTION 'R4 FAILED: a 60-day-old unpaid registration row survived';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE table_name = 'users' AND record_id = v_recent_user::text) THEN
    RAISE EXCEPTION 'R4 FAILED: a recent users row was deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE table_name = 'registrations' AND record_id = v_recent_reg::text) THEN
    RAISE EXCEPTION 'R4 FAILED: a 10-day-old unpaid registration row was deleted';
  END IF;
  SELECT count(*) INTO v_n FROM audit_logs WHERE table_name = 'registrations' AND record_id = v_paid_reg::text;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'R4 FAILED: a paid registration lost history (% rows left)', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE table_name = 'payments' AND record_id = v_unpaid_pay::text) THEN
    RAISE EXCEPTION 'R4 FAILED: a failed payment attempt''s audit row was deleted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE table_name = 'tournaments' AND record_id = v_tournament::text) THEN
    RAISE EXCEPTION 'R4 FAILED: a tournament audit row was deleted';
  END IF;
  SELECT count(*) INTO v_n FROM audit_logs WHERE id = ANY (v_fin_ids);
  IF v_n <> array_length(c_financial, 1) THEN
    RAISE EXCEPTION 'R4 FAILED: % of % decade-old financial audit rows survived', v_n, array_length(c_financial, 1);
  END IF;
  IF EXISTS (SELECT 1 FROM prune_audit_logs(true) WHERE eligible <> 0) THEN
    RAISE EXCEPTION 'R4 FAILED: rows past retention remain after an unbounded run';
  END IF;

  -- ===== R6 ==================================================================
  v_raised := false;
  BEGIN
    PERFORM prune_audit_logs(false, 0);
  EXCEPTION WHEN raise_exception THEN
    v_raised := SQLERRM = 'LIMIT_REQUIRED';
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'R6 FAILED: a zero limit was accepted';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM prune_audit_logs(NULL);
  EXCEPTION WHEN raise_exception THEN
    v_raised := SQLERRM = 'DRY_RUN_REQUIRED';
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'R6 FAILED: a NULL dry-run flag was accepted';
  END IF;

  FOR v_row IN SELECT unnest(ARRAY[
    'prune_audit_logs(boolean, integer)', 'audit_log_retention()', 'audit_logs_storage()'
  ]) AS fn LOOP
    IF has_function_privilege('anon', v_row.fn, 'EXECUTE')
       OR has_function_privilege('authenticated', v_row.fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'R6 FAILED: % is executable by anon or authenticated', v_row.fn;
    END IF;
    IF NOT has_function_privilege('service_role', v_row.fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'R6 FAILED: % is not executable by service_role', v_row.fn;
    END IF;
  END LOOP;

  -- ===== R7 ==================================================================
  IF (SELECT total_bytes FROM audit_logs_storage()) <= 0 THEN
    RAISE EXCEPTION 'R7 FAILED: audit_logs_storage reports no size';
  END IF;

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
