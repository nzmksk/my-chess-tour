-- =============================================
-- SETTLE PAYMENT: AMOUNT GUARD PURCHASE
-- Hardens the CHIP payment flow against stale-purchase settlement:
--   1. settle_registration_payment gains p_amount_cents. When provided, a
--      'paid' outcome is only honored if the amount CHIP actually charged
--      matches the recorded gross_amount_cents. A mismatch (e.g. an abandoned,
--      re-priced purchase being paid) is left pending and reported back so the
--      webhook can log it for manual review instead of silently confirming.
-- =============================================

-- The arity changes (added p_amount_cents), so drop the old 2-arg version to
-- avoid an ambiguous overload for PostgREST.
DROP FUNCTION IF EXISTS settle_registration_payment(uuid, boolean);

CREATE OR REPLACE FUNCTION settle_registration_payment(
  p_payment_id   uuid,
  p_paid         boolean,
  p_amount_cents integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment         payments;
  v_amount_mismatch boolean := false;
BEGIN
  -- Lock the payment row so concurrent deliveries serialize.
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment % not found', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency guard: only act while still pending.
  IF v_payment.status = 'pending' THEN
    IF p_paid
       AND p_amount_cents IS NOT NULL
       AND p_amount_cents <> v_payment.gross_amount_cents THEN
      -- Amount paid doesn't match what we recorded (likely a stale/re-priced
      -- purchase). Don't confirm; leave pending for manual reconciliation.
      v_amount_mismatch := true;
    ELSIF p_paid THEN
      UPDATE payments
        SET status = 'paid', paid_at = now()
        WHERE id = p_payment_id;

      UPDATE registrations
        SET status = 'confirmed', confirmed_at = now()
        WHERE id = v_payment.registration_id
          AND status = 'pending_payment';
    ELSE
      UPDATE payments
        SET status = 'failed'
        WHERE id = p_payment_id;

      UPDATE registrations
        SET status = 'failed_payment'
        WHERE id = v_payment.registration_id
          AND status = 'pending_payment';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'payment_id', p_payment_id,
    'registration_id', v_payment.registration_id,
    'already_processed', v_payment.status <> 'pending',
    'amount_mismatch', v_amount_mismatch
  );
END;
$$;
