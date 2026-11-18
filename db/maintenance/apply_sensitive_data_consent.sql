-- =============================================================================
-- ONE-OFF: bring an existing database up to #451 (separate consent for health
-- and financial data)
--
-- #451 edits the base migrations in place: sensitive_data_consents in 001, its
-- index in 002, has_sensitive_data_consent / record_sensitive_data_consent /
-- the immutability trigger and the consent gate in set_player_bank_account in
-- 003, RLS in 004, and the consent check on the oku-documents upload policy in
-- 005. A fresh build gets all of it. 003 can't simply be re-run on a
-- long-lived database (it creates triggers), so everything this issue adds is
-- repeated below, generated from those files, in one transaction.
--
-- It ends in ROLLBACK, so it is a dry run until that line is changed to COMMIT.
--
-- Order:
--   1. Run this script with COMMIT.
--   2. Deploy the app. The new settings UI records consent through
--      record_sensitive_data_consent, which doesn't exist before step 1. The
--      OLD app keeps working after step 1 for everything except saving bank
--      details and uploading OKU cards, which now need a consent the old UI
--      never asks for, so deploy straight after.
--
-- Data saved before this has NO consent on record, and this script does not
-- invent any: a consent row is evidence that a person ticked a box, and nobody
-- ticked one. Existing bank details and OKU cards stay as they are. The NOTICE
-- at the end counts them, so whoever runs this can decide what to do with
-- them: ask those players to re-save their details and re-upload with the new
-- checkbox, or clear them. Saving or re-uploading through the new UI records
-- consent.
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres / service role), against
-- staging first, then production.
-- =============================================================================

BEGIN;

