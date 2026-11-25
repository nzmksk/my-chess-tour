-- =============================================
-- #721: a minor dependent turns 18 (part of #705).
--
-- A guardian's authority on the 'minor' basis ends at 18. The player is then
-- an adult with capacity, and either takes the record over (#720, account
-- claiming) or claims it and invites the guardian back as a helper on their
-- own authorisation (#719).
--
-- Decisions (#721 asked for them):
--   * From the 18th birthday (Asia/Kuala_Lumpur, as for every age rule here)
--     the guardian can only VIEW the record, start or resend the handover, or
--     end the guardianship. No new registrations or payments, and no consent
--     recorded on the player's behalf. The API refuses profile, consent and
--     OKU changes the same way.
--   * That lasts for a 30-day grace period, so the handover can be arranged.
--     The scheduled job passes the length in (src/lib/guardianship/age-out.ts
--     holds the constants the app shows).
--   * When the grace period ends, the guardianship is revoked: the guardian's
--     access ends like any other revocation. A guardianship with a pending,
--     unexpired handover claim is left until the claim is accepted (it then
--     becomes 'claimed') or lapses, so a handover in flight isn't cut off.
--     Registrations, payments and history stay on the player's record.
--
-- 1. minor_guardianship_aged_out(basis, date_of_birth): the one test, true when
--    a 'minor'-basis guardianship's dependent is 18 or over today.
--
-- 2. assert_payer_acts_for (checkout, #714) refuses an aged-out minor
--    guardianship with AGED_OUT (42501, like NOT_GUARDIAN). It runs inside
--    create_registration_with_payment and start_new_payment_attempt, so a new
--    registration and a fresh payment attempt are both refused. Otherwise
--    unchanged from 20261124170000_register_a_dependent.sql.
--
-- 3. record_sensitive_data_consent refuses a GRANT recorded by a guardian whose
--    minor-basis authority has aged out (AGED_OUT, 42501). A withdrawal is still
--    recorded: withdrawing deletes data, which is never refused. Otherwise
--    unchanged from 20261124180000_consent_on_behalf.sql.
--
-- 4. guardianship_age_out_notices: which notice went out for which
--    guardianship, so the daily job emails each stage once:
--      upcoming   the 18th birthday is within the notice window
--      turned_18  the birthday has passed; the grace period is running
--      ended      the grace period is over and the guardianship was revoked
--    Service role only: RLS on, no policies, no client grants.
--
-- 5. claim_guardianship_age_out_notices(notice_days, grace_days) records and
--    returns the upcoming / turned_18 notices due today, in one INSERT ...
--    ON CONFLICT DO NOTHING, so two overlapping runs can't both send one.
--    end_aged_out_minor_guardianships(grace_days) revokes the guardianships
--    whose grace period is over and returns them, with their 'ended' notice
--    recorded. Locks follow the established order: the dependent's pending
--    claim, then the guardianship.
-- =============================================

-- ---- 1. the test -----------------------------------------------------------
CREATE OR REPLACE FUNCTION minor_guardianship_aged_out(
  p_basis         guardianship_basis,
  p_date_of_birth date
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_basis = 'minor'
     AND p_date_of_birth IS NOT NULL
     AND p_date_of_birth <=
         ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date;
$$;

-- ---- 2. checkout -------------------------------------------------------------
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

-- ---- 3. consent ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_sensitive_data_consent(
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

    IF p_granted AND minor_guardianship_aged_out(
         v_basis,
         (SELECT date_of_birth FROM player_profiles WHERE user_id = p_user_id)
       ) THEN
      RAISE EXCEPTION 'AGED_OUT: the player has turned 18 and gives their own consent'
        USING ERRCODE = '42501';
    END IF;
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
    IF FOUND AND v_latest.granted AND v_latest.version = p_version
       AND v_latest.granted_by IS NOT DISTINCT FROM v_recorded_by
       AND v_latest.on_behalf_basis IS NOT DISTINCT FROM v_basis THEN
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

-- ---- 4. notices ----------------------------------------------------------------
CREATE TYPE guardianship_age_out_stage AS ENUM ('upcoming', 'turned_18', 'ended');

CREATE TABLE guardianship_age_out_notices (
  guardianship_id uuid NOT NULL REFERENCES guardianships(id) ON DELETE CASCADE,
  stage           guardianship_age_out_stage NOT NULL,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guardianship_id, stage)
);

ALTER TABLE guardianship_age_out_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON guardianship_age_out_notices FROM anon, authenticated;

-- ---- 5. the scheduled job's functions -----------------------------------------
CREATE OR REPLACE FUNCTION claim_guardianship_age_out_notices(
  p_notice_days integer,
  p_grace_days  integer
)
RETURNS TABLE (
  stage             guardianship_age_out_stage,
  guardianship_id   uuid,
  guardian_user_id  uuid,
  dependent_user_id uuid,
  turns_18_on       date,
  access_ends_on    date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
BEGIN
  IF p_notice_days IS NULL OR p_notice_days < 0 OR p_grace_days IS NULL OR p_grace_days < 0 THEN
    RAISE EXCEPTION 'notice and grace days must be zero or more' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT g.id,
           g.guardian_user_id,
           g.dependent_user_id,
           (p.date_of_birth + interval '18 years')::date AS turns_18_on
      FROM guardianships g
      JOIN player_profiles p ON p.user_id = g.dependent_user_id
     WHERE g.status = 'active'
       AND g.basis = 'minor'
       AND p.date_of_birth IS NOT NULL
       AND (p.date_of_birth + interval '18 years')::date <= v_today + p_notice_days
  ),
  staged AS (
    SELECT d.*,
           CASE WHEN d.turns_18_on <= v_today THEN 'turned_18'
                ELSE 'upcoming' END::guardianship_age_out_stage AS stage
      FROM due d
  ),
  recorded AS (
    INSERT INTO guardianship_age_out_notices (guardianship_id, stage)
    SELECT s.id, s.stage FROM staged s
    ON CONFLICT DO NOTHING
    RETURNING guardianship_age_out_notices.guardianship_id,
              guardianship_age_out_notices.stage
  )
  SELECT r.stage, s.id, s.guardian_user_id, s.dependent_user_id, s.turns_18_on,
         s.turns_18_on + p_grace_days
    FROM recorded r
    JOIN staged s ON s.id = r.guardianship_id AND s.stage = r.stage;
END;
$$;

CREATE OR REPLACE FUNCTION end_aged_out_minor_guardianships(p_grace_days integer)
RETURNS TABLE (
  guardianship_id   uuid,
  guardian_user_id  uuid,
  dependent_user_id uuid,
  turns_18_on       date
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_row   record;
BEGIN
  IF p_grace_days IS NULL OR p_grace_days < 0 THEN
    RAISE EXCEPTION 'grace days must be zero or more' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT g.id, g.guardian_user_id, g.dependent_user_id,
           (p.date_of_birth + interval '18 years')::date AS turns_18_on
      FROM guardianships g
      JOIN player_profiles p ON p.user_id = g.dependent_user_id
     WHERE g.status = 'active'
       AND g.basis = 'minor'
       AND p.date_of_birth IS NOT NULL
       AND (p.date_of_birth + interval '18 years')::date + p_grace_days <= v_today
     ORDER BY g.id
  LOOP
    PERFORM 1 FROM account_claims c
      WHERE c.dependent_user_id = v_row.dependent_user_id
        AND c.status = 'pending'
        AND c.expires_at > now()
      FOR UPDATE;
    CONTINUE WHEN FOUND;

    UPDATE guardianships g
       SET status = 'revoked', revoked_at = now()
     WHERE g.id = v_row.id AND g.status = 'active';
    CONTINUE WHEN NOT FOUND;

    INSERT INTO guardianship_age_out_notices (guardianship_id, stage)
      VALUES (v_row.id, 'ended')
      ON CONFLICT DO NOTHING;

    guardianship_id   := v_row.id;
    guardian_user_id  := v_row.guardian_user_id;
    dependent_user_id := v_row.dependent_user_id;
    turns_18_on       := v_row.turns_18_on;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION minor_guardianship_aged_out        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION assert_payer_acts_for              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION record_sensitive_data_consent      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_guardianship_age_out_notices FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION end_aged_out_minor_guardianships   FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION minor_guardianship_aged_out        TO service_role;
GRANT  EXECUTE ON FUNCTION assert_payer_acts_for              TO service_role;
GRANT  EXECUTE ON FUNCTION record_sensitive_data_consent      TO service_role;
GRANT  EXECUTE ON FUNCTION claim_guardianship_age_out_notices TO service_role;
GRANT  EXECUTE ON FUNCTION end_aged_out_minor_guardianships   TO service_role;
