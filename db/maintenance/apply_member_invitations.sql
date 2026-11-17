-- =============================================================================
-- ONE-OFF: bring an existing database up to #121 (organization invitations)
--
-- #121 edits the base migrations in place: invitation_status and
-- organization_invitations in 001, uq_org_invitations_pending in 002, the four
-- invitation functions (and their REVOKE / GRANT lines) in 003, and the table's
-- RLS lockdown in 004. A fresh build gets all of it. 003 can't simply be re-run
-- on a long-lived database (it creates triggers), so everything this issue adds
-- is repeated below, copied verbatim from those files, in one transaction.
--
-- It ends in ROLLBACK, so it is a dry run until that line is changed to COMMIT.
--
-- Deploy the app AFTER committing: the new invite route writes invitations
-- through create_organization_invitation, so on a database without it every
-- invite fails with a 500.
--
-- Memberships created by the old flow (added directly, no invitation) are left
-- alone: they are real memberships, and there is nothing for anyone to accept.
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres / service role), against
-- staging first, then production.
-- =============================================================================

BEGIN;

-- 001 -------------------------------------------------------------------------
CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined', 'revoked');

CREATE TABLE organization_invitations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           varchar(255) NOT NULL,
  role_id         integer NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  token_hash      char(64) NOT NULL UNIQUE,
  status          invitation_status NOT NULL DEFAULT 'pending',
  invited_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  responded_at    timestamptz,
  responded_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Compared against users.email, which is stored lowercased.
  CONSTRAINT chk_invitation_email_lower CHECK (email = lower(email)),
  -- Pending exactly while nobody has answered it.
  CONSTRAINT chk_invitation_responded CHECK ((status = 'pending') = (responded_at IS NULL))
);

-- 002 -------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_org_invitations_pending
  ON organization_invitations (organization_id, email)
  WHERE status = 'pending';

-- 004 -------------------------------------------------------------------------
ALTER TABLE organization_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON organization_invitations FROM anon, authenticated;

