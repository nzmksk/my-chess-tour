-- =============================================
-- #714: a guardian registers a dependent for a tournament (part of #705).
--
-- Checkout already takes the payer apart from the participant (#708). Now the
-- route may pass a participant other than the caller: a dependent the caller
-- acts for. The route authorises that with can_act_for() on the caller's own
-- session. These functions run as the service role, where app_user_id() is
-- NULL, so they check the same thing directly as the backstop:
--
-- assert_payer_acts_for(p_payer_user_id, p_participant_user_id) passes when
-- the two are the same person. Otherwise it needs an active guardianship from
-- the payer to the participant, and takes a FOR SHARE lock on that row until
-- the transaction ends. revoke_dependent (#712) locks the same row FOR UPDATE
-- before it looks for a pending payment, so the two serialise:
--   * revoke commits first: the guardianship is no longer active, and this
--     raises NOT_GUARDIAN (42501);
--   * checkout commits first: revoke then sees the new pending_payment
--     registration and refuses with DEPENDENT_HAS_PENDING_PAYMENT.
--
-- create_registration_with_payment and start_new_payment_attempt call it for
-- the payer and participant of every attempt, and set
-- registrations.registered_by to the payer when the payer isn't the
-- participant (NULL when the player registers themselves, as #706 defined).
-- start_new_payment_attempt rewrites it on every attempt, so a retry by the
-- player clears it and a retry by a guardian records them.
--
-- The under-18 block (#711) is unchanged: assert_participant_not_self_managed_minor
-- already exempts managed accounts, so a dependent under 18 can be registered.
--
-- Otherwise both functions are as in
-- 20261124120000_block_under_18_self_registration.sql.
-- =============================================
CREATE FUNCTION assert_payer_acts_for(
  p_payer_user_id       uuid,
  p_participant_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_payer_user_id = p_participant_user_id THEN
    RETURN;
  END IF;

  PERFORM 1
  FROM guardianships
  WHERE guardian_user_id = p_payer_user_id
    AND dependent_user_id = p_participant_user_id
    AND status = 'active'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_GUARDIAN: the payer can''t register this participant'
      USING ERRCODE = '42501';
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
  PERFORM assert_payer_acts_for(v_payer_user_id, p_user_id);

  INSERT INTO registrations (user_id, tournament_id, fee_tier, status, registered_by)
  VALUES (p_user_id, p_tournament_id, p_fee_tier, 'pending_payment',
          NULLIF(v_payer_user_id, p_user_id))
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
  v_payer_user_id            uuid;
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

  v_payer_user_id := COALESCE(p_payer_user_id, v_reg.user_id);
  PERFORM assert_payer_acts_for(v_payer_user_id, v_reg.user_id);

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
    'registration', v_reg.tournament_id, v_reg.id, v_payer_user_id, v_organization_id,
    v_amounts.gross_amount_cents, v_amounts.platform_fee_cents,
    v_amounts.organizer_commission_cents, v_amounts.player_commission_cents,
    v_amounts.net_amount_cents, p_fee_tier, 'MYR', 'pending'
  )
  RETURNING id INTO v_payment_id;

  -- registered_by follows whoever started this attempt, not only the first
  -- one. It is a stopgap: payments.user_id already records the payer of each
  -- attempt, and if checkout ever covers several participants in one payment,
  -- a per-attempt payer record should replace this column.
  UPDATE registrations
    SET registered_by       = NULLIF(v_payer_user_id, v_reg.user_id),
        fee_tier            = p_fee_tier,
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

REVOKE EXECUTE ON FUNCTION assert_payer_acts_for FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION assert_payer_acts_for TO service_role;

-- CREATE OR REPLACE keeps the existing grants; restated so this file reads
-- complete on its own.
REVOKE EXECUTE ON FUNCTION create_registration_with_payment FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION start_new_payment_attempt        FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION create_registration_with_payment TO service_role;
GRANT  EXECUTE ON FUNCTION start_new_payment_attempt        TO service_role;
