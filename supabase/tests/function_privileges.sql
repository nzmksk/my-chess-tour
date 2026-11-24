-- =============================================================================
-- Regression test for EXECUTE privileges on SECURITY DEFINER functions.
--
-- Postgres grants EXECUTE on new functions to PUBLIC, and Supabase grants it to
-- anon and authenticated too, so with the public schema exposed every function
-- is reachable as POST /rest/v1/rpc/<name>. A SECURITY DEFINER function that
-- trusts its arguments (org id, actor id, payment id) is then a way around the
-- API route's permission checks. See the EXECUTE PRIVILEGES blocks at the end of
-- 003_functions_triggers.sql and 006_payment_functions.sql.
--
-- Covers:
--   P1  every server-only function exists and is executable by service_role
--   P2  no SECURITY DEFINER function in public is executable by anon or
--       authenticated unless it is on the client-callable allowlist. This is
--       the guard for FUTURE functions: add a new definer function without
--       revoking EXECUTE and this fails until it is revoked or allowlisted.
--   P3  the allowlisted helpers are still executable by authenticated, so a
--       blanket revoke cannot silently break RLS policies
--   P4  actually calling a server-only function as anon or authenticated is
--       refused with insufficient_privilege (42501), before any body runs
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs and creates nothing. A
-- failing assertion RAISEs; on success it prints "ALL SCENARIOS PASSED" via
-- NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  -- Called only through supabaseAdmin. Keep in sync with the REVOKE blocks.
  v_server_only text[] := ARRAY[
    'set_organization_bank_account',
    'record_sensitive_data_consent',
    'create_organization_application',
    'resubmit_organization_application',
    'set_organization_registered_name',
    'assert_org_name_available',
    'assert_org_entity_documents',
    'review_organization_application',
    'review_tournament_cancellation',
    'assert_tournament_capacity',
    'count_taken_seats',
    'create_registration_with_payment',
    'start_new_payment_attempt',
    'self_managed_minor',
    'assert_participant_not_self_managed_minor',
    'assert_payer_acts_for',
    'create_helper_invitation',
    'accept_helper_invitation',
    'decline_helper_invitation',
    'revoke_helper_invitation',
    'end_helper_guardianship',
    'create_dependent',
    'revoke_dependent',
    'create_account_claim',
    'cancel_account_claim',
    'link_claimed_account',
    'settle_registration_payment',
    'expire_stale_pending_payments',
    'list_unfired_cancellation_refunds',
    'settle_refund',
    'claim_refund_fire',
    'list_stuck_refunds',
    'settle_bank_account_verification',
    'review_bank_account_name',
    'payout_recipient_problem',
    'nominate_payout_beneficiary',
    'accept_payout_nomination',
    'decline_payout_nomination',
    'create_organization_invitation',
    'accept_organization_invitation',
    'decline_organization_invitation',
    'accept_organization_invitation_by_id',
    'decline_organization_invitation_by_id',
    'revoke_organization_invitation',
    'available_payout_cents',
    'tournament_payout_block_reason',
    'queue_payout',
    'settle_payout',
    'list_organization_payout_overview',
    'list_pending_payout_nominations',
    'list_admin_payout_candidates',
    'list_payable_tournaments',
    'withdraw_prize_award',
    'prize_payees',
    'minor_guardianship_aged_out',
    'claim_guardianship_age_out_notices',
    'end_aged_out_minor_guardianships',
    'anonymise_user_audit_logs'
  ];
  -- SECURITY DEFINER functions clients may call. Adding to this list is a
  -- security decision: the function must check the caller itself or expose
  -- nothing sensitive.
  v_client_callable text[] := ARRAY[
    'app_user_id',
    'can_act_for',
    'has_global_permission',
    'has_org_permission',
    'is_org_member',
    'is_org_approved',
    'get_participant_counts'
  ];
  v_name    text;
  v_role    text;
  v_oid     oid;
  v_leaks   text;
BEGIN
  -- P1 ---------------------------------------------------------------------
  FOREACH v_name IN ARRAY v_server_only LOOP
    SELECT p.oid INTO v_oid
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name;

    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'P1 FAIL: function % not found (renamed? update this test and the REVOKE block)', v_name;
    END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'P1 FAIL: service_role cannot execute % — the API routes would break', v_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'P1 PASS — % server-only functions exist and service_role can execute them',
    array_length(v_server_only, 1);

  -- P2 ---------------------------------------------------------------------
  SELECT string_agg(format('%s (%s)', p.oid::regprocedure, r.role), ', ')
    INTO v_leaks
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype <> 'trigger'::regtype   -- not callable via RPC anyway
      AND p.proname <> ALL (v_client_callable)
      AND has_function_privilege(r.role, p.oid, 'EXECUTE');

  IF v_leaks IS NOT NULL THEN
    RAISE EXCEPTION 'P2 FAIL: SECURITY DEFINER functions executable by clients: %. Revoke EXECUTE (see 003 EXECUTE PRIVILEGES) or, if clients must call it, add it to v_client_callable with a reason.', v_leaks;
  END IF;
  RAISE NOTICE 'P2 PASS — no SECURITY DEFINER function outside the allowlist is client-executable';

  -- P3 ---------------------------------------------------------------------
  FOREACH v_name IN ARRAY v_client_callable LOOP
    FOR v_oid IN
      SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_name
    LOOP
      IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'P3 FAIL: authenticated cannot execute % — RLS / permission checks depend on it',
          v_oid::regprocedure;
      END IF;
    END LOOP;
  END LOOP;
  RAISE NOTICE 'P3 PASS — client-callable helpers still executable by authenticated';

  -- P4 ---------------------------------------------------------------------
  -- The privilege check happens before the body runs, so NULL arguments are
  -- enough: reaching the body at all is the failure.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      PERFORM set_organization_bank_account(NULL, NULL, NULL, NULL, NULL);
      RAISE EXCEPTION 'P4 FAIL: % could call set_organization_bank_account', v_role;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;

    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      PERFORM settle_registration_payment(NULL, true);
      RAISE EXCEPTION 'P4 FAIL: % could call settle_registration_payment', v_role;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;

    BEGIN
      EXECUTE format('SET LOCAL ROLE %I', v_role);
      PERFORM review_organization_application(NULL, NULL, 'approve', NULL);
      RAISE EXCEPTION 'P4 FAIL: % could call review_organization_application', v_role;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;

    -- The failed subtransactions already undid SET LOCAL ROLE; this makes the
    -- next iteration independent of that detail.
    RESET ROLE;
  END LOOP;
  RAISE NOTICE 'P4 PASS — anon and authenticated get 42501 calling server-only functions';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
