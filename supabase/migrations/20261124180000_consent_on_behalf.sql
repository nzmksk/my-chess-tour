-- =============================================
-- #717: a guardian or helper records sensitive-data consent for the player
-- they act for (part of #705).
--
-- #451's consent log recorded consent only by the data subject. A dependent
-- has no login, so they can't consent themselves, and the OKU upload policy
-- checked the uploader's own folder and the uploader's own consent, so a
-- guardian couldn't upload a dependent's card either.
--
-- 1. sensitive_data_consents gets two columns:
--      granted_by       who recorded the row, when it wasn't the player.
--                       NULL means the player recorded it themselves, which
--                       is true of every existing row, so nothing is
--                       backfilled. user_id stays the data subject.
--      on_behalf_basis  the guardianship basis the row was recorded under,
--                       which says which wording was agreed to:
--                         minor       the guardian consents on the child's
--                                     behalf;
--                         authorised  the helper confirms that the player
--                                     agreed;
--                         appointed   the appointed guardian consents on the
--                                     adult's behalf.
--                       Set exactly when granted_by is. The guardianship row
--                       could later be reactivated with another basis, so the
--                       log keeps its own copy.
--    No ON DELETE action on granted_by: rows are immutable (#451), and the
--    record of who agreed must not change. Guardianships are ON DELETE
--    RESTRICT, so a guardian's users row isn't hard-deleted anyway.
--
-- 2. record_sensitive_data_consent takes p_recorded_by (default NULL, the
--    player themselves). Anyone else needs an active guardianship of the
--    player. This is the same rule can_act_for() applies to a session; these
--    functions run as the service role, where app_user_id() is NULL, so the
--    rule is checked directly against the named actor. The guardianship row
--    is locked FOR SHARE, so a concurrent revoke_dependent either commits
--    first (and this raises NOT_GUARDIAN, 42501) or waits until this commits.
--    A withdrawal recorded by a guardian names them too. The old
--    four-argument function is dropped rather than overloaded, so every
--    existing call (set_player_bank_account's withdrawal among them) resolves
--    to the new one with the defaults.
--
-- 3. has_sensitive_data_consent is unchanged. It is SECURITY INVOKER, so a
--    client sees only the rows the "Users can view own sensitive data
--    consents" policy allows, and that policy is can_act_for(user_id)
--    (#707). A guardian asking about their dependent gets the answer, and a
--    stranger gets false. Service-role callers bypass RLS as before.
--
-- 4. OKU storage policies: the owner check becomes can_act_for(<path owner>)
--    and the consent check reads the data subject's consent, not the
--    uploader's. The folder segment is cast to uuid only inside a CASE, since
--    SQL doesn't promise to evaluate AND operands in order and a non-uuid
--    folder name must be refused, not raise. A guardian can also read their
--    dependent's card, like the owner.
--
-- Admin OKU review is unchanged. Withdrawing consent still deletes the data;
-- the API does that for a dependent the same way as for the player.
-- =============================================

-- ---- 1. columns -------------------------------------------------------------
ALTER TABLE sensitive_data_consents
  ADD COLUMN granted_by      uuid REFERENCES users(id),
  ADD COLUMN on_behalf_basis guardianship_basis,
  ADD CONSTRAINT chk_consent_on_behalf
    CHECK ((granted_by IS NULL) = (on_behalf_basis IS NULL)),
  ADD CONSTRAINT chk_consent_granted_by_not_subject
    CHECK (granted_by IS DISTINCT FROM user_id);

CREATE INDEX idx_sensitive_data_consents_granted_by
  ON sensitive_data_consents (granted_by)
  WHERE granted_by IS NOT NULL;

COMMENT ON COLUMN sensitive_data_consents.granted_by IS
  'Who recorded this row when it was not the data subject (user_id): their guardian or helper. NULL means the player recorded it themselves.';
COMMENT ON COLUMN sensitive_data_consents.on_behalf_basis IS
  'The guardianship basis granted_by acted under, which names the wording agreed to. Set exactly when granted_by is.';

-- ---- 2. record_sensitive_data_consent ---------------------------------------
DROP FUNCTION record_sensitive_data_consent(uuid, sensitive_data_category, boolean, varchar);

CREATE FUNCTION record_sensitive_data_consent(
  p_user_id     uuid,
  p_category    sensitive_data_category,
  p_granted     boolean,
  p_version     varchar(20) DEFAULT NULL,
  p_recorded_by uuid        DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest      sensitive_data_consents;
  v_recorded_by uuid := NULLIF(p_recorded_by, p_user_id);
  v_basis       guardianship_basis;
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

  IF v_recorded_by IS NOT NULL THEN
    SELECT basis INTO v_basis
      FROM guardianships
      WHERE guardian_user_id = v_recorded_by
        AND dependent_user_id = p_user_id
        AND status = 'active'
      FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'NOT_GUARDIAN: only the player or someone acting for them can record their consent'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT * INTO v_latest
    FROM sensitive_data_consents
    WHERE user_id = p_user_id AND category = p_category
    ORDER BY id DESC
    LIMIT 1;

  IF p_granted THEN
    IF FOUND AND v_latest.granted AND v_latest.version = p_version
       AND v_latest.granted_by IS NOT DISTINCT FROM v_recorded_by THEN
      RETURN false;
    END IF;
  ELSIF NOT FOUND OR NOT v_latest.granted THEN
    RETURN false;
  END IF;

  INSERT INTO sensitive_data_consents
      (user_id, category, granted, version, granted_by, on_behalf_basis)
    VALUES (p_user_id, p_category, p_granted,
            CASE WHEN p_granted THEN p_version END,
            v_recorded_by, v_basis);

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION record_sensitive_data_consent FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION record_sensitive_data_consent TO service_role;

-- ---- 4. OKU storage policies ------------------------------------------------
DROP POLICY "Users can upload own OKU document" ON storage.objects;
DROP POLICY "OKU documents readable by owner or admin" ON storage.objects;

CREATE POLICY "Players and those acting for them can upload an OKU document"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'oku-documents'
  AND (storage.foldername(name))[1] = 'users'
  AND CASE
        WHEN (storage.foldername(name))[2]
             ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN can_act_for(((storage.foldername(name))[2])::uuid)
             AND has_sensitive_data_consent(((storage.foldername(name))[2])::uuid, 'health')
        ELSE false
      END
);

CREATE POLICY "OKU documents readable by those acting for the player or admin"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'oku-documents'
  AND (
    CASE
      WHEN (storage.foldername(name))[2]
           ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      THEN can_act_for(((storage.foldername(name))[2])::uuid)
      ELSE false
    END
    OR has_global_permission(app_user_id(), 'platform.manage')
  )
);
