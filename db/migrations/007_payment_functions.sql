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

-- =============================================
-- SETTLE BANK ACCOUNT VERIFICATION
-- Records CHIP Send's verdict on a registered payout recipient (#519). Called by
-- two paths that must agree, both classifying through chipBankAccountOutcome:
--   * registerOrganizationBankAccount, when POST /send/bank_accounts already
--     answers `verified` synchronously;
--   * the CHIP Send webhook, on a bank-account status event.
-- Either may arrive first, or both, or the webhook twice. So:
--   * the row is locked FOR UPDATE, serializing the two paths;
--   * a row that is no longer 'pending' is terminal and the call is a no-op
--     ({"already_processed": true}) — a verdict is never overwritten. A changed
--     account gets a NEW row (set_organization_bank_account supersedes), so
--     there is never a legitimate reason to flip verified ↔ rejected in place.
--
--   p_verified = true  → status 'verified', verified_at stamped, reason cleared.
--   p_verified = false → status 'rejected' with p_reason (or a generic reason;
--                        the organizer is shown it, so it must not be blank).
-- p_chip_bank_account_id is recorded when given and never cleared by a NULL.
--
-- Superseded rows (is_active = false) are still settled — the verdict is history
-- worth keeping — but `is_active` is returned so the caller can skip telling the
-- organizer about an account they have already replaced.
-- =============================================
CREATE OR REPLACE FUNCTION settle_bank_account_verification(
  p_bank_account_id      uuid,
  p_chip_bank_account_id bigint,
  p_verified             boolean,
  p_reason               text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row organization_bank_accounts;
BEGIN
  SELECT * INTO v_row
    FROM organization_bank_accounts
    WHERE id = p_bank_account_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank account % not found', p_bank_account_id USING ERRCODE = 'P0002';
  END IF;

  IF v_row.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'bank_account_id',   v_row.id,
      'organization_id',   v_row.organization_id,
      'already_processed', true,
      'verified',          v_row.status = 'verified',
      'is_active',         v_row.is_active
    );
  END IF;

  IF p_verified THEN
    UPDATE organization_bank_accounts
      SET status               = 'verified',
          verified_at          = now(),
          rejection_reason     = NULL,
          chip_bank_account_id = COALESCE(p_chip_bank_account_id, chip_bank_account_id)
      WHERE id = p_bank_account_id;
  ELSE
    UPDATE organization_bank_accounts
      SET status               = 'rejected',
          verified_at          = NULL,
          rejection_reason     = COALESCE(NULLIF(btrim(p_reason), ''),
                                          'The bank could not verify these account details.'),
          chip_bank_account_id = COALESCE(p_chip_bank_account_id, chip_bank_account_id)
      WHERE id = p_bank_account_id;
  END IF;

  RETURN jsonb_build_object(
    'bank_account_id',   v_row.id,
    'organization_id',   v_row.organization_id,
    'already_processed', false,
    'verified',          p_verified,
    'is_active',         v_row.is_active
  );
END;
$$;

-- =============================================
-- AVAILABLE PAYOUT
-- The single source of truth for how much may leave for a tournament right now,
-- used by every call site (queue, execute, dashboards):
--
--   net_payout_cents - payouts still in flight
--
-- net_payout_cents already nets fees, refunds and PAID payouts, but the view only
-- knows the ledger, so it cannot see a payout that has been queued or sent and not
-- yet settled. Subtracting those here closes that double-spend window.
-- p_exclude_payout_id lets a payout ask "how much is available to ME".
--
-- No prize term: prizes are never funded from this money.
-- =============================================
CREATE OR REPLACE FUNCTION available_payout_cents(
  p_tournament_id     uuid,
  p_exclude_payout_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    0,
    COALESCE((
      SELECT SUM(s.net_payout_cents)
      FROM tournament_payout_summary s
      WHERE s.tournament_id = p_tournament_id
    ), 0)
    - COALESCE((
      SELECT SUM(p.amount_cents)
      FROM payouts p
      WHERE p.tournament_id = p_tournament_id
        AND p.approval <> 'rejected'
        AND p.status IN ('pending', 'processing')
        AND p.id IS DISTINCT FROM p_exclude_payout_id
    ), 0)
  )::integer;
$$;

