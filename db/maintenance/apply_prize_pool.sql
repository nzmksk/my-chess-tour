-- =============================================================================
-- ONE-OFF: bring an existing database up to #523 (platform-managed prize pool)
--
-- #523 edits the base migrations in place: player_bank_accounts, prize_fundings
-- and prize_awards in 001 (and the bank columns leave player_profiles), their
-- indexes in 002, triggers, audit redaction/anonymisation, set_player_bank_account
-- and the agreement version in 003, RLS in 004, and the money functions in 007. A
-- fresh build gets all of it. 003 can't simply be re-run on a long-lived database
-- (it creates triggers), so its part is repeated below, generated from those
-- files, in one transaction. 007 is CREATE OR REPLACE throughout and IS re-run.
--
-- Order:
--   1. Run this script. It ends in ROLLBACK, so it is a dry run until that line
--      is changed to COMMIT.
--   2. Re-run db/migrations/007_payment_functions.sql in full: the prize
--      functions, the registration gate inside create_registration_with_payment
--      and start_new_payment_attempt, and settle_bank_account_verification's
--      player branch.
--   3. Deploy the app. Before step 2 the checkout route's prize_pool_blocks_
--      registration call fails, so deploy only after it.
--
-- Two things change for existing users:
--   * player_profiles.bank_name / bank_account_holder / bank_account_number are
--     DROPPED. They were free text with no SWIFT code and nothing ever consumed
--     them; they can't be registered with CHIP Send as they are. Players re-enter
--     their details in Settings, picking their bank from the list. Count what is
--     lost first:  SELECT count(*) FROM player_profiles WHERE bank_account_number IS NOT NULL;
--   * The Organizer Agreement moves to version 2026-11-18. Every organization is
--     shown the re-acceptance panel, and payouts wait until an owner accepts.
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres / service role), against
-- staging first, then production.
-- =============================================================================

BEGIN;

-- 001 -------------------------------------------------------------------------
ALTER TABLE player_profiles
  DROP COLUMN bank_name,
  DROP COLUMN bank_account_holder,
  DROP COLUMN bank_account_number;

CREATE TABLE player_bank_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bank_name            varchar(100) NOT NULL,  -- display name, derived server-side from bank_code
  bank_code            varchar(11)  NOT NULL,  -- SWIFT/BIC, e.g. MBBEMYKL
  account_holder       varchar(255) NOT NULL,
  account_number       varchar(50)  NOT NULL,  -- digits only, normalized on write
  status               bank_account_status NOT NULL DEFAULT 'pending',
  chip_bank_account_id bigint,                 -- CHIP /send/bank_accounts id
  verified_at          timestamptz,
  rejection_reason     text,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_player_bank_account_number_digits CHECK (account_number ~ '^[0-9]{5,20}$'),
  CONSTRAINT chk_player_bank_code_format  CHECK (bank_code ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  CONSTRAINT chk_player_bank_verified_at  CHECK (verified_at IS NULL OR status = 'verified')
);

CREATE TABLE prize_fundings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id       uuid NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  funder_name         varchar(255) NOT NULL,
  funder_email        varchar(255) NOT NULL,
  amount_cents        integer NOT NULL,
  status              payment_status NOT NULL DEFAULT 'pending',
  chip_transaction_id varchar(255),           -- CHIP purchase id
  checkout_url        text,                   -- forwarded to the funder
  payment_method      varchar(50),
  payment_id          uuid REFERENCES payments(id) ON DELETE RESTRICT,
  paid_at             timestamptz,
  created_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_prize_funding_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT chk_prize_funding_paid_shape
    CHECK ((status = 'paid') = (payment_id IS NOT NULL AND paid_at IS NOT NULL))
);

