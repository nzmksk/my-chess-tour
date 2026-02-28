
-- Tournaments
CREATE INDEX idx_tournaments_status_start ON tournaments (status, start_date);
CREATE INDEX idx_tournaments_organizer ON tournaments (organizer_id);
CREATE INDEX idx_tournaments_state ON tournaments (venue_state);

-- Organizer members
CREATE INDEX idx_org_members_user ON organizer_members (user_id);
CREATE INDEX idx_org_members_org ON organizer_members (organizer_id);

-- Registrations
CREATE INDEX idx_registrations_user ON registrations (user_id);
CREATE INDEX idx_registrations_tournament_status ON registrations (tournament_id, status);

-- Payments
CREATE INDEX idx_payments_chip_purchase ON payments (chip_purchase_id);
CREATE INDEX idx_payments_registration ON payments (registration_id);

-- Payouts
CREATE INDEX idx_payouts_tournament ON payouts (tournament_id);

