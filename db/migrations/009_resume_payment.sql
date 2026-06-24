-- =============================================
-- SHARED COMMISSION MATH
-- Single source of truth for what a player is charged. Used by both
-- create_registration_with_payment (initial registration) and
-- reset_registration_for_payment (retry/resume).
--
--   platform_fee         = floor(amount * commission_rate / 100)
--   organizer_commission = floor(platform_fee * organizer_commission_pct / 10)
--   player_commission    = platform_fee - organizer_commission
--   gross                = amount + player_commission   (what the player pays)
--   net                  = gross - platform_fee          (what the organizer nets)
-- =============================================
CREATE OR REPLACE FUNCTION compute_registration_amounts(
  p_amount_cents             integer,
  p_commission_rate          smallint,
  p_organizer_commission_pct smallint,
  OUT platform_fee_cents         integer,
  OUT organizer_commission_cents integer,
  OUT player_commission_cents    integer,
  OUT gross_amount_cents         integer,
  OUT net_amount_cents           integer
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  platform_fee_cents         := FLOOR(p_amount_cents::numeric * p_commission_rate / 100)::integer;
  organizer_commission_cents := FLOOR(platform_fee_cents::numeric * p_organizer_commission_pct / 10)::integer;
  player_commission_cents    := platform_fee_cents - organizer_commission_cents;
  gross_amount_cents         := p_amount_cents + player_commission_cents;
  net_amount_cents           := gross_amount_cents - platform_fee_cents;
END;
$$;

-- =============================================
-- ATOMIC REGISTRATION + PAYMENT CREATION
-- (Re-defined to use compute_registration_amounts; behavior unchanged.)
-- =============================================
CREATE OR REPLACE FUNCTION create_registration_with_payment(
  p_user_id        uuid,
  p_tournament_id  uuid,
  p_fee_tier       varchar(50),
  p_amount_cents   integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_registration               registrations;
  v_commission_rate            smallint;
  v_organizer_commission_pct   smallint;
  v_organization_id            uuid;
  v_amounts                    record;
BEGIN
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
    currency,
    status
  ) VALUES (
    'registration',
    p_tournament_id,
    v_registration.id,
    p_user_id,
    v_organization_id,
    v_amounts.gross_amount_cents,
    v_amounts.platform_fee_cents,
    v_amounts.organizer_commission_cents,
    v_amounts.player_commission_cents,
    v_amounts.net_amount_cents,
    'MYR',
    'pending'
  );

  RETURN row_to_json(v_registration)::jsonb;
END;
$$;

-- =============================================
-- RESET REGISTRATION FOR (RE)PAYMENT
-- Used by the checkout route when a user resumes a pending_payment or retries a
-- failed_payment registration — possibly with a different fee tier. Re-prices
-- the registration + its payment for the chosen tier and resets the payment to
-- 'pending' so a fresh CHIP purchase can be initiated.
-- =============================================
CREATE OR REPLACE FUNCTION reset_registration_for_payment(
  p_registration_id uuid,
  p_fee_tier        varchar(50),
  p_amount_cents    integer
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
  v_amounts                  record;
BEGIN
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration % not found', p_registration_id USING ERRCODE = 'P0002';
  END IF;

  IF v_reg.status NOT IN ('pending_payment', 'failed_payment') THEN
    RAISE EXCEPTION 'registration % is not resumable (status %)', p_registration_id, v_reg.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT commission_rate, organizer_commission_pct
  INTO v_commission_rate, v_organizer_commission_pct
  FROM tournaments
  WHERE id = v_reg.tournament_id;

  SELECT * INTO v_amounts
  FROM compute_registration_amounts(
    p_amount_cents, v_commission_rate, v_organizer_commission_pct
  );

  UPDATE registrations
    SET fee_tier = p_fee_tier, status = 'pending_payment'
    WHERE id = p_registration_id;

  UPDATE payments
    SET gross_amount_cents         = v_amounts.gross_amount_cents,
        platform_fee_cents         = v_amounts.platform_fee_cents,
        organizer_commission_cents = v_amounts.organizer_commission_cents,
        player_commission_cents    = v_amounts.player_commission_cents,
        net_amount_cents           = v_amounts.net_amount_cents,
        status                     = 'pending',
        chip_transaction_id        = NULL,
        paid_at                    = NULL
    WHERE registration_id = p_registration_id
      AND type = 'registration';

  RETURN jsonb_build_object('registration_id', p_registration_id);
END;
$$;
