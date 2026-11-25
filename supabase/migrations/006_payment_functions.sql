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
-- CHECKOUT GUARDS (#705)
-- self_managed_minor (#711): true when the user's account is 'self' and their
-- date of birth makes them under 18 today in Malaysia (Asia/Kuala_Lumpur).
-- "Under 18" is date_of_birth > today - 18 years, so someone born on 29
-- February is 18 on 1 March in a common year, matching isUnderAdultAge in
-- src/lib/auth/adult-age.ts. No date of birth means no refusal. Managed
-- accounts (dependents) are exempt: a guardian registers them.
--
-- Signup refuses under-18s (#710), PATCH /api/v1/profile won't save an
-- under-18 date of birth on a self-managed account, and checkout refuses an
-- under-18 self-managed participant (checkParticipantAge in
-- registrations/validators.ts). This is the database backstop, for a date of
-- birth written some other way: support or a script.
-- =============================================
CREATE FUNCTION self_managed_minor(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN player_profiles p ON p.user_id = u.id
    WHERE u.id = p_user_id
      AND u.account_type = 'self'
      AND p.date_of_birth >
          ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date
  );
$$;

-- =============================================
-- ASSERT PARTICIPANT NOT SELF MANAGED MINOR
-- =============================================
-- Raises UNDER_18 (P0001), which the checkout route maps to the same 422 as its
-- own check. Both checkout functions call it for the participant
-- (registrations.user_id), whoever pays. Confirmed registrations and
-- settlement aren't touched.
CREATE FUNCTION assert_participant_not_self_managed_minor(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF self_managed_minor(p_user_id) THEN
    RAISE EXCEPTION 'UNDER_18: a self-managed account holder under 18 can''t register; under-18s take part through a parent or guardian''s account'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- =============================================
-- ASSERT PAYER ACTS FOR
-- =============================================
-- Passes when payer and participant are the same person (#714). Otherwise it
-- needs an active guardianship from the payer to the participant (NOT_GUARDIAN,
-- 42501) whose minor-basis authority hasn't aged out (AGED_OUT, 42501, #721),
-- and takes a FOR SHARE lock on that row until the transaction ends.
-- revoke_dependent locks the same row FOR UPDATE before it looks for a pending
-- payment, so the two serialise: a revoke that commits first makes this raise,
-- and a checkout that commits first makes the revoke refuse with
-- DEPENDENT_HAS_PENDING_PAYMENT. The checkout functions run as the service
-- role, where app_user_id() is NULL, so this is the backstop for the route's
-- can_act_for() check.
CREATE OR REPLACE FUNCTION assert_payer_acts_for(
  p_payer_user_id       uuid,
  p_participant_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_basis guardianship_basis;
BEGIN
  IF p_payer_user_id = p_participant_user_id THEN
    RETURN;
  END IF;

  SELECT basis INTO v_basis
  FROM guardianships
  WHERE guardian_user_id = p_payer_user_id
    AND dependent_user_id = p_participant_user_id
    AND status = 'active'
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_GUARDIAN: the payer can''t register this participant'
      USING ERRCODE = '42501';
  END IF;

  IF minor_guardianship_aged_out(
       v_basis,
       (SELECT date_of_birth FROM player_profiles WHERE user_id = p_participant_user_id)
     ) THEN
    RAISE EXCEPTION 'AGED_OUT: the participant has turned 18, so their guardian can no longer register them'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- =============================================
-- CREATE: first attempt. Atomically inserts the registration + its first payment
-- row, points the registration at it, and returns {registration_id, payment_id}
-- so the caller can initiate CHIP on that exact row. Capacity is enforced by the
-- check_tournament_capacity INSERT trigger (003).
-- The payer is kept apart from the participant (#708): registrations.user_id is
-- who plays, payments.user_id whose money it is (p_payer_user_id; NULL means
-- the participant pays). Mixing them up would send a refund to the wrong
-- person, or hand a guardian's payment history to the dependent on a claim.
-- Both are checked first: assert_payer_acts_for and
-- assert_participant_not_self_managed_minor. registered_by is set to the payer
-- when the payer isn't the participant.
-- =============================================
CREATE OR REPLACE FUNCTION create_registration_with_payment(
  p_user_id        uuid,
  p_tournament_id  uuid,
  p_fee_tier       varchar(50),
  p_amount_cents   integer,
  p_payer_user_id  uuid DEFAULT NULL
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
  v_payer_user_id            uuid := COALESCE(p_payer_user_id, p_user_id);
BEGIN
  -- A platform-distributed prize pool must be fully funded before anyone can
  -- enter (#523). The checkout route checks first; this is the backstop.
  -- Checked under the tournament row lock (the capacity trigger takes the same
  -- lock again on insert), so a prize edit either commits first and is seen
  -- here, or waits and sees this hold (guard_tournament_prizes_in_checkout).
  PERFORM 1 FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF prize_pool_blocks_registration(p_tournament_id) THEN
    RAISE EXCEPTION 'PRIZE_POOL_NOT_FUNDED: registration opens once the prize pool is funded'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM assert_participant_not_self_managed_minor(p_user_id);
  PERFORM assert_payer_acts_for(v_payer_user_id, p_user_id);

  INSERT INTO registrations (user_id, tournament_id, fee_tier, status, registered_by)
  VALUES (p_user_id, p_tournament_id, p_fee_tier, 'pending_payment',
          NULLIF(v_payer_user_id, p_user_id))
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
    fee_tier,
    currency,
    status
  ) VALUES (
    'registration',
    p_tournament_id,
    v_registration.id,
    v_payer_user_id,
    v_organization_id,
    v_amounts.gross_amount_cents,
    v_amounts.platform_fee_cents,
    v_amounts.organizer_commission_cents,
    v_amounts.player_commission_cents,
    v_amounts.net_amount_cents,
    p_fee_tier,
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
-- The payer is whoever retries, checked as on create, and registered_by is
-- rewritten on every attempt: a retry by the player clears it and a retry by a
-- guardian records them.
-- =============================================
CREATE OR REPLACE FUNCTION start_new_payment_attempt(
  p_registration_id uuid,
  p_fee_tier        varchar(50),
  p_amount_cents    integer,
  p_payer_user_id   uuid DEFAULT NULL
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
  v_payer_user_id            uuid;
BEGIN
  SELECT * INTO v_reg FROM registrations WHERE id = p_registration_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'registration % not found', p_registration_id USING ERRCODE = 'P0002';
  END IF;

  IF v_reg.status NOT IN ('pending_payment', 'failed_payment', 'cancelled_payment') THEN
    RAISE EXCEPTION 'registration % is not resumable (status %)', p_registration_id, v_reg.status
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM assert_participant_not_self_managed_minor(v_reg.user_id);

  v_payer_user_id := COALESCE(p_payer_user_id, v_reg.user_id);
  PERFORM assert_payer_acts_for(v_payer_user_id, v_reg.user_id);

  -- Under the tournament row lock, for the same reason as the first attempt.
  -- assert_tournament_capacity below takes it again.
  PERFORM 1 FROM tournaments WHERE id = v_reg.tournament_id FOR UPDATE;
  IF prize_pool_blocks_registration(v_reg.tournament_id) THEN
    RAISE EXCEPTION 'PRIZE_POOL_NOT_FUNDED: registration opens once the prize pool is funded'
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
    player_commission_cents, net_amount_cents, fee_tier, currency, status
  ) VALUES (
    'registration', v_reg.tournament_id, v_reg.id, v_payer_user_id, v_organization_id,
    v_amounts.gross_amount_cents, v_amounts.platform_fee_cents,
    v_amounts.organizer_commission_cents, v_amounts.player_commission_cents,
    v_amounts.net_amount_cents, p_fee_tier, 'MYR', 'pending'
  )
  RETURNING id INTO v_payment_id;

  -- registered_by follows whoever started this attempt, not only the first
  -- one. It is a stopgap: payments.user_id already records the payer of each
  -- attempt, and if checkout ever covers several participants in one payment,
  -- a per-attempt payer record should replace this column.
  UPDATE registrations
    SET registered_by       = NULLIF(v_payer_user_id, v_reg.user_id),
        fee_tier            = p_fee_tier,
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
  v_newly_confirmed boolean := false;
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
        -- Only the call that actually confirms the registration reports it, so
        -- the confirmation email goes out once however many paths settle (webhook,
        -- success-page reconcile, a second paid attempt on the same registration).
        v_newly_confirmed := FOUND;
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
    'amount_mismatch', v_amount_mismatch,
    'newly_confirmed', v_newly_confirmed
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
-- LIST UNFIRED CANCELLATION REFUNDS (#496)
-- The work list for the refund sweep (POST /api/v1/cron/refunds), which sends
-- cancellation refunds to CHIP off the admin's request. Returns refunds, across
-- every cancelled tournament, that are still owed and that nobody has fired yet
-- (last_fired_at NULL). Oldest request first, at most p_limit rows, so each run
-- takes a bounded chunk and the next run carries on.
--
-- Excludes:
--   * refunds queued less than p_min_age ago. The approval emails players that
--     the tournament is off after its response; this gap keeps a sweep that
--     happens to run right then from settling a refund (and emailing "refund
--     completed") ahead of that notice.
--   * refunds whose registration payment has no CHIP purchase. claim_refund_fire
--     refuses those ('no_purchase') without stamping them, so listing them would
--     have every run retry them. They show on the stuck list instead.
--   * refunds on tournaments that aren't cancelled: cancellation refunds are the
--     only ones the sweep may send. A future player-requested refund (#509)
--     that sits 'pending' awaiting review must not be fired by it.
-- Once fired, a refund leaves this list for good; if it doesn't settle, it is
-- the admin re-fire's (list_stuck_refunds / claim_refund_fire) to deal with.
-- =============================================
CREATE OR REPLACE FUNCTION list_unfired_cancellation_refunds(
  p_min_age interval,
  p_limit   integer
)
RETURNS TABLE (
  refund_id     uuid,
  tournament_id uuid,
  requested_at  timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rf.id, t.id, rf.requested_at
  FROM refunds rf
  JOIN registrations r ON r.id = rf.registration_id
  JOIN tournaments t   ON t.id = r.tournament_id
  JOIN payments p      ON p.id = r.current_payment_id
   AND p.type = 'registration'
   AND p.status = 'paid'
   AND p.chip_transaction_id IS NOT NULL
  WHERE t.status = 'cancelled'
    AND rf.status = 'pending'
    AND rf.processed_at IS NULL
    AND rf.chip_refund_id IS NULL
    AND rf.last_fired_at IS NULL
    AND rf.requested_at <= now() - p_min_age
  ORDER BY rf.requested_at, rf.id
  LIMIT p_limit;
$$;

-- =============================================
-- REFUND FIRE DUE (#497)
-- Whether a pending refund may be sent to CHIP again. `pending` is overloaded: a
-- refund that was fired a moment ago and is waiting on its payment.refunded
-- webhook looks exactly like one that is stuck. So a refund is due only when:
--   * it was never fired (the refund sweep hasn't reached it), or
--   * it was fired at least p_min_age ago and nothing has settled it since.
-- A reported failure does NOT shorten the wait. purchase.refund_failure is
-- correlated by the original purchase only, so a late failure from an earlier
-- fire is indistinguishable from one for the latest fire; letting it make the
-- refund due would let a second claim through while the latest fire is still
-- reconciling or POSTing to CHIP. The age rule alone is what the in-flight
-- guard rests on.
-- Shared by claim_refund_fire and list_stuck_refunds so the button and the list
-- can't disagree. Not SECURITY DEFINER: it reads nothing.
-- =============================================
CREATE OR REPLACE FUNCTION refund_fire_due(
  p_last_fired_at timestamptz,
  p_min_age       interval
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_last_fired_at IS NULL
      OR p_last_fired_at <= now() - p_min_age;
$$;

-- =============================================
-- CLAIM REFUND FIRE (#497)
-- Called immediately before the app asks CHIP to refund (POST /purchases/{id}/
-- refund/), by both the refund sweep and the ops re-fire. Locks the refund,
-- re-checks it, and stamps last_fired_at in one step, so two admins pressing
-- "Retry" together (or a retry racing the refund sweep) can't both reach CHIP.
--
-- Refuses, without stamping, a refund that:
--   * has processed_at or chip_refund_id set, or is 'approved' → 'settled'.
--     Re-POSTing /refund/ against a purchase whose money already went back
--     returns 400 purchase_refund_error; settle_refund is idempotent but CHIP
--     is not ours to re-call.
--   * is 'rejected' → 'rejected'.
--   * isn't due (refund_fire_due) → 'in_flight'.
--   * has no paid registration payment with a CHIP purchase id → 'no_purchase'.
--     Nothing to refund against; left unstamped so it stays on the stuck list
--     for someone to resolve by hand.
--   * doesn't exist → 'not_found'.
--
-- Returns {"claimed": true, "original_chip_purchase_id": ...} once claimed, or
-- {"claimed": false, "reason": <one of the above>}.
-- =============================================
CREATE OR REPLACE FUNCTION claim_refund_fire(
  p_refund_id uuid,
  p_min_age   interval
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund      refunds;
  v_purchase_id varchar(255);
BEGIN
  SELECT * INTO v_refund FROM refunds WHERE id = p_refund_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'not_found');
  END IF;

  IF v_refund.processed_at IS NOT NULL
     OR v_refund.chip_refund_id IS NOT NULL
     OR v_refund.status = 'approved' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'settled');
  END IF;

  IF v_refund.status = 'rejected' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'rejected');
  END IF;

  IF NOT refund_fire_due(v_refund.last_fired_at, p_min_age) THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'in_flight');
  END IF;

  SELECT p.chip_transaction_id INTO v_purchase_id
  FROM registrations r
  JOIN payments p ON p.id = r.current_payment_id
   AND p.type = 'registration'
   AND p.status = 'paid'
  WHERE r.id = v_refund.registration_id;

  IF v_purchase_id IS NULL THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'no_purchase');
  END IF;

  UPDATE refunds SET last_fired_at = now() WHERE id = p_refund_id;

  RETURN jsonb_build_object(
    'claimed', true,
    'original_chip_purchase_id', v_purchase_id
  );
END;
$$;

-- =============================================
-- LIST STUCK REFUNDS (#497)
-- Every refund, across all tournaments, that is still owed and is due a re-fire
-- (refund_fire_due): never fired, fired p_min_age ago with no answer, or failed
-- since it was fired. What the admin "Stuck refunds" page lists and the admin
-- dashboard counts. Oldest request first.
--
-- A never-fired refund counts only once it was queued p_min_age ago. The refund
-- sweep (#496), not the approval, sends a new cancellation's refunds, so every
-- refund starts out unfired; listing them straight away would raise the
-- dashboard's stuck banner on every approval. One still unfired after
-- p_min_age is one the sweep didn't get to, and that is worth a look. The list
-- stays a subset of what claim_refund_fire accepts, so a Retry on it still works.
--
-- original_chip_purchase_id is NULL when the registration payment has no CHIP
-- purchase: claim_refund_fire refuses those ('no_purchase'), so the page shows
-- them as needing a hand rather than offering a retry.
-- =============================================
CREATE FUNCTION list_stuck_refunds(p_min_age interval)
RETURNS TABLE (
  refund_id                 uuid,
  registration_id           uuid,
  tournament_id             uuid,
  tournament_name           varchar(255),
  payer_name                text,
  payer_email               varchar(255),
  amount_cents              integer,
  requested_at              timestamptz,
  last_fired_at             timestamptz,
  failed_at                 timestamptz,
  original_chip_purchase_id varchar(255)
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT rf.id, rf.registration_id, t.id, t.name,
         NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''),
         u.email,
         rf.refund_amount_cents, rf.requested_at, rf.last_fired_at, rf.failed_at,
         p.chip_transaction_id
  FROM refunds rf
  JOIN registrations r ON r.id = rf.registration_id
  JOIN tournaments t   ON t.id = r.tournament_id
  LEFT JOIN payments p ON p.id = r.current_payment_id
   AND p.type = 'registration'
   AND p.status = 'paid'
  LEFT JOIN payments cp ON cp.id = r.current_payment_id
  LEFT JOIN users u     ON u.id = cp.user_id
  WHERE rf.status = 'pending'
    AND rf.processed_at IS NULL
    AND rf.chip_refund_id IS NULL
    AND refund_fire_due(rf.last_fired_at, p_min_age)
    AND (rf.last_fired_at IS NOT NULL OR rf.requested_at <= now() - p_min_age)
  ORDER BY rf.requested_at, rf.id;
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
--           failed_at is stamped the first time only.
-- The refund id is used as the correlation handle; p_chip_refund_id is the CHIP
-- refund Payment id (distinct from the original purchase id).
--
-- The result says whether THIS call did the work, so the caller can send the
-- refund outcome email exactly once (#512). A refund can be settled twice (the
-- sync response and the webhook for the same refund) and CHIP may redeliver a
-- failure, and every one of those calls returns without error:
--   newly_settled → this call booked the refund. Exactly one call ever does.
--   newly_failed  → this call recorded the refund's FIRST failure. A redelivered
--                   or repeated failure reports false, so the player hears about
--                   a failure once, and about the money landing once.
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
      'settled', true,
      'newly_settled', false,
      'newly_failed', false
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
      SET chip_refund_id = COALESCE(p_chip_refund_id, chip_refund_id),
          failed_at      = COALESCE(failed_at, now())
      WHERE id = p_refund_id;
  END IF;

  RETURN jsonb_build_object(
    'refund_id', v_refund.id,
    'registration_id', v_refund.registration_id,
    'already_processed', false,
    'settled', v_settled,
    'newly_settled', v_settled,
    'newly_failed', NOT p_paid AND v_refund.failed_at IS NULL
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
--   p_verified = true  → status 'verified', verified_at stamped, reason cleared,
--                        or 'name_mismatch' when p_name_matched is false
--                        (#374): the bank's holder name (recorded in
--                        bank_holder_name) isn't who the money is for, so an
--                        admin reviews it (review_bank_account_name).
--   p_verified = false → status 'rejected' with p_reason (or a generic reason;
--                        the organizer is shown it, so it must not be blank).
-- p_chip_bank_account_id is recorded when given and never cleared by a NULL.
--
-- Superseded rows (is_active = false) are still settled — the verdict is history
-- worth keeping — but `is_active` is returned so the caller can skip telling the
-- organizer about an account they have already replaced.
--
-- Player prize accounts (player_bank_accounts, #523) go through the same CHIP
-- registration and settle here too. The id is looked up in the organization
-- table first and the player table second; the ids are uuids, so one can't be
-- in both. `owner` says which it was: 'organization' (organization_id set) or
-- 'player' (user_id set).
-- =============================================
CREATE FUNCTION settle_bank_account_verification(
  p_bank_account_id      uuid,
  p_chip_bank_account_id bigint,
  p_verified             boolean,
  p_reason               text    DEFAULT NULL,
  p_bank_holder_name     text    DEFAULT NULL,
  p_name_matched         boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_default_reason CONSTANT text := 'The bank could not verify these account details.';
  v_owner       text;
  v_org_id      uuid;
  v_user_id     uuid;
  v_status      bank_account_status;
  v_is_active   boolean;
  v_bank_name   varchar(255);
  v_reviewed_at timestamptz;
  v_new_name    varchar(255) := left(NULLIF(btrim(p_bank_holder_name), ''), 255);
  v_reason      text := COALESCE(NULLIF(btrim(p_reason), ''), c_default_reason);
  v_new_status  bank_account_status;
BEGIN
  SELECT 'organization', organization_id, NULL::uuid, status, is_active,
         bank_holder_name, name_reviewed_at
    INTO v_owner, v_org_id, v_user_id, v_status, v_is_active, v_bank_name, v_reviewed_at
    FROM organization_bank_accounts
    WHERE id = p_bank_account_id
    FOR UPDATE;

  IF NOT FOUND THEN
    SELECT 'player', NULL::uuid, user_id, status, is_active,
           bank_holder_name, name_reviewed_at
      INTO v_owner, v_org_id, v_user_id, v_status, v_is_active, v_bank_name, v_reviewed_at
      FROM player_bank_accounts
      WHERE id = p_bank_account_id
      FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank account % not found', p_bank_account_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_status = 'pending'
    OR (v_status = 'name_mismatch' AND v_bank_name IS NULL AND v_reviewed_at IS NULL
        AND p_verified AND v_new_name IS NOT NULL)
  ) THEN
    -- The verdict stands, but a holder name it was settled without is still
    -- worth keeping.
    IF v_bank_name IS NULL AND v_new_name IS NOT NULL THEN
      IF v_owner = 'organization' THEN
        UPDATE organization_bank_accounts SET bank_holder_name = v_new_name WHERE id = p_bank_account_id;
      ELSE
        UPDATE player_bank_accounts SET bank_holder_name = v_new_name WHERE id = p_bank_account_id;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'bank_account_id',   p_bank_account_id,
      'owner',             v_owner,
      'organization_id',   v_org_id,
      'user_id',           v_user_id,
      'already_processed', true,
      'verified',          v_status = 'verified',
      'status',            v_status,
      'is_active',         v_is_active
    );
  END IF;

  v_new_status := CASE
    WHEN NOT p_verified THEN 'rejected'
    WHEN p_name_matched THEN 'verified'
    ELSE 'name_mismatch'
  END::bank_account_status;

  IF v_owner = 'organization' THEN
    UPDATE organization_bank_accounts
      SET status               = v_new_status,
          verified_at          = CASE WHEN v_new_status = 'verified' THEN now() END,
          rejection_reason     = CASE WHEN v_new_status = 'rejected' THEN v_reason END,
          bank_holder_name     = COALESCE(v_new_name, bank_holder_name),
          chip_bank_account_id = COALESCE(p_chip_bank_account_id, chip_bank_account_id)
      WHERE id = p_bank_account_id;
  ELSE
    UPDATE player_bank_accounts
      SET status               = v_new_status,
          verified_at          = CASE WHEN v_new_status = 'verified' THEN now() END,
          rejection_reason     = CASE WHEN v_new_status = 'rejected' THEN v_reason END,
          bank_holder_name     = COALESCE(v_new_name, bank_holder_name),
          chip_bank_account_id = COALESCE(p_chip_bank_account_id, chip_bank_account_id)
      WHERE id = p_bank_account_id;
  END IF;

  RETURN jsonb_build_object(
    'bank_account_id',   p_bank_account_id,
    'owner',             v_owner,
    'organization_id',   v_org_id,
    'user_id',           v_user_id,
    'already_processed', false,
    'verified',          v_new_status = 'verified',
    'status',            v_new_status,
    'is_active',         v_is_active
  );
END;
$$;

-- =============================================
-- REVIEW BANK ACCOUNT NAME
-- =============================================
-- An admin confirms a 'name_mismatch' account ('verified') or rejects it
-- ('rejected'), with a note either way (#374). Who decided and why stays on
-- the row (name_reviewed_by / _at / _note) and in its audit trail. Only the
-- active row can be reviewed (#704): every payout and prize check reads the
-- active row only, and the queue at /admin/bank-accounts lists active rows. A
-- superseded row keeps 'name_mismatch': that is what CHIP said about it.
--
-- Refuses with:
--   P0002            no such bank account
--   NOT_UNDER_REVIEW (P0001) the account isn't 'name_mismatch' (already
--                    decided, or never needed review)
--   SUPERSEDED       (P0001) the owner has replaced the account since
--   NOTE_REQUIRED    (P0001) a blank note
--   22023            an action other than 'confirm' or 'reject'
CREATE OR REPLACE FUNCTION review_bank_account_name(
  p_bank_account_id uuid,
  p_reviewer_id     uuid,
  p_action          text,
  p_note            text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner      text;
  v_org_id     uuid;
  v_user_id    uuid;
  v_status     bank_account_status;
  v_is_active  boolean;
  v_note       text := NULLIF(btrim(p_note), '');
  v_new_status bank_account_status;
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('confirm', 'reject') THEN
    RAISE EXCEPTION 'action must be confirm or reject, got %', p_action USING ERRCODE = '22023';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'NOTE_REQUIRED: say why the account is confirmed or rejected'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT 'organization', organization_id, NULL::uuid, status, is_active
    INTO v_owner, v_org_id, v_user_id, v_status, v_is_active
    FROM organization_bank_accounts
    WHERE id = p_bank_account_id
    FOR UPDATE;

  IF NOT FOUND THEN
    SELECT 'player', NULL::uuid, user_id, status, is_active
      INTO v_owner, v_org_id, v_user_id, v_status, v_is_active
      FROM player_bank_accounts
      WHERE id = p_bank_account_id
      FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank account % not found', p_bank_account_id USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'name_mismatch' THEN
    RAISE EXCEPTION 'NOT_UNDER_REVIEW: this account is %, not awaiting a name review', v_status
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT v_is_active THEN
    RAISE EXCEPTION 'SUPERSEDED: the owner has replaced this account since'
      USING ERRCODE = 'P0001';
  END IF;

  v_new_status := CASE p_action WHEN 'confirm' THEN 'verified' ELSE 'rejected' END::bank_account_status;

  IF v_owner = 'organization' THEN
    UPDATE organization_bank_accounts
      SET status           = v_new_status,
          verified_at      = CASE WHEN v_new_status = 'verified' THEN now() END,
          rejection_reason = CASE WHEN v_new_status = 'rejected' THEN v_note END,
          name_reviewed_by = p_reviewer_id,
          name_reviewed_at = now(),
          name_review_note = v_note
      WHERE id = p_bank_account_id;
  ELSE
    UPDATE player_bank_accounts
      SET status           = v_new_status,
          verified_at      = CASE WHEN v_new_status = 'verified' THEN now() END,
          rejection_reason = CASE WHEN v_new_status = 'rejected' THEN v_note END,
          name_reviewed_by = p_reviewer_id,
          name_reviewed_at = now(),
          name_review_note = v_note
      WHERE id = p_bank_account_id;
  END IF;

  RETURN jsonb_build_object(
    'bank_account_id',   p_bank_account_id,
    'owner',             v_owner,
    'organization_id',   v_org_id,
    'user_id',           v_user_id,
    'already_processed', false,
    'verified',          v_new_status = 'verified',
    'status',            v_new_status,
    'is_active',         v_is_active
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
-- CLAIM PAYOUT SEND
-- executePayout calls this immediately before it asks CHIP for the transfer. It
-- re-checks the blocks and moves the row from 'pending' to 'processing' in one
-- step, under the same tournament lock that review_tournament_cancellation takes.
-- Without that lock, a cancellation could be approved after executePayout's own
-- block check but before CHIP is called, and both the refunds and the transfer
-- would go ahead. With it, one of two things happens: the claim sees the
-- cancellation and refuses, or the cancellation sees 'processing' and refuses.
--
-- 'processing' with no chip_send_instruction_id means the row has been claimed
-- and CHIP may or may not have created the instruction. executePayout resumes
-- such a row by sending again: `reference` dedupes the transfer, so a second send
-- returns the existing instruction instead of paying twice. The row goes back to
-- 'pending' only when CHIP definitely refused the send.
--
-- Returns NULL once the row is claimed. Otherwise returns why it wasn't: a
-- tournament_payout_block_reason code, or 'not_claimable' when the row is
-- missing, unapproved, settled or already claimed.
-- =============================================
CREATE OR REPLACE FUNCTION claim_payout_send(p_payout_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament_id uuid;
  v_payout        payouts;
  v_block         text;
BEGIN
  SELECT tournament_id INTO v_tournament_id FROM payouts WHERE id = p_payout_id;
  IF NOT FOUND THEN
    RETURN 'not_claimable';
  END IF;

  -- Tournament first, then the payout: the lock order every payout function uses.
  PERFORM 1 FROM tournaments WHERE id = v_tournament_id FOR UPDATE;
  SELECT * INTO v_payout FROM payouts WHERE id = p_payout_id FOR UPDATE;

  IF v_payout.processed_at IS NOT NULL
     OR v_payout.approval <> 'approved'
     OR v_payout.status <> 'pending' THEN
    RETURN 'not_claimable';
  END IF;

  v_block := tournament_payout_block_reason(v_tournament_id);
  IF v_block IS NOT NULL THEN
    RETURN v_block;
  END IF;

  UPDATE payouts SET status = 'processing' WHERE id = p_payout_id;
  RETURN NULL;
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
-- list_unfired_cancellation_refunds does for the refund sweep, and answer "how much
-- is available" through available_payout_cents rather than re-deriving it.
-- =============================================

-- Per-tournament payout position for one organization: the tournaments it
-- organized, plus those whose payout it has accepted as beneficiary. Drafts have no
-- money to show. recipient_problem is surfaced so that a recipient which has lapsed
-- (agreement bumped, bank account replaced) shows up on both dashboards instead of
-- failing silently in the sweep. early_payout_cap_cents / early_payout_problem
-- answer "can we ask for money early, and how much".
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
  recipient_problem          text,
  early_payout_cap_cents     integer,
  early_payout_problem       text
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
    payout_recipient_problem(v.recipient_id),
    -- So the dashboard can offer an early payout, or say why it can't, before
    -- the organizer tries.
    (SELECT c.cap_cents FROM early_payout_cap(v.id) c),
    early_payout_problem(v.id)
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
-- TOURNAMENT END INSTANT
-- The instant a tournament is considered finished, as an absolute timestamptz.
-- The automatic payout is due PAYOUT_HOLD_DAYS after it.
--
-- end_date is a calendar date at the venue (tournaments.timezone), so its end is
-- local midnight at the close of that day. `timestamp AT TIME ZONE zone` reads a
-- wall-clock time in that zone, which makes this DST-safe and correct per
-- tournament: a GMT+9 venue ends an hour before a GMT+8 one with the same
-- end_date. Never compare against current_date instead: that is the server's
-- UTC date, eight hours off what a Malaysian organizer sees.
--
-- Seam for tournament schedules (planned, not built). When they land, the last
-- scheduled session's end goes FIRST in the COALESCE:
--   (SELECT max(s.ends_at) FROM tournament_schedule_items s WHERE s.tournament_id = t.id),
-- Whatever table that feature creates must expose a per-tournament
-- `ends_at timestamptz`, an absolute instant rather than a local time, so that
-- nothing else here changes and every caller is already correct. The table
-- doesn't exist yet, and a SQL function body can't name a missing table, so for
-- now the COALESCE holds the fallback alone.
--
-- Not SECURITY DEFINER: it only reads tournaments, so it can run as the caller,
-- and that lets the planner inline it into list_payable_tournaments.
-- =============================================
CREATE OR REPLACE FUNCTION tournament_end_instant(p_tournament_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    -- the schedule branch goes here
    ((t.end_date + 1)::timestamp AT TIME ZONE t.timezone)
  )
  FROM tournaments t
  WHERE t.id = p_tournament_id;
$$;

-- =============================================
-- LIST PAYABLE TOURNAMENTS
-- The automatic payout sweep's work list (POST /api/v1/cron/payouts), encapsulating
-- the join the way list_unfired_cancellation_refunds does for refunds. A tournament
-- is payable when ALL of these hold:
--
--   * it is published (never draft, never cancelled);
--   * tournament_end_instant + p_hold_days has passed. One instant comparison, so
--     the sweep passes no calendar date and its schedule needs no timezone;
--   * nothing is in the way (tournament_payout_block_reason): no cancellation
--     under review and no player refund still unsettled;
--   * the recipient (the ACCEPTED beneficiary, else the organizing org) can be paid
--     (payout_recipient_problem): approved, entity type set, current agreement, an
--     active verified bank account with a CHIP id;
--   * no payout is in flight for it, of either kind. A rejected early request keeps
--     status 'pending' but reserves nothing, so it doesn't count;
--   * it has no live automatic payout (one not failed). A failed one is retried,
--     as queue_payout's superseded_by expects;
--   * at least p_min_cents is available.
--
-- The recipient and block rules are the same functions queue_payout applies, so a
-- listed tournament is one queue_payout accepts, barring a race it reports itself.
-- A tournament left off for a recipient problem is still shown, with the reason, by
-- list_admin_payout_candidates.
--
-- p_as_of is "now" for the deadline. Callers leave it to default; it exists so the
-- tests can stand at an exact instant either side of a deadline, which now()
-- (fixed for a whole transaction) doesn't allow.
-- =============================================
CREATE OR REPLACE FUNCTION list_payable_tournaments(
  p_hold_days integer,
  p_min_cents integer,
  p_as_of     timestamptz DEFAULT now()
)
RETURNS TABLE (
  tournament_id             uuid,
  tournament_name           varchar(255),
  recipient_organization_id uuid,
  end_instant               timestamptz,
  available_cents           integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ended AS (
    SELECT t.id,
           t.name,
           tournament_end_instant(t.id) AS end_instant,
           CASE WHEN t.beneficiary_accepted_at IS NOT NULL
                THEN t.beneficiary_organization_id
                ELSE t.organization_id
           END AS recipient_id
    FROM tournaments t
    WHERE t.status = 'published'
      AND t.organization_id IS NOT NULL
  ),
  candidates AS (
    SELECT e.*, available_payout_cents(e.id) AS available
    FROM ended e
    WHERE e.end_instant + make_interval(days => p_hold_days) <= p_as_of
      AND tournament_payout_block_reason(e.id) IS NULL
      AND payout_recipient_problem(e.recipient_id) IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM payouts p
        WHERE p.tournament_id = e.id
          AND p.approval <> 'rejected'
          AND p.status IN ('pending', 'processing')
      )
      AND NOT EXISTS (
        SELECT 1 FROM payouts p
        WHERE p.tournament_id = e.id
          AND p.kind = 'automatic'
          AND p.status <> 'failed'
      )
  )
  SELECT c.id, c.name, c.recipient_id, c.end_instant, c.available
  FROM candidates c
  WHERE c.available >= p_min_cents
  ORDER BY c.end_instant, c.id;
$$;

-- =============================================
-- PLATFORM-MANAGED PRIZE POOL (#523)
-- Opt-in per tournament via prizes.distribution = 'platform'. The governing rule:
-- THE PLATFORM NEVER PAYS OUT PRIZE MONEY IT HAS NOT COLLECTED. Prize money is
-- ring-fenced from organizer revenue at every level: its own ledger types
-- (prize_funding in, player_prize out), its own balance in the summary view
-- (prize_pool_balance_cents, which net_payout_cents never reads), and a hard
-- funding check before any winner is paid.
--
--   funded    = prize_funding paid in                    (view)
--   paid out  = player_prize paid out                    (view)
--   balance   = funded - paid out                        prize_pool_balance_cents
--   reserved  = APPROVED awards not yet settled          (prize_awards)
--   available = balance - reserved                       available_prize_pool_cents
--
-- An award awaiting review reserves nothing; approving it is what commits the
-- money, under the tournament row lock, so two concurrent approvals can't both
-- see the same balance. The send then mirrors a payout: claim under the same
-- lock, CHIP Send with reference = award id, settle once (settle_prize_award).
--
-- Funds left over once every prize is settled (a category with no eligible
-- winner, a no-show) are returned to the funders. That is an operations step,
-- not automated here; see wiki/prize-flow.md and section 9 of the Organizer
-- Agreement, which says the same.
-- =============================================

-- Total declared prize money in a tournaments.prizes document: every category
-- entry plus every special prize. The SQL twin of totalDeclaredPrizeCents
-- (src/lib/tournaments/prize-funding.ts): only JSON numbers count, anything
-- else is ignored rather than raising, as there.
CREATE OR REPLACE FUNCTION declared_prize_total_cents(p_prizes jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE((
    SELECT SUM((e->>'amount_cents')::numeric)
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_prizes->'categories') = 'array'
                THEN p_prizes->'categories' ELSE '[]'::jsonb END) c,
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(c->'entries') = 'array'
                THEN c->'entries' ELSE '[]'::jsonb END) e
    WHERE jsonb_typeof(e->'amount_cents') = 'number'
  ), 0)::integer
  + COALESCE((
    SELECT SUM((s->>'amount_cents')::numeric)
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_prizes->'special') = 'array'
                THEN p_prizes->'special' ELSE '[]'::jsonb END) s
    WHERE jsonb_typeof(s->'amount_cents') = 'number'
  ), 0)::integer;
$$;

-- The declared amount of one prize: a category's placed entry, or (p_place NULL)
-- a special prize by name. NULL when the tournament declares no such prize.
CREATE OR REPLACE FUNCTION declared_prize_amount_cents(
  p_prizes   jsonb,
  p_category text,
  p_place    text
)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_place IS NULL THEN (
      SELECT (s->>'amount_cents')::integer
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(p_prizes->'special') = 'array'
                  THEN p_prizes->'special' ELSE '[]'::jsonb END) s
      WHERE btrim(s->>'name') = btrim(p_category)
        AND jsonb_typeof(s->'amount_cents') = 'number'
      LIMIT 1
    )
    ELSE (
      SELECT (e->>'amount_cents')::integer
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(p_prizes->'categories') = 'array'
                  THEN p_prizes->'categories' ELSE '[]'::jsonb END) c,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(c->'entries') = 'array'
                  THEN c->'entries' ELSE '[]'::jsonb END) e
      WHERE btrim(c->>'name') = btrim(p_category)
        AND btrim(e->>'place') = btrim(p_place)
        AND jsonb_typeof(e->'amount_cents') = 'number'
      LIMIT 1
    )
  END;
$$;

-- Where a tournament's prize pool stands, in one row. Every caller (the
-- registration gate, the review guard, both dashboards) reads it from here.
CREATE OR REPLACE FUNCTION prize_pool_position(p_tournament_id uuid)
RETURNS TABLE (
  distribution        text,
  declared_cents      integer,
  funded_cents        integer,
  paid_out_cents      integer,
  balance_cents       integer,
  reserved_cents      integer,
  pending_review_cents integer,
  available_cents     integer,
  fully_funded        boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT COALESCE(tt.prizes->>'distribution', 'organizer') AS distribution,
           declared_prize_total_cents(tt.prizes) AS declared
    FROM tournaments tt
    WHERE tt.id = p_tournament_id
  ),
  ledger AS (
    SELECT COALESCE(SUM(s.total_prize_funding_cents), 0)::integer AS funded,
           COALESCE(SUM(s.total_prizes_cents), 0)::integer        AS paid_out
    FROM tournament_payout_summary s
    WHERE s.tournament_id = p_tournament_id
  ),
  awards AS (
    SELECT
      COALESCE(SUM(a.amount_cents) FILTER (
        WHERE a.approval = 'approved' AND a.status IN ('pending', 'processing')
      ), 0)::integer AS reserved,
      COALESCE(SUM(a.amount_cents) FILTER (
        WHERE a.approval = 'pending'
      ), 0)::integer AS pending_review
    FROM prize_awards a
    WHERE a.tournament_id = p_tournament_id
  )
  SELECT
    t.distribution,
    t.declared,
    l.funded,
    l.paid_out,
    l.funded - l.paid_out,
    a.reserved,
    a.pending_review,
    GREATEST(0, l.funded - l.paid_out - a.reserved),
    -- Only a platform-distributed pool has to be funded. Nothing declared is
    -- trivially funded.
    t.distribution <> 'platform' OR l.funded >= t.declared
  FROM t, ledger l, awards a;
$$;

-- How much of the pool may still be committed to awards, optionally ignoring
-- one award's own reservation ("how much is available to ME").
CREATE OR REPLACE FUNCTION available_prize_pool_cents(
  p_tournament_id    uuid,
  p_exclude_award_id uuid DEFAULT NULL
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
      SELECT SUM(s.total_prize_funding_cents - s.total_prizes_cents)
      FROM tournament_payout_summary s
      WHERE s.tournament_id = p_tournament_id
    ), 0)
    - COALESCE((
      SELECT SUM(a.amount_cents)
      FROM prize_awards a
      WHERE a.tournament_id = p_tournament_id
        AND a.approval = 'approved'
        AND a.status IN ('pending', 'processing')
        AND a.id IS DISTINCT FROM p_exclude_award_id
    ), 0)
  )::integer;
$$;

-- THE REGISTRATION GATE. No player may register (or pay) for a
-- platform-distributed tournament until its pool is fully funded: otherwise
-- players enter an event whose advertised prizes have no money behind them.
-- An unfunded tournament isn't listed at all (it waits in 'pending_funding'),
-- so this is the backstop for the one case left: a listed tournament whose
-- prizes were raised before anyone paid, which reopens the gap until the
-- top-up is paid. Checked by the checkout route and by
-- create_registration_with_payment and start_new_payment_attempt.
CREATE OR REPLACE FUNCTION prize_pool_blocks_registration(p_tournament_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT NOT p.fully_funded FROM prize_pool_position(p_tournament_id) p), false);
$$;

-- Each funder's share of a prizes document: what the prizes naming them add up
-- to. A funder is matched on its name, ignoring case and surrounding spaces, so
-- "ACME Sdn Bhd" on one category and "acme sdn bhd " on another are one sponsor
-- with one payment link. funder_name is the spelling of its first appearance.
-- Prizes with no money, or no named funder (publish validation refuses those
-- when money is attached), are left out.
CREATE OR REPLACE FUNCTION declared_prize_funders(p_prizes jsonb)
RETURNS TABLE (funder_key text, funder_name text, amount_cents integer)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH items AS (
    SELECT btrim(c->'funding'->>'funder_name') AS name,
           (e->>'amount_cents')::numeric        AS amount,
           ci * 100000 + ei                     AS ord
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_prizes->'categories') = 'array'
                THEN p_prizes->'categories' ELSE '[]'::jsonb END) WITH ORDINALITY AS cc(c, ci),
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(c->'entries') = 'array'
                THEN c->'entries' ELSE '[]'::jsonb END) WITH ORDINALITY AS ee(e, ei)
    WHERE jsonb_typeof(e->'amount_cents') = 'number'
    UNION ALL
    SELECT btrim(s->'funding'->>'funder_name'),
           (s->>'amount_cents')::numeric,
           1000000000 + si
    FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(p_prizes->'special') = 'array'
                THEN p_prizes->'special' ELSE '[]'::jsonb END) WITH ORDINALITY AS ss(s, si)
    WHERE jsonb_typeof(s->'amount_cents') = 'number'
  )
  SELECT lower(name), (array_agg(name ORDER BY ord))[1], SUM(amount)::integer
  FROM items
  WHERE COALESCE(name, '') <> ''
  GROUP BY lower(name)
  HAVING SUM(amount) > 0;
$$;

-- =============================================
-- SET PRIZE FUNDER CONTACTS
-- Replaces a tournament's funder contacts with p_contacts, an array of
-- {funder_name, funder_email}: names not in it are removed, the rest are
-- upserted. Names match case- and space-insensitively, as in
-- declared_prize_funders. Emails are stored trimmed and lower-cased. Raises
-- PRIZE_FUNDER_CONTACT_INVALID on a blank name, a malformed address or the
-- same funder twice. Takes the tournament lock, so it can't interleave with
-- reconcile_prize_funding_requests reading the contacts.
-- =============================================
CREATE OR REPLACE FUNCTION set_prize_funder_contacts(
  p_tournament_id uuid,
  p_contacts      jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contacts jsonb := COALESCE(p_contacts, '[]'::jsonb);
  v_count    integer;
BEGIN
  PERFORM 1 FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % not found', p_tournament_id USING ERRCODE = 'P0002';
  END IF;
  IF jsonb_typeof(v_contacts) <> 'array' THEN
    RAISE EXCEPTION 'PRIZE_FUNDER_CONTACT_INVALID: not a list' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_contacts) x
    WHERE COALESCE(btrim(x->>'funder_name'), '') = ''
       OR length(btrim(x->>'funder_name')) > 255
  ) THEN
    RAISE EXCEPTION 'PRIZE_FUNDER_CONTACT_INVALID: funder name required' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_contacts) x
    WHERE x->>'funder_email' IS NULL
       OR length(btrim(x->>'funder_email')) > 255
       OR btrim(x->>'funder_email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ) THEN
    RAISE EXCEPTION 'PRIZE_FUNDER_CONTACT_INVALID: invalid email' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_contacts) x
    GROUP BY lower(btrim(x->>'funder_name')) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PRIZE_FUNDER_CONTACT_INVALID: duplicate funder' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM prize_funder_contacts c
  WHERE c.tournament_id = p_tournament_id
    AND lower(btrim(c.funder_name)) NOT IN (
      SELECT lower(btrim(x->>'funder_name')) FROM jsonb_array_elements(v_contacts) x
    );

  INSERT INTO prize_funder_contacts (tournament_id, funder_name, funder_email)
  SELECT p_tournament_id, btrim(x->>'funder_name'), lower(btrim(x->>'funder_email'))
  FROM jsonb_array_elements(v_contacts) x
  ON CONFLICT (tournament_id, lower(btrim(funder_name)))
  DO UPDATE SET funder_name  = EXCLUDED.funder_name,
                funder_email = EXCLUDED.funder_email
  WHERE prize_funder_contacts.funder_name  IS DISTINCT FROM EXCLUDED.funder_name
     OR prize_funder_contacts.funder_email IS DISTINCT FROM EXCLUDED.funder_email;

  v_count := jsonb_array_length(v_contacts);
  RETURN v_count;
END;
$$;

-- =============================================
-- RELEASE FUNDED TOURNAMENT
-- Lists a 'pending_funding' tournament (status → 'published') once its prize
-- pool is fully funded, or once it no longer needs funding at all (the
-- organizer switched to paying the winners themselves, or dropped the prize
-- money). Returns whether this call listed it. Takes the tournament lock;
-- callers that already hold it (settle_prize_funding,
-- reconcile_prize_funding_requests) simply re-take it.
--
-- published_at was stamped when the organizer published, and stays: that is
-- when they committed to the event, and chk_published_at (before the deadline
-- and the start) held then.
-- =============================================
CREATE OR REPLACE FUNCTION release_funded_tournament(p_tournament_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status tournament_status;
BEGIN
  SELECT status INTO v_status FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'pending_funding' THEN
    RETURN false;
  END IF;
  IF NOT COALESCE((SELECT p.fully_funded FROM prize_pool_position(p_tournament_id) p), false) THEN
    RETURN false;
  END IF;

  UPDATE tournaments SET status = 'published' WHERE id = p_tournament_id;
  RETURN true;
END;
$$;

-- =============================================
-- RECONCILE PRIZE FUNDING REQUESTS
-- Makes a tournament's open funding requests match what its prizes ask of each
-- funder. Run when the tournament is published, whenever its prizes or funder
-- contacts change, when it is cancelled, and by the daily run. For each funder
-- (declared_prize_funders, plus any funder asked before):
--
--   need = the funder's declared share - what they have already paid
--
--   need <= 0                 every open request is cancelled
--   an open request asks for exactly `need` at the current address
--                             it is kept, and every other one is cancelled
--   otherwise                 every open request is cancelled and a new one
--                             asks for `need` (no address yet: reported in
--                             missing_contacts and nothing is created)
--
-- "Open" is pending and not cancelled. A failed request (the funder's payment
-- failed) is closed, so the next run asks again with a fresh link. When the
-- tournament isn't asking for money (not platform-distributed, a draft,
-- cancelled), every open request is cancelled.
--
-- Rows only: creating each new request's CHIP purchase, cancelling each
-- cancelled one's, and emailing the funder happen in the app afterwards
-- (src/services/prizes/funding-requests.ts), outside this transaction. Ends by
-- releasing the tournament if the pool is now funded.
--
-- Returns { created: [id], cancelled: [{id, chip_transaction_id}],
--           missing_contacts: [funder_name], released: bool }.
-- =============================================
CREATE OR REPLACE FUNCTION reconcile_prize_funding_requests(
  p_tournament_id uuid,
  p_actor         uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament tournaments;
  v_asking     boolean;
  r            record;
  v_need       integer;
  v_keep       uuid;
  v_new_id     uuid;
  v_created    jsonb := '[]'::jsonb;
  v_cancelled  jsonb := '[]'::jsonb;
  v_missing    jsonb := '[]'::jsonb;
  v_batch      jsonb;
BEGIN
  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % not found', p_tournament_id USING ERRCODE = 'P0002';
  END IF;

  v_asking := COALESCE(v_tournament.prizes->>'distribution', 'organizer') = 'platform'
              AND v_tournament.status IN ('pending_funding', 'published');

  FOR r IN
    WITH declared AS (
      SELECT d.* FROM declared_prize_funders(v_tournament.prizes) d WHERE v_asking
    ),
    asked AS (
      SELECT DISTINCT lower(btrim(f.funder_name)) AS funder_key
      FROM prize_fundings f WHERE f.tournament_id = p_tournament_id
    ),
    keys AS (
      SELECT declared.funder_key FROM declared UNION SELECT asked.funder_key FROM asked
    )
    SELECT k.funder_key,
           d.funder_name,
           COALESCE(d.amount_cents, 0) AS target_cents,
           c.funder_email,
           COALESCE((
             SELECT SUM(f.amount_cents) FROM prize_fundings f
             WHERE f.tournament_id = p_tournament_id
               AND lower(btrim(f.funder_name)) = k.funder_key
               AND f.status = 'paid'
           ), 0)::integer AS paid_cents
    FROM keys k
    LEFT JOIN declared d ON d.funder_key = k.funder_key
    LEFT JOIN prize_funder_contacts c
      ON c.tournament_id = p_tournament_id
     AND lower(btrim(c.funder_name)) = k.funder_key
    ORDER BY k.funder_key
  LOOP
    v_need := r.target_cents - r.paid_cents;
    v_keep := NULL;

    IF v_need > 0 AND r.funder_email IS NOT NULL THEN
      SELECT f.id INTO v_keep
      FROM prize_fundings f
      WHERE f.tournament_id = p_tournament_id
        AND lower(btrim(f.funder_name)) = r.funder_key
        AND f.status = 'pending' AND f.cancelled_at IS NULL
        AND f.amount_cents = v_need
        AND lower(f.funder_email) = lower(r.funder_email)
      ORDER BY f.created_at DESC
      LIMIT 1;
    END IF;

    WITH c AS (
      UPDATE prize_fundings f
        SET cancelled_at = now()
      WHERE f.tournament_id = p_tournament_id
        AND lower(btrim(f.funder_name)) = r.funder_key
        AND f.status = 'pending' AND f.cancelled_at IS NULL
        AND f.id IS DISTINCT FROM v_keep
      RETURNING f.id, f.chip_transaction_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'chip_transaction_id', c.chip_transaction_id)), '[]'::jsonb)
      INTO v_batch FROM c;
    v_cancelled := v_cancelled || v_batch;

    IF v_need > 0 AND v_keep IS NULL THEN
      IF r.funder_email IS NULL THEN
        v_missing := v_missing || to_jsonb(r.funder_name);
      ELSE
        INSERT INTO prize_fundings (tournament_id, funder_name, funder_email, amount_cents, created_by)
        VALUES (p_tournament_id, r.funder_name, lower(r.funder_email), v_need, p_actor)
        RETURNING id INTO v_new_id;
        v_created := v_created || to_jsonb(v_new_id);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'created',          v_created,
    'cancelled',        v_cancelled,
    'missing_contacts', v_missing,
    'released',         release_funded_tournament(p_tournament_id)
  );
END;
$$;

-- =============================================
-- SETTLE PRIZE FUNDING (idempotent, keyed by a prize_fundings row)
-- Called by the CHIP Collect webhook when a prize-funding purchase reports an
-- outcome. The settle_registration_payment shape:
--   paid  → book ONE type='prize_funding' ledger row (which feeds
--           prize_pool_balance_cents) and mark the contribution paid. "Real money
--           wins": honored over a row already marked failed. Only honored when
--           p_amount_cents matches what the funder was asked for; a mismatch is
--           left as-is and reported back for manual reconciliation.
--   !paid → only a still-pending row becomes failed; a paid one is never undone.
--   already paid → no-op, reported back.
-- A payment that completes the pool of a 'pending_funding' tournament lists it
-- (release_funded_tournament), reported back as went_live so the caller can
-- refresh the public pages and tell the organizer.
--
-- The ledger row carries the ORGANIZING org, like every payments row, so it
-- groups with the tournament's other money in the summary view; it moves
-- net_payout_cents by nothing because the view never reads prize types there.
-- =============================================
CREATE OR REPLACE FUNCTION settle_prize_funding(
  p_funding_id     uuid,
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
  v_funding         prize_fundings;
  v_tournament_id   uuid;
  v_org_id          uuid;
  v_payment_id      uuid;
  v_amount_mismatch boolean := false;
  v_newly_paid      boolean := false;
  v_went_live       boolean := false;
BEGIN
  -- Tournament lock first, then the row, as everywhere else:
  -- reconcile_prize_funding_requests locks in that order, and this may release
  -- the tournament.
  SELECT tournament_id INTO v_tournament_id FROM prize_fundings WHERE id = p_funding_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prize funding % not found', p_funding_id USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM tournaments WHERE id = v_tournament_id FOR UPDATE;

  SELECT * INTO v_funding FROM prize_fundings WHERE id = p_funding_id FOR UPDATE;

  IF p_paid THEN
    IF v_funding.status <> 'paid' THEN
      IF p_amount_cents IS NOT NULL AND p_amount_cents <> v_funding.amount_cents THEN
        v_amount_mismatch := true;
      ELSE
        SELECT organization_id INTO v_org_id FROM tournaments WHERE id = v_funding.tournament_id;

        INSERT INTO payments (
          type, tournament_id, user_id, organization_id,
          gross_amount_cents, platform_fee_cents, organizer_commission_cents,
          player_commission_cents, net_amount_cents, currency,
          payment_method, chip_transaction_id, status, paid_at
        ) VALUES (
          'prize_funding', v_funding.tournament_id, NULL, v_org_id,
          v_funding.amount_cents, 0, 0,
          0, v_funding.amount_cents, 'MYR',
          p_payment_method, v_funding.chip_transaction_id, 'paid', now()
        )
        RETURNING id INTO v_payment_id;

        UPDATE prize_fundings
          SET status         = 'paid',
              payment_id     = v_payment_id,
              paid_at        = now(),
              payment_method = COALESCE(p_payment_method, payment_method)
          WHERE id = p_funding_id;

        v_newly_paid := true;
        -- The payment that completes the pool lists the tournament.
        v_went_live := release_funded_tournament(v_funding.tournament_id);
      END IF;
    END IF;
  ELSIF v_funding.status = 'pending' THEN
    UPDATE prize_fundings SET status = 'failed' WHERE id = p_funding_id;
  END IF;

  RETURN jsonb_build_object(
    'funding_id',        p_funding_id,
    'tournament_id',     v_funding.tournament_id,
    'already_processed', v_funding.status = 'paid',
    'amount_mismatch',   v_amount_mismatch,
    'newly_paid',        v_newly_paid,
    'went_live',         v_went_live
  );
END;
$$;

-- =============================================
-- PRIZE PAYEES
-- =============================================
-- Whose account each winner's prize is paid to (#718), for many winners at
-- once, so the award lists and emails read the same rule as
-- claim_prize_award_send. A winner with an active 'minor' guardianship is paid
-- to a guardian: the one whose active account is verified, else one who has an
-- account at all, else the earliest guardianship, then the guardian's id, so
-- the same guardian is chosen every time. Everyone else is paid to their own
-- account.
CREATE OR REPLACE FUNCTION prize_payees(p_winners uuid[])
RETURNS TABLE (
  winner_user_id uuid,
  payee_user_id  uuid,
  reason         prize_payee_reason
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id,
         COALESCE(g.guardian_user_id, w.id),
         CASE WHEN g.guardian_user_id IS NULL THEN 'winner'
              ELSE 'guardian_of_minor' END::prize_payee_reason
    FROM unnest(p_winners) AS w(id)
    LEFT JOIN LATERAL (
      SELECT gs.guardian_user_id
        FROM guardianships gs
        JOIN users gu ON gu.id = gs.guardian_user_id AND gu.deleted_at IS NULL
        LEFT JOIN player_bank_accounts b
          ON b.user_id = gs.guardian_user_id AND b.is_active
       WHERE gs.dependent_user_id = w.id
         AND gs.status = 'active'
         AND gs.basis = 'minor'
       ORDER BY (b.status = 'verified') DESC NULLS LAST,
                (b.id IS NOT NULL) DESC,
                gs.created_at,
                gs.guardian_user_id
       LIMIT 1
    ) g ON true
   WHERE w.id IS NOT NULL;
$$;

-- =============================================
-- ENTER PRIZE AWARD
-- The organizer names a winner, after the event. Nothing is reserved and
-- nothing moves until a platform admin approves it (review_prize_award). Refused
-- with PRIZE_AWARD_NOT_ALLOWED: <code> when:
--   not_platform_distributed  the organizer pays this tournament's winners
--   tournament_not_published / tournament_cancelled / cancellation_pending
--   tournament_not_finished   before the last day of play, in the venue's zone
--   winner_not_registered     the winner holds no confirmed registration: a
--                             prize can only go to someone who played
--   prize_not_declared        no such category + place (or special prize)
-- and PRIZE_AWARD_EXCEEDS_PRIZE when the live awards for that prize would add
-- up to more than it declares. Several awards for one prize are allowed (a tie
-- split between players) as long as they fit inside it.
--
-- Takes the tournament lock, so two entries for one prize can't both fit.
-- =============================================
CREATE OR REPLACE FUNCTION enter_prize_award(
  p_tournament_id uuid,
  p_user_id       uuid,
  p_category      text,
  p_place         text,
  p_amount_cents  integer,
  p_entered_by    uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament tournaments;
  v_category   text := btrim(p_category);
  v_place      text := NULLIF(btrim(p_place), '');
  v_declared   integer;
  v_committed  integer;
  v_id         uuid;
BEGIN
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount_cents must be positive' USING ERRCODE = '22023';
  END IF;
  IF v_category IS NULL OR v_category = '' THEN
    RAISE EXCEPTION 'category is required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_tournament FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % not found', p_tournament_id USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_tournament.prizes->>'distribution', 'organizer') <> 'platform' THEN
    RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: not_platform_distributed' USING ERRCODE = 'P0001';
  END IF;
  IF v_tournament.status = 'cancelled' THEN
    RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: tournament_cancelled' USING ERRCODE = 'P0001';
  END IF;
  IF v_tournament.status <> 'published' THEN
    RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: tournament_not_published' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tournament_cancellation_requests c
    WHERE c.tournament_id = p_tournament_id AND c.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: cancellation_pending' USING ERRCODE = 'P0001';
  END IF;
  -- The final round is played on end_date, so results exist from that day on.
  IF (v_tournament.end_date::timestamp AT TIME ZONE v_tournament.timezone) > now() THEN
    RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: tournament_not_finished' USING ERRCODE = 'P0001';
  END IF;
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM registrations r
    WHERE r.tournament_id = p_tournament_id AND r.user_id = p_user_id AND r.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: winner_not_registered' USING ERRCODE = 'P0001';
  END IF;

  v_declared := declared_prize_amount_cents(v_tournament.prizes, v_category, v_place);
  IF v_declared IS NULL OR v_declared <= 0 THEN
    RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: prize_not_declared' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(SUM(a.amount_cents), 0) INTO v_committed
    FROM prize_awards a
    WHERE a.tournament_id = p_tournament_id
      AND a.category = v_category
      AND a.place IS NOT DISTINCT FROM v_place
      AND a.approval <> 'rejected'
      AND a.status <> 'failed';

  IF v_committed + p_amount_cents > v_declared THEN
    RAISE EXCEPTION 'PRIZE_AWARD_EXCEEDS_PRIZE: % cents requested, % cents of this prize is left',
      p_amount_cents, v_declared - v_committed
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO prize_awards (
    tournament_id, organization_id, user_id, category, place, amount_cents, entered_by
  ) VALUES (
    p_tournament_id, v_tournament.organization_id, p_user_id, v_category, v_place,
    p_amount_cents, p_entered_by
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- =============================================
-- REVIEW PRIZE AWARD
-- A platform admin approves or rejects an entered award. The review_payout_request
-- shape: tournament lock, then the award; P0002 when missing; P0001
-- PRIZE_AWARD_ALREADY_REVIEWED once reviewed.
--
-- Approve is where the hard guard lives. Under the tournament lock it refuses
-- unless the pool is FULLY funded (PRIZE_AWARD_NOT_ALLOWED: pool_not_funded) and
-- the award fits in what is still uncommitted:
--
--   amount <= available_prize_pool_cents(tournament, this award)
--
-- else PRIZE_AWARD_EXCEEDS_POOL. Because every approval takes the same row lock
-- and reads the reservations committed before it, concurrent approvals can never
-- together exceed the collected pool. It also refuses on a cancelled or
-- cancelling tournament, or an award whose winner's account has been deleted.
--
-- Approve does NOT move money: the route calls executePrizeAward afterwards.
-- Reject records the reason and frees nothing (nothing was reserved).
-- =============================================
CREATE OR REPLACE FUNCTION review_prize_award(
  p_award_id         uuid,
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
  v_tournament    tournaments;
  v_award         prize_awards;
  v_position      record;
  v_available     integer;
  v_new_approval  approval_status;
  v_reviewed_at   timestamptz := now();
BEGIN
  IF p_action IS NULL OR p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'action must be approve or reject, got %', p_action USING ERRCODE = '22023';
  END IF;
  IF p_action = 'reject' AND (p_rejection_reason IS NULL OR btrim(p_rejection_reason) = '') THEN
    RAISE EXCEPTION 'a rejection reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT tournament_id INTO v_tournament_id FROM prize_awards WHERE id = p_award_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prize award % not found', p_award_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_tournament FROM tournaments WHERE id = v_tournament_id FOR UPDATE;
  SELECT * INTO v_award FROM prize_awards WHERE id = p_award_id FOR UPDATE;

  IF v_award.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'PRIZE_AWARD_WITHDRAWN: the organizer withdrew prize award %', p_award_id
      USING ERRCODE = 'P0001';
  END IF;
  IF v_award.approval <> 'pending' THEN
    RAISE EXCEPTION 'PRIZE_AWARD_ALREADY_REVIEWED: prize award % already reviewed', p_award_id
      USING ERRCODE = 'P0001';
  END IF;

  IF p_action = 'approve' THEN
    IF v_tournament.status = 'cancelled' THEN
      RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: tournament_cancelled' USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (
      SELECT 1 FROM tournament_cancellation_requests c
      WHERE c.tournament_id = v_tournament_id AND c.status = 'pending'
    ) THEN
      RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: cancellation_pending' USING ERRCODE = 'P0001';
    END IF;
    IF v_award.user_id IS NULL THEN
      RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: winner_missing' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_position FROM prize_pool_position(v_tournament_id);
    IF v_position.distribution <> 'platform' THEN
      RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: not_platform_distributed' USING ERRCODE = 'P0001';
    END IF;
    IF NOT v_position.fully_funded THEN
      RAISE EXCEPTION 'PRIZE_AWARD_NOT_ALLOWED: pool_not_funded' USING ERRCODE = 'P0001';
    END IF;

    v_available := available_prize_pool_cents(v_tournament_id, p_award_id);
    IF v_award.amount_cents > v_available THEN
      RAISE EXCEPTION 'PRIZE_AWARD_EXCEEDS_POOL: % cents requested, % cents of the collected pool is uncommitted',
        v_award.amount_cents, v_available
        USING ERRCODE = 'P0001';
    END IF;

    v_new_approval := 'approved';
    UPDATE prize_awards
      SET approval    = v_new_approval,
          reviewed_by = p_reviewer_id,
          reviewed_at = v_reviewed_at
      WHERE id = p_award_id;
  ELSE
    v_new_approval := 'rejected';
    UPDATE prize_awards
      SET approval         = v_new_approval,
          reviewed_by      = p_reviewer_id,
          reviewed_at      = v_reviewed_at,
          rejection_reason = btrim(p_rejection_reason)
      WHERE id = p_award_id;
  END IF;

  RETURN jsonb_build_object(
    'id',              v_award.id,
    'tournament_id',   v_award.tournament_id,
    'organization_id', v_award.organization_id,
    'user_id',         v_award.user_id,
    'amount_cents',    v_award.amount_cents,
    'approval',        v_new_approval,
    'reviewed_at',     v_reviewed_at
  );
END;
$$;

-- =============================================
-- WITHDRAW PRIZE AWARD
-- =============================================
-- The organizer withdraws an award while it awaits review (#611): approval
-- 'rejected' with withdrawn_at / withdrawn_by, and no admin review. Takes the
-- tournament lock, then the award, the same order as enter_prize_award and
-- review_prize_award, so a withdrawal and an approval serialise. Once approved
-- its money is reserved and the send may be under way, so reversing it stays
-- an admin decision.
--
-- Refuses with:
--   P0002                                    no such award in that tournament
--   PRIZE_AWARD_NOT_WITHDRAWABLE: approved   (P0001) an admin approved it
--   PRIZE_AWARD_NOT_WITHDRAWABLE: rejected   (P0001) an admin rejected it
--   PRIZE_AWARD_NOT_WITHDRAWABLE: withdrawn  (P0001) already withdrawn
CREATE OR REPLACE FUNCTION withdraw_prize_award(
  p_tournament_id uuid,
  p_award_id      uuid,
  p_withdrawn_by  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_award        prize_awards;
  v_withdrawn_at timestamptz := now();
BEGIN
  PERFORM 1 FROM tournaments WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % not found', p_tournament_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_award FROM prize_awards
    WHERE id = p_award_id AND tournament_id = p_tournament_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prize award % not found', p_award_id USING ERRCODE = 'P0002';
  END IF;

  IF v_award.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'PRIZE_AWARD_NOT_WITHDRAWABLE: withdrawn' USING ERRCODE = 'P0001';
  END IF;
  IF v_award.approval <> 'pending' THEN
    RAISE EXCEPTION 'PRIZE_AWARD_NOT_WITHDRAWABLE: %', v_award.approval USING ERRCODE = 'P0001';
  END IF;

  UPDATE prize_awards
    SET approval     = 'rejected',
        withdrawn_by = p_withdrawn_by,
        withdrawn_at = v_withdrawn_at
    WHERE id = p_award_id;

  RETURN jsonb_build_object(
    'id',              v_award.id,
    'tournament_id',   v_award.tournament_id,
    'organization_id', v_award.organization_id,
    'user_id',         v_award.user_id,
    'category',        v_award.category,
    'place',           v_award.place,
    'amount_cents',    v_award.amount_cents,
    'withdrawn_at',    v_withdrawn_at
  );
END;
$$;

-- =============================================
-- CLAIM PRIZE AWARD SEND
-- claim_payout_send for an award. executePrizeAward calls it immediately before
-- asking CHIP for the transfer. Under the tournament lock it re-checks that the
-- tournament isn't cancelled or cancelling and that the award still fits in the
-- pool, snapshots the payee's active VERIFIED bank account (prize_payees: the
-- winner's own, or a minor winner's guardian's, #718) with payee_user_id /
-- payee_reason, and moves the row from 'pending' to 'processing'.
--
-- Returns NULL once claimed, else why not: 'not_claimable' (missing, unapproved,
-- settled or already claimed), 'tournament_cancelled', 'cancellation_pending',
-- 'winner_missing', 'bank_account_not_verified' (the winner has no verified
-- account yet: the award waits, with its money reserved), or 'pool_insufficient'.
-- =============================================
CREATE OR REPLACE FUNCTION claim_prize_award_send(p_award_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament_id uuid;
  v_status        tournament_status;
  v_award         prize_awards;
  v_payee         record;
  v_bank_id       uuid;
BEGIN
  SELECT tournament_id INTO v_tournament_id FROM prize_awards WHERE id = p_award_id;
  IF NOT FOUND THEN
    RETURN 'not_claimable';
  END IF;

  SELECT status INTO v_status FROM tournaments WHERE id = v_tournament_id FOR UPDATE;
  SELECT * INTO v_award FROM prize_awards WHERE id = p_award_id FOR UPDATE;

  IF v_award.processed_at IS NOT NULL
     OR v_award.approval <> 'approved'
     OR v_award.status <> 'pending' THEN
    RETURN 'not_claimable';
  END IF;

  IF v_status = 'cancelled' THEN
    RETURN 'tournament_cancelled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tournament_cancellation_requests c
    WHERE c.tournament_id = v_tournament_id AND c.status = 'pending'
  ) THEN
    RETURN 'cancellation_pending';
  END IF;
  IF v_award.user_id IS NULL THEN
    RETURN 'winner_missing';
  END IF;

  IF v_award.amount_cents > available_prize_pool_cents(v_tournament_id, p_award_id) THEN
    RETURN 'pool_insufficient';
  END IF;

  SELECT * INTO v_payee FROM prize_payees(ARRAY[v_award.user_id]);

  SELECT b.id INTO v_bank_id
    FROM player_bank_accounts b
    WHERE b.user_id = v_payee.payee_user_id
      AND b.is_active
      AND b.status = 'verified'
      AND b.chip_bank_account_id IS NOT NULL;
  IF v_bank_id IS NULL THEN
    RETURN 'bank_account_not_verified';
  END IF;

  UPDATE prize_awards
    SET status          = 'processing',
        bank_account_id = v_bank_id,
        payee_user_id   = v_payee.payee_user_id,
        payee_reason    = v_payee.reason
    WHERE id = p_award_id;
  RETURN NULL;
END;
$$;

-- =============================================
-- SETTLE PRIZE AWARD (idempotent, keyed by a prize_awards row)
-- settle_payout for an award, reached from the synchronous send response or the
-- CHIP Send webhook, whichever comes first:
--   paid  → book ONE type='player_prize' ledger row (user_id = the winner,
--           organization_id = the organizing org) and stamp the award paid. The
--           ledger row drains prize_pool_balance_cents and nothing else.
--   !paid → record why, status 'failed', processed. No ledger row. Terminal, as
--           for payouts: CHIP dedupes on `reference`, so the winner is entered
--           again as a new award.
--   already processed → no-op, reported back.
--
-- chip_transaction_id = 'send_' || instruction id, for the same reason as payouts:
-- idx_payments_chip_transaction is unique across ALL payment types.
--
-- "Real money wins": more settled than the pool had available is booked anyway and
-- reported as over_award, to be logged at error level.
-- =============================================
CREATE OR REPLACE FUNCTION settle_prize_award(
  p_award_id                 uuid,
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
  v_award       prize_awards;
  v_instruction bigint;
  v_settled     integer;
  v_payment_id  uuid;
  v_over_award  boolean := false;
BEGIN
  SELECT * INTO v_award FROM prize_awards WHERE id = p_award_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'prize award % not found', p_award_id USING ERRCODE = 'P0002';
  END IF;

  IF v_award.processed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'award_id',          v_award.id,
      'tournament_id',     v_award.tournament_id,
      'already_processed', true,
      'settled',           true,
      'paid',              v_award.status = 'paid',
      'paid_after_failed', p_paid AND v_award.status = 'failed'
    );
  END IF;

  v_instruction := COALESCE(p_chip_send_instruction_id, v_award.chip_send_instruction_id);

  IF p_paid THEN
    IF v_instruction IS NULL THEN
      RAISE EXCEPTION 'prize award % settled as paid with no send instruction id', p_award_id
        USING ERRCODE = 'P0001';
    END IF;

    v_settled := COALESCE(p_amount_cents, v_award.amount_cents);
    IF v_settled <= 0 THEN
      RAISE EXCEPTION 'prize award % settled with a non-positive amount (%)', p_award_id, v_settled
        USING ERRCODE = 'P0001';
    END IF;

    v_over_award := v_settled > available_prize_pool_cents(v_award.tournament_id, p_award_id);

    INSERT INTO payments (
      type, tournament_id, user_id, organization_id,
      gross_amount_cents, platform_fee_cents, organizer_commission_cents,
      player_commission_cents, net_amount_cents, currency,
      payment_method, chip_transaction_id, status, paid_at
    ) VALUES (
      'player_prize', v_award.tournament_id, v_award.user_id, v_award.organization_id,
      v_settled, 0, 0,
      0, v_settled, 'MYR',
      'chip_send', 'send_' || v_instruction, 'paid', now()
    )
    RETURNING id INTO v_payment_id;

    UPDATE prize_awards
      SET status                   = 'paid',
          payment_id               = v_payment_id,
          settled_amount_cents     = v_settled,
          chip_send_instruction_id = v_instruction,
          chip_receipt_url         = COALESCE(p_receipt_url, chip_receipt_url),
          failure_reason           = NULL,
          processed_at             = now()
      WHERE id = p_award_id;
  ELSE
    UPDATE prize_awards
      SET status                   = 'failed',
          chip_send_instruction_id = v_instruction,
          failure_reason           = COALESCE(NULLIF(btrim(p_failure_reason), ''), 'send_instruction_failed'),
          processed_at             = now()
      WHERE id = p_award_id;
  END IF;

  RETURN jsonb_build_object(
    'award_id',          v_award.id,
    'tournament_id',     v_award.tournament_id,
    'already_processed', false,
    'settled',           true,
    'paid',              p_paid,
    'amount_cents',      v_settled,
    'over_award',        v_over_award
  );
END;
$$;

-- =============================================
-- EXECUTE PRIVILEGES — SERVER-ONLY FUNCTIONS
-- Same reasoning as the block at the end of 003_functions_triggers.sql: these
-- SECURITY DEFINER functions trust their arguments, and the checkout route,
-- CHIP webhook and expiry/refund jobs call them through the service role. Left
-- executable by clients, anyone could settle their own registration as paid,
-- settle refunds, list pending or stuck refunds across every organization (with
-- player emails), stamp a refund as fired so a real retry is refused, mark their own
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
REVOKE EXECUTE ON FUNCTION list_unfired_cancellation_refunds FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION settle_refund                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_refund_fire                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_stuck_refunds                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION settle_bank_account_verification  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION available_payout_cents            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION tournament_payout_block_reason    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION queue_payout                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION early_payout_cap                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION early_payout_problem              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION request_early_payout              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION review_payout_request             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_payout_send                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION settle_payout                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_organization_payout_overview FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_pending_payout_nominations   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_admin_payout_candidates      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_payable_tournaments          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION prize_pool_position               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION available_prize_pool_cents        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION prize_pool_blocks_registration    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION settle_prize_funding              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION set_prize_funder_contacts         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION release_funded_tournament         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION reconcile_prize_funding_requests  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION enter_prize_award                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION review_prize_award                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_prize_award_send            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION settle_prize_award                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION review_bank_account_name FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION self_managed_minor FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION assert_participant_not_self_managed_minor FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION assert_payer_acts_for FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION withdraw_prize_award FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION prize_payees FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION create_registration_with_payment  TO service_role;
GRANT EXECUTE ON FUNCTION start_new_payment_attempt         TO service_role;
GRANT EXECUTE ON FUNCTION settle_registration_payment       TO service_role;
GRANT EXECUTE ON FUNCTION expire_stale_pending_payments     TO service_role;
GRANT EXECUTE ON FUNCTION list_unfired_cancellation_refunds TO service_role;
GRANT EXECUTE ON FUNCTION settle_refund                     TO service_role;
GRANT EXECUTE ON FUNCTION claim_refund_fire                 TO service_role;
GRANT EXECUTE ON FUNCTION list_stuck_refunds                TO service_role;
GRANT EXECUTE ON FUNCTION settle_bank_account_verification  TO service_role;
GRANT EXECUTE ON FUNCTION available_payout_cents            TO service_role;
GRANT EXECUTE ON FUNCTION tournament_payout_block_reason    TO service_role;
GRANT EXECUTE ON FUNCTION queue_payout                      TO service_role;
GRANT EXECUTE ON FUNCTION early_payout_cap                  TO service_role;
GRANT EXECUTE ON FUNCTION early_payout_problem              TO service_role;
GRANT EXECUTE ON FUNCTION request_early_payout              TO service_role;
GRANT EXECUTE ON FUNCTION review_payout_request             TO service_role;
GRANT EXECUTE ON FUNCTION claim_payout_send                 TO service_role;
GRANT EXECUTE ON FUNCTION settle_payout                     TO service_role;
GRANT EXECUTE ON FUNCTION list_organization_payout_overview TO service_role;
GRANT EXECUTE ON FUNCTION list_pending_payout_nominations   TO service_role;
GRANT EXECUTE ON FUNCTION list_admin_payout_candidates      TO service_role;
GRANT EXECUTE ON FUNCTION list_payable_tournaments          TO service_role;
GRANT EXECUTE ON FUNCTION prize_pool_position               TO service_role;
GRANT EXECUTE ON FUNCTION available_prize_pool_cents        TO service_role;
GRANT EXECUTE ON FUNCTION prize_pool_blocks_registration    TO service_role;
GRANT EXECUTE ON FUNCTION settle_prize_funding              TO service_role;
GRANT EXECUTE ON FUNCTION set_prize_funder_contacts         TO service_role;
GRANT EXECUTE ON FUNCTION release_funded_tournament         TO service_role;
GRANT EXECUTE ON FUNCTION reconcile_prize_funding_requests  TO service_role;
GRANT EXECUTE ON FUNCTION enter_prize_award                 TO service_role;
GRANT EXECUTE ON FUNCTION review_prize_award                TO service_role;
GRANT EXECUTE ON FUNCTION claim_prize_award_send            TO service_role;
GRANT EXECUTE ON FUNCTION settle_prize_award                TO service_role;
GRANT EXECUTE ON FUNCTION review_bank_account_name TO service_role;
GRANT EXECUTE ON FUNCTION self_managed_minor TO service_role;
GRANT EXECUTE ON FUNCTION assert_participant_not_self_managed_minor TO service_role;
GRANT EXECUTE ON FUNCTION assert_payer_acts_for TO service_role;
GRANT EXECUTE ON FUNCTION withdraw_prize_award TO service_role;
GRANT EXECUTE ON FUNCTION prize_payees TO service_role;
