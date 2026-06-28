-- =============================================
-- EXPIRE STALE PENDING PAYMENTS (app-owned, time-based)
-- CHIP emits no expiry webhook (see wiki/chip-webhook.md), so an abandoned
-- checkout never reaches a terminal state on its own. This function terminalizes
-- pending_payment registrations whose payment window has lapsed: the
-- registration becomes cancelled_payment (cancellation_reason 'payment_expired')
-- and its registration payment becomes failed (the payment enum has no
-- cancelled value; failed is the terminal).
--
-- Expiry is triggered lazily on read, scoped to one registration, one
-- tournament, or one user, so list/manage loaders only ever sweep what they
-- display. Called with no scoping args it sweeps everything, so the same
-- function doubles as a future pg_cron backstop with no changes.
--
-- Returns the affected rows so the caller can best-effort cancel the CHIP
-- purchase. The purchase `due` (see PAYMENT_DUE_MINUTES) already makes the link
-- unpayable, so cancellation is belt-and-suspenders.
-- =============================================

CREATE OR REPLACE FUNCTION expire_stale_pending_payments(
  p_ttl             interval,
  p_tournament_id   uuid DEFAULT NULL,
  p_registration_id uuid DEFAULT NULL,
  p_user_id         uuid DEFAULT NULL
)
RETURNS TABLE (registration_id uuid, chip_transaction_id varchar)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH stale AS (
    -- Lock only the rows we'll terminalize; SKIP LOCKED lets concurrent callers
    -- (another read path, a future cron) run without blocking each other.
    SELECT r.id
    FROM registrations r
    WHERE r.status = 'pending_payment'
      AND r.registered_at < now() - p_ttl
      AND (p_tournament_id   IS NULL OR r.tournament_id = p_tournament_id)
      AND (p_registration_id IS NULL OR r.id            = p_registration_id)
      AND (p_user_id         IS NULL OR r.user_id       = p_user_id)
    FOR UPDATE SKIP LOCKED
  ),
  expired_regs AS (
    UPDATE registrations r
      SET status              = 'cancelled_payment',
          cancelled_at        = now(),
          cancellation_reason = 'payment_expired'
      FROM stale
      WHERE r.id = stale.id
      RETURNING r.id
  ),
  expired_payments AS (
    UPDATE payments p
      SET status = 'failed'
      FROM expired_regs
      WHERE p.registration_id = expired_regs.id
        AND p.type   = 'registration'
        AND p.status = 'pending'
      RETURNING p.registration_id, p.chip_transaction_id
  )
  SELECT er.id, ep.chip_transaction_id
  FROM expired_regs er
  LEFT JOIN expired_payments ep ON ep.registration_id = er.id;
END;
$$;
