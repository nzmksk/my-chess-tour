-- =============================================
-- #707: a guardian acts for their dependents through can_act_for() (part of
-- #705).
--
-- can_act_for() (003_functions_triggers.sql) was the self check, kept as a
-- seam (#501) so this could be one function body instead of a sweep through
-- every policy. It now also says yes to a guardian whose guardianship of
-- p_user_id is 'active'. A revoked or claimed guardianship stops counting the
-- moment its status changes.
--
-- Every policy that calls it widens at once. On the guardian's side they read
-- a dependent's:
--   player_profiles        read, insert and update
--   registrations          read
--   payments               read (the ones the dependent paid; the ones the
--                          guardian paid are already the guardian's own)
--   refunds                read, through the registration
--   player_bank_accounts   read
--   sensitive_data_consents read
--   prize_awards           read
-- registrations, payments and refunds have no client writes at all
-- (004_rls.sql), so a guardian writes those through the API like anyone else.
--
-- One direction only. A dependent with a login of their own doesn't gain sight
-- of the guardian's data: the row has to name the caller as guardian_user_id.
--
-- Deliberately unchanged, and still not calling can_act_for(): users,
-- user_global_roles, organization_memberships and the own-account audit_logs
-- policy. A guardian doesn't inherit a dependent's account record, platform
-- role, organization membership or change history. has_global_permission and
-- has_org_permission take the user id they're given and never consult
-- can_act_for(), so roles can't leak through them either.
--
-- The storage policies for the OKU bucket compare app_user_id() and are
-- widened separately (#717).
--
-- SECURITY DEFINER as before, so it reads guardianships without that table's
-- RLS. That policy compares app_user_id() directly for the same reason: a
-- guardian must not see other guardians' rows for the same dependent.
-- idx_guardianships_guardian_active serves the lookup.
-- =============================================
CREATE OR REPLACE FUNCTION can_act_for(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT p_user_id = app_user_id()
      OR EXISTS (SELECT 1 FROM guardianships g
                 WHERE g.guardian_user_id = app_user_id()
                   AND g.dependent_user_id = p_user_id
                   AND g.status = 'active');
$$;
