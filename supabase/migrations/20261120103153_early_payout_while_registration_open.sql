-- =============================================
-- EARLY PAYOUT WHILE REGISTRATION IS OPEN (#663)
-- An organizer may now request an early payout while registration is still
-- open. Their costs (venue deposits, arbiters) fall due before the event,
-- often before entries close, so waiting for the close helped no one.
-- Everything that makes an advance safe is unchanged: the 50% cap is taken on
-- net revenue at the time of the request (live refunds already count against
-- it), there are at most two, a platform admin approves each one, and the
-- Organizer Agreement makes any shortfall repayable (clause 8).
--
-- The only change is that the registration_open refusal is gone.
-- request_early_payout, review_payout_request and the payout overview all call
-- this function, so all three follow.
-- =============================================

-- =============================================
-- EARLY PAYOUT PROBLEM
-- Why an early payout cannot be requested (or approved) for this tournament right
-- now, or NULL if it can. One definition shared by request_early_payout,
-- review_payout_request and the organizer's payout overview, so the dashboard
-- explains a refusal before the organizer hits it. In order:
--
--   tournament_not_found, tournament_cancelled, tournament_not_published
--   beneficiary_set          third-party payouts are final-only: the organizing org
--                            would owe the claw-back on money that went elsewhere
--   cancellation_pending, refund_pending      (tournament_payout_block_reason)
--   organization_not_approved, entity_type_missing, agreement_not_current,
--   bank_account_not_verified                 (payout_recipient_problem)
--   early_payout_limit_reached   both request_seq slots are held
--   early_payout_in_flight       another early request is awaiting review or in flight
--   nothing_payable_early        the cap is below MIN_PAYOUT_CENTS
--
-- Registration may still be open (#663).
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

REVOKE EXECUTE ON FUNCTION early_payout_problem FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION early_payout_problem TO service_role;