-- =============================================
-- TOURNAMENT PAYOUT BLOCK
-- Why no money may leave for this tournament right now, or NULL if it may:
-- cancelled, a cancellation under review, or a player refund still unsettled.
-- Cancellation refunds every player their full gross, so paying the organizer
-- while one is possible risks money the platform then can't fund.
--
-- Checked when a payout is queued and again just before it is sent, because a
-- payout can wait days for budget.
-- =============================================
CREATE OR REPLACE FUNCTION tournament_payout_block_reason(p_tournament_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM tournaments t WHERE t.id = p_tournament_id)
      THEN 'tournament_not_found'
    WHEN EXISTS (SELECT 1 FROM tournaments t WHERE t.id = p_tournament_id AND t.status = 'cancelled')
      THEN 'tournament_cancelled'
    WHEN EXISTS (
      SELECT 1 FROM tournament_cancellation_requests c
      WHERE c.tournament_id = p_tournament_id AND c.status = 'pending'
    )
      THEN 'cancellation_pending'
    WHEN EXISTS (
      SELECT 1 FROM refunds rf
      JOIN registrations r ON r.id = rf.registration_id
      WHERE r.tournament_id = p_tournament_id
        AND rf.status <> 'rejected'
        AND rf.processed_at IS NULL
    )
      THEN 'refund_pending'
  END;
$$;