CREATE TABLE prize_awards (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id            uuid NOT NULL REFERENCES tournaments(id)   ON DELETE RESTRICT,
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  -- The winner. SET NULL keeps the money record if the account is deleted;
  -- an award with no winner can't be sent (claim_prize_award_send).
  user_id                  uuid REFERENCES users(id) ON DELETE SET NULL,
  -- SET NULL, not RESTRICT as on payouts: deleting a player's account cascades
  -- to their bank accounts, and a paid prize must not block that. The money
  -- record survives in payments and on this row.
  bank_account_id          uuid REFERENCES player_bank_accounts(id) ON DELETE SET NULL,
  -- Which declared prize this is: a category name with its place, or a
  -- special prize's name with place NULL. Checked against tournaments.prizes.
  category                 varchar(255) NOT NULL,
  place                    varchar(50),
  amount_cents             integer NOT NULL,
  settled_amount_cents     integer,
  approval                 approval_status NOT NULL DEFAULT 'pending',
  status                   payout_status   NOT NULL DEFAULT 'pending',
  entered_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  entered_at               timestamptz NOT NULL DEFAULT now(),
  reviewed_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at              timestamptz,
  rejection_reason         text,
  chip_send_instruction_id bigint,
  chip_send_limit_id       bigint,
  chip_receipt_url         text,
  failure_reason           text,
  payment_id               uuid REFERENCES payments(id) ON DELETE RESTRICT,
  processed_at             timestamptz,  -- set once by settle_prize_award; the idempotency marker
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_prize_award_amount_positive CHECK (amount_cents > 0),
  CONSTRAINT chk_prize_award_reviewed_at     CHECK (reviewed_at IS NULL OR reviewed_at >= entered_at),
  CONSTRAINT chk_prize_award_paid_shape      CHECK (status <> 'paid' OR (payment_id IS NOT NULL AND settled_amount_cents IS NOT NULL)),
  -- Nothing moves before an admin has approved it.
  CONSTRAINT chk_prize_award_moves_approved  CHECK (status = 'pending' OR approval = 'approved')
);

-- 002 -------------------------------------------------------------------------
CREATE UNIQUE INDEX uniq_active_bank_account_per_player
  ON player_bank_accounts (user_id) WHERE is_active;
CREATE INDEX idx_player_bank_accounts_chip_id ON player_bank_accounts (chip_bank_account_id)
  WHERE chip_bank_account_id IS NOT NULL;

-- Prize fundings
-- One CHIP purchase per contribution, so webhook correlation can't fan out.
CREATE UNIQUE INDEX uniq_prize_fundings_chip_transaction
  ON prize_fundings (chip_transaction_id) WHERE chip_transaction_id IS NOT NULL;
CREATE INDEX idx_prize_fundings_tournament ON prize_fundings (tournament_id, created_at);

-- Prize awards
CREATE UNIQUE INDEX uniq_prize_awards_chip_send_instruction
  ON prize_awards (chip_send_instruction_id) WHERE chip_send_instruction_id IS NOT NULL;
-- The same winner can't hold the same prize twice. A tie splits a prize between
-- DIFFERENT players, which this allows; enter_prize_award caps the split at the
-- declared amount. Rejected and failed awards fall out, so the winner can be
-- entered again.
CREATE UNIQUE INDEX uniq_live_prize_award
  ON prize_awards (tournament_id, category, COALESCE(place, ''), user_id)
  WHERE approval <> 'rejected' AND status <> 'failed';
CREATE INDEX idx_prize_awards_tournament     ON prize_awards (tournament_id, entered_at);
CREATE INDEX idx_prize_awards_user           ON prize_awards (user_id);
CREATE INDEX idx_prize_awards_pending_review ON prize_awards (entered_at) WHERE approval = 'pending';
CREATE INDEX idx_prize_awards_in_flight      ON prize_awards (status, updated_at) WHERE status = 'processing';

-- 003 -------------------------------------------------------------------------
CREATE TRIGGER set_updated_at BEFORE UPDATE ON player_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON prize_fundings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON prize_awards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON player_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON prize_fundings
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON prize_awards
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

CREATE OR REPLACE FUNCTION audit_trigger_func()
RETURNS TRIGGER AS $$
DECLARE
  v_record_id  text;
  v_org_id     uuid;
  v_old        jsonb;
  v_new        jsonb;
  v_changed_by uuid;
  v_pk_col     text := COALESCE(TG_ARGV[0], 'id');