-- 001 -------------------------------------------------------------------------
-- =============================================
-- SENSITIVE DATA CONSENTS (#451)
-- Separate, explicit consent for the two kinds of data that need more than
-- the Terms of Service: health data (an OKU card and the disability status it
-- proves) and financial data (a player's bank details). Accepting the Terms at
-- signup is not consent to either. Each is asked for on its own, at the moment
-- the data is collected, and recorded here.
--
-- An append-only log, not a pair of columns: every grant and every withdrawal
-- is its own row, so "what had this person agreed to on date X, and to which
-- wording?" can be answered after the fact. A user's current position for a
-- category is their newest row (highest id; created_at can tie inside one
-- transaction). No row at all means never asked.
--
-- version is the wording the user was shown, written server-side from
-- src/lib/reference/legal.ts and never from the request body. A withdrawal
-- carries none: it withdraws whatever was granted.
--
-- Written only by record_sensitive_data_consent (003); clients cannot write
-- (004) and no one can UPDATE a row (guard_consent_immutable, 003).
-- =============================================
CREATE TYPE sensitive_data_category AS ENUM ('health', 'financial');

CREATE TABLE sensitive_data_consents (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   sensitive_data_category NOT NULL,
  granted    boolean NOT NULL,
  version    varchar(20),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A grant names the wording agreed to; a withdrawal names none.
  CONSTRAINT chk_consent_version CHECK (granted = (version IS NOT NULL))
);

-- 002 -------------------------------------------------------------------------
-- Sensitive data consents: a user's current position for a category is their
-- newest row, read by has_sensitive_data_consent on every bank-detail save and
-- OKU upload.
CREATE INDEX idx_sensitive_data_consents_latest
  ON sensitive_data_consents (user_id, category, id DESC);

-- 003 -------------------------------------------------------------------------
-- =============================================
-- SENSITIVE DATA CONSENT (#451)
-- has_sensitive_data_consent answers "may we hold this kind of data for this
-- user right now?": true only when their newest row for the category is a
-- grant. Deliberately NOT SECURITY DEFINER, so it sees only what the caller's
-- RLS allows: the storage policy on oku-documents calls it as the uploading
-- user, who can read their own rows (004), and the service-role functions
-- bypass RLS. As a definer function anyone could ask it about anyone, and
-- whether a stranger has agreed to share health data is itself health data.
--
-- record_sensitive_data_consent is the only write path for the log. It locks
-- the users row (as set_player_bank_account does, so a save and a withdrawal
-- cannot interleave) and writes a row only when the position changes:
-- re-granting the same wording, or withdrawing what was never granted, is a
-- no-op that returns false. A grant of NEWER wording is written, so the log
-- shows the user agreed to it. p_version must come from legal.ts on the
-- server, never the request.
-- =============================================
CREATE OR REPLACE FUNCTION has_sensitive_data_consent(
  p_user_id  uuid,
  p_category sensitive_data_category
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT granted
      FROM sensitive_data_consents
      WHERE user_id = p_user_id AND category = p_category
      ORDER BY id DESC
      LIMIT 1
  ), false);
$$;

CREATE OR REPLACE FUNCTION record_sensitive_data_consent(
  p_user_id  uuid,
  p_category sensitive_data_category,
  p_granted  boolean,
  p_version  varchar(20) DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest sensitive_data_consents;
BEGIN
  IF p_granted IS NULL THEN
    RAISE EXCEPTION 'p_granted is required' USING ERRCODE = '22023';
  END IF;

  IF p_granted AND p_version IS NULL THEN
    RAISE EXCEPTION 'a consent grant must name the version agreed to'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM users
    WHERE id = p_user_id AND deleted_at IS NULL
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_latest
    FROM sensitive_data_consents
    WHERE user_id = p_user_id AND category = p_category
    ORDER BY id DESC
    LIMIT 1;

  IF p_granted THEN
    IF FOUND AND v_latest.granted AND v_latest.version = p_version THEN
      RETURN false;
    END IF;
  ELSIF NOT FOUND OR NOT v_latest.granted THEN
    RETURN false;
  END IF;

  INSERT INTO sensitive_data_consents (user_id, category, granted, version)
    VALUES (p_user_id, p_category, p_granted,
            CASE WHEN p_granted THEN p_version END);

  RETURN true;
END;
$$;

-- A consent row is evidence. Correcting one would rewrite what the user agreed
-- to; a change of mind is a new row. ON DELETE CASCADE from users still works:
-- this guards UPDATE only.
CREATE OR REPLACE FUNCTION guard_consent_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'sensitive_data_consents rows are immutable; record a new grant or withdrawal instead'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER guard_consent_immutable
  BEFORE UPDATE ON sensitive_data_consents
  FOR EACH ROW EXECUTE FUNCTION guard_consent_immutable();

-- =============================================
-- SET PLAYER BANK ACCOUNT
-- The ONLY write path for player_bank_accounts (004_rls.sql revokes client
-- writes), and set_organization_bank_account for a person: supersede rather
-- than update, under a lock on the users row, with the same no-op rule for an
-- unchanged 'verified' or 'pending' row and the same masked return.
--
-- Clearing (all-NULL details) deactivates the active row and inserts nothing,
-- returning {"changed": true, "id": null}. A prize award that already
-- snapshotted the old account keeps it; one not yet sent waits for a new one.
--
-- Bank details are held only with the player's financial-data consent (#451),
-- so saving them without a current grant is refused with CONSENT_REQUIRED.
-- The route records the grant first, from the checkbox the player ticked.
-- Clearing is how a player withdraws that consent, so it records the
-- withdrawal in the same transaction: there is no moment where the log says
-- withdrawn while the details are still active, or the reverse.
-- =============================================
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
    v_changed := FOUND;
    PERFORM record_sensitive_data_consent(p_user_id, 'financial', false);
    RETURN jsonb_build_object('changed', v_changed, 'id', NULL);
  END IF;

  IF NOT has_sensitive_data_consent(p_user_id, 'financial') THEN
    RAISE EXCEPTION 'CONSENT_REQUIRED: bank details need the player''s financial data consent'
      USING ERRCODE = 'P0001';
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

REVOKE EXECUTE ON FUNCTION record_sensitive_data_consent   FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_sensitive_data_consent   TO service_role;
-- set_player_bank_account keeps its existing grants: CREATE OR REPLACE with the
-- same signature does not reset them.

-- 004 -------------------------------------------------------------------------
ALTER TABLE sensitive_data_consents ENABLE ROW LEVEL SECURITY;

-- =============================================
-- SENSITIVE DATA CONSENTS (#451)
-- A user can read their own consent history (and has_sensitive_data_consent,
-- run as the uploading user by the oku-documents storage policy, depends on
-- that). Platform admins can read everyone's, to answer a PDPA access request
-- or a complaint. No one writes from a client: record_sensitive_data_consent
-- is the only write path, and a client-inserted grant would be consent the
-- user never gave.
-- =============================================
CREATE POLICY "Users can view own sensitive data consents"
ON sensitive_data_consents FOR SELECT
USING (can_act_for(user_id));

CREATE POLICY "Platform admins can view sensitive data consents"
ON sensitive_data_consents FOR SELECT
USING (has_global_permission(app_user_id(), 'platform.manage'));

REVOKE UPDATE, INSERT, DELETE ON sensitive_data_consents FROM anon, authenticated;

-- 005 -------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can upload own OKU document" ON storage.objects;

-- Owner can upload their own OKU document, and only once they have given
-- separate consent to the processing of their health data (#451). The card is
-- health data the moment it lands in this bucket, before any API route sees
-- it, so the consent check has to sit here rather than in POST
-- /api/v1/profile/oku alone. has_sensitive_data_consent runs as the uploader,
-- who can read their own consent rows (004_rls.sql).
CREATE POLICY "Users can upload own OKU document"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'oku-documents'
  AND (storage.foldername(name))[1] = 'users'
  AND (storage.foldername(name))[2] = app_user_id()::text
  AND has_sensitive_data_consent(app_user_id(), 'health')
);

-- Data held before this rollout, with no consent on record -----------------
DO $$
DECLARE
  v_bank integer;
  v_oku  integer;
BEGIN
  SELECT count(*) INTO v_bank FROM player_bank_accounts WHERE is_active;
  SELECT count(*) INTO v_oku  FROM player_profiles WHERE oku_document_path IS NOT NULL;
  RAISE NOTICE 'Held without recorded consent: % active player bank account(s), % OKU card(s)',
    v_bank, v_oku;
END;
$$;

ROLLBACK;
