-- =============================================
-- #286: one account per mailbox.
--
-- test@gmail.com, test+123@gmail.com and t.e.s.t@googlemail.com all deliver
-- to the same Gmail inbox, but idx_users_email_active compares them as typed,
-- so one person could hold several accounts. canonical_email() reduces an
-- address to the mailbox it reaches:
--   - lower-cased and trimmed
--   - a "+tag" sub-address dropped, on every domain (Gmail, Outlook, iCloud,
--     Fastmail, Proton and Google Workspace all deliver it to the base address)
--   - for gmail.com / googlemail.com only: dots dropped, and googlemail.com
--     read as gmail.com
-- users.email keeps the address as typed; it's what mail is sent to and what
-- the user signs in with. users.email_canonical is unique among active users.
--
-- Existing duplicates are grandfathered, not merged: the oldest active account
-- of each mailbox holds the canonical address, and the later ones keep
-- email_canonical NULL, which the unique index ignores. Changing a
-- grandfathered row's email recomputes it, so it can't be moved onto another
-- taken mailbox.
--
-- The trigger fires on INSERT and on UPDATE OF email only, so updating any
-- other column of a grandfathered row doesn't recompute it and collide.
--
-- The backfill writes one audit row per user, tagged
-- migration.canonical_user_email. email_canonical is personal data like email;
-- anonymise_user_audit_logs keeps only allowlisted keys, so it's stripped too.
-- =============================================

CREATE OR REPLACE FUNCTION canonical_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  v_email  text := lower(btrim(p_email));
  v_at     int;
  v_local  text;
  v_domain text;
BEGIN
  IF strpos(v_email, '@') = 0 THEN
    RETURN v_email;
  END IF;

  v_at     := length(v_email) - strpos(reverse(v_email), '@') + 1;
  v_local  := left(v_email, v_at - 1);
  v_domain := substr(v_email, v_at + 1);

  IF strpos(v_local, '+') > 1 THEN
    v_local := split_part(v_local, '+', 1);
  END IF;

  IF v_domain IN ('gmail.com', 'googlemail.com') THEN
    v_local  := replace(v_local, '.', '');
    v_domain := 'gmail.com';
  END IF;

  RETURN v_local || '@' || v_domain;
END;
$$;

ALTER TABLE users ADD COLUMN email_canonical varchar(255);

SELECT set_config('app.audit_context', 'migration.canonical_user_email', true);

UPDATE users u
SET email_canonical = ranked.canonical
FROM (
  SELECT id,
         canonical_email(email) AS canonical,
         row_number() OVER (
           PARTITION BY canonical_email(email)
           ORDER BY created_at, id
         ) AS rank
  FROM users
  WHERE deleted_at IS NULL
) ranked
WHERE u.id = ranked.id
  AND ranked.rank = 1;

UPDATE users
SET email_canonical = canonical_email(email)
WHERE deleted_at IS NOT NULL;

DO $$
DECLARE
  v_grandfathered int;
BEGIN
  SELECT count(*) INTO v_grandfathered
  FROM users
  WHERE deleted_at IS NULL AND email_canonical IS NULL;

  IF v_grandfathered > 0 THEN
    RAISE NOTICE '#286: % active account(s) share a mailbox with an older account and keep email_canonical NULL', v_grandfathered;
  END IF;
END;
$$;

CREATE UNIQUE INDEX idx_users_email_canonical_active
  ON users (email_canonical)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION set_users_email_canonical()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email_canonical := canonical_email(NEW.email);
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_email_canonical
  BEFORE INSERT OR UPDATE OF email ON users
  FOR EACH ROW EXECUTE FUNCTION set_users_email_canonical();

-- Whether an active account already uses the mailbox p_email reaches. The
-- signup route asks before creating the auth user, so a variant gets the usual
-- "already exists" answer instead of failing inside handle_new_user.
CREATE OR REPLACE FUNCTION email_registered(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users
    WHERE email_canonical = canonical_email(p_email)
      AND deleted_at IS NULL
  );
$$;

REVOKE EXECUTE ON FUNCTION email_registered(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION email_registered(text) TO service_role;
