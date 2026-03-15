-- RBAC
CREATE INDEX idx_permissions_key ON permissions (key);
CREATE INDEX idx_roles_permissions_permission ON roles_permissions (permission_id);
CREATE INDEX idx_user_global_roles_role ON user_global_roles (role_id);

-- Organization memberships
CREATE INDEX idx_org_memberships_user ON organization_memberships (user_id);
CREATE INDEX idx_org_memberships_role ON organization_memberships (role_id);

-- Tournaments
CREATE INDEX idx_tournaments_status_start ON tournaments (status, start_date);
CREATE INDEX idx_tournaments_organizer ON tournaments (organization_id);

-- Registrations
CREATE INDEX idx_registrations_user ON registrations (user_id);
CREATE INDEX idx_registrations_tournament_status ON registrations (tournament_id, status);

-- Payments
CREATE INDEX idx_payments_chip_transaction ON payments (chip_transaction_id);
CREATE INDEX idx_payments_registration ON payments (registration_id);
CREATE INDEX idx_payments_payout_summary ON payments (tournament_id, organization_id, type)
  INCLUDE (gross_amount_cents, platform_fee_cents)
  WHERE status = 'paid'
  AND type IN ('registration', 'player_prize');
