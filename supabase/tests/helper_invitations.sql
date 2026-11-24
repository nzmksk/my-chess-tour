-- =============================================================================
-- Regression test: a player invites a helper to their existing account (#719).
--
-- Covers:
--   H1  the player invites: a pending row with the token's hash, a lower-cased
--       address and a 72-hour expiry; inviting the same address again replaces
--       the token and restarts the expiry on the same row
--   H2  who may invite: not a managed account, not a self account under 18,
--       not to their own mailbox (any variant), not as a legal guardian, not
--       to someone who already helps them, not to a malformed address
--   H3  the helper accepts while signed in as the invited mailbox: an active
--       'authorised' / 'player_invite' guardianship over the player's own
--       account, which stays 'self' with its login; the invitation is used up
--       and links the guardianship; the helper can act for the player through
--       can_act_for(); a different account, or a second accept, is refused
--   H4  an expired invitation can't be accepted or declined; declining with
--       the token needs no account, is idempotent, and closes the invitation
--   H5  the player withdraws a pending invitation; nobody else can
--   H6  either side ends the relationship: a stranger can't; the player
--       revokes, and the helper loses access at once; accepting a fresh
--       invitation reactivates the same guardianship row; the helper steps down
--   H7  a helper must be a self-managed adult with a login
--   H8  every step is audited
--   H9  clients can't call the functions or write invitations; the player
--       reads their own invitations, nobody else does
--
-- HOW TO RUN: paste into the Supabase SQL editor AFTER applying the current
-- migrations. Runs inside a transaction that ROLLBACKs, so it builds throwaway
-- fixtures and persists NOTHING. A failing assertion RAISEs; on success it
-- prints "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_minor_dob     date := ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '16 years')::date;
  v_player_auth   uuid := gen_random_uuid();
  v_helper_auth   uuid := gen_random_uuid();
  v_other_auth    uuid := gen_random_uuid();
  v_minor_auth    uuid := gen_random_uuid();
  v_player        uuid;
  v_helper        uuid;
  v_other         uuid;
  v_minor         uuid;
  v_managed       uuid;
  v_res           jsonb;
  v_inv           uuid;
  v_inv2          uuid;
  v_guardianship  uuid;
  v_count         integer;
  v_row           record;
BEGIN
  -- ---- fixtures ------------------------------------------------------------
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_player_auth, 'blind.player@gmail.com', 'Bea', 'Player')
    RETURNING id INTO v_player;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_helper_auth, 'helper.one@gmail.com', 'Hal', 'Helper')
    RETURNING id INTO v_helper;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_other_auth, 'helper-other@test.local', 'Otto', 'Other')
    RETURNING id INTO v_other;
  INSERT INTO users (auth_user_id, email, first_name, last_name)
    VALUES (v_minor_auth, 'helper-minor@test.local', 'Mo', 'Minor')
    RETURNING id INTO v_minor;
  INSERT INTO users (email, first_name, last_name, account_type)
    VALUES (NULL, 'Mia', 'Managed', 'managed')
    RETURNING id INTO v_managed;
  INSERT INTO player_profiles (user_id) VALUES (v_player), (v_helper), (v_other), (v_managed);
  INSERT INTO player_profiles (user_id, date_of_birth) VALUES (v_minor, v_minor_dob);

  -- ===== H1 ===============================================================
  v_res := create_helper_invitation(v_player, '  HelperOne+carer@Gmail.com ', 'carer', repeat('a', 64));
  v_inv := (v_res->>'invitation_id')::uuid;
  SELECT * INTO v_row FROM helper_invitations WHERE id = v_inv;
  IF v_row.status <> 'pending' OR v_row.email <> 'helperone+carer@gmail.com'
     OR v_row.token_hash <> repeat('a', 64) OR v_row.relationship <> 'carer'
     OR v_row.expires_at NOT BETWEEN now() + interval '71 hours' AND now() + interval '73 hours' THEN
    RAISE EXCEPTION 'H1 FAIL: invitation is %', row_to_json(v_row);
  END IF;

  UPDATE helper_invitations SET expires_at = now() + interval '1 hour' WHERE id = v_inv;
  v_res := create_helper_invitation(v_player, 'helperone+carer@gmail.com', 'coach', repeat('b', 64));
  IF (v_res->>'invitation_id')::uuid <> v_inv THEN
    RAISE EXCEPTION 'H1 FAIL: inviting again created a second pending row';
  END IF;
  SELECT * INTO v_row FROM helper_invitations WHERE id = v_inv;
  IF v_row.token_hash <> repeat('b', 64) OR v_row.relationship <> 'coach'
     OR v_row.expires_at < now() + interval '71 hours' THEN
    RAISE EXCEPTION 'H1 FAIL: inviting again didn''t refresh the invitation: %', row_to_json(v_row);
  END IF;
  IF EXISTS (SELECT 1 FROM helper_invitations WHERE token_hash = repeat('a', 64)) THEN
    RAISE EXCEPTION 'H1 FAIL: the old token still matches';
  END IF;
  RAISE NOTICE 'H1 PASS: the player invites, and inviting again refreshes the link';

  -- ===== H2 ===============================================================
  BEGIN
    PERFORM create_helper_invitation(v_managed, 'x@test.local', 'carer', repeat('c', 64));
    RAISE EXCEPTION 'H2 FAIL: a managed account invited a helper';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'HELPER_INVITE_NOT_ALLOWED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_helper_invitation(v_minor, 'x@test.local', 'carer', repeat('c', 64));
    RAISE EXCEPTION 'H2 FAIL: an under-18 self account invited a helper';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'HELPER_INVITE_NOT_ALLOWED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_helper_invitation(v_player, 'Blind.Player+me@googlemail.com', 'carer', repeat('c', 64));
    RAISE EXCEPTION 'H2 FAIL: the player invited their own mailbox';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'HELPER_SELF%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_helper_invitation(v_player, 'x@test.local', 'legal_guardian', repeat('c', 64));
    RAISE EXCEPTION 'H2 FAIL: a helper was invited as a legal guardian';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVALID_HELPER_INVITATION%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM create_helper_invitation(v_player, 'not-an-address', 'carer', repeat('c', 64));
    RAISE EXCEPTION 'H2 FAIL: a malformed address was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVALID_HELPER_INVITATION%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'H2 PASS: only an adult self-managed player invites someone else';

  -- ===== H3 ===============================================================
  BEGIN
    PERFORM accept_helper_invitation(repeat('b', 64), v_other, '2026-11-24');
    RAISE EXCEPTION 'H3 FAIL: a different account accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM NOT LIKE 'INVITATION_WRONG_ACCOUNT%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM accept_helper_invitation(repeat('9', 64), v_helper, '2026-11-24');
    RAISE EXCEPTION 'H3 FAIL: an unknown token was accepted';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM NOT LIKE 'INVITATION_NOT_FOUND%' THEN RAISE; END IF;
  END;

  v_res := accept_helper_invitation(repeat('b', 64), v_helper, '2026-11-24');
  v_guardianship := (v_res->>'guardianship_id')::uuid;
  SELECT * INTO v_row FROM guardianships WHERE id = v_guardianship;
  IF v_row.guardian_user_id <> v_helper OR v_row.dependent_user_id <> v_player
     OR v_row.status <> 'active' OR v_row.basis <> 'authorised'
     OR v_row.authorisation_method <> 'player_invite' OR v_row.relationship <> 'coach'
     OR v_row.terms_version <> '2026-11-24' THEN
    RAISE EXCEPTION 'H3 FAIL: guardianship is %', row_to_json(v_row);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_player AND account_type = 'self'
                 AND auth_user_id = v_player_auth) THEN
    RAISE EXCEPTION 'H3 FAIL: the player''s account changed';
  END IF;
  SELECT * INTO v_row FROM helper_invitations WHERE id = v_inv;
  IF v_row.status <> 'accepted' OR v_row.responded_by <> v_helper
     OR v_row.guardianship_id <> v_guardianship OR v_row.responded_at IS NULL THEN
    RAISE EXCEPTION 'H3 FAIL: invitation after accept is %', row_to_json(v_row);
  END IF;

  BEGIN
    PERFORM accept_helper_invitation(repeat('b', 64), v_helper, '2026-11-24');
    RAISE EXCEPTION 'H3 FAIL: the invitation was used twice';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVITATION_CLOSED%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM create_helper_invitation(v_player, 'HELPER.ONE@gmail.com', 'carer', repeat('c', 64));
    RAISE EXCEPTION 'H3 FAIL: re-invited someone already helping';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'HELPER_ALREADY_ACTIVE%' THEN RAISE; END IF;
  END;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_helper_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM player_profiles WHERE user_id = v_player;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'H3 FAIL: the helper can''t act for the player';
  END IF;
  RAISE NOTICE 'H3 PASS: accepting creates the guardianship once';

  -- ===== H4 ===============================================================
  v_res := create_helper_invitation(v_player, 'helper-other@test.local', 'other', repeat('d', 64));
  v_inv2 := (v_res->>'invitation_id')::uuid;
  UPDATE helper_invitations SET created_at = now() - interval '4 days',
                                expires_at = now() - interval '1 day'
    WHERE id = v_inv2;
  BEGIN
    PERFORM accept_helper_invitation(repeat('d', 64), v_other, '2026-11-24');
    RAISE EXCEPTION 'H4 FAIL: an expired invitation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVITATION_EXPIRED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM decline_helper_invitation(repeat('d', 64));
    RAISE EXCEPTION 'H4 FAIL: an expired invitation was declined';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVITATION_EXPIRED%' THEN RAISE; END IF;
  END;

  v_res := create_helper_invitation(v_player, 'helper-other@test.local', 'other', repeat('e', 64));
  IF (v_res->>'invitation_id')::uuid <> v_inv2 THEN
    RAISE EXCEPTION 'H4 FAIL: re-inviting after expiry didn''t reuse the pending row';
  END IF;
  v_res := decline_helper_invitation(repeat('e', 64));
  IF (v_res->>'already_declined')::boolean THEN
    RAISE EXCEPTION 'H4 FAIL: a first decline reported already_declined';
  END IF;
  v_res := decline_helper_invitation(repeat('e', 64), v_other);
  IF NOT (v_res->>'already_declined')::boolean THEN
    RAISE EXCEPTION 'H4 FAIL: a second decline wasn''t idempotent';
  END IF;
  BEGIN
    PERFORM accept_helper_invitation(repeat('e', 64), v_other, '2026-11-24');
    RAISE EXCEPTION 'H4 FAIL: a declined invitation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVITATION_CLOSED%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'H4 PASS: expiry and declining close the invitation';

  -- ===== H5 ===============================================================
  v_res := create_helper_invitation(v_player, 'helper-other@test.local', 'other', repeat('f', 64));
  v_inv2 := (v_res->>'invitation_id')::uuid;
  BEGIN
    PERFORM revoke_helper_invitation(v_other, v_inv2);
    RAISE EXCEPTION 'H5 FAIL: someone else withdrew the player''s invitation';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM NOT LIKE 'INVITATION_NOT_FOUND%' THEN RAISE; END IF;
  END;
  v_res := revoke_helper_invitation(v_player, v_inv2);
  IF (v_res->>'already_revoked')::boolean
     OR NOT EXISTS (SELECT 1 FROM helper_invitations WHERE id = v_inv2 AND status = 'revoked') THEN
    RAISE EXCEPTION 'H5 FAIL: withdrawing returned %', v_res;
  END IF;
  BEGIN
    PERFORM accept_helper_invitation(repeat('f', 64), v_other, '2026-11-24');
    RAISE EXCEPTION 'H5 FAIL: a withdrawn invitation was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVITATION_CLOSED%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'H5 PASS: the player withdraws a pending invitation';

  -- ===== H6 ===============================================================
  BEGIN
    PERFORM end_helper_guardianship(v_other, v_guardianship);
    RAISE EXCEPTION 'H6 FAIL: a stranger ended the relationship';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM NOT LIKE 'HELPER_NOT_FOUND%' THEN RAISE; END IF;
  END;

  v_res := end_helper_guardianship(v_player, v_guardianship);
  IF v_res->>'ended_by' <> 'player' THEN
    RAISE EXCEPTION 'H6 FAIL: player revoke returned %', v_res;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM guardianships WHERE id = v_guardianship
                 AND status = 'revoked' AND revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'H6 FAIL: the guardianship wasn''t revoked';
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_helper_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM player_profiles WHERE user_id = v_player;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'H6 FAIL: the helper still acts for the player after revoke';
  END IF;

  BEGIN
    PERFORM end_helper_guardianship(v_player, v_guardianship);
    RAISE EXCEPTION 'H6 FAIL: ended twice';
  EXCEPTION WHEN no_data_found THEN
    IF SQLERRM NOT LIKE 'HELPER_NOT_FOUND%' THEN RAISE; END IF;
  END;

  PERFORM create_helper_invitation(v_player, 'helper.one@gmail.com', 'carer', repeat('1', 64));
  v_res := accept_helper_invitation(repeat('1', 64), v_helper, '2026-12-01');
  IF (v_res->>'guardianship_id')::uuid <> v_guardianship THEN
    RAISE EXCEPTION 'H6 FAIL: a fresh accept created a second guardianship row';
  END IF;
  SELECT * INTO v_row FROM guardianships WHERE id = v_guardianship;
  IF v_row.status <> 'active' OR v_row.revoked_at IS NOT NULL
     OR v_row.relationship <> 'carer' OR v_row.terms_version <> '2026-12-01' THEN
    RAISE EXCEPTION 'H6 FAIL: reactivated guardianship is %', row_to_json(v_row);
  END IF;

  v_res := end_helper_guardianship(v_helper, v_guardianship);
  IF v_res->>'ended_by' <> 'helper' THEN
    RAISE EXCEPTION 'H6 FAIL: step down returned %', v_res;
  END IF;
  RAISE NOTICE 'H6 PASS: the player revokes and the helper steps down';

  -- ===== H7 ===============================================================
  PERFORM create_helper_invitation(v_player, 'helper-minor@test.local', 'other', repeat('2', 64));
  BEGIN
    PERFORM accept_helper_invitation(repeat('2', 64), v_minor, '2026-11-24');
    RAISE EXCEPTION 'H7 FAIL: an under-18 account became a helper';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'HELPER_NOT_ELIGIBLE%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'H7 PASS: a helper must be a self-managed adult';

  -- ===== H8 ===============================================================
  SELECT count(*) INTO v_count FROM audit_logs
    WHERE table_name = 'helper_invitations' AND record_id = v_inv::text;
  IF v_count < 3 THEN
    RAISE EXCEPTION 'H8 FAIL: % audit rows for the invitation (expected invite, refresh and accept)', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM audit_logs
    WHERE table_name = 'guardianships' AND record_id = v_guardianship::text;
  IF v_count < 4 THEN
    RAISE EXCEPTION 'H8 FAIL: % audit rows for the guardianship (expected accept, revoke, re-accept and step down)', v_count;
  END IF;
  RAISE NOTICE 'H8 PASS: every step is audited';

  -- ===== H9 ===============================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_player_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM helper_invitations;
  RESET ROLE;
  IF v_count < 4 THEN
    RAISE EXCEPTION 'H9 FAIL: the player sees % of their invitations', v_count;
  END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_helper_auth, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_count FROM helper_invitations;
  RESET ROLE;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'H9 FAIL: the helper reads % invitations through the table', v_count;
  END IF;

  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM create_helper_invitation(v_helper, 'x@test.local', 'carer', repeat('3', 64));
    RAISE EXCEPTION 'H9 FAIL: a client called create_helper_invitation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM accept_helper_invitation(repeat('2', 64), v_helper, '2026-11-24');
    RAISE EXCEPTION 'H9 FAIL: a client called accept_helper_invitation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM end_helper_guardianship(v_helper, v_guardianship);
    RAISE EXCEPTION 'H9 FAIL: a client called end_helper_guardianship';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO helper_invitations (player_user_id, email, relationship, token_hash, expires_at)
      VALUES (v_helper, 'x@test.local', 'carer', repeat('4', 64), now() + interval '1 day');
    RAISE EXCEPTION 'H9 FAIL: a client inserted an invitation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '{}', true);
  RAISE NOTICE 'H9 PASS: clients can''t write, and only the player reads';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END $$;

ROLLBACK;