-- =============================================
-- QUEUE PAYOUT
-- Creates the row that reserves the money; executePayout (src/services/payouts/
-- execute.ts) sends it, because a network call can't run in this transaction.
--
-- Takes a tournament-row lock so concurrent callers serialize, resolves the
-- recipient (the ACCEPTED beneficiary, else the organizing org), refuses anything
-- blocked or ineligible, and refuses an amount above what is available. A NULL
-- p_amount_cents means all of it. Returns the new id, or NULL when a live automatic
-- payout already exists, so a re-run of the sweep is a no-op rather than an error.
--
-- Automatic only. An early payout needs a reason, a request_seq and a review, all
-- of which belong to request_early_payout.
--
-- Failures RAISE P0001 with a stable sentinel prefix for the route to map.
-- =============================================
CREATE OR REPLACE FUNCTION queue_payout(
  p_tournament_id uuid,
  p_kind          payout_kind,
  p_amount_cents  integer,
  p_requested_by  uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Mirrors MIN_PAYOUT_CENTS in src/services/payouts/constants.ts, so the database
  -- enforces it even if a route is bypassed. Below this, CHIP fees exceed the transfer.
  c_min_payout_cents CONSTANT integer := 1000;
  v_tournament tournaments;
  v_blocked    text;
  v_recipient  uuid;
  v_problem    text;
  v_bank_id    uuid;
  v_available  integer;
  v_amount     integer;
  v_id         uuid;
BEGIN
  IF p_kind <> 'automatic' THEN
    RAISE EXCEPTION 'PAYOUT_KIND_UNSUPPORTED: only automatic payouts are queued here'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % not found', p_tournament_id USING ERRCODE = 'P0002';
  END IF;

  v_blocked := tournament_payout_block_reason(p_tournament_id);
  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION 'PAYOUT_BLOCKED: %', v_blocked USING ERRCODE = 'P0001';
  END IF;

  IF v_tournament.organization_id IS NULL THEN
    RAISE EXCEPTION 'PAYOUT_BLOCKED: tournament has no organizing organization'
      USING ERRCODE = 'P0001';
  END IF;

  -- Checked before the amount: with a live payout in flight nothing is available,
  -- and "already queued" is the true answer, not "below the minimum".
  IF EXISTS (
    SELECT 1 FROM payouts p
    WHERE p.tournament_id = p_tournament_id
      AND p.kind = 'automatic'
      AND p.status <> 'failed'
  ) THEN
    RETURN NULL;
  END IF;

  -- An unaccepted nomination redirects nothing.
  v_recipient := CASE
    WHEN v_tournament.beneficiary_accepted_at IS NOT NULL
      THEN v_tournament.beneficiary_organization_id
    ELSE v_tournament.organization_id
  END;

  -- The amount is the admin's input, so it is checked before the recipient: a
  -- typo'd amount should be reported as that, not as some other problem. An
  -- omitted amount means everything available; an explicit one above that is a
  -- mistake, and is refused rather than quietly reduced.
  v_available := available_payout_cents(p_tournament_id);

  IF p_amount_cents > v_available THEN
    RAISE EXCEPTION 'PAYOUT_EXCEEDS_AVAILABLE: % cents requested, % cents is available',
      p_amount_cents, v_available
      USING ERRCODE = 'P0001';
  END IF;

  v_amount := COALESCE(p_amount_cents, v_available);

  IF v_amount < c_min_payout_cents THEN
    RAISE EXCEPTION 'PAYOUT_BELOW_MINIMUM: % cents is payable, the minimum is %',
      v_amount, c_min_payout_cents
      USING ERRCODE = 'P0001';
  END IF;

  v_problem := payout_recipient_problem(v_recipient);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'PAYOUT_RECIPIENT_INELIGIBLE: %', v_problem USING ERRCODE = 'P0001';
  END IF;

  SELECT b.id INTO v_bank_id
    FROM organization_bank_accounts b
    WHERE b.organization_id = v_recipient AND b.is_active AND b.status = 'verified';

  INSERT INTO payouts (
    tournament_id, organization_id, recipient_organization_id, bank_account_id,
    kind, amount_cents, approval, requested_by
  ) VALUES (
    p_tournament_id, v_tournament.organization_id, v_recipient, v_bank_id,
    'automatic', v_amount, 'approved', p_requested_by
  )
  ON CONFLICT (tournament_id) WHERE (kind = 'automatic' AND status <> 'failed') DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- This row is the retry of any earlier failed attempt.
  UPDATE payouts
    SET superseded_by = v_id
    WHERE tournament_id = p_tournament_id
      AND kind = 'automatic'
      AND status = 'failed'
      AND superseded_by IS NULL;

  RETURN v_id;
END;
$$;

-- =============================================
-- EARLY PAYOUT CAP
-- How much may be paid early for a tournament right now, with the arithmetic laid
-- out so the admin review page can show why the ceiling is what it is:
--
--   ceiling = FLOOR(net_revenue * EARLY_PAYOUT_MAX_PCT / 100)
--   cap     = LEAST(available, ceiling - early payouts already committed)
--
-- "Committed" is every early payout awaiting review, in flight or paid (its settled
-- amount once paid). Rejected and failed ones moved no money. p_exclude_payout_id
-- is the request under review, which must not count against itself.
-- =============================================
CREATE OR REPLACE FUNCTION early_payout_cap(
  p_tournament_id     uuid,
  p_exclude_payout_id uuid DEFAULT NULL
)
RETURNS TABLE (
  net_revenue_cents     bigint,
  paid_payouts_cents    bigint,
  live_refund_cents     bigint,
  max_pct               integer,
  ceiling_cents         bigint,
  early_committed_cents bigint,
  available_cents       integer,
  cap_cents             integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH figures AS (
    SELECT
      COALESCE((
        SELECT SUM(s.net_revenue_cents) FROM tournament_payout_summary s
        WHERE s.tournament_id = p_tournament_id
      ), 0)::bigint AS net_revenue,
      COALESCE((
        SELECT SUM(s.total_payouts_cents) FROM tournament_payout_summary s
        WHERE s.tournament_id = p_tournament_id
      ), 0)::bigint AS paid_payouts,
      -- Refunds not yet settled. Any of these blocks an early payout outright, but
      -- the reviewer should see how much is at stake.
      COALESCE((
        SELECT SUM(rf.refund_amount_cents) FROM refunds rf
        JOIN registrations r ON r.id = rf.registration_id
        WHERE r.tournament_id = p_tournament_id
          AND rf.status <> 'rejected'
          AND rf.processed_at IS NULL
      ), 0)::bigint AS live_refunds,
      -- Mirrors EARLY_PAYOUT_MAX_PCT in src/services/payouts/constants.ts.
      50 AS pct,
      COALESCE((
        SELECT SUM(CASE WHEN p.status = 'paid'
                        THEN COALESCE(p.settled_amount_cents, p.amount_cents)
                        ELSE p.amount_cents END)
        FROM payouts p
        WHERE p.tournament_id = p_tournament_id
          AND p.kind = 'early'
          AND p.approval <> 'rejected'
          AND p.status <> 'failed'
          AND p.id IS DISTINCT FROM p_exclude_payout_id
      ), 0)::bigint AS committed,
      available_payout_cents(p_tournament_id, p_exclude_payout_id) AS available
  )
  SELECT
    f.net_revenue,
    f.paid_payouts,
    f.live_refunds,
    f.pct,
    GREATEST(0, FLOOR(f.net_revenue * f.pct / 100.0))::bigint,
    f.committed,
    f.available,
    GREATEST(0, LEAST(f.available::bigint, FLOOR(f.net_revenue * f.pct / 100.0)::bigint - f.committed))::integer
  FROM figures f;
$$;

-- =============================================
-- EARLY PAYOUT PROBLEM
-- Why an early payout cannot be requested (or approved) for this tournament right
-- now, or NULL if it can. One definition shared by request_early_payout,
-- review_payout_request and the organizer's payout overview, so the dashboard
-- explains a refusal before the organizer hits it. In order:
--
--   tournament_not_found, tournament_cancelled, tournament_not_published
--   registration_open        registration_closed_at unset or still in the future
--   beneficiary_set          third-party payouts are final-only: the organizing org
--                            would owe the claw-back on money that went elsewhere
--   cancellation_pending, refund_pending      (tournament_payout_block_reason)
--   organization_not_approved, entity_type_missing, agreement_not_current,
--   bank_account_not_verified                 (payout_recipient_problem)
--   early_payout_limit_reached   both request_seq slots are held
--   early_payout_in_flight       another early request is awaiting review or in flight
--   nothing_payable_early        the cap is below MIN_PAYOUT_CENTS
--
-- p_exclude_payout_id is the request under review: its own slot, reservation and
-- liveness must not count against it.
-- =============================================
CREATE OR REPLACE FUNCTION early_payout_problem(
  p_tournament_id     uuid,
  p_exclude_payout_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Mirrors MIN_PAYOUT_CENTS in src/services/payouts/constants.ts.
  c_min_payout_cents CONSTANT integer := 1000;
  v_tournament tournaments;
  v_problem    text;
BEGIN
  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN 'tournament_not_found';
  END IF;
  IF v_tournament.status = 'cancelled' THEN
    RETURN 'tournament_cancelled';
  END IF;
  IF v_tournament.status <> 'published' THEN
    RETURN 'tournament_not_published';
  END IF;
  IF v_tournament.registration_closed_at IS NULL OR v_tournament.registration_closed_at > now() THEN
    RETURN 'registration_open';
  END IF;
  IF v_tournament.beneficiary_organization_id IS NOT NULL THEN
    RETURN 'beneficiary_set';
  END IF;

  v_problem := tournament_payout_block_reason(p_tournament_id);
  IF v_problem IS NOT NULL THEN
    RETURN v_problem;
  END IF;

  v_problem := payout_recipient_problem(v_tournament.organization_id);
  IF v_problem IS NOT NULL THEN
    RETURN v_problem;
  END IF;

  IF (
    SELECT count(DISTINCT p.request_seq)
    FROM payouts p
    WHERE p.tournament_id = p_tournament_id
      AND p.kind = 'early'
      AND p.approval <> 'rejected'
      AND p.status <> 'failed'
      AND p.id IS DISTINCT FROM p_exclude_payout_id
  ) >= 2 THEN
    RETURN 'early_payout_limit_reached';
  END IF;

  IF EXISTS (
    SELECT 1 FROM payouts p
    WHERE p.tournament_id = p_tournament_id
      AND p.kind = 'early'
      AND p.approval <> 'rejected'
      AND p.status IN ('pending', 'processing')
      AND p.id IS DISTINCT FROM p_exclude_payout_id
  ) THEN
    RETURN 'early_payout_in_flight';
  END IF;

  IF (SELECT c.cap_cents FROM early_payout_cap(p_tournament_id, p_exclude_payout_id) c) < c_min_payout_cents THEN
    RETURN 'nothing_payable_early';
  END IF;

  RETURN NULL;
END;
$$;

-- =============================================
-- REQUEST EARLY PAYOUT
-- An organizer asks for part of a tournament's net revenue before the automatic
-- payout, up to EARLY_PAYOUT_MAX_PCT of it, at most twice. The row is created
-- `pending` review and reserves its amount at once (available_payout_cents counts
-- pending rows), so nothing else can promise the same money while it waits.
--
-- Takes the tournament-row lock first, the assert_tournament_capacity idiom, so
-- concurrent requests serialize and the slot count below can't race. Checks the
-- actor's payout.request itself as a backstop to the route.
--
-- request_seq is the lowest free slot. Rejected and failed requests hold none
-- (see uniq_early_payout_seq_per_tournament), so a typo'd amount the admin turns
-- down, or a transfer the bank bounces, doesn't cost the organizer a request. A
-- failed request taking the same seq is linked to this one via superseded_by.
--
-- Failures RAISE P0001 with a stable sentinel prefix for the route to map:
--   EARLY_PAYOUT_NOT_ALLOWED: <early_payout_problem code>
--   EARLY_PAYOUT_EXCEEDS_CAP: <n> cents requested, <m> cents can be paid early
--   PAYOUT_BELOW_MINIMUM:     <n> cents requested, the minimum is <m>
--   EARLY_PAYOUT_INVALID:     a missing reason or a non-positive amount
-- =============================================
CREATE OR REPLACE FUNCTION request_early_payout(
  p_tournament_id uuid,
  p_user_id       uuid,
  p_amount_cents  integer,
  p_reason        text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Mirrors MIN_PAYOUT_CENTS in src/services/payouts/constants.ts.
  c_min_payout_cents CONSTANT integer := 1000;
  v_tournament tournaments;
  v_problem    text;
  v_cap        integer;
  v_seq        smallint;
  v_bank_id    uuid;
  v_id         uuid;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'EARLY_PAYOUT_INVALID: the amount must be a positive number of cents'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'EARLY_PAYOUT_INVALID: a reason is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % not found', p_tournament_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT has_org_permission(p_user_id, v_tournament.organization_id, 'payout.request') THEN
    RAISE EXCEPTION 'PAYOUT_FORBIDDEN: payout.request is required on the organizing organization'
      USING ERRCODE = '42501';
  END IF;

  v_problem := early_payout_problem(p_tournament_id);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'EARLY_PAYOUT_NOT_ALLOWED: %', v_problem USING ERRCODE = 'P0001';
  END IF;

  SELECT c.cap_cents INTO v_cap FROM early_payout_cap(p_tournament_id) c;

  IF p_amount_cents > v_cap THEN
    RAISE EXCEPTION 'EARLY_PAYOUT_EXCEEDS_CAP: % cents requested, % cents can be paid early',
      p_amount_cents, v_cap
      USING ERRCODE = 'P0001';
  END IF;
  IF p_amount_cents < c_min_payout_cents THEN
    RAISE EXCEPTION 'PAYOUT_BELOW_MINIMUM: % cents requested, the minimum is %',
      p_amount_cents, c_min_payout_cents
      USING ERRCODE = 'P0001';
  END IF;

  -- early_payout_problem has already refused when both slots are held.
  SELECT s INTO v_seq
    FROM generate_series(1, 2) s
    WHERE NOT EXISTS (
      SELECT 1 FROM payouts p
      WHERE p.tournament_id = p_tournament_id
        AND p.kind = 'early'
        AND p.approval <> 'rejected'
        AND p.status <> 'failed'
        AND p.request_seq = s
    )
    ORDER BY s
    LIMIT 1;

  SELECT b.id INTO v_bank_id
    FROM organization_bank_accounts b
    WHERE b.organization_id = v_tournament.organization_id AND b.is_active AND b.status = 'verified';

  INSERT INTO payouts (
    tournament_id, organization_id, recipient_organization_id, bank_account_id,
    kind, request_seq, amount_cents, approval, reason, requested_by
  ) VALUES (
    p_tournament_id, v_tournament.organization_id, v_tournament.organization_id, v_bank_id,
    'early', v_seq, p_amount_cents, 'pending', btrim(p_reason), p_user_id
  )
  RETURNING id INTO v_id;

  -- This request is the retry of a failed one in the same slot, if there is one.
  UPDATE payouts
    SET superseded_by = v_id
    WHERE tournament_id = p_tournament_id
      AND kind = 'early'
      AND request_seq = v_seq
      AND status = 'failed'
      AND superseded_by IS NULL;

  RETURN v_id;
END;
$$;

-- =============================================
-- REVIEW PAYOUT REQUEST
-- A platform admin approves or rejects an early payout request. Modelled on
-- review_tournament_cancellation: the row is locked, a missing one is P0002 and
-- one already reviewed is P0001 (PAYOUT_ALREADY_REVIEWED).
--
-- Approve re-runs every check request_early_payout made, because days may have
-- passed: a cancellation may now be pending, refunds may have landed, the
-- organizer may have lapsed on the agreement, availability may have collapsed.
-- The request's own reservation and slot are excluded so it isn't counted against
-- itself. A refusal raises the same sentinels as request_early_payout and leaves
-- the request pending, so the admin can reject it with a reason instead.
--
-- Approve does NOT move money. A network call can't run in this transaction (the
-- same constraint as review_tournament_cancellation), so it only sets
-- approval='approved', leaving status 'pending', and the route fires
-- executePayout afterwards, best-effort. The bank account is re-snapshotted here:
-- if the organizer replaced theirs while the request waited, the new verified one
-- is where they want the money, and the old one would only fail at send time.
--
-- Reject unlinks any failed request this one had superseded, so that row reads as
-- un-retried again; the slot itself was never held (see
-- uniq_early_payout_seq_per_tournament).
--
-- Locks the tournament before the payout, the same order as request_early_payout,
-- so the two can't deadlock.
-- =============================================
CREATE OR REPLACE FUNCTION review_payout_request(
  p_payout_id        uuid,
  p_reviewer_id      uuid,
  p_action           text,
  p_rejection_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament_id uuid;
  v_payout        payouts;
  v_problem       text;
  v_cap           integer;
  v_bank_id       uuid;
  v_new_approval  approval_status;
  v_reviewed_at   timestamptz := now();
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'action must be approve or reject, got %', p_action USING ERRCODE = '22023';
  END IF;
  IF p_action = 'reject' AND (p_rejection_reason IS NULL OR btrim(p_rejection_reason) = '') THEN
    RAISE EXCEPTION 'a rejection reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT tournament_id INTO v_tournament_id FROM payouts WHERE id = p_payout_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1 FROM tournaments WHERE id = v_tournament_id FOR UPDATE;
  SELECT * INTO v_payout FROM payouts WHERE id = p_payout_id FOR UPDATE;

  -- Automatic payouts are created approved, so they land here too.
  IF v_payout.approval <> 'pending' THEN
    RAISE EXCEPTION 'PAYOUT_ALREADY_REVIEWED: payout % already reviewed', p_payout_id
      USING ERRCODE = 'P0001';
  END IF;

  IF p_action = 'approve' THEN
    v_problem := early_payout_problem(v_payout.tournament_id, p_payout_id);
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION 'EARLY_PAYOUT_NOT_ALLOWED: %', v_problem USING ERRCODE = 'P0001';
    END IF;

    SELECT c.cap_cents INTO v_cap FROM early_payout_cap(v_payout.tournament_id, p_payout_id) c;
    IF v_payout.amount_cents > v_cap THEN
      RAISE EXCEPTION 'EARLY_PAYOUT_EXCEEDS_CAP: % cents requested, % cents can be paid early',
        v_payout.amount_cents, v_cap
        USING ERRCODE = 'P0001';
    END IF;

    -- early_payout_problem guarantees there is one.
    SELECT b.id INTO v_bank_id
      FROM organization_bank_accounts b
      WHERE b.organization_id = v_payout.recipient_organization_id AND b.is_active AND b.status = 'verified';

    v_new_approval := 'approved';
    UPDATE payouts
      SET approval        = v_new_approval,
          reviewed_by     = p_reviewer_id,
          reviewed_at     = v_reviewed_at,
          bank_account_id = v_bank_id
      WHERE id = p_payout_id;
  ELSE
    v_new_approval := 'rejected';
    UPDATE payouts
      SET approval         = v_new_approval,
          reviewed_by      = p_reviewer_id,
          reviewed_at      = v_reviewed_at,
          rejection_reason = btrim(p_rejection_reason)
      WHERE id = p_payout_id;

    UPDATE payouts SET superseded_by = NULL WHERE superseded_by = p_payout_id;
  END IF;

  RETURN jsonb_build_object(
    'id',              v_payout.id,
    'tournament_id',   v_payout.tournament_id,
    'organization_id', v_payout.organization_id,
    'amount_cents',    v_payout.amount_cents,
    'approval',        v_new_approval,
    'reviewed_at',     v_reviewed_at
  );
END;
$$;

-- =============================================
-- SETTLE PAYOUT (idempotent, keyed by a specific payout row)
-- The settle_refund twin, called by both the sync response and the webhook:
--   paid  → the money left: book one type='organizer_payout' ledger row, which is
--           what drains net_payout_cents, then stamp the payout paid/processed.
--   !paid → record why, status 'failed', processed. No ledger row.
--   already processed → no-op, reported back.
--
-- ⚠️ DELIBERATE DIVERGENCE from settle_refund, which leaves a failed refund
-- `pending` for a retry on the same row. A failed payout is TERMINAL and a retry is
-- a NEW row, linked via superseded_by. CHIP Send dedupes on `reference` (our row
-- id), so re-sending the same row after a hard failure would return the FAILED
-- instruction forever. Do not "fix" this to match refunds.
--
-- The ledger row always carries the ORGANIZING org, even when a beneficiary was
-- paid: tournament_payout_summary groups on it, so anything else would leave the
-- organizer's balance undrained.
--
-- The 'send_' prefix on chip_transaction_id is load-bearing.
-- idx_payments_chip_transaction is unique across ALL payment types, and a Send
-- instruction id is a small integer sharing that namespace with Collect purchase
-- uuids. The prefix makes a collision structurally impossible.
--
-- "Real money wins", as in settle_registration_payment: if more was settled than
-- was available (a refund landed while the transfer was in flight), the row is
-- booked anyway and over_payout comes back true for loud logging. The money has
-- physically left, and refusing to record it would make the ledger lie.
-- paid_after_failed is the same alarm for a row we had already written off.
-- =============================================
CREATE OR REPLACE FUNCTION settle_payout(
  p_payout_id                uuid,
  p_chip_send_instruction_id bigint,
  p_paid                     boolean,
  p_amount_cents             integer DEFAULT NULL,
  p_receipt_url              text DEFAULT NULL,
  p_failure_reason           text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout      payouts;
  v_instruction bigint;
  v_settled     integer;
  v_payment_id  uuid;
  v_over_payout boolean := false;
BEGIN
  SELECT * INTO v_payout FROM payouts WHERE id = p_payout_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  IF v_payout.processed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'payout_id',         v_payout.id,
      'tournament_id',     v_payout.tournament_id,
      'already_processed', true,
      'settled',           true,
      'paid',              v_payout.status = 'paid',
      'paid_after_failed', p_paid AND v_payout.status = 'failed'
    );
  END IF;

  v_instruction := COALESCE(p_chip_send_instruction_id, v_payout.chip_send_instruction_id);

  IF p_paid THEN
    IF v_instruction IS NULL THEN
      RAISE EXCEPTION 'payout % settled as paid with no send instruction id', p_payout_id
        USING ERRCODE = 'P0001';
    END IF;

    v_settled := COALESCE(p_amount_cents, v_payout.amount_cents);
    IF v_settled <= 0 THEN
      RAISE EXCEPTION 'payout % settled with a non-positive amount (%)', p_payout_id, v_settled
        USING ERRCODE = 'P0001';
    END IF;

    v_over_payout := v_settled > available_payout_cents(v_payout.tournament_id, p_payout_id);

    INSERT INTO payments (
      type, tournament_id, user_id, organization_id,
      gross_amount_cents, platform_fee_cents, organizer_commission_cents,
      player_commission_cents, net_amount_cents, currency,
      payment_method, chip_transaction_id, status, paid_at
    ) VALUES (
      'organizer_payout', v_payout.tournament_id, NULL, v_payout.organization_id,
      v_settled, 0, 0,
      0, v_settled, 'MYR',
      'chip_send', 'send_' || v_instruction, 'paid', now()
    )
    RETURNING id INTO v_payment_id;

    UPDATE payouts
      SET status                   = 'paid',
          payment_id               = v_payment_id,
          settled_amount_cents     = v_settled,
          chip_send_instruction_id = v_instruction,
          chip_receipt_url         = COALESCE(p_receipt_url, chip_receipt_url),
          failure_reason           = NULL,
          processed_at             = now()
      WHERE id = p_payout_id;
  ELSE
    UPDATE payouts
      SET status                   = 'failed',
          chip_send_instruction_id = v_instruction,
          failure_reason           = COALESCE(NULLIF(btrim(p_failure_reason), ''), 'send_instruction_failed'),
          processed_at             = now()
      WHERE id = p_payout_id;
  END IF;

  RETURN jsonb_build_object(
    'payout_id',         v_payout.id,
    'tournament_id',     v_payout.tournament_id,
    'already_processed', false,
    'settled',           true,
    'paid',              p_paid,
    'amount_cents',      v_settled,
    'over_payout',       v_over_payout
  );
END;
$$;

-- =============================================
-- PAYOUT READ HELPERS
-- Encapsulate the joins for the payout pages, the way
-- list_pending_cancellation_refunds does for the refund job, and answer "how much
-- is available" through available_payout_cents rather than re-deriving it.
-- =============================================

-- Per-tournament payout position for one organization: the tournaments it
-- organized, plus those whose payout it has accepted as beneficiary. Drafts have no
-- money to show. recipient_problem is surfaced so that a recipient which has lapsed
-- (agreement bumped, bank account replaced) shows up on both dashboards instead of
-- failing silently in the sweep.
CREATE OR REPLACE FUNCTION list_organization_payout_overview(p_org_id uuid)
RETURNS TABLE (
  tournament_id              uuid,
  tournament_name            varchar(255),
  tournament_status          tournament_status,
  organizing_organization_id uuid,
  organizing_organization    varchar(255),
  recipient_organization_id  uuid,
  recipient_organization     varchar(255),
  is_beneficiary             boolean,
  net_revenue_cents          bigint,
  paid_payouts_cents         bigint,
  available_cents            integer,
  early_requests_used        integer,
  recipient_problem          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH visible AS (
    SELECT t.*,
           CASE WHEN t.beneficiary_accepted_at IS NOT NULL
                THEN t.beneficiary_organization_id
                ELSE t.organization_id
           END AS recipient_id
    FROM tournaments t
    WHERE t.status <> 'draft'
      AND (
        t.organization_id = p_org_id
        OR (t.beneficiary_organization_id = p_org_id AND t.beneficiary_accepted_at IS NOT NULL)
      )
  )
  SELECT
    v.id,
    v.name,
    v.status,
    v.organization_id,
    organizer.name,
    v.recipient_id,
    recipient.name,
    v.organization_id IS DISTINCT FROM p_org_id,
    COALESCE(s.net_revenue_cents, 0),
    COALESCE(s.total_payouts_cents, 0),
    available_payout_cents(v.id),
    -- The slots uniq_early_payout_seq_per_tournament holds: rejected and failed
    -- requests moved no money, so they don't count.
    (
      SELECT count(DISTINCT p.request_seq)::integer
      FROM payouts p
      WHERE p.tournament_id = v.id AND p.kind = 'early'
        AND p.approval <> 'rejected' AND p.status <> 'failed'
    ),
    payout_recipient_problem(v.recipient_id)
  FROM visible v
  LEFT JOIN organizations organizer ON organizer.id = v.organization_id
  LEFT JOIN organizations recipient ON recipient.id = v.recipient_id
  LEFT JOIN tournament_payout_summary s
    ON s.tournament_id = v.id AND s.organization_id = v.organization_id
  ORDER BY v.start_date DESC;
$$;

-- Nominations this organization can still accept. Once a player has paid the
-- nomination is frozen, and it can never be accepted, so it isn't offered.
CREATE OR REPLACE FUNCTION list_pending_payout_nominations(p_org_id uuid)
RETURNS TABLE (
  tournament_id           uuid,
  tournament_name         varchar(255),
  start_date              date,
  organizing_organization varchar(255)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.name, t.start_date, o.name
  FROM tournaments t
  LEFT JOIN organizations o ON o.id = t.organization_id
  WHERE t.beneficiary_organization_id = p_org_id
    AND t.beneficiary_accepted_at IS NULL
    AND t.status <> 'cancelled'
    AND NOT EXISTS (
      SELECT 1 FROM payments p
      WHERE p.tournament_id = t.id AND p.type = 'registration' AND p.status = 'paid'
    )
  ORDER BY t.start_date;
$$;

-- What a platform admin could pay out by hand right now: published tournaments with
-- at least the minimum available and no live automatic payout. Anything in the way
-- is returned rather than filtered out, so the admin can see why it can't be paid.
CREATE OR REPLACE FUNCTION list_admin_payout_candidates()
RETURNS TABLE (
  tournament_id             uuid,
  tournament_name           varchar(255),
  end_date                  date,
  organizing_organization   varchar(255),
  recipient_organization_id uuid,
  recipient_organization    varchar(255),
  is_beneficiary            boolean,
  available_cents           integer,
  block_reason              text,
  recipient_problem         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT t.*,
           available_payout_cents(t.id) AS available,
           CASE WHEN t.beneficiary_accepted_at IS NOT NULL
                THEN t.beneficiary_organization_id
                ELSE t.organization_id
           END AS recipient_id
    FROM tournaments t
    WHERE t.status = 'published'
      AND NOT EXISTS (
        SELECT 1 FROM payouts p
        WHERE p.tournament_id = t.id AND p.kind = 'automatic' AND p.status <> 'failed'
      )
  )
  SELECT
    c.id,
    c.name,
    c.end_date,
    organizer.name,
    c.recipient_id,
    recipient.name,
    c.recipient_id IS DISTINCT FROM c.organization_id,
    c.available,
    tournament_payout_block_reason(c.id),
    payout_recipient_problem(c.recipient_id)
  FROM candidates c
  LEFT JOIN organizations organizer ON organizer.id = c.organization_id
  LEFT JOIN organizations recipient ON recipient.id = c.recipient_id
  WHERE c.available >= 1000  -- MIN_PAYOUT_CENTS, as in queue_payout
  ORDER BY c.end_date;
$$;

-- =============================================
-- EXECUTE PRIVILEGES — SERVER-ONLY FUNCTIONS
-- Same reasoning as the block at the end of 003_functions_triggers.sql: these
-- SECURITY DEFINER functions trust their arguments, and the checkout route,
-- CHIP webhook and expiry/refund jobs call them through the service role. Left
-- executable by clients, anyone could settle their own registration as paid,
-- settle refunds, list pending refunds across every organization, mark their own
-- payout bank account verified, or book and queue payouts. The read-only payout
-- functions are revoked too: they reveal any organization's balance.
--
-- compute_registration_amounts is not SECURITY DEFINER (pure arithmetic) and is
-- left as is.
-- =============================================
REVOKE EXECUTE ON FUNCTION create_registration_with_payment  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION start_new_payment_attempt         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION settle_registration_payment       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION expire_stale_pending_payments     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_pending_cancellation_refunds FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION settle_refund                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION settle_bank_account_verification  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION available_payout_cents            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION tournament_payout_block_reason    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION queue_payout                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION early_payout_cap                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION early_payout_problem              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION request_early_payout              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION review_payout_request             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION settle_payout                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_organization_payout_overview FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_pending_payout_nominations   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_admin_payout_candidates      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION create_registration_with_payment  TO service_role;
GRANT EXECUTE ON FUNCTION start_new_payment_attempt         TO service_role;
GRANT EXECUTE ON FUNCTION settle_registration_payment       TO service_role;
GRANT EXECUTE ON FUNCTION expire_stale_pending_payments     TO service_role;
GRANT EXECUTE ON FUNCTION list_pending_cancellation_refunds TO service_role;
GRANT EXECUTE ON FUNCTION settle_refund                     TO service_role;
GRANT EXECUTE ON FUNCTION settle_bank_account_verification  TO service_role;
GRANT EXECUTE ON FUNCTION available_payout_cents            TO service_role;
GRANT EXECUTE ON FUNCTION tournament_payout_block_reason    TO service_role;
GRANT EXECUTE ON FUNCTION queue_payout                      TO service_role;
GRANT EXECUTE ON FUNCTION early_payout_cap                  TO service_role;
GRANT EXECUTE ON FUNCTION early_payout_problem              TO service_role;
GRANT EXECUTE ON FUNCTION request_early_payout              TO service_role;
GRANT EXECUTE ON FUNCTION review_payout_request             TO service_role;
GRANT EXECUTE ON FUNCTION settle_payout                     TO service_role;
GRANT EXECUTE ON FUNCTION list_organization_payout_overview TO service_role;
GRANT EXECUTE ON FUNCTION list_pending_payout_nominations   TO service_role;
GRANT EXECUTE ON FUNCTION list_admin_payout_candidates      TO service_role;
