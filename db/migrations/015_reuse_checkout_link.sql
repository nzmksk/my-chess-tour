-- =============================================
-- REUSE CHECKOUT LINK ON RESUME
-- A live pending_payment is resumed by handing the user back the *same* CHIP
-- checkout link (no timer reset, no new purchase), so we persist the link on the
-- payment row. Two supporting changes here:
--   1. payments.checkout_url stores the CHIP checkout URL for reuse.
--   2. reset_registration_for_payment (the "fresh start" path) now also accepts
--      a cancelled_payment registration — the expiry feature terminalizes lapsed
--      checkouts to cancelled_payment, and without this the checkout route would
--      409 on them — and clears checkout_url alongside chip_transaction_id.
-- =============================================

ALTER TABLE payments ADD COLUMN IF NOT EXISTS checkout_url text;

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

  -- pending_payment (lapsed) and failed_payment retry, plus cancelled_payment
  -- (an expired checkout) re-registering with a — possibly different — tier.
  IF v_reg.status NOT IN ('pending_payment', 'failed_payment', 'cancelled_payment') THEN
    RAISE EXCEPTION 'registration % is not resumable (status %)', p_registration_id, v_reg.status
      USING ERRCODE = 'P0001';
  END IF;

  -- Re-check capacity excluding this registration; a lapsed/failed/expired row
  -- may have had its slot taken by someone else in the meantime.
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
        checkout_url               = NULL,
        paid_at                    = NULL
    WHERE registration_id = p_registration_id
      AND type = 'registration';

  RETURN jsonb_build_object('registration_id', p_registration_id);
END;
$$;