BEGIN
  -- Build row snapshots
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := row_to_json(OLD)::jsonb;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := row_to_json(NEW)::jsonb;
  END IF;

  -- Extract record_id from the appropriate column
  v_record_id := COALESCE(v_new, v_old) ->> v_pk_col;

  -- Redact sensitive columns before the snapshot is persisted. Done after
  -- record_id extraction so a redacted column can never be the PK. Without this
  -- every bank-account write is copied verbatim into audit_logs, which is
  -- retained far longer than the row itself.
  -- What to redact per table lives in redact_audit_snapshot, which the
  -- maintenance scrub calls too. Unlisted tables pass through untouched.
  v_old := redact_audit_snapshot(TG_TABLE_NAME, v_old);
  v_new := redact_audit_snapshot(TG_TABLE_NAME, v_new);

  -- Resolve organization_id based on source table
  IF TG_TABLE_NAME = 'organizations' THEN
    v_org_id := v_record_id::uuid;
  ELSIF TG_TABLE_NAME IN (
    'organization_memberships', 'tournaments', 'payments', 'payouts',
    'organization_bank_accounts', 'organization_documents', 'prize_awards'
  ) THEN
    v_org_id := (COALESCE(v_new, v_old) ->> 'organization_id')::uuid;
  ELSIF TG_TABLE_NAME IN ('registrations', 'prize_fundings') THEN
    SELECT t.organization_id INTO v_org_id
    FROM tournaments t
    WHERE t.id = (COALESCE(v_new, v_old) ->> 'tournament_id')::uuid;
  ELSIF TG_TABLE_NAME = 'refunds' THEN
    SELECT t.organization_id INTO v_org_id
    FROM registrations r JOIN tournaments t ON t.id = r.tournament_id
    WHERE r.id = (COALESCE(v_new, v_old) ->> 'registration_id')::uuid;
  END IF;
  -- users, player_profiles, player_bank_accounts, user_global_roles → v_org_id stays NULL

  -- changed_by is a FK to users(id), but the JWT carries the AUTH id, so it has
  -- to be resolved through users.auth_user_id. Reading the claim directly would
  -- write an id that only coincidentally resolves while self-signup keeps the
  -- two equal, and would violate the FK the moment they diverge.
  -- Not app_user_id(): this trigger also fires under the service role and from
  -- SECURITY DEFINER functions, where auth.uid() is NULL — reading the claim
  -- keeps attribution working in those paths, and NULL means "no user acted".
  SELECT u.id INTO v_changed_by
  FROM public.users u
  WHERE u.auth_user_id =
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;

  INSERT INTO public.audit_logs (table_name, record_id, action, changed_by, organization_id, context, old_data, new_data)
  VALUES (
    TG_TABLE_NAME,
    v_record_id,
    TG_OP,
    v_changed_by,
    v_org_id,
    COALESCE(NULLIF(current_setting('app.audit_context', true), ''), 'trigger'),
    v_old,
    v_new
  );

  RETURN COALESCE(NEW, OLD);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'audit_trigger_func failed on % (%): % (SQLSTATE: %)', TG_TABLE_NAME, TG_OP, SQLERRM, SQLSTATE
      USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION redact_audit_snapshot(p_table_name text, p_data jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_table_name
    WHEN 'player_profiles' THEN
      redact_jsonb_filenames(
        redact_jsonb_columns(p_data, ARRAY['bank_account_number']),
        ARRAY['oku_document_path'])
    WHEN 'organization_bank_accounts' THEN
      redact_jsonb_columns(p_data, ARRAY['account_number'])
    WHEN 'player_bank_accounts' THEN
      redact_jsonb_columns(p_data, ARRAY['account_number'])
    WHEN 'organization_documents' THEN
      redact_jsonb_filenames(p_data, ARRAY['storage_path', 'original_filename'])
    ELSE p_data
  END;
$$;

CREATE OR REPLACE FUNCTION anonymise_user_audit_logs(p_user_id uuid)
RETURNS TABLE (snapshots_anonymised integer, changed_by_cleared integer)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  c_keep_users           constant text[] := ARRAY[
    'id', 'is_verified', 'verified_at', 'terms_version', 'terms_accepted_at',
    'created_at', 'updated_at', 'deleted_at'
  ];
  c_keep_player_profiles constant text[] := ARRAY['user_id', 'created_at', 'updated_at'];
  -- The account number is already masked to its last 4 on the way in; the
  -- holder's name and the bank are what is left to strip.
  c_keep_player_bank     constant text[] := ARRAY[
    'id', 'user_id', 'status', 'is_active', 'verified_at', 'created_at', 'updated_at'
  ];
  c_financial            constant text[] := ARRAY[
    'payments', 'refunds', 'payouts', 'registrations', 'prize_awards', 'prize_fundings'
  ];
  v_bank_rows            integer;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'USER_ID_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'USER_NOT_DELETED'
      USING ERRCODE = 'P0001',
            DETAIL  = 'Delete the users row, or set deleted_at, before anonymising its audit history.';
  END IF;

  UPDATE audit_logs a
  SET old_data = anonymise_jsonb_except(a.old_data, k.keep),
      new_data = anonymise_jsonb_except(a.new_data, k.keep)
  FROM (VALUES ('users', c_keep_users), ('player_profiles', c_keep_player_profiles)) AS k(table_name, keep)
  WHERE a.table_name = k.table_name
    AND a.record_id  = p_user_id::text
    AND (   a.old_data IS DISTINCT FROM anonymise_jsonb_except(a.old_data, k.keep)
         OR a.new_data IS DISTINCT FROM anonymise_jsonb_except(a.new_data, k.keep));
  GET DIAGNOSTICS snapshots_anonymised = ROW_COUNT;

  -- A player bank account's audit rows are keyed by the account's own id, so
  -- they are found by the owner recorded inside the snapshot.
  UPDATE audit_logs a
  SET old_data = anonymise_jsonb_except(a.old_data, c_keep_player_bank),
      new_data = anonymise_jsonb_except(a.new_data, c_keep_player_bank)
  WHERE a.table_name = 'player_bank_accounts'
    AND COALESCE(a.new_data, a.old_data) ->> 'user_id' = p_user_id::text
    AND (   a.old_data IS DISTINCT FROM anonymise_jsonb_except(a.old_data, c_keep_player_bank)
         OR a.new_data IS DISTINCT FROM anonymise_jsonb_except(a.new_data, c_keep_player_bank));
  GET DIAGNOSTICS v_bank_rows = ROW_COUNT;
  snapshots_anonymised := snapshots_anonymised + v_bank_rows;

  UPDATE audit_logs
  SET changed_by = NULL
  WHERE changed_by = p_user_id
    AND table_name <> ALL (c_financial);
  GET DIAGNOSTICS changed_by_cleared = ROW_COUNT;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION set_player_bank_account(
  p_user_id        uuid,
  p_bank_code      varchar(11),
  p_bank_name      varchar(100),
  p_account_holder varchar(255),
  p_account_number varchar(50)
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current player_bank_accounts;
  v_row     player_bank_accounts;
  v_changed boolean := true;
  v_clear   boolean := p_bank_code IS NULL AND p_bank_name IS NULL
                       AND p_account_holder IS NULL AND p_account_number IS NULL;
BEGIN
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
    RETURN jsonb_build_object('changed', FOUND, 'id', NULL);
  END IF;

  IF FOUND
     AND v_current.bank_code      = p_bank_code
     AND v_current.bank_name      = p_bank_name
     AND v_current.account_holder = p_account_holder
     AND v_current.account_number = p_account_number
     AND v_current.status <> 'rejected'
  THEN
    v_changed := false;
    v_row     := v_current;
  ELSE
    UPDATE player_bank_accounts
      SET is_active = false
      WHERE user_id = p_user_id AND is_active;

    INSERT INTO player_bank_accounts (
      user_id, bank_name, bank_code, account_holder, account_number
    ) VALUES (
      p_user_id, p_bank_name, p_bank_code, p_account_holder, p_account_number
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

CREATE OR REPLACE FUNCTION current_organizer_agreement_version()
RETURNS varchar(20)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '2026-11-18'::varchar(20);
$$;

REVOKE EXECUTE ON FUNCTION set_player_bank_account FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION set_player_bank_account TO service_role;

-- 004 -------------------------------------------------------------------------
ALTER TABLE player_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE prize_fundings ENABLE ROW LEVEL SECURITY;
ALTER TABLE prize_awards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can view own bank accounts"
ON player_bank_accounts FOR SELECT
USING (can_act_for(user_id));

CREATE POLICY "Platform admins full access to player bank accounts"
ON player_bank_accounts FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

REVOKE UPDATE, INSERT, DELETE ON player_bank_accounts FROM anon, authenticated;

CREATE POLICY "Org payout viewers can view prize fundings"
ON prize_fundings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM tournaments t
    WHERE t.id = prize_fundings.tournament_id
      AND has_org_permission(app_user_id(), t.organization_id, 'payout.view')
  )
);

CREATE POLICY "Platform admins full access to prize fundings"
ON prize_fundings FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

REVOKE UPDATE, INSERT, DELETE ON prize_fundings FROM anon, authenticated;

CREATE POLICY "Org payout viewers can view prize awards"
ON prize_awards FOR SELECT
USING (has_org_permission(app_user_id(), organization_id, 'payout.view'));

CREATE POLICY "Winners can view own prize awards"
ON prize_awards FOR SELECT
USING (can_act_for(user_id));

CREATE POLICY "Platform admins full access to prize awards"
ON prize_awards FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

REVOKE UPDATE, INSERT, DELETE ON prize_awards FROM anon, authenticated;

ROLLBACK;
