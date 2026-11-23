-- =============================================
-- #706: the guardianship schema (part of #705).
--
-- A guardian (the parent of a minor) or a helper (a carer for an adult player,
-- for example a blind player) needs to act for another player. This adds the
-- tables and columns only. Nothing reads them yet, so behaviour doesn't change:
-- can_act_for() still means "self" until #707 widens it.
--
-- 1. users.account_type: 'self' is an account its holder signs in to; 'managed'
--    is a dependent a guardian created, with no login of its own. A managed
--    account may have no email (a child often has none), so users.email becomes
--    nullable, and only a managed account may leave it empty. A managed account
--    has no auth_user_id; when its holder claims it (#720) the same UPDATE sets
--    the login and flips it to 'self'.
--
-- 2. registrations.registered_by: who made the registration when it wasn't the
--    participant. NULL means the player registered themselves, which is true of
--    every existing row, so nothing is backfilled. ON DELETE SET NULL, like
--    registrations.user_id: the registration outlives the account.
--
-- 3. guardianships: one row per guardian and dependent.
--      basis says why the guardian may act:
--        minor       a parent or legal guardian of someone under 18. Accepts
--                    the Terms on the child's behalf.
--        authorised  an adult player authorised this helper. The player stays
--                    the party to the Terms.
--        appointed   legally appointed for an adult who lacks capacity.
--      authorisation_method records how an adult's guardianship was
--      established, so it is NULL exactly when the basis is minor.
--      terms_version / terms_accepted_at are the Terms the guardian accepted
--      when the row was created.
--    Both user references are ON DELETE RESTRICT: a dependent with payment
--    history must never disappear by cascade, and neither may the person who
--    acted for them.
--    The basis is always chosen, never inferred (not from OKU status either).
--
-- 4. A guardian may hold at most 10 active guardianships, checked by a trigger.
--    The trigger locks the guardian's users row first, so two concurrent
--    inserts for one guardian can't both see 9 and end on 11.
--
-- 5. Audited like every other table. guardianships isn't in
--    audit_log_retention(), so its history is never pruned: it is the evidence
--    of who was allowed to act, and pay, for whom.
--
-- 6. RLS: the guardian, and the dependent if they have a login, can read the
--    row. The policy compares app_user_id() directly, not can_act_for():
--    #707 will define can_act_for() in terms of this table, and a guardian must
--    not gain sight of other guardians' rows through it. Clients can't write;
--    every write goes through server-side functions added with the features
--    that need them.
-- =============================================

-- ---- 1. users ---------------------------------------------------------------
CREATE TYPE account_type AS ENUM ('self', 'managed');

ALTER TABLE users
  ADD COLUMN account_type account_type NOT NULL DEFAULT 'self';

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT chk_users_email_required
    CHECK (email IS NOT NULL OR account_type = 'managed'),
  ADD CONSTRAINT chk_users_managed_has_no_login
    CHECK (account_type = 'self' OR auth_user_id IS NULL);

-- ---- 2. registrations -------------------------------------------------------
ALTER TABLE registrations
  ADD COLUMN registered_by uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_registrations_registered_by
  ON registrations (registered_by)
  WHERE registered_by IS NOT NULL;

-- ---- 3. guardianships -------------------------------------------------------
CREATE TYPE guardianship_relationship AS ENUM ('parent', 'legal_guardian', 'carer', 'coach', 'other');
CREATE TYPE guardianship_basis AS ENUM ('minor', 'authorised', 'appointed');
CREATE TYPE guardianship_status AS ENUM ('active', 'revoked', 'claimed');
CREATE TYPE guardianship_authorisation_method AS ENUM ('player_invite', 'guardian_attestation', 'document');

CREATE TABLE guardianships (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_user_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  dependent_user_id     uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  relationship          guardianship_relationship NOT NULL,
  basis                 guardianship_basis NOT NULL,
  status                guardianship_status NOT NULL DEFAULT 'active',
  terms_version         varchar(20) NOT NULL,
  terms_accepted_at     timestamptz NOT NULL,
  authorisation_method  guardianship_authorisation_method,
  created_at            timestamptz NOT NULL DEFAULT now(),
  revoked_at            timestamptz,

  CONSTRAINT uq_guardianship_pair UNIQUE (guardian_user_id, dependent_user_id),
  CONSTRAINT chk_guardianship_not_self
    CHECK (guardian_user_id <> dependent_user_id),
  -- Only a parent or legal guardian accepts the Terms for a child.
  CONSTRAINT chk_guardianship_minor_relationship
    CHECK (basis <> 'minor' OR relationship IN ('parent', 'legal_guardian')),
  -- A minor's guardian needs no authorisation; an adult's always records one.
  CONSTRAINT chk_guardianship_authorisation_for_basis
    CHECK ((basis = 'minor') = (authorisation_method IS NULL)),
  -- A revoked row says when, and nothing else carries a revoked_at.
  CONSTRAINT chk_guardianship_revoked_at
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT chk_guardianship_revoked_after_created
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_guardianships_dependent ON guardianships (dependent_user_id);
CREATE INDEX idx_guardianships_guardian_active
  ON guardianships (guardian_user_id)
  WHERE status = 'active';

-- ---- 4. The active-dependent cap -------------------------------------------
CREATE OR REPLACE FUNCTION enforce_guardianship_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  c_limit  constant integer := 10;
  v_active integer;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'active'
     AND OLD.guardian_user_id = NEW.guardian_user_id THEN
    RETURN NEW;
  END IF;

  -- Serializes cap checks per guardian. NO KEY UPDATE doesn't conflict with
  -- the KEY SHARE locks foreign keys take, so other rows referencing the
  -- guardian aren't held up.
  PERFORM 1 FROM users WHERE id = NEW.guardian_user_id FOR NO KEY UPDATE;

  SELECT count(*) INTO v_active
  FROM guardianships
  WHERE guardian_user_id = NEW.guardian_user_id
    AND status = 'active'
    AND id <> NEW.id;

  IF v_active >= c_limit THEN
    RAISE EXCEPTION 'GUARDIANSHIP_LIMIT_REACHED: a guardian may act for at most % players', c_limit
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enforce_guardianship_limit
  BEFORE INSERT OR UPDATE OF status, guardian_user_id ON guardianships
  FOR EACH ROW EXECUTE FUNCTION enforce_guardianship_limit();

-- ---- 5. Audit ---------------------------------------------------------------
CREATE TRIGGER audit_trail AFTER INSERT OR UPDATE OR DELETE ON guardianships
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_func();

-- ---- 6. RLS -----------------------------------------------------------------
ALTER TABLE guardianships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Guardian and dependent can view their guardianship"
ON guardianships FOR SELECT
USING (
  guardian_user_id = app_user_id()
  OR dependent_user_id = app_user_id()
);

REVOKE ALL ON guardianships FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON guardianships FROM authenticated;

REVOKE EXECUTE ON FUNCTION enforce_guardianship_limit() FROM PUBLIC, anon, authenticated;
