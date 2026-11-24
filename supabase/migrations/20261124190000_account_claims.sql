-- =============================================
-- #720: a guardian hands a dependent's record over to its player (part of
-- #705).
--
-- A dependent who grows up, or an adult whose carer set them up, wants to
-- manage their own record and keep their registrations, profile, FIDE sync
-- and public profile URL. users.id never changes (#501), so the handover
-- itself is one users UPDATE plus guardianships.status = 'claimed'.
--
-- Claim first, never merge afterwards. The guardian starts the handover while
-- the player has no account, the player gets a link, sets a password, and
-- signup LINKS the existing users row instead of creating a new one.
--
-- 1. account_claims: one row per handover attempt.
--    - Only the SHA-256 of the emailed token is stored (token_hash), never the
--      token, as for organization and helper invitations.
--    - 72-hour expiry, single use: accepting flips status to 'accepted' and
--      records the auth user it was bound to.
--    - At most one pending claim per dependent (partial unique index).
--      Starting another one cancels the earlier claim, so its link stops
--      working.
--    - email is the player's address, lower-cased. The link goes there, and
--      the account it creates must have that mailbox (canonical_email, #286).
--    - Both user references are ON DELETE RESTRICT, like guardianships: the
--      claim is part of the record of who handed what to whom.
--    - Audited (audit_trail) and kept out of audit_log_retention(), like
--      guardianships and helper_invitations.
--    - RLS: the guardian who started a claim can read it, every column but
--      token_hash. The hash is what a signup presents to claim the record, so
--      no client may read it back. Clients can't write.
--
-- 2. Functions, called by the API with the service role. Errors are RAISEd
--    with a CODE: prefix, which the routes map to responses.
--    create_account_claim  the guardian starts a handover. Needs an active
--                          guardianship (DEPENDENT_NOT_FOUND), a managed
--                          dependent (CLAIM_NOT_ALLOWED), a date of birth that
--                          makes them 18 or over (UNDER_18: under-18s can't
--                          hold an account, #710; #721 covers turning 18), and
--                          an address that no account uses yet (EMAIL_TAKEN:
--                          we don't merge automatically, the player contacts
--                          support).
--    cancel_account_claim  the guardian withdraws a pending claim.
--    link_claimed_account  the link step, run by handle_new_user (below).
--
-- 3. The link step binds to the player's VERIFIED email, so it runs when the
--    auth user's email is confirmed, inside the auth.users write that
--    confirms it:
--      - handle_new_user: a new auth user whose metadata carries
--        claim_token_hash never gets a users row of its own. If it is created
--        already confirmed, link_claimed_account runs in the INSERT;
--      - handle_claimed_user_confirmed (new trigger on_auth_user_confirmed):
--        otherwise it runs in the UPDATE that sets email_confirmed_at.
--    The API's admin createUser(email_confirm) reaches one of the two in the
--    same transaction, whichever order Auth writes them in, so creating the
--    login and accepting the claim commit or fail together. The API creates
--    the login confirmed only because the player opened the emailed link;
--    a signup made any other way waits for its own confirmation email.
--    link_claimed_account refuses (CLAIM_INVALID) a claim that isn't pending,
--    has expired, or whose guardianship is no longer active; an auth user
--    that isn't confirmed (CLAIM_EMAIL_UNVERIFIED) or doesn't reach the
--    claim's mailbox (CLAIM_EMAIL_MISMATCH); EMAIL_TAKEN again, in case an
--    account appeared since; and UNDER_18 on the profile's date of birth.
--    Then it:
--      - points the users row at the new login: auth_user_id, email,
--        account_type 'self', contact_email cleared (the player's own address
--        replaces it), and the Terms the player accepted;
--      - sets every active guardianship of the player to 'claimed', so each
--        guardian's access ends at that moment;
--      - marks the claim accepted.
--    The player's registrations, profile and history stay on the same
--    users.id. Payments stay with whoever paid: payments.user_id is the payer
--    (#708), so the guardian's receipts don't move.
--    Locks, in one order everywhere: the dependent's pending claim, then the
--    guardianship, then the dependent's users row. create_account_claim and
--    link_claimed_account both follow it, so a resend racing an acceptance
--    waits instead of deadlocking. Guardianship before users is also the
--    order checkout (#714) and consent recording (#717) use.
--
-- Otherwise handle_new_user is as in 20261124110000_date_of_birth_at_signup.sql.
-- =============================================

-- ---- 1. account_claims -----------------------------------------------------
CREATE TYPE account_claim_status AS ENUM ('pending', 'accepted', 'cancelled');

CREATE TABLE account_claims (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dependent_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  guardian_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  email             varchar(255) NOT NULL,
  token_hash        char(64) NOT NULL UNIQUE,
  status            account_claim_status NOT NULL DEFAULT 'pending',
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  accepted_at       timestamptz,
  auth_user_id      uuid,
  cancelled_at      timestamptz,

  CONSTRAINT chk_account_claim_email_lower CHECK (email = lower(email)),
  CONSTRAINT chk_account_claim_not_self
    CHECK (guardian_user_id <> dependent_user_id),
  CONSTRAINT chk_account_claim_accepted
    CHECK ((status = 'accepted') = (accepted_at IS NOT NULL AND auth_user_id IS NOT NULL)),
  CONSTRAINT chk_account_claim_cancelled
    CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX uq_account_claims_one_pending
  ON account_claims (dependent_user_id)
  WHERE status = 'pending';
CREATE INDEX idx_account_claims_guardian ON account_claims (guardian_user_id);

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON account_claims
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

ALTER TABLE account_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Guardian can view the claims they started"
ON account_claims FOR SELECT
USING (guardian_user_id = app_user_id());

REVOKE ALL ON account_claims FROM anon;
REVOKE ALL ON account_claims FROM authenticated;
GRANT SELECT (id, dependent_user_id, guardian_user_id, email, status,
              created_at, expires_at, accepted_at, auth_user_id, cancelled_at)
  ON account_claims TO authenticated;

-- ---- 2. create / cancel ----------------------------------------------------
CREATE FUNCTION create_account_claim(
  p_guardian_user_id  uuid,
  p_dependent_user_id uuid,
  p_email             text,
  p_token_hash        text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email   text := lower(btrim(p_email));
  v_user    users;
  v_dob     date;
  v_claim   account_claims;
BEGIN
  PERFORM 1 FROM account_claims
    WHERE dependent_user_id = p_dependent_user_id
      AND status = 'pending'
    FOR UPDATE;

  PERFORM 1 FROM guardianships
    WHERE guardian_user_id = p_guardian_user_id
      AND dependent_user_id = p_dependent_user_id
      AND status = 'active'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPENDENT_NOT_FOUND: no active dependent with that id on this account'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = p_dependent_user_id FOR UPDATE;
  IF v_user.account_type <> 'managed' OR v_user.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_NOT_ALLOWED: only a dependent with no login of their own can be handed over'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT date_of_birth INTO v_dob FROM player_profiles WHERE user_id = p_dependent_user_id;
  IF v_dob IS NULL
     OR v_dob > ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date THEN
    RAISE EXCEPTION 'UNDER_18: a player must be 18 or over to hold their own account'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_email = '' OR strpos(v_email, '@') = 0 THEN
    RAISE EXCEPTION 'INVALID_EMAIL: an email address is required' USING ERRCODE = '22023';
  END IF;

  IF email_registered(v_email) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN: an account already uses this email'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE account_claims
    SET status = 'cancelled', cancelled_at = now()
    WHERE dependent_user_id = p_dependent_user_id
      AND status = 'pending';

  INSERT INTO account_claims (dependent_user_id, guardian_user_id, email, token_hash, expires_at)
    VALUES (p_dependent_user_id, p_guardian_user_id, v_email, p_token_hash, now() + interval '72 hours')
    RETURNING * INTO v_claim;

  RETURN jsonb_build_object(
    'claim_id',   v_claim.id,
    'email',      v_claim.email,
    'expires_at', v_claim.expires_at
  );
END;
$$;

CREATE FUNCTION cancel_account_claim(
  p_guardian_user_id  uuid,
  p_dependent_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM guardianships
    WHERE guardian_user_id = p_guardian_user_id
      AND dependent_user_id = p_dependent_user_id
      AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DEPENDENT_NOT_FOUND: no active dependent with that id on this account'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE account_claims
    SET status = 'cancelled', cancelled_at = now()
    WHERE dependent_user_id = p_dependent_user_id
      AND status = 'pending';
  RETURN FOUND;
END;
$$;

-- ---- 3. the link step ------------------------------------------------------
CREATE FUNCTION link_claimed_account(
  p_auth_user_id       uuid,
  p_email              text,
  p_email_confirmed_at timestamptz,
  p_token_hash         text,
  p_terms_version      varchar(20)
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim account_claims;
  v_user  users;
  v_dob   date;
BEGIN
  SELECT * INTO v_claim FROM account_claims WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_claim.status <> 'pending' OR v_claim.expires_at <= now() THEN
    RAISE EXCEPTION 'CLAIM_INVALID: this handover link is no longer valid'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'CLAIM_EMAIL_UNVERIFIED: the account''s email must be verified'
      USING ERRCODE = 'P0001';
  END IF;
  IF canonical_email(p_email) IS DISTINCT FROM canonical_email(v_claim.email) THEN
    RAISE EXCEPTION 'CLAIM_EMAIL_MISMATCH: the account must use the address the link was sent to'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM guardianships
    WHERE guardian_user_id = v_claim.guardian_user_id
      AND dependent_user_id = v_claim.dependent_user_id
      AND status = 'active'
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLAIM_INVALID: the guardian who started this handover no longer acts for this player'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_claim.dependent_user_id FOR UPDATE;
  IF v_user.account_type <> 'managed' OR v_user.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'CLAIM_INVALID: this record can''t be handed over any more'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT date_of_birth INTO v_dob FROM player_profiles WHERE user_id = v_user.id;
  IF v_dob IS NULL
     OR v_dob > ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date THEN
    RAISE EXCEPTION 'UNDER_18: a player must be 18 or over to hold their own account'
      USING ERRCODE = 'P0001';
  END IF;

  IF email_registered(p_email) THEN
    RAISE EXCEPTION 'EMAIL_TAKEN: an account already uses this email'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE users
    SET auth_user_id      = p_auth_user_id,
        email             = p_email,
        account_type      = 'self',
        contact_email     = NULL,
        terms_version     = p_terms_version,
        terms_accepted_at = CASE WHEN p_terms_version IS NULL THEN NULL ELSE now() END
    WHERE id = v_user.id;

  UPDATE guardianships
    SET status = 'claimed'
    WHERE dependent_user_id = v_user.id
      AND status = 'active';

  UPDATE account_claims
    SET status = 'accepted', accepted_at = now(), auth_user_id = p_auth_user_id
    WHERE id = v_claim.id;

  RETURN v_user.id;
END;
$$;

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_terms_version varchar(20) := NULLIF(NEW.raw_user_meta_data->>'terms_version', '');
  v_date_of_birth date        := NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '')::date;
  v_claim_hash    text        := NULLIF(NEW.raw_user_meta_data->>'claim_token_hash', '');
BEGIN
  IF v_claim_hash IS NOT NULL THEN
    IF NEW.email_confirmed_at IS NOT NULL THEN
      PERFORM link_claimed_account(NEW.id, NEW.email, NEW.email_confirmed_at,
                                   v_claim_hash, v_terms_version);
    END IF;
    RETURN NEW;
  END IF;

  IF v_date_of_birth >
     ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date THEN
    RAISE EXCEPTION 'UNDER_18: an account holder must be 18 or over; under-18s take part through a parent or guardian''s account'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.users (
    id, auth_user_id, email, first_name, last_name,
    terms_version, terms_accepted_at
  )
  VALUES (
    NEW.id,
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    v_terms_version,
    CASE WHEN v_terms_version IS NULL THEN NULL ELSE now() END
  );

  INSERT INTO public.player_profiles (user_id, date_of_birth)
  VALUES (NEW.id, v_date_of_birth);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'handle_new_user failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE
      USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE FUNCTION handle_claimed_user_confirmed()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE auth_user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  PERFORM link_claimed_account(
    NEW.id, NEW.email, NEW.email_confirmed_at,
    NEW.raw_user_meta_data->>'claim_token_hash',
    NULLIF(NEW.raw_user_meta_data->>'terms_version', '')
  );
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'handle_claimed_user_confirmed failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE
      USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL
        AND NEW.email_confirmed_at IS NOT NULL
        AND NEW.raw_user_meta_data ? 'claim_token_hash')
  EXECUTE FUNCTION handle_claimed_user_confirmed();

REVOKE EXECUTE ON FUNCTION handle_claimed_user_confirmed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION create_account_claim FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION cancel_account_claim FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION link_claimed_account FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION create_account_claim TO service_role;
GRANT  EXECUTE ON FUNCTION cancel_account_claim TO service_role;
GRANT  EXECUTE ON FUNCTION link_claimed_account TO service_role;
