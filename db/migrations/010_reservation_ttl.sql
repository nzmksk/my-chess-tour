-- =============================================
-- RESERVATION HOLD WINDOW (H3)
-- A pending_payment registration holds a seat for a limited time. After the
-- window lapses it stops counting toward capacity, so abandoned checkouts free
-- their slot automatically (no scheduler required). Capacity is enforced purely
-- in Postgres so the row-lock guarantee against overbooking is preserved.
-- =============================================

-- Single tunable knob for the hold window.
-- (Inlined as a literal interval below; change here when adjusting.)

-- Shared capacity guard. Locks the tournament row, counts confirmed seats plus
-- pending_payment seats still inside the 10-minute hold window, and raises if at
-- capacity. p_exclude_registration_id lets a resume ignore its own row.
CREATE OR REPLACE FUNCTION assert_tournament_capacity(
  p_tournament_id           uuid,
  p_exclude_registration_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max     integer;
  v_current integer;
BEGIN
  SELECT max_participants INTO v_max
  FROM tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_current
  FROM registrations
  WHERE tournament_id = p_tournament_id
    AND (
      status = 'confirmed'
      OR (
        status = 'pending_payment'
        AND registered_at > now() - interval '10 minutes'
      )
    )
    AND (p_exclude_registration_id IS NULL OR id <> p_exclude_registration_id);

  IF v_current >= v_max THEN
    RAISE EXCEPTION 'Tournament is full (% / % participants)', v_current, v_max
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Capacity trigger now delegates to the shared guard (applies the hold window).
CREATE OR REPLACE FUNCTION check_tournament_capacity()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM assert_tournament_capacity(NEW.tournament_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Resume now re-checks capacity (excluding its own row, since an UPDATE bypasses
-- the INSERT-only trigger) and refreshes the hold by resetting registered_at.
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

  -- Re-check capacity excluding this registration; a lapsed/failed row may have
  -- had its slot taken by someone else in the meantime.
  PERFORM assert_tournament_capacity(v_reg.tournament_id, p_registration_id);

  SELECT commission_rate, organizer_commission_pct
  INTO v_commission_rate, v_organizer_commission_pct
  FROM tournaments
  WHERE id = v_reg.tournament_id;

  SELECT * INTO v_amounts
  FROM compute_registration_amounts(
    p_amount_cents, v_commission_rate, v_organizer_commission_pct
  );

  UPDATE registrations
    SET fee_tier            = p_fee_tier,
        status              = 'pending_payment',
        registered_at       = now(),
        cancelled_at        = NULL,
        cancellation_reason = NULL
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
