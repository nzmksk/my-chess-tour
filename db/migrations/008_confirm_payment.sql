-- =============================================
-- SETTLE REGISTRATION PAYMENT
-- Called by the CHIP webhook handler (service_role) to finalize a payment.
-- Atomically + idempotently transitions a pending payment and its registration:
--   p_paid = true  -> payment 'paid'   + registration 'confirmed'
--   p_paid = false -> payment 'failed' + registration 'failed_payment'
-- Repeated deliveries (CHIP retries) are no-ops once the payment leaves 'pending'.
-- =============================================
CREATE OR REPLACE FUNCTION settle_registration_payment(
  p_payment_id uuid,
  p_paid       boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment payments;
BEGIN
  -- Lock the payment row so concurrent deliveries serialize.
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment % not found', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency guard: only act while still pending.
  IF v_payment.status = 'pending' THEN
    IF p_paid THEN
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
    'already_processed', v_payment.status <> 'pending'
  );
END;
$$;
