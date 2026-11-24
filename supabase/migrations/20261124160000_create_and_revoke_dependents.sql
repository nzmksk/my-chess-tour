-- =============================================
-- #712: a guardian creates and manages dependents (part of #705).
--
-- A dependent is a player record with no login: a parent's child, or an
-- assisted adult whose carer acts for them. Both are a users row
-- (account_type 'managed', no auth_user_id), a player_profiles row and a
-- guardianships row. The API calls these functions with the service role,
-- after checking who the caller is; clients can't call them.
--
-- 1. users.contact_email: an optional address for an adult dependent, used for
--    notifications only. It is not users.email on purpose. users.email is the
--    sign-in identity and unique per mailbox (#286), so a guardian typing a
--    dependent's address there would stop that person from ever signing up
--    with it, and a guardian could squat anyone's address that way. Only a
--    managed account carries one; the route allows it for adult dependents.
--    anonymise_user_audit_logs keeps only allowlisted keys, so it is stripped
--    from audit history like email.
--
-- 2. create_dependent(...) inserts the three rows in one transaction and
--    returns {dependent_id, guardianship_id, reactivated}.
--    - The guardian must be a live self-managed account with a login.
--    - basis 'minor' needs a date of birth under 18 today in Malaysia
--      (Asia/Kuala_Lumpur), the same rule as self_managed_minor (#711);
--      'authorised' needs 18 or over, and records
--      authorisation_method = 'guardian_attestation': the guardian confirms
--      the player authorised them.
--    - 'appointed' is refused (BASIS_NOT_SUPPORTED) for now. The epic says an
--      appointed guardian needs proof, and there is no document upload or
--      admin review for it yet. Allowing it on the guardian's word would let
--      anyone take over an adult's record by claiming an appointment.
--    - The guardian accepts the Terms version the server passes in.
--    - Adding the same dependent again (same first name, last name and date
--      of birth, compared case-insensitively, among this guardian's managed
--      dependents) never creates a second player record. A revoked
--      guardianship is reactivated with the new relationship, basis and Terms
--      acceptance; an active one raises DEPENDENT_EXISTS.
--    - The guardian's users row is locked first, so two concurrent adds of the
--      same child can't both miss each other. enforce_guardianship_limit takes
--      the same lock, and still enforces the cap of 10 active dependents on
--      insert and on reactivation.
--
-- 3. revoke_dependent(p_guardian_user_id, p_dependent_user_id) sets the
--    guardianship to 'revoked' and stamps revoked_at. Nothing else changes: the
--    dependent's records, registrations and payments stay as they are.
--    - No active guardianship of that dependent by this guardian raises
--      DEPENDENT_NOT_FOUND, so a stranger learns nothing.
--    - A pending_payment registration for the dependent raises
--      DEPENDENT_HAS_PENDING_PAYMENT: a checkout is in flight, and the guardian
--      who started it should finish or abandon it first.
--    - Confirmed registrations for tournaments that haven't ended are not
--      cancelled; they are returned so the API can warn about them.
--
-- Errors are RAISEd with a CODE: prefix and SQLSTATE P0001, which the routes
-- map to responses.
-- =============================================

-- ---- 1. users.contact_email -------------------------------------------------
ALTER TABLE users
  ADD COLUMN contact_email varchar(255),
  ADD CONSTRAINT chk_users_contact_email_managed_only
    CHECK (contact_email IS NULL OR account_type = 'managed');

-- ---- 2. create_dependent ----------------------------------------------------
CREATE FUNCTION create_dependent(
  p_guardian_user_id uuid,
  p_first_name       text,
  p_last_name        text,
  p_date_of_birth    date,
  p_relationship     guardianship_relationship,
  p_basis            guardianship_basis,
  p_terms_version    text,
  p_gender           gender DEFAULT NULL,
  p_nationality      text DEFAULT NULL,
  p_contact_email    text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today         date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_adult_cutoff  date := (v_today - interval '18 years')::date;
  v_first_name    text := btrim(p_first_name);
  v_last_name     text := btrim(p_last_name);
  v_nationality   text := NULLIF(btrim(p_nationality), '');
  v_contact_email text := NULLIF(lower(btrim(p_contact_email)), '');
  v_method        guardianship_authorisation_method;
  v_existing      record;
  v_dependent_id  uuid;
  v_guardianship  uuid;
BEGIN
  PERFORM 1
  FROM users
  WHERE id = p_guardian_user_id
    AND account_type = 'self'
    AND auth_user_id IS NOT NULL
    AND deleted_at IS NULL
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE: only a self-managed account can add dependents'
      USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(v_first_name, '') = '' OR coalesce(v_last_name, '') = '' THEN
    RAISE EXCEPTION 'INVALID_DEPENDENT: first and last name are required'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_date_of_birth IS NULL OR p_date_of_birth > v_today THEN
    RAISE EXCEPTION 'INVALID_DEPENDENT: a date of birth on or before today is required'
      USING ERRCODE = 'P0001';
  END IF;
  IF coalesce(btrim(p_terms_version), '') = '' THEN
    RAISE EXCEPTION 'INVALID_DEPENDENT: the guardian must accept the Terms'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_basis = 'appointed' THEN
    RAISE EXCEPTION 'BASIS_NOT_SUPPORTED: an appointed guardianship needs proof and admin review, which isn''t available yet'
      USING ERRCODE = 'P0001';
  ELSIF p_basis = 'minor' THEN
    IF p_date_of_birth <= v_adult_cutoff THEN
      RAISE EXCEPTION 'BASIS_AGE_MISMATCH: basis minor needs a dependent under 18'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_contact_email IS NOT NULL THEN
      RAISE EXCEPTION 'INVALID_DEPENDENT: only an adult dependent may have a contact email'
        USING ERRCODE = 'P0001';
    END IF;
    v_method := NULL;
  ELSE
    IF p_date_of_birth > v_adult_cutoff THEN
      RAISE EXCEPTION 'BASIS_AGE_MISMATCH: basis % needs a dependent aged 18 or over', p_basis
        USING ERRCODE = 'P0001';
    END IF;
    v_method := 'guardian_attestation';
  END IF;

  SELECT g.id AS guardianship_id, g.status, u.id AS dependent_id
  INTO v_existing
  FROM guardianships g
  JOIN users u ON u.id = g.dependent_user_id
  JOIN player_profiles p ON p.user_id = u.id
  WHERE g.guardian_user_id = p_guardian_user_id
    AND u.account_type = 'managed'
    AND u.deleted_at IS NULL
    AND lower(u.first_name) = lower(v_first_name)
    AND lower(u.last_name) = lower(v_last_name)
    AND p.date_of_birth = p_date_of_birth
    AND g.status IN ('active', 'revoked')
  ORDER BY (g.status = 'active') DESC, g.created_at
  LIMIT 1
  FOR UPDATE OF g;

  IF FOUND THEN
    IF v_existing.status = 'active' THEN
      RAISE EXCEPTION 'DEPENDENT_EXISTS: this dependent is already on your account'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE guardianships
    SET status               = 'active',
        revoked_at           = NULL,
        relationship         = p_relationship,
        basis                = p_basis,
        authorisation_method = v_method,
        terms_version        = p_terms_version,
        terms_accepted_at    = now()
    WHERE id = v_existing.guardianship_id;

    UPDATE users
    SET contact_email = v_contact_email
    WHERE id = v_existing.dependent_id
      AND contact_email IS DISTINCT FROM v_contact_email;

    RETURN jsonb_build_object(
      'dependent_id', v_existing.dependent_id,
      'guardianship_id', v_existing.guardianship_id,
      'reactivated', true
    );
  END IF;

  INSERT INTO users (email, first_name, last_name, account_type, contact_email)
  VALUES (NULL, v_first_name, v_last_name, 'managed', v_contact_email)
  RETURNING id INTO v_dependent_id;

  INSERT INTO player_profiles (user_id, date_of_birth, gender, nationality)
  VALUES (v_dependent_id, p_date_of_birth, p_gender, v_nationality);

  INSERT INTO guardianships (
    guardian_user_id, dependent_user_id, relationship, basis,
    terms_version, terms_accepted_at, authorisation_method
  ) VALUES (
    p_guardian_user_id, v_dependent_id, p_relationship, p_basis,
    p_terms_version, now(), v_method
  )
  RETURNING id INTO v_guardianship;

  RETURN jsonb_build_object(
    'dependent_id', v_dependent_id,
    'guardianship_id', v_guardianship,
    'reactivated', false
  );
END;
$$;

-- ---- 3. revoke_dependent ----------------------------------------------------
CREATE FUNCTION revoke_dependent(
  p_guardian_user_id  uuid,
  p_dependent_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_today        date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_guardianship uuid;
  v_upcoming     jsonb;
BEGIN
  SELECT id INTO v_guardianship
  FROM guardianships
  WHERE guardian_user_id = p_guardian_user_id
    AND dependent_user_id = p_dependent_user_id
    AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPENDENT_NOT_FOUND: no active dependent with that id on this account'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM registrations
    WHERE user_id = p_dependent_user_id
      AND status = 'pending_payment'
  ) THEN
    RAISE EXCEPTION 'DEPENDENT_HAS_PENDING_PAYMENT: finish or abandon the dependent''s pending checkout first'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'registration_id', r.id,
           'tournament_id', t.id,
           'tournament_name', t.name,
           'start_date', t.start_date
         ) ORDER BY t.start_date, t.name), '[]'::jsonb)
  INTO v_upcoming
  FROM registrations r
  JOIN tournaments t ON t.id = r.tournament_id
  WHERE r.user_id = p_dependent_user_id
    AND r.status = 'confirmed'
    AND t.status <> 'cancelled'
    AND t.end_date >= v_today;

  UPDATE guardianships
  SET status = 'revoked',
      revoked_at = now()
  WHERE id = v_guardianship;

  RETURN jsonb_build_object(
    'guardianship_id', v_guardianship,
    'upcoming_registrations', v_upcoming
  );
END;
$$;

-- ---- Privileges -------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION create_dependent(uuid, text, text, date, guardianship_relationship, guardianship_basis, text, gender, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION revoke_dependent(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_dependent(uuid, text, text, date, guardianship_relationship, guardianship_basis, text, gender, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION revoke_dependent(uuid, uuid)
  TO service_role;
