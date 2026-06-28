-- =============================================
-- IMMUTABLE PER-ATTEMPT PAYMENTS + SINGLE TIMEOUT
-- payments is a ledger: each checkout attempt is its own immutable row, never
-- mutated/re-priced. A registration points at its active attempt via
-- registrations.current_payment_id. Settlement only terminalizes the
-- registration for its *current* attempt, so a stale/superseded purchase's
-- webhook can no longer flip the live attempt (fixes the resume race).
--
-- Replaces reset_registration_for_payment (in-place mutation) with
-- start_new_payment_attempt (append a new row). Expiry now leaves the payment
-- pending so a late `paid` webhook can still rescue a just-expired registration
-- (single 10-minute timeout: real money wins).
-- =============================================

-- The active payment attempt for a registration.
ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS current_payment_id uuid REFERENCES payments(id) ON DELETE CASCADE;

-- Backfill existing registrations to their latest registration payment.
UPDATE registrations r
  SET current_payment_id = (
    SELECT p.id FROM payments p
    WHERE p.registration_id = r.id AND p.type = 'registration'
    ORDER BY p.created_at DESC
    LIMIT 1
  )
  WHERE r.current_payment_id IS NULL;

-- =============================================
-- CREATE: first attempt. Now also points the registration at its payment and
-- returns the payment id so the caller can initiate CHIP on that exact row.
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
  v_registration             registrations;
  v_commission_rate          smallint;
  v_organizer_commission_pct smallint;
  v_organization_id          uuid;
  v_amounts                  record;
  v_payment_id               uuid;
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
    type, tournament_id, registration_id, user_id, organization_id,
    gross_amount_cents, platform_fee_cents, organizer_commission_cents,
    player_commission_cents, net_amount_cents, currency, status
  ) VALUES (
    'registration', p_tournament_id, v_registration.id, p_user_id, v_organization_id,
    v_amounts.gross_amount_cents, v_amounts.platform_fee_cents,
    v_amounts.organizer_commission_cents, v_amounts.player_commission_cents,
    v_amounts.net_amount_cents, 'MYR', 'pending'
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
-- START A NEW ATTEMPT (replaces reset_registration_for_payment).
-- Supersedes the prior attempt (marks it failed so its webhooks can't settle the
-- registration), appends a fresh pending payment, and re-arms the hold.
-- =============================================
DROP FUNCTION IF EXISTS reset_registration_for_payment(uuid, varchar, integer);

CREATE OR REPLACE FUNCTION start_new_payment_attempt(
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

  -- Re-check capacity excluding this row; a lapsed/failed/expired row may have
  -- lost its slot in the meantime.
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
    player_commission_cents, net_amount_cents, currency, status
  ) VALUES (
    'registration', v_reg.tournament_id, v_reg.id, v_reg.user_id, v_organization_id,
    v_amounts.gross_amount_cents, v_amounts.platform_fee_cents,
    v_amounts.organizer_commission_cents, v_amounts.player_commission_cents,
    v_amounts.net_amount_cents, 'MYR', 'pending'
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

-- =============================================
-- SETTLE: keyed by a specific payment row.
--   paid  → that payment paid; confirm the registration (rescues a just-expired
--           one — real money wins), pointing it at the paid attempt. Amount guard
--           unchanged.
--   !paid → that payment failed; terminalize the registration ONLY if this is its
--           current attempt (a superseded/old attempt's failure is a no-op on the
--           registration).
-- =============================================
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
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment % not found', p_payment_id USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency: only act while this attempt is still pending.
  IF v_payment.status = 'pending' THEN
    IF p_paid
       AND p_amount_cents IS NOT NULL
       AND p_amount_cents <> v_payment.gross_amount_cents THEN
      v_amount_mismatch := true;
    ELSIF p_paid THEN
      UPDATE payments
        SET status = 'paid', paid_at = now()
        WHERE id = p_payment_id;

      UPDATE registrations
        SET status              = 'confirmed',
            confirmed_at        = now(),
            current_payment_id  = p_payment_id,
            cancelled_at        = NULL,
            cancellation_reason = NULL
        WHERE id = v_payment.registration_id
          AND status <> 'confirmed';
    ELSE
      UPDATE payments
        SET status = 'failed'
        WHERE id = p_payment_id;

      UPDATE registrations
        SET status = 'failed_payment'
        WHERE id = v_payment.registration_id
          AND current_payment_id = p_payment_id
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

-- =============================================
-- EXPIRE: terminalize the *registration* only; leave the current payment pending
-- so a late `paid` webhook can still rescue it. Returns the expired registration
-- ids. (Single timeout: callers pass the 10-minute window.)
-- =============================================
DROP FUNCTION IF EXISTS expire_stale_pending_payments(interval, uuid, uuid, uuid);

CREATE FUNCTION expire_stale_pending_payments(
  p_ttl             interval,
  p_tournament_id   uuid DEFAULT NULL,
  p_registration_id uuid DEFAULT NULL,
  p_user_id         uuid DEFAULT NULL
)
RETURNS TABLE (registration_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH stale AS (
    SELECT r.id
    FROM registrations r
    WHERE r.status = 'pending_payment'
      AND r.registered_at < now() - p_ttl
      AND (p_tournament_id   IS NULL OR r.tournament_id = p_tournament_id)
      AND (p_registration_id IS NULL OR r.id            = p_registration_id)
      AND (p_user_id         IS NULL OR r.user_id       = p_user_id)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE registrations r
    SET status              = 'cancelled_payment',
        cancelled_at        = now(),
        cancellation_reason = 'payment_expired'
    FROM stale
    WHERE r.id = stale.id
    RETURNING r.id;
END;
$$;
