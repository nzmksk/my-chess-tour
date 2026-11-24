-- =============================================
-- #719: a player invites a helper to their existing account (part of #705).
--
-- A player who already has an account (for example a blind player who signed
-- up with a screen reader) may want a carer to help. Creating a second,
-- managed record for them (#712) would split one person into two identities
-- that can't be cleanly merged, so instead the player invites the helper, and
-- accepting creates a guardianship over the player's own account:
-- basis 'authorised', authorisation_method 'player_invite'. The player keeps
-- their login and account_type stays 'self'. The player inviting is the
-- consent record: they authorised it themselves.
--
-- 1. helper_invitations: one row per invitation.
--    - Only the SHA-256 of the emailed token is stored (token_hash), never
--      the token, as for organization invitations.
--    - Short expiry: 72 hours from creation (or from the last resend).
--    - Single use: accepting flips status to 'accepted' and links the
--      guardianship it created; a second accept is refused (INVITATION_CLOSED).
--    - email is lower-cased; the helper must be signed in with an account
--      whose address reaches the same mailbox (canonical_email, #286).
--    - relationship is what the helper will be to the player. Not
--      'legal_guardian': that is an appointed guardianship, which needs proof.
--    - One pending invitation per player and address. Inviting the same
--      address again replaces the token and restarts the 72 hours.
--    - player_user_id is ON DELETE RESTRICT like guardianships: it is part of
--      the evidence of who authorised whom.
--
-- 2. Functions, all called by the API with the service role:
--    create_helper_invitation   the player invites. Only a live self-managed
--                               account with a login that isn't under 18 can
--                               (HELPER_INVITE_NOT_ALLOWED); not to their own
--                               mailbox (HELPER_SELF); not to someone already
--                               helping them (HELPER_ALREADY_ACTIVE).
--    accept_helper_invitation   the helper accepts with the emailed token. They
--                               must be signed in as the invited mailbox
--                               (INVITATION_WRONG_ACCOUNT) and be a live
--                               self-managed adult with a login
--                               (HELPER_NOT_ELIGIBLE). Inserts the guardianship,
--                               or reactivates an earlier revoked or claimed
--                               row for the same pair (guardianships allows one
--                               row per pair). The helper accepts the Terms
--                               version the server passes in. The cap of 10
--                               active guardianships per helper still applies.
--    decline_helper_invitation  anyone holding the token can say no, with or
--                               without an account; declining grants nothing.
--    revoke_helper_invitation   the player withdraws a pending invitation.
--    end_helper_guardianship    the player revokes a helper, or the helper
--                               steps down. Either side, at any time; nothing
--                               else changes, so registrations and payments
--                               the helper made stay as they are. The player
--                               can end any active guardianship over their own
--                               self-managed account, not only invited ones:
--                               an adult with capacity decides who acts for
--                               them.
--    Errors are RAISEd with a CODE: prefix, which the routes map to responses.
--
-- 3. Audited like every other table (audit_trail), and kept out of
--    audit_log_retention() like guardianships: together they are the record of
--    who authorised whom.
--
-- 4. RLS: the player can read their own invitations. Clients can't write; the
--    helper reads an invitation through the API by its token.
-- =============================================

-- ---- 1. helper_invitations ---------------------------------------------------
CREATE TABLE helper_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  email           varchar(255) NOT NULL,
  relationship    guardianship_relationship NOT NULL,
  token_hash      char(64) NOT NULL UNIQUE,
  status          invitation_status NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  responded_at    timestamptz,
  responded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  guardianship_id uuid REFERENCES guardianships(id) ON DELETE RESTRICT,

  CONSTRAINT chk_helper_invitation_email_lower CHECK (email = lower(email)),
  CONSTRAINT chk_helper_invitation_relationship
    CHECK (relationship <> 'legal_guardian'),
  CONSTRAINT chk_helper_invitation_responded
    CHECK ((status = 'pending') = (responded_at IS NULL)),
  CONSTRAINT chk_helper_invitation_accepted_links_guardianship
    CHECK ((status = 'accepted') = (guardianship_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_helper_invitations_pending
  ON helper_invitations (player_user_id, email)
  WHERE status = 'pending';

CREATE INDEX idx_helper_invitations_player
  ON helper_invitations (player_user_id, created_at DESC);

CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON helper_invitations
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

ALTER TABLE helper_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players can view their own helper invitations"
ON helper_invitations FOR SELECT
USING (player_user_id = app_user_id());

REVOKE ALL ON helper_invitations FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON helper_invitations FROM authenticated;

-- ---- 2. Functions -------------------------------------------------------------
CREATE FUNCTION create_helper_invitation(
  p_player_user_id uuid,
  p_email          text,
  p_relationship   guardianship_relationship,
  p_token_hash     text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_email      text := lower(btrim(p_email));
  v_expires_at timestamptz := now() + interval '72 hours';
  v_player     users;
  v_id         uuid;
BEGIN
  SELECT * INTO v_player
  FROM users
  WHERE id = p_player_user_id
  FOR NO KEY UPDATE;

  IF NOT FOUND
     OR v_player.account_type <> 'self'
     OR v_player.auth_user_id IS NULL
     OR v_player.deleted_at IS NOT NULL
     OR self_managed_minor(p_player_user_id) THEN
    RAISE EXCEPTION 'HELPER_INVITE_NOT_ALLOWED: only a self-managed account aged 18 or over can invite a helper'
      USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(v_email, '') = '' OR strpos(v_email, '@') < 2 THEN
    RAISE EXCEPTION 'INVALID_HELPER_INVITATION: a valid email address is required'
      USING ERRCODE = 'P0001';
  END IF;
  IF p_relationship = 'legal_guardian' THEN
    RAISE EXCEPTION 'INVALID_HELPER_INVITATION: a helper can''t be invited as a legal guardian'
      USING ERRCODE = 'P0001';
  END IF;

  IF canonical_email(v_email) = canonical_email(v_player.email) THEN
    RAISE EXCEPTION 'HELPER_SELF: you can''t invite yourself as your own helper'
      USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM guardianships g
    JOIN users h ON h.id = g.guardian_user_id
    WHERE g.dependent_user_id = p_player_user_id
      AND g.status = 'active'
      AND h.deleted_at IS NULL
      AND h.email_canonical = canonical_email(v_email)
  ) THEN
    RAISE EXCEPTION 'HELPER_ALREADY_ACTIVE: this person already helps you'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE helper_invitations
  SET token_hash   = p_token_hash,
      relationship = p_relationship,
      created_at   = now(),
      expires_at   = v_expires_at
  WHERE player_user_id = p_player_user_id
    AND email = v_email
    AND status = 'pending'
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    INSERT INTO helper_invitations (
      player_user_id, email, relationship, token_hash, expires_at
    ) VALUES (
      p_player_user_id, v_email, p_relationship, p_token_hash, v_expires_at
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object(
    'invitation_id', v_id,
    'email', v_email,
    'expires_at', v_expires_at
  );
END;
$$;

CREATE FUNCTION accept_helper_invitation(
  p_token_hash     text,
  p_helper_user_id uuid,
  p_terms_version  text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inv          helper_invitations;
  v_helper       users;
  v_player       users;
  v_existing     guardianships;
  v_guardianship uuid;
BEGIN
  SELECT * INTO v_inv
  FROM helper_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: no invitation for this link'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: this invitation expired at %', v_inv.expires_at
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_helper FROM users WHERE id = p_helper_user_id;
  IF NOT FOUND
     OR v_helper.deleted_at IS NOT NULL
     OR v_helper.email IS NULL
     OR canonical_email(v_helper.email) <> canonical_email(v_inv.email) THEN
    RAISE EXCEPTION 'INVITATION_WRONG_ACCOUNT: this invitation was sent to a different address'
      USING ERRCODE = '42501';
  END IF;

  IF v_helper.id = v_inv.player_user_id THEN
    RAISE EXCEPTION 'HELPER_SELF: you can''t be your own helper'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_helper.account_type <> 'self'
     OR v_helper.auth_user_id IS NULL
     OR self_managed_minor(v_helper.id) THEN
    RAISE EXCEPTION 'HELPER_NOT_ELIGIBLE: a helper must hold their own account and be 18 or over'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_player FROM users WHERE id = v_inv.player_user_id;
  IF v_player.deleted_at IS NOT NULL
     OR v_player.account_type <> 'self'
     OR v_player.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'HELPER_INVITE_NOT_ALLOWED: this player can no longer be helped through an invitation'
      USING ERRCODE = 'P0001';
  END IF;

  IF coalesce(btrim(p_terms_version), '') = '' THEN
    RAISE EXCEPTION 'INVALID_HELPER_INVITATION: the helper must accept the Terms'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing
  FROM guardianships
  WHERE guardian_user_id = v_helper.id
    AND dependent_user_id = v_inv.player_user_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.status = 'active' THEN
      RAISE EXCEPTION 'HELPER_ALREADY_ACTIVE: you already help this player'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE guardianships
    SET status               = 'active',
        revoked_at           = NULL,
        relationship         = v_inv.relationship,
        basis                = 'authorised',
        authorisation_method = 'player_invite',
        terms_version        = p_terms_version,
        terms_accepted_at    = now()
    WHERE id = v_existing.id;
    v_guardianship := v_existing.id;
  ELSE
    INSERT INTO guardianships (
      guardian_user_id, dependent_user_id, relationship, basis,
      authorisation_method, terms_version, terms_accepted_at
    ) VALUES (
      v_helper.id, v_inv.player_user_id, v_inv.relationship, 'authorised',
      'player_invite', p_terms_version, now()
    )
    RETURNING id INTO v_guardianship;
  END IF;

  UPDATE helper_invitations
  SET status          = 'accepted',
      responded_at    = now(),
      responded_by    = v_helper.id,
      guardianship_id = v_guardianship
  WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'invitation_id', v_inv.id,
    'guardianship_id', v_guardianship,
    'player_user_id', v_inv.player_user_id
  );
END;
$$;

CREATE FUNCTION decline_helper_invitation(
  p_token_hash text,
  p_user_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inv helper_invitations;
BEGIN
  SELECT * INTO v_inv
  FROM helper_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: no invitation for this link'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status = 'declined' THEN
    RETURN jsonb_build_object('invitation_id', v_inv.id, 'already_declined', true);
  END IF;
  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: this invitation expired at %', v_inv.expires_at
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE helper_invitations
  SET status = 'declined', responded_at = now(), responded_by = p_user_id
  WHERE id = v_inv.id;

  RETURN jsonb_build_object('invitation_id', v_inv.id, 'already_declined', false);
END;
$$;

CREATE FUNCTION revoke_helper_invitation(
  p_player_user_id uuid,
  p_invitation_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inv helper_invitations;
BEGIN
  SELECT * INTO v_inv
  FROM helper_invitations
  WHERE id = p_invitation_id
    AND player_user_id = p_player_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: invitation % not found', p_invitation_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status = 'revoked' THEN
    RETURN jsonb_build_object('invitation_id', v_inv.id, 'already_revoked', true);
  END IF;
  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE helper_invitations
  SET status = 'revoked', responded_at = now(), responded_by = p_player_user_id
  WHERE id = v_inv.id;

  RETURN jsonb_build_object('invitation_id', v_inv.id, 'already_revoked', false);
END;
$$;

CREATE FUNCTION end_helper_guardianship(
  p_user_id         uuid,
  p_guardianship_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_g     guardianships;
  v_ended text;
BEGIN
  SELECT g.* INTO v_g
  FROM guardianships g
  JOIN users d ON d.id = g.dependent_user_id
  WHERE g.id = p_guardianship_id
    AND g.status = 'active'
    AND (
      g.guardian_user_id = p_user_id
      OR (g.dependent_user_id = p_user_id AND d.account_type = 'self')
    )
  FOR UPDATE OF g;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'HELPER_NOT_FOUND: no active helper relationship with that id for this account'
      USING ERRCODE = 'P0002';
  END IF;

  v_ended := CASE WHEN v_g.guardian_user_id = p_user_id THEN 'helper' ELSE 'player' END;

  UPDATE guardianships
  SET status = 'revoked', revoked_at = now()
  WHERE id = v_g.id;

  RETURN jsonb_build_object(
    'guardianship_id', v_g.id,
    'ended_by', v_ended,
    'guardian_user_id', v_g.guardian_user_id,
    'dependent_user_id', v_g.dependent_user_id
  );
END;
$$;

-- ---- Privileges -------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION create_helper_invitation(uuid, text, guardianship_relationship, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION accept_helper_invitation(text, uuid, text)                           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decline_helper_invitation(text, uuid)                                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION revoke_helper_invitation(uuid, uuid)                                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION end_helper_guardianship(uuid, uuid)                                  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION create_helper_invitation(uuid, text, guardianship_relationship, text) TO service_role;
GRANT EXECUTE ON FUNCTION accept_helper_invitation(text, uuid, text)                           TO service_role;
GRANT EXECUTE ON FUNCTION decline_helper_invitation(text, uuid)                                TO service_role;
GRANT EXECUTE ON FUNCTION revoke_helper_invitation(uuid, uuid)                                 TO service_role;
GRANT EXECUTE ON FUNCTION end_helper_guardianship(uuid, uuid)                                  TO service_role;
