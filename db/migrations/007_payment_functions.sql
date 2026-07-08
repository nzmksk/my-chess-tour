-- =============================================
-- REGISTRATION + PAYMENT MONEY FUNCTIONS
-- payments is an append-only ledger: each checkout attempt is its own immutable
-- row, never mutated/re-priced. registrations.current_payment_id (001) points at
-- the active attempt. Settlement only terminalizes the registration for its
-- *current* attempt, so a stale/superseded purchase's webhook can't flip the live
-- attempt. A single payment-timeout window (10 min) governs the CHIP `due`, the
-- seat hold (assert_tournament_capacity), resume "is-live", and expiry; a late
-- `paid` webhook can still rescue a just-expired registration.
-- =============================================

-- =============================================
-- SHARED COMMISSION MATH
-- Single source of truth for what a player is charged. Used by both
-- create_registration_with_payment and start_new_payment_attempt.
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
-- CREATE: first attempt. Atomically inserts the registration + its first payment
-- row, points the registration at it, and returns {registration_id, payment_id}
-- so the caller can initiate CHIP on that exact row. Capacity is enforced by the
-- check_tournament_capacity INSERT trigger (003).
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
-- payment, re-arms the hold, and points current_payment_id at the new row.
-- =============================================
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
-- SETTLE: keyed by a specific payment row (idempotent).
--   paid  → that payment paid; confirm the registration, pointing it at the paid
--           attempt. "Real money wins": a `paid` outcome is honored over ANY
--           non-`paid` state — a row already marked `failed` by supersession (a
--           newer attempt) or by an earlier decline the payer then retried on the
--           SAME purchase — so a genuine late `paid` can't be silently dropped.
--           Idempotent: a row already `paid` is untouched. Only honored if
--           p_amount_cents matches the recorded gross (guards a stale/re-priced
--           purchase); a mismatch is left as-is and reported back. The CHIP-
--           reported instrument (p_payment_method) is back-filled here — it isn't
--           known at insert time, only once the payer picks one at checkout.
--   !paid → that payment failed; only terminalizes a still-`pending` row (never
--           overrides a `paid` one), and flips the registration ONLY if this is
--           its current attempt (a superseded/old attempt's failure is a no-op on
--           the registration).
-- =============================================

CREATE OR REPLACE FUNCTION settle_registration_payment(
  p_payment_id     uuid,
  p_paid           boolean,
  p_amount_cents   integer DEFAULT NULL,
  p_payment_method varchar(50) DEFAULT NULL
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

  IF p_paid THEN
    -- A `paid` outcome wins over any non-`paid` state (pending, or a row already
    -- `failed` by supersession / a retried decline) — real money wins. A row
    -- already `paid` is left untouched (idempotent). The amount guard blocks a
    -- stale/re-priced purchase from confirming at the wrong price.
    IF v_payment.status <> 'paid' THEN
      IF p_amount_cents IS NOT NULL
         AND p_amount_cents <> v_payment.gross_amount_cents THEN
        v_amount_mismatch := true;
      ELSE
        -- COALESCE keeps any already-recorded method if a later settling call
        -- omits it (this UPDATE only runs on the first `paid` transition, so the
        -- method is written once by whichever path — webhook or reconciliation —
        -- settles first).
        UPDATE payments
          SET status = 'paid',
              paid_at = now(),
              payment_method = COALESCE(p_payment_method, payment_method)
          WHERE id = p_payment_id;

        UPDATE registrations
          SET status              = 'confirmed',
              confirmed_at        = now(),
              current_payment_id  = p_payment_id,
              cancelled_at        = NULL,
              cancellation_reason = NULL
          WHERE id = v_payment.registration_id
            AND status <> 'confirmed';
      END IF;
    END IF;
  ELSE
    -- Failure only terminalizes a still-`pending` row (never overrides a `paid`
    -- one) and only flips the registration when this is its current attempt.
    IF v_payment.status = 'pending' THEN
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
    'already_processed', v_payment.status = 'paid',
    'amount_mismatch', v_amount_mismatch
  );
END;
$$;

