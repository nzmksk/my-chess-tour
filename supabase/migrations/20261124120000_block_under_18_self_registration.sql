-- =============================================
-- #711: a self-managed account whose holder is under 18 can't register (part
-- of #705).
--
-- Signup now asks for a date of birth and refuses under-18s (#710), but an
-- account from before that, or one created outside signup, may have none, and
-- its holder could save an under-18 date later and then register and pay on
-- their own account. The app refuses that twice:
-- PATCH /api/v1/profile won't save an under-18 date of birth on a self-managed
-- account, and checkout refuses an under-18 self-managed participant
-- (checkParticipantAge in registrations/validators.ts). This is the database
-- backstop, for a date of birth written some other way: support, a script, or
-- a row from before #711.
--
-- self_managed_minor(p_user_id) is true when the user's account is 'self' and
-- their date of birth makes them under 18 today in Malaysia
-- (Asia/Kuala_Lumpur, the platform's time zone). "Under 18" is date_of_birth > today - 18 years, so
-- someone born on 29 February is 18 on 1 March in a common year, matching
-- isUnderAdultAge in src/lib/auth/adult-age.ts. No date of birth means no
-- refusal: only accounts from before #710 or created outside signup lack one.
-- Managed accounts (dependents) are exempt: a guardian registers them.
--
-- assert_participant_not_self_managed_minor raises UNDER_18 (P0001), which
-- the checkout route maps to the same 422 as its own check. Both checkout
-- functions call it for the participant (registrations.user_id), whoever
-- pays: create_registration_with_payment before inserting, and
-- start_new_payment_attempt before a new attempt on an existing registration.
-- Confirmed registrations and settlement aren't touched.
--
-- Otherwise both functions are as in
-- 20261123120000_separate_payer_from_participant.sql.
-- =============================================
CREATE FUNCTION self_managed_minor(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN player_profiles p ON p.user_id = u.id
    WHERE u.id = p_user_id
      AND u.account_type = 'self'
      AND p.date_of_birth >
          ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date
  );
$$;

CREATE FUNCTION assert_participant_not_self_managed_minor(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF self_managed_minor(p_user_id) THEN
    RAISE EXCEPTION 'UNDER_18: a self-managed account holder under 18 can''t register; under-18s take part through a parent or guardian''s account'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION create_registration_with_payment(
  p_user_id        uuid,
  p_tournament_id  uuid,
  p_fee_tier       varchar(50),
  p_amount_cents   integer,
  p_payer_user_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registration             registrations;
  v_commission_rate          smallint;
  v_organizer_commission_pct smallint;
  v_organization_id          uuid;
  v_amounts                  record;
  v_payment_id               uuid;
  v_payer_user_id            uuid := COALESCE(p_payer_user_id, p_user_id);
BEGIN
  -- A platform-distributed prize pool must be fully funded before anyone can
  -- enter (#523). The checkout route checks first; this is the backstop.
  -- Checked under the tournament row lock (the capacity trigger takes the same
  -- lock again on insert), so a prize edit either commits first and is seen
  -- here, or waits and sees this hold (guard_tournament_prizes_in_checkout).
  PERFORM 1 FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF prize_pool_blocks_registration(p_tournament_id) THEN
    RAISE EXCEPTION 'PRIZE_POOL_NOT_FUNDED: registration opens once the prize pool is funded'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM assert_participant_not_self_managed_minor(p_user_id);

  INSERT INTO registrations (user_id, tournament_id, fee_tier, status)
  VALUES (p_user_id, p_tournament_id, p_fee_tier, 'pending_payment')
  RETURNING * INTO v_registration;

  SELECT commission_rate, organizer_commission_pct, organization_id
  INTO v_commission_rate, v_organizer_commission_pct, v_organization_id
  FROM tournaments
  WHERE id = p_tournament_id;

  SELECT * INTO v_amounts
  FROM compute_registration_amounts(
    p_amount_cents, v_commission_rate, v_organizer_commission_pct
  );

  INSERT INTO payments (
    type,
    tournament_id,
    registration_id,
    user_id,
    organization_id,
    gross_amount_cents,
    platform_fee_cents,
    organizer_commission_cents,
    player_commission_cents,
    net_amount_cents,
    fee_tier,
    currency,
    status
  ) VALUES (
    'registration',
    p_tournament_id,
    v_registration.id,
    v_payer_user_id,
    v_organization_id,
    v_amounts.gross_amount_cents,
    v_amounts.platform_fee_cents,
    v_amounts.organizer_commission_cents,
    v_amounts.player_commission_cents,
    v_amounts.net_amount_cents,
    p_fee_tier,
    'MYR',
    'pending'
  )
  RETURNING id INTO v_payment_id;

  UPDATE registrations SET current_payment_id = v_payment_id WHERE id = v_registration.id;

  RETURN jsonb_build_object(
    'registration_id', v_registration.id,
    'payment_id', v_payment_id
  );
END;
$$;

-- =============================================
-- START A NEW ATTEMPT (resume after the link lapsed / a decline / an expiry).
-- Re-checks capacity excluding this row, supersedes the prior attempt (marks it
-- failed so its webhooks can't settle the registration), appends a fresh pending
-- payment, re-arms the hold, and points current_payment_id at the new row. The
-- new payment belongs to p_payer_user_id, whoever is retrying, which need not be
-- whoever paid the earlier attempt.
-- =============================================
CREATE OR REPLACE FUNCTION start_new_payment_attempt(
  p_registration_id uuid,
  p_fee_tier        varchar(50),
  p_amount_cents    integer,
  p_payer_user_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg                      registrations;
  v_commission_rate          smallint;
  v_organizer_commission_pct smallint;
  v_organization_id          uuid;
  v_amounts                  record;
  v_payment_id               uuid;
BEGIN
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration % not found', p_registration_id USING ERRCODE = 'P0002';
  END IF;

  IF v_reg.status NOT IN ('pending_payment', 'failed_payment', 'cancelled_payment') THEN
    RAISE EXCEPTION 'registration % is not resumable (status %)', p_registration_id, v_reg.status
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM assert_participant_not_self_managed_minor(v_reg.user_id);

  -- Under the tournament row lock, for the same reason as the first attempt.
  -- assert_tournament_capacity below takes it again.
  PERFORM 1 FROM tournaments WHERE id = v_reg.tournament_id FOR UPDATE;
  IF prize_pool_blocks_registration(v_reg.tournament_id) THEN
    RAISE EXCEPTION 'PRIZE_POOL_NOT_FUNDED: registration opens once the prize pool is funded'
      USING ERRCODE = 'P0001';
  END IF;

  -- A lapsed/failed/expired row may have lost its slot in the meantime.
  PERFORM assert_tournament_capacity(v_reg.tournament_id, p_registration_id);

  -- Supersede the prior attempt so a late webhook for it can't settle the
  -- registration (the double-charge guard cancels its CHIP link separately).
  IF v_reg.current_payment_id IS NOT NULL THEN
    UPDATE payments SET status = 'failed'
      WHERE id = v_reg.current_payment_id AND status = 'pending';
  END IF;

  SELECT commission_rate, organizer_commission_pct, organization_id
  INTO v_commission_rate, v_organizer_commission_pct, v_organization_id
  FROM tournaments
  WHERE id = v_reg.tournament_id;

  SELECT * INTO v_amounts
  FROM compute_registration_amounts(
    p_amount_cents, v_commission_rate, v_organizer_commission_pct
  );

  INSERT INTO payments (
    type, tournament_id, registration_id, user_id, organization_id,
    gross_amount_cents, platform_fee_cents, organizer_commission_cents,
    player_commission_cents, net_amount_cents, fee_tier, currency, status
  ) VALUES (
    'registration', v_reg.tournament_id, v_reg.id, COALESCE(p_payer_user_id, v_reg.user_id), v_organization_id,
    v_amounts.gross_amount_cents, v_amounts.platform_fee_cents,
    v_amounts.organizer_commission_cents, v_amounts.player_commission_cents,
    v_amounts.net_amount_cents, p_fee_tier, 'MYR', 'pending'
  )
  RETURNING id INTO v_payment_id;

  UPDATE registrations
    SET fee_tier            = p_fee_tier,
        status              = 'pending_payment',
        registered_at       = now(),
        cancelled_at        = NULL,
        cancellation_reason = NULL,
        current_payment_id  = v_payment_id
    WHERE id = p_registration_id;

  RETURN jsonb_build_object(
    'registration_id', p_registration_id,
    'payment_id', v_payment_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION self_managed_minor                        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION assert_participant_not_self_managed_minor FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION self_managed_minor                        TO service_role;
GRANT  EXECUTE ON FUNCTION assert_participant_not_self_managed_minor TO service_role;

-- CREATE OR REPLACE keeps the existing grants; restated so this file reads
-- complete on its own.
REVOKE EXECUTE ON FUNCTION create_registration_with_payment FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION start_new_payment_attempt        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION create_registration_with_payment TO service_role;
GRANT  EXECUTE ON FUNCTION start_new_payment_attempt        TO service_role;
