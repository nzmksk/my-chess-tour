-- =============================================================================
-- Regression test for organization invitations (#121).
--
-- An invitation grants nothing until the invited person accepts it, signed in
-- with the address it was sent to, within 30 days. Load-bearing invariants:
--
--   1. Only accepting creates a membership, and only for the invited address.
--   2. Expiry needs no job: once expires_at passes, accept and decline refuse.
--   3. One pending invitation per organization and address; inviting again
--      refreshes it (new token, role and expiry) instead of stacking rows.
--
-- Covers:
--   I1  create inserts a pending row, lowercased, expiring in 30 days
--   I2  inviting the same address again refreshes the same row (resent = true)
--   I3  a caller without org.invite is refused (42501)
--   I4  owner and unknown roles are refused (22023)
--   I5  an address that already belongs to a member is refused (23505)
--   I6  an unapproved organization can't invite (INVITATION_ORG_UNAVAILABLE)
--   I7  accepting from a different account is refused and changes nothing
--   I8  accepting inserts the membership with the offered role; again is a no-op
--   I9  an expired invitation can be neither accepted nor declined
--   I10 declining needs no account; accepting afterwards is refused
--   I11 revoking needs org.invite; a revoked link can't be accepted
--   I12 a closed invitation frees the address for a fresh one
--   I13 clients have no access to the table at all
--   I14 from the invitee's own list (by id), only the invitee can decline
--   I15 from the invitee's own list (by id), only the invitee can accept
--   I16 the link-based functions report which invitation they answered
--
-- HOW TO RUN: paste into the Supabase SQL editor (service role) AFTER applying
-- the current migrations and seed (the owner/admin/member roles and their
-- permissions come from 006). Runs inside a transaction that ROLLBACKs, so it
-- persists NOTHING. A failing assertion RAISEs; on success it prints
-- "ALL SCENARIOS PASSED" via NOTICE.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_owner_role  integer;
  v_admin_role  integer;
  v_member_role integer;
  v_owner       uuid;
  v_member      uuid;
  v_invitee     uuid;
  v_stranger    uuid;
  v_org         uuid;
  v_pending_org uuid;
  v_res         jsonb;
  v_id          uuid;
  v_inv         organization_invitations;
  v_count       integer;
  v_hash_a      text := encode(sha256('token-a'::bytea), 'hex');
  v_hash_b      text := encode(sha256('token-b'::bytea), 'hex');
  v_hash_c      text := encode(sha256('token-c'::bytea), 'hex');
  v_hash_d      text := encode(sha256('token-d'::bytea), 'hex');
  v_hash_e      text := encode(sha256('token-e'::bytea), 'hex');
  v_hash_g      text := encode(sha256('token-g'::bytea), 'hex');
  v_hash_h      text := encode(sha256('token-h'::bytea), 'hex');
BEGIN
  SELECT id INTO v_owner_role  FROM roles WHERE name = 'owner'  AND scope = 'organization';
  SELECT id INTO v_admin_role  FROM roles WHERE name = 'admin'  AND scope = 'organization';
  SELECT id INTO v_member_role FROM roles WHERE name = 'member' AND scope = 'organization';
  IF v_owner_role IS NULL OR v_admin_role IS NULL OR v_member_role IS NULL THEN
    RAISE EXCEPTION 'SETUP FAIL: organization roles missing — apply 006_seed.sql first';
  END IF;

  INSERT INTO users (email, first_name, last_name) VALUES ('inv-owner@test.local', 'O', 'T')    RETURNING id INTO v_owner;
  INSERT INTO users (email, first_name, last_name) VALUES ('inv-member@test.local', 'M', 'T')   RETURNING id INTO v_member;
  INSERT INTO users (email, first_name, last_name) VALUES ('inv-invitee@test.local', 'I', 'T')  RETURNING id INTO v_invitee;
  INSERT INTO users (email, first_name, last_name) VALUES ('inv-stranger@test.local', 'S', 'T') RETURNING id INTO v_stranger;

  INSERT INTO organizations (name, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('INV ORG', 'society', current_organizer_agreement_version(), now(), 'approved')
    RETURNING id INTO v_org;
  INSERT INTO organizations (name, entity_type, agreement_version, agreement_accepted_at, approval_status)
    VALUES ('INV PENDING ORG', 'society', current_organizer_agreement_version(), now(), 'pending')
    RETURNING id INTO v_pending_org;

  INSERT INTO organization_memberships (organization_id, user_id, role_id) VALUES
    (v_org, v_owner, v_owner_role),
    (v_org, v_member, v_member_role),
    (v_pending_org, v_owner, v_owner_role);

  -- ---- I1: create -----------------------------------------------------------
  v_res := create_organization_invitation(v_org, '  Inv-Invitee@Test.Local ', 'member', v_owner, v_hash_a);
  v_id := (v_res->>'id')::uuid;
  SELECT * INTO v_inv FROM organization_invitations WHERE id = v_id;
  IF v_inv.email <> 'inv-invitee@test.local' OR v_inv.status <> 'pending'
     OR v_inv.role_id <> v_member_role OR v_inv.token_hash <> v_hash_a
     OR (v_res->>'resent')::boolean THEN
    RAISE EXCEPTION 'I1 FAIL: unexpected row %', row_to_json(v_inv);
  END IF;
  IF v_inv.expires_at NOT BETWEEN now() + interval '30 days' - interval '1 minute'
                              AND now() + interval '30 days' + interval '1 minute' THEN
    RAISE EXCEPTION 'I1 FAIL: expires_at % is not 30 days out', v_inv.expires_at;
  END IF;
  RAISE NOTICE 'I1 PASS — pending, lowercased, expires in 30 days';

  -- ---- I2: invite again refreshes ------------------------------------------
  UPDATE organization_invitations SET expires_at = now() - interval '1 day' WHERE id = v_id;
  v_res := create_organization_invitation(v_org, 'inv-invitee@test.local', 'admin', v_owner, v_hash_b);
  SELECT count(*) INTO v_count FROM organization_invitations
   WHERE organization_id = v_org AND email = 'inv-invitee@test.local';
  SELECT * INTO v_inv FROM organization_invitations WHERE id = v_id;
  IF (v_res->>'id')::uuid <> v_id OR v_count <> 1 OR NOT (v_res->>'resent')::boolean
     OR v_inv.token_hash <> v_hash_b OR v_inv.role_id <> v_admin_role
     OR v_inv.expires_at < now() + interval '29 days' THEN
    RAISE EXCEPTION 'I2 FAIL: re-invite did not refresh the row (% rows, %)', v_count, row_to_json(v_inv);
  END IF;
  RAISE NOTICE 'I2 PASS — re-invite refreshes token, role and expiry on the same row';

  -- ---- I3: no org.invite ----------------------------------------------------
  BEGIN
    PERFORM create_organization_invitation(v_org, 'x@test.local', 'member', v_member, v_hash_c);
    RAISE EXCEPTION 'I3 FAIL: a member without org.invite created an invitation';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'I3 PASS — org.invite required';
  END;

  -- ---- I4: roles that can't be offered -------------------------------------
  BEGIN
    PERFORM create_organization_invitation(v_org, 'x@test.local', 'owner', v_owner, v_hash_c);
    RAISE EXCEPTION 'I4 FAIL: owner offered by invitation';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  BEGIN
    PERFORM create_organization_invitation(v_org, 'x@test.local', 'platform_admin', v_owner, v_hash_c);
    RAISE EXCEPTION 'I4 FAIL: a global role offered by invitation';
  EXCEPTION WHEN sqlstate '22023' THEN NULL;
  END;
  RAISE NOTICE 'I4 PASS — only admin and member can be offered';

  -- ---- I5: already a member -------------------------------------------------
  BEGIN
    PERFORM create_organization_invitation(v_org, 'INV-MEMBER@test.local', 'admin', v_owner, v_hash_c);
    RAISE EXCEPTION 'I5 FAIL: invited an existing member';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'I5 PASS — an existing member can''t be invited';
  END;

  -- ---- I6: unapproved organization -----------------------------------------
  BEGIN
    PERFORM create_organization_invitation(v_pending_org, 'x@test.local', 'member', v_owner, v_hash_c);
    RAISE EXCEPTION 'I6 FAIL: an unapproved organization invited someone';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVITATION_ORG_UNAVAILABLE%' THEN RAISE; END IF;
    RAISE NOTICE 'I6 PASS — unapproved organizations can''t invite';
  END;

  -- ---- I7: wrong account ----------------------------------------------------
  BEGIN
    PERFORM accept_organization_invitation(v_hash_b, v_stranger);
    RAISE EXCEPTION 'I7 FAIL: a different account accepted the invitation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT * INTO v_inv FROM organization_invitations WHERE id = v_id;
  IF v_inv.status <> 'pending' OR EXISTS (
    SELECT 1 FROM organization_memberships WHERE organization_id = v_org AND user_id = v_stranger
  ) THEN
    RAISE EXCEPTION 'I7 FAIL: the refused accept changed something';
  END IF;
  RAISE NOTICE 'I7 PASS — only the invited address can accept';

  -- ---- I8: accept -----------------------------------------------------------
  v_res := accept_organization_invitation(v_hash_b, v_invitee);
  SELECT * INTO v_inv FROM organization_invitations WHERE id = v_id;
  IF (v_res->>'organization_id')::uuid <> v_org OR (v_res->>'already_accepted')::boolean
     OR v_inv.status <> 'accepted' OR v_inv.responded_by <> v_invitee OR v_inv.responded_at IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM organization_memberships
        WHERE organization_id = v_org AND user_id = v_invitee AND role_id = v_admin_role
     ) THEN
    RAISE EXCEPTION 'I8 FAIL: accept did not grant the offered role (%)', v_res;
  END IF;
  v_res := accept_organization_invitation(v_hash_b, v_invitee);
  IF NOT (v_res->>'already_accepted')::boolean THEN
    RAISE EXCEPTION 'I8 FAIL: a repeated accept was not idempotent (%)', v_res;
  END IF;
  RAISE NOTICE 'I8 PASS — accept grants the offered role; repeating it is a no-op';

  -- ---- I9: expired ----------------------------------------------------------
  v_res := create_organization_invitation(v_org, 'inv-stranger@test.local', 'member', v_owner, v_hash_c);
  UPDATE organization_invitations SET expires_at = now() - interval '1 second'
   WHERE id = (v_res->>'id')::uuid;
  BEGIN
    PERFORM accept_organization_invitation(v_hash_c, v_stranger);
    RAISE EXCEPTION 'I9 FAIL: accepted an expired invitation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVITATION_EXPIRED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM decline_organization_invitation(v_hash_c, NULL);
    RAISE EXCEPTION 'I9 FAIL: declined an expired invitation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVITATION_EXPIRED%' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM organization_memberships WHERE organization_id = v_org AND user_id = v_stranger) THEN
    RAISE EXCEPTION 'I9 FAIL: an expired invitation granted a membership';
  END IF;
  RAISE NOTICE 'I9 PASS — expired invitations can be neither accepted nor declined';

  -- ---- I10: decline ---------------------------------------------------------
  -- Re-inviting the expired address refreshes it, so it can be declined.
  PERFORM create_organization_invitation(v_org, 'inv-stranger@test.local', 'member', v_owner, v_hash_d);
  v_res := decline_organization_invitation(v_hash_d, NULL);
  SELECT * INTO v_inv FROM organization_invitations WHERE token_hash = v_hash_d;
  IF v_inv.status <> 'declined' OR v_inv.responded_by IS NOT NULL
     OR (v_res->>'already_declined')::boolean THEN
    RAISE EXCEPTION 'I10 FAIL: decline did not close the invitation (%)', row_to_json(v_inv);
  END IF;
  v_res := decline_organization_invitation(v_hash_d, NULL);
  IF NOT (v_res->>'already_declined')::boolean THEN
    RAISE EXCEPTION 'I10 FAIL: a repeated decline was not idempotent';
  END IF;
  BEGIN
    PERFORM accept_organization_invitation(v_hash_d, v_stranger);
    RAISE EXCEPTION 'I10 FAIL: accepted a declined invitation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVITATION_CLOSED%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'I10 PASS — decline needs no account and closes the invitation';

  -- ---- I11: revoke ----------------------------------------------------------
  v_res := create_organization_invitation(v_org, 'inv-stranger@test.local', 'member', v_owner, v_hash_e);
  v_id := (v_res->>'id')::uuid;
  BEGIN
    PERFORM revoke_organization_invitation(v_id, v_org, v_member);
    RAISE EXCEPTION 'I11 FAIL: a member without org.invite revoked an invitation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM revoke_organization_invitation(v_id, v_org, v_owner);
  BEGIN
    PERFORM accept_organization_invitation(v_hash_e, v_stranger);
    RAISE EXCEPTION 'I11 FAIL: accepted a revoked invitation';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'INVITATION_CLOSED%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM revoke_organization_invitation(v_id, v_pending_org, v_owner);
    RAISE EXCEPTION 'I11 FAIL: revoked through another organization';
  EXCEPTION WHEN sqlstate 'P0002' THEN NULL;
  END;
  RAISE NOTICE 'I11 PASS — revoke needs org.invite and kills the link';

  -- ---- I12: a closed invitation frees the address ---------------------------
  v_res := create_organization_invitation(v_org, 'inv-stranger@test.local', 'member', v_owner,
                                          encode(sha256('token-f'::bytea), 'hex'));
  IF (v_res->>'resent')::boolean OR (v_res->>'id')::uuid = v_id THEN
    RAISE EXCEPTION 'I12 FAIL: a closed invitation was reused (%)', v_res;
  END IF;
  SELECT count(*) INTO v_count FROM organization_invitations
   WHERE organization_id = v_org AND email = 'inv-stranger@test.local';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'I12 FAIL: expected 3 rows of history for the address, found %', v_count;
  END IF;
  RAISE NOTICE 'I12 PASS — declined and revoked rows stay as history; a new invitation is a new row';

  -- ---- I13: no client access -----------------------------------------------
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM organization_invitations LIMIT 1;
    RAISE EXCEPTION 'I13 FAIL: authenticated can read organization_invitations';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM organization_invitations LIMIT 1;
    RAISE EXCEPTION 'I13 FAIL: anon can read organization_invitations';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RESET ROLE;
  RAISE NOTICE 'I13 PASS — clients have no access to invitations';

  -- ---- I14: decline by id -------------------------------------------------
  -- I12 left the stranger one pending invitation.
  SELECT id INTO v_id FROM organization_invitations
   WHERE organization_id = v_org AND email = 'inv-stranger@test.local' AND status = 'pending';
  BEGIN
    PERFORM decline_organization_invitation_by_id(v_id, v_invitee);
    RAISE EXCEPTION 'I14 FAIL: another account declined by id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM decline_organization_invitation_by_id(v_id, NULL);
    RAISE EXCEPTION 'I14 FAIL: declined by id with no account';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  v_res := decline_organization_invitation_by_id(v_id, v_stranger);
  SELECT * INTO v_inv FROM organization_invitations WHERE id = v_id;
  IF v_inv.status <> 'declined' OR v_inv.responded_by <> v_stranger
     OR (v_res->>'invitation_id')::uuid <> v_id OR (v_res->>'already_declined')::boolean THEN
    RAISE EXCEPTION 'I14 FAIL: the invitee could not decline by id (%)', v_res;
  END IF;
  IF NOT (decline_organization_invitation_by_id(v_id, v_stranger)->>'already_declined')::boolean THEN
    RAISE EXCEPTION 'I14 FAIL: a repeated decline by id was not idempotent';
  END IF;
  RAISE NOTICE 'I14 PASS — only the invitee can decline by id';

  -- ---- I15: accept by id --------------------------------------------------
  v_res := create_organization_invitation(v_org, 'inv-stranger@test.local', 'member', v_owner, v_hash_g);
  v_id := (v_res->>'id')::uuid;
  BEGIN
    PERFORM accept_organization_invitation_by_id(v_id, v_invitee);
    RAISE EXCEPTION 'I15 FAIL: another account accepted by id';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  v_res := accept_organization_invitation_by_id(v_id, v_stranger);
  IF (v_res->>'invitation_id')::uuid <> v_id OR NOT EXISTS (
    SELECT 1 FROM organization_memberships
     WHERE organization_id = v_org AND user_id = v_stranger AND role_id = v_member_role
  ) THEN
    RAISE EXCEPTION 'I15 FAIL: the invitee could not accept by id (%)', v_res;
  END IF;
  RAISE NOTICE 'I15 PASS — only the invitee can accept by id';

  -- ---- I16: link-based results name the invitation ------------------------
  v_res := create_organization_invitation(v_org, 'no-account@test.local', 'member', v_owner, v_hash_h);
  v_id := (v_res->>'id')::uuid;
  v_res := decline_organization_invitation(v_hash_h, NULL);
  IF (v_res->>'invitation_id')::uuid IS DISTINCT FROM v_id THEN
    RAISE EXCEPTION 'I16 FAIL: decline by link did not name the invitation (%)', v_res;
  END IF;
  IF (accept_organization_invitation(v_hash_b, v_invitee)->>'invitation_id') IS NULL THEN
    RAISE EXCEPTION 'I16 FAIL: accept by link did not name the invitation';
  END IF;
  RAISE NOTICE 'I16 PASS — accept and decline by link report the invitation id';

  RAISE NOTICE 'ALL SCENARIOS PASSED';
END;
$$;

ROLLBACK;