-- =============================================
-- EXPIRE STALE PENDING PAYMENTS (app-owned, time-based)
-- CHIP emits no expiry webhook (see wiki/chip-webhook.md), so an abandoned
-- checkout never terminalizes on its own. Flips pending_payment registrations
-- older than the TTL to cancelled_payment, scoped to one registration, one
-- tournament, or one user (so read paths only sweep what they display); unscoped
-- it doubles as a future pg_cron backstop. Leaves the payment row pending so a
-- late `paid` webhook can still rescue the registration. FOR UPDATE SKIP LOCKED
-- so concurrent callers don't block. Returns the expired registration ids.
-- =============================================
CREATE OR REPLACE FUNCTION expire_stale_pending_payments(
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

-- =============================================
-- LIST PENDING CANCELLATION REFUNDS
-- Read helper for the refund-orchestration loop (initiateCancellationRefunds).
-- Returns the not-yet-processed refunds for a tournament together with the CHIP
-- purchase id of the original (paid) registration payment — the id the CHIP
-- refund is issued against (POST /purchases/{original_chip_purchase_id}/refund/).
-- A refund whose registration payment somehow lacks a chip id is still returned
-- (original_chip_purchase_id NULL) so the caller can log it rather than silently
-- skip. Encapsulates the refunds → registrations → paid-payment join.
-- =============================================
CREATE OR REPLACE FUNCTION list_pending_cancellation_refunds(
  p_tournament_id uuid
)
RETURNS TABLE (
  refund_id                 uuid,
  registration_id           uuid,
  amount_cents              integer,
  original_chip_purchase_id varchar(255)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rf.id, rf.registration_id, rf.refund_amount_cents, p.chip_transaction_id
  FROM refunds rf
  JOIN registrations r ON r.id = rf.registration_id
  JOIN payments p ON p.id = r.current_payment_id
   AND p.type = 'registration'
   AND p.status = 'paid'
  WHERE r.tournament_id = p_tournament_id
    AND rf.status <> 'rejected'
    AND rf.processed_at IS NULL;
$$;

-- =============================================
-- SETTLE REFUND (idempotent, keyed by a specific refund row)
--   paid  → the CHIP refund cleared: append a type='refund' payment ledger row
--           mirroring the original registration payment's positive magnitudes
--           (so tournament_payout_summary reverses that registration's revenue),
--           and stamp the refund approved/processed with the CHIP refund id.
--           Idempotent: a refund already processed (processed_at set) is a no-op.
--           The unique idx_payments_chip_transaction + uniq_paid_refund_per_
--           registration indexes are the last line of defence if the sync
--           response and the webhook settle the same refund concurrently.
--   !paid → the CHIP refund failed: record the CHIP refund id (if any) but leave
--           the refund pending and unprocessed so ops can retry; no ledger row.
-- The refund id is used as the correlation handle; p_chip_refund_id is the CHIP
-- refund Payment id (distinct from the original purchase id).
-- =============================================
CREATE OR REPLACE FUNCTION settle_refund(
  p_refund_id      uuid,
  p_chip_refund_id varchar(255),
  p_paid           boolean,
  p_payment_method varchar(50) DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund   refunds;
  v_src      payments;
  v_settled  boolean := false;
BEGIN
  SELECT * INTO v_refund FROM refunds WHERE id = p_refund_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund % not found', p_refund_id USING ERRCODE = 'P0002';
  END IF;

  -- Already processed → idempotent no-op (a late/duplicate webhook or a
  -- sync+webhook race). Report back without touching the ledger.
  IF v_refund.processed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'refund_id', v_refund.id,
      'registration_id', v_refund.registration_id,
      'already_processed', true,
      'settled', true
    );
  END IF;

  IF p_paid THEN
    -- Source the original paid registration payment to mirror its amounts. If it
    -- can't be found the money model is inconsistent — fail loudly rather than
    -- book a malformed refund row.
    SELECT p.* INTO v_src
    FROM registrations r
    JOIN payments p ON p.id = r.current_payment_id
    WHERE r.id = v_refund.registration_id
      AND p.type = 'registration'
      AND p.status = 'paid';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'no paid registration payment for refund %', p_refund_id USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO payments (
      type, tournament_id, registration_id, user_id, organization_id,
      gross_amount_cents, platform_fee_cents, organizer_commission_cents,
      player_commission_cents, net_amount_cents, currency,
      payment_method, chip_transaction_id, status, paid_at
    ) VALUES (
      'refund', v_src.tournament_id, v_src.registration_id, v_src.user_id, v_src.organization_id,
      v_src.gross_amount_cents, v_src.platform_fee_cents, v_src.organizer_commission_cents,
      v_src.player_commission_cents, v_src.net_amount_cents, v_src.currency,
      p_payment_method, p_chip_refund_id, 'paid', now()
    );

    UPDATE refunds
      SET status         = 'approved',
          chip_refund_id = p_chip_refund_id,
          reviewed_at    = COALESCE(reviewed_at, now()),
          processed_at   = now()
      WHERE id = p_refund_id;

    v_settled := true;
  ELSE
    -- Failure: record the CHIP refund id for traceability but leave the refund
    -- pending/unprocessed so a retry can re-fire it.
    UPDATE refunds
      SET chip_refund_id = COALESCE(p_chip_refund_id, chip_refund_id)
      WHERE id = p_refund_id;
  END IF;

  RETURN jsonb_build_object(
    'refund_id', v_refund.id,
    'registration_id', v_refund.registration_id,
    'already_processed', false,
    'settled', v_settled
  );
END;
$$;
