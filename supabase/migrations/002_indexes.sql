-- RBAC
CREATE INDEX idx_permissions_key ON permissions (key);
CREATE INDEX idx_role_permissions_permission ON role_permissions (permission_id);
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

-- Audit logs
CREATE INDEX idx_audit_logs_table_record ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_logs_org ON audit_logs (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_audit_logs_changed_by ON audit_logs (changed_by) WHERE changed_by IS NOT NULL;
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at);

-- Payments
CREATE INDEX idx_payments_chip_transaction ON payments (chip_transaction_id);
CREATE INDEX idx_payments_registration ON payments (registration_id);
CREATE INDEX idx_payments_payout_summary ON payments (tournament_id, organization_id, type)
  INCLUDE (gross_amount_cents, platform_fee_cents)
  WHERE status = 'paid'
  AND type IN ('registration', 'player_prize');