-- 003 -------------------------------------------------------------------------
-- Invites p_email to p_org_id as p_role, or refreshes the pending invitation the
-- address already has there: new token, role and inviter, and a fresh 30 days.
-- Refuses an address that already belongs to a member. p_token_hash is the
-- SHA-256 of the token the caller will email; the token itself never arrives.
CREATE OR REPLACE FUNCTION create_organization_invitation(
  p_org_id     uuid,
  p_email      text,
  p_role       text,
  p_invited_by uuid,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email   text := lower(btrim(p_email));
  v_role_id integer;
  v_id      uuid;
  v_created timestamptz;
  v_expires timestamptz;
  v_resent  boolean;
BEGIN
  IF NOT has_org_permission(p_invited_by, p_org_id, 'org.invite') THEN
    RAISE EXCEPTION 'INVITATION_FORBIDDEN: org.invite is required' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organizations
     WHERE id = p_org_id AND approval_status = 'approved' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'INVITATION_ORG_UNAVAILABLE: organization % is not approved', p_org_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Owner is never offered by invitation.
  SELECT id INTO v_role_id FROM roles
   WHERE name = p_role AND scope = 'organization' AND name IN ('admin', 'member');
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'INVITATION_INVALID_ROLE: % cannot be offered by invitation', p_role
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_memberships m
      JOIN users u ON u.id = m.user_id
     WHERE m.organization_id = p_org_id
       AND u.email = v_email
       AND u.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'INVITATION_ALREADY_MEMBER: % is already a member', v_email
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO organization_invitations AS i
    (organization_id, email, role_id, token_hash, invited_by, expires_at)
  VALUES
    (p_org_id, v_email, v_role_id, p_token_hash, p_invited_by, now() + interval '30 days')
  ON CONFLICT (organization_id, email) WHERE status = 'pending'
  DO UPDATE SET
    role_id    = EXCLUDED.role_id,
    token_hash = EXCLUDED.token_hash,
    invited_by = EXCLUDED.invited_by,
    created_at = now(),
    expires_at = EXCLUDED.expires_at
  -- xmax is non-zero on the row an ON CONFLICT update rewrote, zero on a fresh insert.
  RETURNING i.id, i.created_at, i.expires_at, (i.xmax <> 0)
    INTO v_id, v_created, v_expires, v_resent;

  RETURN jsonb_build_object(
    'id',         v_id,
    'email',      v_email,
    'role',       p_role,
    'created_at', v_created,
    'expires_at', v_expires,
    'resent',     v_resent
  );
END;
$$;

-- The invitee accepting. p_user_id must be signed in with the invited address:
-- the token proves someone read the email, the address match proves it is the
-- person it was sent to (a forwarded link is not enough). Inserts the
-- membership with the offered role. Accepting twice is not an error, and an
-- invitee who has meanwhile become a member keeps the role they already hold.
CREATE OR REPLACE FUNCTION accept_organization_invitation(
  p_token_hash text,
  p_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv    organization_invitations;
  v_email  text;
  v_joined boolean;
BEGIN
  SELECT * INTO v_inv FROM organization_invitations
   WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: no invitation for this link' USING ERRCODE = 'P0002';
  END IF;

  SELECT email INTO v_email FROM users WHERE id = p_user_id AND deleted_at IS NULL;
  IF v_email IS NULL OR lower(v_email) <> v_inv.email THEN
    RAISE EXCEPTION 'INVITATION_WRONG_ACCOUNT: this invitation was sent to a different address'
      USING ERRCODE = '42501';
  END IF;

  IF v_inv.status = 'accepted' THEN
    RETURN jsonb_build_object(
      'organization_id',  v_inv.organization_id,
      'already_accepted', true
    );
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: this invitation expired at %', v_inv.expires_at
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organizations
     WHERE id = v_inv.organization_id AND approval_status = 'approved' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'INVITATION_ORG_UNAVAILABLE: the organization is no longer available'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO organization_memberships (organization_id, user_id, role_id)
  VALUES (v_inv.organization_id, p_user_id, v_inv.role_id)
  ON CONFLICT (organization_id, user_id) DO NOTHING;
  v_joined := FOUND;

  UPDATE organization_invitations
     SET status = 'accepted', responded_at = now(), responded_by = p_user_id
   WHERE id = v_inv.id;

  RETURN jsonb_build_object(
    'organization_id',  v_inv.organization_id,
    'already_accepted', false,
    'already_member',   NOT v_joined
  );
END;
$$;

-- The invitee turning it down. Holding the token is enough: declining grants
-- nothing, and someone who never wants an account should not need one to say
-- no. p_user_id records who declined when they were signed in (NULL otherwise).
-- Declining twice is not an error.
CREATE OR REPLACE FUNCTION decline_organization_invitation(
  p_token_hash text,
  p_user_id    uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv organization_invitations;
BEGIN
  SELECT * INTO v_inv FROM organization_invitations
   WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: no invitation for this link' USING ERRCODE = 'P0002';
  END IF;

  IF v_inv.status = 'declined' THEN
    RETURN jsonb_build_object('organization_id', v_inv.organization_id, 'already_declined', true);
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status USING ERRCODE = 'P0001';
  END IF;

  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITATION_EXPIRED: this invitation expired at %', v_inv.expires_at
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE organization_invitations
     SET status = 'declined', responded_at = now(), responded_by = p_user_id
   WHERE id = v_inv.id;

  RETURN jsonb_build_object('organization_id', v_inv.organization_id, 'already_declined', false);
END;
$$;

-- An inviter withdrawing a pending invitation (expired or not), so its link stops
-- working at once rather than at expiry, e.g. one sent to a mistyped address.
CREATE OR REPLACE FUNCTION revoke_organization_invitation(
  p_invitation_id uuid,
  p_org_id        uuid,
  p_user_id       uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv organization_invitations;
BEGIN
  SELECT * INTO v_inv FROM organization_invitations
   WHERE id = p_invitation_id AND organization_id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: invitation % not found', p_invitation_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT has_org_permission(p_user_id, p_org_id, 'org.invite') THEN
    RAISE EXCEPTION 'INVITATION_FORBIDDEN: org.invite is required' USING ERRCODE = '42501';
  END IF;

  IF v_inv.status <> 'pending' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: this invitation was %', v_inv.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE organization_invitations
     SET status = 'revoked', responded_at = now(), responded_by = p_user_id
   WHERE id = v_inv.id;

  RETURN jsonb_build_object('id', v_inv.id, 'email', v_inv.email);
END;
$$;

REVOKE EXECUTE ON FUNCTION create_organization_invitation  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION accept_organization_invitation  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION decline_organization_invitation FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION revoke_organization_invitation  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION create_organization_invitation  TO service_role;
GRANT EXECUTE ON FUNCTION accept_organization_invitation  TO service_role;
GRANT EXECUTE ON FUNCTION decline_organization_invitation TO service_role;
GRANT EXECUTE ON FUNCTION revoke_organization_invitation  TO service_role;

ROLLBACK;
