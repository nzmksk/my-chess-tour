-- =============================================
-- #718: pay a dependent's prize to the right account (part of #705).
--
-- A prize award was always sent to the winner's own active, verified
-- player_bank_accounts row. For a minor that is wrong: a child holds no
-- account of their own here, and their guardian answers for their money. For
-- an adult helped by someone else, the danger runs the other way: the helper
-- could enter their own account and receive the player's prize.
--
-- 1. Minors (an active guardianship with basis 'minor'):
--      * set_player_bank_account refuses to save details for them
--        (MINOR_DEPENDENT, P0001). Clearing still works: it is how consent is
--        withdrawn and the data erased.
--      * their award is paid to a guardian's account. prize_payees() picks
--        which: the guardian whose active account is verified, else one who
--        has an account at all, else the earliest guardianship, then the
--        guardian's id, so the same guardian is chosen every time.
--
-- 2. Adults helped by someone ('authorised' / 'appointed') keep their own
--    player_bank_accounts row. A helper may enter it, under the financial
--    consent they recorded for the player (#717): set_player_bank_account
--    takes p_entered_by, which must be the player or someone with an active
--    guardianship of them (NOT_GUARDIAN, 42501, otherwise). The row keeps
--    entered_by, and the holder-name check (src/services/payouts/
--    bank-account.ts, #374) compares CHIP's holder name against the PLAYER's
--    name for a row someone else entered, never the typed holder, which the
--    helper chose. The guardianship row is locked FOR SHARE before the users
--    row, the order checkout (#714), consent (#717) and account claims (#720)
--    use, so a concurrent revoke_dependent either commits first or waits.
--    The old five-argument function is dropped, so existing calls resolve to
--    the new one with p_entered_by NULL (the player themselves).
--
-- 3. prize_awards.user_id stays the winner. claim_prize_award_send now snapshots
--    the PAYEE's account and records whose it is and why:
--      payee_user_id  the account holder's users row (the winner, or the guardian)
--      payee_reason   'winner' or 'guardian_of_minor'
--    Awards claimed before this migration were all paid to the winner's own
--    account, so they are backfilled as such.
--
-- prize_payees(uuid[]) answers for many winners at once, so the award lists
-- and emails read the same rule as the claim instead of copying it.
-- =============================================

CREATE TYPE prize_payee_reason AS ENUM ('winner', 'guardian_of_minor');

ALTER TABLE player_bank_accounts
  ADD COLUMN entered_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_player_bank_account_entered_by_other
    CHECK (entered_by IS DISTINCT FROM user_id);

COMMENT ON COLUMN player_bank_accounts.entered_by IS
  'Who saved these details when it was not the player: their guardian or helper. NULL means the player saved them. The holder name of such a row is checked against the player''s name.';

ALTER TABLE prize_awards
  ADD COLUMN payee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN payee_reason  prize_payee_reason;

COMMENT ON COLUMN prize_awards.payee_user_id IS
  'Whose bank account the award was sent to, snapshotted with bank_account_id when the send is claimed: the winner, or a minor winner''s guardian.';
COMMENT ON COLUMN prize_awards.payee_reason IS
  'Why the award went to that account: winner (their own) or guardian_of_minor.';

UPDATE prize_awards a
  SET payee_user_id = COALESCE(
        (SELECT b.user_id FROM player_bank_accounts b WHERE b.id = a.bank_account_id),
        a.user_id),
      payee_reason  = 'winner'
  WHERE a.bank_account_id IS NOT NULL OR a.status IN ('processing', 'paid');

-- ---- prize_payees ---------------------------------------------------------
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

-- ---- set_player_bank_account ---------------------------------------------
DROP FUNCTION set_player_bank_account(uuid, varchar, varchar, varchar, varchar);

CREATE FUNCTION set_player_bank_account(
  p_user_id        uuid,
  p_bank_code      varchar(11),
  p_bank_name      varchar(100),
  p_account_holder varchar(255),
  p_account_number varchar(50),
  p_entered_by     uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current    player_bank_accounts;
  v_row        player_bank_accounts;
  v_changed    boolean := true;
  v_entered_by uuid := NULLIF(p_entered_by, p_user_id);
  v_clear      boolean := p_bank_code IS NULL AND p_bank_name IS NULL
                          AND p_account_holder IS NULL AND p_account_number IS NULL;
BEGIN
  IF v_entered_by IS NOT NULL THEN
    PERFORM 1 FROM guardianships
      WHERE guardian_user_id = v_entered_by
        AND dependent_user_id = p_user_id
        AND status = 'active'
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_GUARDIAN: only the player or someone acting for them can set their bank details'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  PERFORM 1 FROM users
    WHERE id = p_user_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_current
    FROM player_bank_accounts
    WHERE user_id = p_user_id AND is_active;

  IF v_clear THEN
    UPDATE player_bank_accounts
      SET is_active = false
      WHERE user_id = p_user_id AND is_active;
    v_changed := FOUND;

    DELETE FROM player_bank_accounts b
      WHERE b.user_id = p_user_id
        AND NOT EXISTS (SELECT 1 FROM prize_awards a WHERE a.bank_account_id = b.id);

    UPDATE player_bank_accounts
      SET account_number = '****' || right(account_number, 4),
          redacted_at    = now()
      WHERE user_id = p_user_id AND redacted_at IS NULL;

    PERFORM record_sensitive_data_consent(p_user_id, 'financial', false, NULL, v_entered_by);
    RETURN jsonb_build_object('changed', v_changed, 'id', NULL);
  END IF;

  IF EXISTS (
    SELECT 1 FROM guardianships
    WHERE dependent_user_id = p_user_id AND status = 'active' AND basis = 'minor'
  ) THEN
    RAISE EXCEPTION 'MINOR_DEPENDENT: a minor''s prizes are paid to their guardian''s bank account'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT has_sensitive_data_consent(p_user_id, 'financial') THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED: bank details need the player''s financial data consent'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_current.id IS NOT NULL
     AND v_current.bank_code      = p_bank_code
     AND v_current.bank_name      = p_bank_name
     AND v_current.account_holder = p_account_holder
     AND v_current.account_number = p_account_number
     AND v_current.entered_by IS NOT DISTINCT FROM v_entered_by
     AND v_current.status <> 'rejected'
  THEN
    v_changed := false;
    v_row     := v_current;
  ELSE
    UPDATE player_bank_accounts
      SET is_active = false
      WHERE user_id = p_user_id AND is_active;

    INSERT INTO player_bank_accounts (
      user_id, bank_name, bank_code, account_holder, account_number, entered_by
    ) VALUES (
      p_user_id, p_bank_name, p_bank_code, p_account_holder, p_account_number, v_entered_by
    )
    RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'changed',              v_changed,
    'id',                   v_row.id,
    'bank_name',            v_row.bank_name,
    'bank_code',            v_row.bank_code,
    'account_holder',       v_row.account_holder,
    'account_number_last4', right(v_row.account_number, 4),
    'status',               v_row.status,
    'rejection_reason',     v_row.rejection_reason,
    'verified_at',          v_row.verified_at
  );
END;
$$;

-- ---- claim_prize_award_send -----------------------------------------------
-- Unchanged from 006_payment_functions.sql except that it snapshots the
-- payee's account (prize_payees) and records payee_user_id / payee_reason.
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

REVOKE EXECUTE ON FUNCTION prize_payees            FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION set_player_bank_account FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION prize_payees            TO service_role;
GRANT  EXECUTE ON FUNCTION set_player_bank_account TO service_role;
