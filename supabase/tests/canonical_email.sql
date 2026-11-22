-- =============================================================================
-- Regression test for one account per mailbox (#286).
--
-- Covers:
--   E1  canonical_email(): case and whitespace, +tags on any domain, Gmail dots
--       and googlemail.com, and what it leaves alone
--   E2  a users insert stores the canonical address
--   E3  a +tag or dotted Gmail variant of an active account is refused by the
--       unique index
--   E4  signing up through auth.users with a variant fails in handle_new_user,
--       and leaves no auth row
--   E5  a soft-deleted account's mailbox can be used again
--   E6  a grandfathered row (email_canonical NULL) can still be updated, and
--       changing its email recomputes the canonical address, so it can't move
--       onto a taken mailbox
--   E7  email_registered() answers for variants, ignores deleted accounts, and
--       is executable by service_role only
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs. A failing assertion
-- RAISEs; on success it prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_a      uuid;
  v_b      uuid;
  v_auth   uuid := gen_random_uuid();
  v_canon  text;
  v_raised boolean;
BEGIN
  -- ---- E1 ------------------------------------------------------------------
  IF canonical_email('  Test@Gmail.com ') <> 'test@gmail.com' THEN
    RAISE EXCEPTION 'E1 FAILED: case and whitespace';
  END IF;
  IF canonical_email('test+123@gmail.com') <> 'test@gmail.com' THEN
    RAISE EXCEPTION 'E1 FAILED: gmail +tag';
  END IF;
  IF canonical_email('t.e.s.t+promo@googlemail.com') <> 'test@gmail.com' THEN
    RAISE EXCEPTION 'E1 FAILED: googlemail dots and +tag';
  END IF;
  IF canonical_email('first.last+news@outlook.com') <> 'first.last@outlook.com' THEN
    RAISE EXCEPTION 'E1 FAILED: +tag dropped but dots kept off Gmail, got %',
      canonical_email('first.last+news@outlook.com');
  END IF;
  IF canonical_email('a+b+c@club.my') <> 'a@club.my' THEN
    RAISE EXCEPTION 'E1 FAILED: everything from the first +';
  END IF;
  IF canonical_email('+only@club.my') <> '+only@club.my' THEN
    RAISE EXCEPTION 'E1 FAILED: a local part that starts with + is kept';
  END IF;
  IF canonical_email('first-last@yahoo.com') <> 'first-last@yahoo.com' THEN
    RAISE EXCEPTION 'E1 FAILED: hyphens are not sub-addresses';
  END IF;
  IF canonical_email('not-an-email') <> 'not-an-email' THEN
    RAISE EXCEPTION 'E1 FAILED: no @';
  END IF;
  IF canonical_email(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'E1 FAILED: NULL in, NULL out';
  END IF;

  -- ---- E2 ------------------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'mailbox.one@gmail.com', 'Mail', 'Box')
    RETURNING id, email_canonical INTO v_a, v_canon;
  IF v_canon IS DISTINCT FROM 'mailboxone@gmail.com' THEN
    RAISE EXCEPTION 'E2 FAILED: expected mailboxone@gmail.com, got %', v_canon;
  END IF;

  -- ---- E3 ------------------------------------------------------------------
  v_raised := false;
  BEGIN
    INSERT INTO users (auth_user_id, email, first_name, last_name)
      VALUES (gen_random_uuid(), 'mailboxone+2@gmail.com', 'Mail', 'Box');
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'E3 FAILED: +tag variant accepted';
  END IF;

  v_raised := false;
  BEGIN
    INSERT INTO users (auth_user_id, email, first_name, last_name)
      VALUES (gen_random_uuid(), 'MailBox.One@googlemail.com', 'Mail', 'Box');
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'E3 FAILED: googlemail variant accepted';
  END IF;

  -- ---- E4 ------------------------------------------------------------------
  v_raised := false;
  BEGIN
    INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES (v_auth, 'm.a.i.l.b.o.x.o.n.e+signup@gmail.com',
              '{"first_name":"Mail","last_name":"Box"}'::jsonb);
  EXCEPTION WHEN raise_exception THEN
    v_raised := SQLERRM LIKE 'handle_new_user failed:%';
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'E4 FAILED: auth signup with a variant was not refused by handle_new_user';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_auth) THEN
    RAISE EXCEPTION 'E4 FAILED: the refused auth row survived';
  END IF;

  -- ---- E5 ------------------------------------------------------------------
  UPDATE users SET deleted_at = now() WHERE id = v_a;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'mailboxone+back@gmail.com', 'Mail', 'Box')
    RETURNING id INTO v_b;
  IF (SELECT email_canonical FROM users WHERE id = v_b) <> 'mailboxone@gmail.com' THEN
    RAISE EXCEPTION 'E5 FAILED: the reused mailbox has no canonical address';
  END IF;

  -- ---- E6 ------------------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (gen_random_uuid(), 'grandfathered@club.my', 'Grand', 'Father')
    RETURNING id INTO v_a;
  UPDATE users SET email_canonical = NULL WHERE id = v_a;

  UPDATE users SET first_name = 'Grandpa' WHERE id = v_a;
  IF (SELECT email_canonical FROM users WHERE id = v_a) IS NOT NULL THEN
    RAISE EXCEPTION 'E6 FAILED: an unrelated update recomputed a grandfathered row';
  END IF;

  v_raised := false;
  BEGIN
    UPDATE users SET email = 'mailboxone+moved@gmail.com' WHERE id = v_a;
  EXCEPTION WHEN unique_violation THEN
    v_raised := true;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'E6 FAILED: a grandfathered row moved onto a taken mailbox';
  END IF;

  UPDATE users SET email = 'Grand.Father+x@club.my' WHERE id = v_a;
  IF (SELECT email_canonical FROM users WHERE id = v_a) <> 'grand.father@club.my' THEN
    RAISE EXCEPTION 'E6 FAILED: changing the email did not recompute the canonical address';
  END IF;

  -- ---- E7 ------------------------------------------------------------------
  IF NOT email_registered('M.A.I.L.B.O.X.O.N.E+q@googlemail.com') THEN
    RAISE EXCEPTION 'E7 FAILED: a variant of an active account is not reported';
  END IF;
  IF email_registered('someone-new@gmail.com') THEN
    RAISE EXCEPTION 'E7 FAILED: an unused mailbox is reported';
  END IF;
  UPDATE users SET deleted_at = now() WHERE id = v_b;
  IF email_registered('mailboxone@gmail.com') THEN
    RAISE EXCEPTION 'E7 FAILED: a deleted account is reported';
  END IF;

  IF has_function_privilege('anon', 'email_registered(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'email_registered(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'E7 FAILED: email_registered is executable by anon or authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'email_registered(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'E7 FAILED: email_registered is not executable by service_role';
  END IF;

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
