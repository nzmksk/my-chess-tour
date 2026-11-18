-- =============================================================================
-- ONE-OFF: bring an existing database up to #616 (in-app bug reports)
--
-- #616 edits the base migrations in place: the bug_reports table in 001, its
-- indexes in 002, and its RLS lockdown in 004. A fresh build gets all of it.
-- Everything this issue adds is repeated below, copied verbatim from those
-- files, in one transaction.
--
-- It ends in ROLLBACK, so it is a dry run until that line is changed to COMMIT.
--
-- Deploy the app AFTER committing: POST /api/v1/feedback saves each report
-- here before filing it on GitHub, so on a database without the table every
-- report fails with a 500.
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres / service role), against
-- staging first, then production.
-- =============================================================================

BEGIN;

-- 001 -------------------------------------------------------------------------
CREATE TABLE bug_reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  description         text NOT NULL,
  details             text,
  context             jsonb NOT NULL DEFAULT '{}'::jsonb,
  github_issue_number integer,
  filed_at            timestamptz,
  filing_error        text,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_bug_report_description CHECK (description ~ '[^[:space:]]'),
  CONSTRAINT chk_bug_report_filed CHECK ((github_issue_number IS NULL) = (filed_at IS NULL))
);

-- 002 -------------------------------------------------------------------------
CREATE INDEX idx_bug_reports_user ON bug_reports (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_bug_reports_unfiled ON bug_reports (created_at) WHERE github_issue_number IS NULL;

-- 004 -------------------------------------------------------------------------
ALTER TABLE bug_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins full access to bug reports"
ON bug_reports FOR ALL
USING (has_global_permission(app_user_id(), 'platform.manage'));

REVOKE UPDATE, INSERT, DELETE ON bug_reports FROM anon, authenticated;

ROLLBACK;
