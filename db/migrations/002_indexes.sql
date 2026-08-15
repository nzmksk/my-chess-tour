-- RBAC
CREATE INDEX idx_permissions_key ON permissions (key);
CREATE INDEX idx_role_permissions_permission ON role_permissions (permission_id);
CREATE INDEX idx_user_global_roles_role ON user_global_roles (role_id);

-- Users (partial unique: allows email reuse after soft delete)
CREATE UNIQUE INDEX idx_users_email_active ON users (email) WHERE deleted_at IS NULL;

-- Organizations (case-insensitive unique name among active, non-deleted orgs)
CREATE UNIQUE INDEX idx_organizations_name_active ON organizations (lower(name)) WHERE deleted_at IS NULL;

-- Organization bank accounts
-- Exactly one active account per org. Changing details = deactivate + insert a
-- fresh 'pending' row, which is what forces re-verification.
CREATE UNIQUE INDEX uniq_active_bank_account_per_org
  ON organization_bank_accounts (organization_id) WHERE is_active;

-- Anti-fraud: one bank account cannot be the active payout destination for two
-- organizations (payout redirection).
CREATE UNIQUE INDEX uniq_active_bank_destination
  ON organization_bank_accounts (bank_code, account_number) WHERE is_active;

-- Correlation fallback. NON-unique on purpose: CHIP may return the same
-- bank_account_id for an identical (account_number, bank_code) pair under a
-- different reference. Correlation goes via `reference` (our uuid) first.
CREATE INDEX idx_bank_accounts_chip_id ON organization_bank_accounts (chip_bank_account_id)
  WHERE chip_bank_account_id IS NOT NULL;

-- Organization documents (fetched as a set per application/organization)
CREATE INDEX idx_org_documents_org ON organization_documents (organization_id);

-- Organization memberships
CREATE INDEX idx_org_memberships_user ON organization_memberships (user_id);
CREATE INDEX idx_org_memberships_role ON organization_memberships (role_id);

-- Tournaments
CREATE INDEX idx_tournaments_status_start ON tournaments (status, start_date);
CREATE INDEX idx_tournaments_organizer ON tournaments (organization_id);
-- Public URL slug. NULLs allowed (drafts have no slug); also serves slug lookups.
CREATE UNIQUE INDEX tournaments_slug_key ON tournaments (slug);

-- Registrations
CREATE INDEX idx_registrations_user ON registrations (user_id);
CREATE INDEX idx_registrations_tournament_status ON registrations (tournament_id, status);

-- Tournament cancellation requests
-- At most one live (pending) request per tournament; a rejected request may be
-- re-filed. The API relies on this unique violation (23505) to reject duplicates.
CREATE UNIQUE INDEX uniq_pending_cancellation_per_tournament
  ON tournament_cancellation_requests (tournament_id)
  WHERE status = 'pending';
CREATE INDEX idx_cancellation_requests_status ON tournament_cancellation_requests (status, created_at);

-- Audit logs
CREATE INDEX idx_audit_logs_table_record ON audit_logs (table_name, record_id);
CREATE INDEX idx_audit_logs_org ON audit_logs (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_audit_logs_changed_by ON audit_logs (changed_by) WHERE changed_by IS NOT NULL;
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at);

-- Payments
-- Unique so one CHIP purchase id maps to at most one payment row (webhook
-- correlation can't fan out). NULLs allowed: a payment has no chip_transaction_id
-- until checkout creates the purchase.
CREATE UNIQUE INDEX idx_payments_chip_transaction ON payments (chip_transaction_id)
  WHERE chip_transaction_id IS NOT NULL;
CREATE INDEX idx_payments_registration ON payments (registration_id);
CREATE INDEX idx_payments_payout_summary ON payments (tournament_id, organization_id, type)
  INCLUDE (gross_amount_cents)
  WHERE status = 'paid'
  AND type IN ('registration', 'player_prize', 'refund', 'organizer_payout');

-- At most one paid refund per registration. Defence-in-depth alongside the
-- unique chip_transaction_id index: even if two settlement paths (sync response
-- + webhook) race, only one refund payment row can land.
CREATE UNIQUE INDEX uniq_paid_refund_per_registration ON payments (registration_id)
  WHERE type = 'refund' AND status = 'paid';

-- Refunds
-- At most one live (non-rejected) refund per registration. Refund creation on
-- tournament cancellation (review_tournament_cancellation) relies on ON CONFLICT
-- against this index to stay idempotent; a rejected refund may be re-created.
CREATE UNIQUE INDEX uniq_active_refund_per_registration ON refunds (registration_id)
  WHERE status <> 'rejected';
