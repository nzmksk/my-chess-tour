-- Case-insensitive unique organization names among active (non-deleted) organizations
CREATE UNIQUE INDEX idx_organizations_name_active ON organizations (lower(name)) WHERE deleted_at IS NULL;
