-- =============================================
-- #611: an organizer can withdraw a prize award while it awaits review.
--
-- Until now an award entered with the wrong winner or amount could only be
-- taken back by a platform admin rejecting it, so the organizer had to reach
-- an admin outside the app.
--
-- A withdrawn award is a rejected one that the organizer rejected:
--
--   approval     = 'rejected'
--   withdrawn_at = when, withdrawn_by = who
--   reviewed_by, reviewed_at, rejection_reason stay NULL (no admin decided it)
--
-- Reusing 'rejected' means every existing rule for a live award ("not rejected
-- and not failed") already leaves a withdrawn one out: the tie-split sum in
-- enter_prize_award, uniq_live_prize_award (so the corrected award can be
-- entered for the same winner), prize_pool_position's pending_review_cents,
-- the admin review queue (approval = 'pending') and idx_prize_awards_pending_review.
-- approval_status is shared with organizations, refunds and payouts, so a new
-- enum value would leak into them.
--
-- withdraw_prize_award takes the tournament lock, then the award, the same
-- order as enter_prize_award and review_prize_award, so a withdrawal and an
-- approval of one award serialise: whichever runs second sees the first's
-- outcome. Only an award still 'pending' approval can be withdrawn. Once
-- approved its money is reserved and the send may be under way, so reversing
-- it stays an admin decision.
--
-- withdraw_prize_award refuses with:
--   P0002                              no such award in that tournament
--   PRIZE_AWARD_NOT_WITHDRAWABLE: approved   (P0001) an admin approved it
--   PRIZE_AWARD_NOT_WITHDRAWABLE: rejected   (P0001) an admin rejected it
--   PRIZE_AWARD_NOT_WITHDRAWABLE: withdrawn  (P0001) already withdrawn
--
-- review_prize_award now refuses a withdrawn award with PRIZE_AWARD_WITHDRAWN
-- instead of PRIZE_AWARD_ALREADY_REVIEWED, for an admin acting on a stale
-- page. Otherwise it is unchanged from 006_payment_functions.sql.
--
-- The audit trigger on prize_awards records the withdrawal as an UPDATE, with
-- the actor and the 'prize-award.withdraw' action from the API route.
-- =============================================

ALTER TABLE prize_awards
  ADD COLUMN withdrawn_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN withdrawn_at timestamptz,
  ADD CONSTRAINT chk_prize_award_withdrawn_shape CHECK (
    withdrawn_at IS NULL
    OR (approval = 'rejected' AND reviewed_at IS NULL AND rejection_reason IS NULL)
  ),
  ADD CONSTRAINT chk_prize_award_withdrawn_by CHECK (
    withdrawn_by IS NULL OR withdrawn_at IS NOT NULL
  );

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

REVOKE EXECUTE ON FUNCTION withdraw_prize_award FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION withdraw_prize_award TO service_role;
