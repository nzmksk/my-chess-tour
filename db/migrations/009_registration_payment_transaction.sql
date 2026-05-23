-- =============================================
-- ATOMIC REGISTRATION + PAYMENT CREATION
-- Inserts a registration and its corresponding pending payment
-- record in a single transaction, preventing partial writes.
--
-- Commission formula:
--   platform_fee        = FLOOR(base_fee * commission_rate / 100)
--   organizer_commission = FLOOR(platform_fee * organizer_commission_pct / 10)
--   player_commission   = platform_fee - organizer_commission
--   gross               = base_fee + player_commission  (what the player pays)
--   net                 = gross - platform_fee           (what the organizer nets)
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
  v_platform_fee_cents         integer;
  v_organizer_commission_cents integer;
  v_player_commission_cents    integer;
  v_gross_amount_cents         integer;
  v_net_amount_cents           integer;
BEGIN
  INSERT INTO registrations (user_id, tournament_id, fee_tier, status)
  VALUES (p_user_id, p_tournament_id, p_fee_tier, 'pending_payment')
  RETURNING * INTO v_registration;

  SELECT commission_rate, organizer_commission_pct, organization_id
  INTO v_commission_rate, v_organizer_commission_pct, v_organization_id
  FROM tournaments
  WHERE id = p_tournament_id;

  v_platform_fee_cents         := FLOOR(p_amount_cents::numeric * v_commission_rate / 100)::integer;
  v_organizer_commission_cents := FLOOR(v_platform_fee_cents::numeric * v_organizer_commission_pct / 10)::integer;
  v_player_commission_cents    := v_platform_fee_cents - v_organizer_commission_cents;
  v_gross_amount_cents         := p_amount_cents + v_player_commission_cents;
  v_net_amount_cents           := v_gross_amount_cents - v_platform_fee_cents;

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
    v_gross_amount_cents,
    v_platform_fee_cents,
    v_organizer_commission_cents,
    v_player_commission_cents,
    v_net_amount_cents,
    'MYR',
    'pending'
  );

  RETURN row_to_json(v_registration)::jsonb;
END;
$$;
