-- =============================================
-- #708: separate the payer from the participant.
--
-- create_registration_with_payment passed one p_user_id to both the
-- registration and its payment, because the person registering was always the
-- person paying. Once guardians and helpers exist (#705) they won't be, and
-- mixing them up is expensive to undo: a refund would go to the wrong person,
-- and a handover (#720) would give the guardian's payment history to someone
-- who never paid. So:
--   registrations.user_id = the participant (who plays)
--   payments.user_id      = the payer (whose money it is)
--
-- Both functions gain p_payer_user_id. On a retry the payer is whoever
-- retries, so start_new_payment_attempt takes it too rather than copying the
-- participant from the registration.
--
-- p_payer_user_id defaults to NULL, read as "the participant pays", so a
-- caller that predates this keeps working and nothing changes until a caller
-- passes someone else. The checkout route always passes the caller explicitly.
--
-- A new parameter is a new signature, and CREATE OR REPLACE would add an
-- overload beside the old one and make every 4-argument call ambiguous. So the
-- old signatures are dropped first, and the privileges, which go with them,
-- are granted again below.
--
-- The refund ledger row already copied user_id from the paid payment, so it
-- names the payer with no change here.
-- =============================================

COMMENT ON COLUMN payments.user_id IS
  'The payer: whose money this row moves. For a registration payment this can differ from registrations.user_id, which is the participant (#708). A refund row copies it from the payment it refunds.';

DROP FUNCTION create_registration_with_payment(uuid, uuid, varchar, integer);
DROP FUNCTION start_new_payment_attempt(uuid, varchar, integer);

-- =============================================
-- CREATE: first attempt. Atomically inserts the registration + its first payment
-- row, points the registration at it, and returns {registration_id, payment_id}
-- so the caller can initiate CHIP on that exact row. Capacity is enforced by the
-- check_tournament_capacity INSERT trigger (003). The registration belongs to
-- p_user_id (the participant); the payment to p_payer_user_id.
-- =============================================
CREATE FUNCTION create_registration_with_payment(
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
CREATE FUNCTION start_new_payment_attempt(
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

REVOKE EXECUTE ON FUNCTION create_registration_with_payment FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION start_new_payment_attempt        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_registration_with_payment TO service_role;
GRANT EXECUTE ON FUNCTION start_new_payment_attempt        TO service_role;
