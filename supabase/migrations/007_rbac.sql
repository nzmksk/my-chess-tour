-- =============================================================================
-- Migration 007 — RBAC reference data
-- MY Chess Tour
--
-- The roles, permissions and role-permission mappings the permission checks
-- in 003 (has_global_permission, has_org_permission, ...) and the policies in
-- 004 look up by name. Every environment needs them, production included, so
-- they are a migration, not seed data (they moved here from
-- supabase/staging/seed.sql in #631). wiki/roles-and-permissions.md describes what
-- each one allows.
--
-- To change them later, add a new migration; this file has already run.
-- =============================================================================

-- =============================================
-- RBAC: Roles, Permissions, Role-Permission Mappings
-- =============================================
DO $$
DECLARE
  -- Role IDs
  r_platform_admin integer;
  r_owner          integer;
  r_admin          integer;
  r_member         integer;

  -- Permission IDs
  p_platform_manage  integer;
  p_org_manage       integer;
  p_org_invite       integer;
  p_tournament_create integer;
  p_tournament_edit   integer;
  p_tournament_delete integer;
  p_tournament_view   integer;
  p_registration_view integer;
  p_payment_view      integer;
  p_refund_manage     integer;
  p_bank_account_manage integer;
  p_payout_view       integer;
  p_payout_request    integer;
BEGIN
  -- Roles
  INSERT INTO roles (name, scope) VALUES ('platform_admin', 'global') RETURNING id INTO r_platform_admin;
  INSERT INTO roles (name, scope) VALUES ('owner', 'organization') RETURNING id INTO r_owner;
  INSERT INTO roles (name, scope) VALUES ('admin', 'organization') RETURNING id INTO r_admin;
  INSERT INTO roles (name, scope) VALUES ('member', 'organization') RETURNING id INTO r_member;

  -- Permissions
  INSERT INTO permissions (key) VALUES ('platform.manage') RETURNING id INTO p_platform_manage;
  INSERT INTO permissions (key) VALUES ('org.manage') RETURNING id INTO p_org_manage;
  INSERT INTO permissions (key) VALUES ('org.invite') RETURNING id INTO p_org_invite;
  INSERT INTO permissions (key) VALUES ('tournament.create') RETURNING id INTO p_tournament_create;
  INSERT INTO permissions (key) VALUES ('tournament.edit') RETURNING id INTO p_tournament_edit;
  INSERT INTO permissions (key) VALUES ('tournament.delete') RETURNING id INTO p_tournament_delete;
  INSERT INTO permissions (key) VALUES ('tournament.view') RETURNING id INTO p_tournament_view;
  INSERT INTO permissions (key) VALUES ('registration.view') RETURNING id INTO p_registration_view;
  INSERT INTO permissions (key) VALUES ('payment.view') RETURNING id INTO p_payment_view;
  INSERT INTO permissions (key) VALUES ('refund.manage') RETURNING id INTO p_refund_manage;
  -- Owner-only. Where the organization's money lands is not something a
  -- delegated org `admin` should be able to read or redirect.
  INSERT INTO permissions (key) VALUES ('bank_account.manage') RETURNING id INTO p_bank_account_manage;
  -- Payouts. Viewing is shared with org admins, but anything that moves money to
  -- a bank account is owner-only, the same tier as org.manage.
  INSERT INTO permissions (key) VALUES ('payout.view') RETURNING id INTO p_payout_view;
  INSERT INTO permissions (key) VALUES ('payout.request') RETURNING id INTO p_payout_request;

  -- platform_admin: platform.manage (implies all)
  INSERT INTO role_permissions (role_id, permission_id) VALUES (r_platform_admin, p_platform_manage);

  -- owner: all org permissions
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (r_owner, p_org_manage),
    (r_owner, p_org_invite),
    (r_owner, p_tournament_create),
    (r_owner, p_tournament_edit),
    (r_owner, p_tournament_delete),
    (r_owner, p_tournament_view),
    (r_owner, p_registration_view),
    (r_owner, p_payment_view),
    (r_owner, p_refund_manage),
    (r_owner, p_bank_account_manage),
    (r_owner, p_payout_view),
    (r_owner, p_payout_request);

  -- admin: all except org.manage, tournament.delete, bank_account.manage and
  -- payout.request
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (r_admin, p_org_invite),
    (r_admin, p_tournament_create),
    (r_admin, p_tournament_edit),
    (r_admin, p_tournament_view),
    (r_admin, p_registration_view),
    (r_admin, p_payment_view),
    (r_admin, p_refund_manage),
    (r_admin, p_payout_view);

  -- member: view-only
  INSERT INTO role_permissions (role_id, permission_id) VALUES
    (r_member, p_tournament_view),
    (r_member, p_registration_view);
END;
$$;
