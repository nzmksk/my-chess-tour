-- =============================================================================
-- ONE-OFF: redact audit rows written before snapshot redaction covered them
-- (#503; redaction itself landed in #516, #518 and #503)
--
-- audit_trigger_func masks sensitive columns on the way into audit_logs, but
-- only for rows written after each column was added to audit_redacted_columns.
-- A database built from the current migrations has no older rows. A long-lived
-- one (staging, production) may: bank numbers and document paths from before
-- #516, and every organization_documents.original_filename from before #503.
--
-- Scrubbing loses audit history for these fields. That is the point, but it is
-- a deliberate call (#503, open question 1), so this file has two parts:
--
--   1. CHECK  — read-only. Run it on its own first. No rows back means there is
--               nothing to scrub; stop there.
--   2. SCRUB  — rewrites exactly the rows the check reports, in one transaction,
--               and re-runs the check before finishing. It ends in ROLLBACK,
--               so it is a dry run until that line is changed to COMMIT.
--
-- Both parts read the column list from audit_redacted_columns() and treat a row
-- as raw when redact_jsonb_columns() would change it, so they need
-- 003_functions_triggers.sql as of #503 (that function, and the idempotent
-- redact_jsonb_columns). Re-running the scrub is safe: a second pass finds
-- nothing.
--
-- HOW TO RUN: Supabase SQL editor (or psql as postgres / service role), against
-- staging first, then production.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. CHECK (read-only)
-- -----------------------------------------------------------------------------
SELECT a.table_name,
       count(*)          AS raw_rows,
       min(a.created_at) AS oldest,
       max(a.created_at) AS newest
FROM audit_logs a
WHERE cardinality(audit_redacted_columns(a.table_name)) > 0
  AND (   a.old_data IS DISTINCT FROM redact_jsonb_columns(a.old_data, audit_redacted_columns(a.table_name))
       OR a.new_data IS DISTINCT FROM redact_jsonb_columns(a.new_data, audit_redacted_columns(a.table_name)))
GROUP BY a.table_name
ORDER BY a.table_name;


-- -----------------------------------------------------------------------------
-- 2. SCRUB — ends in ROLLBACK, so running the whole file is still a dry run.
--    Change the last line to COMMIT once the reported count matches the check.
-- -----------------------------------------------------------------------------
BEGIN;

DO $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE audit_logs a
  SET old_data = redact_jsonb_columns(a.old_data, audit_redacted_columns(a.table_name)),
      new_data = redact_jsonb_columns(a.new_data, audit_redacted_columns(a.table_name))
  WHERE cardinality(audit_redacted_columns(a.table_name)) > 0
    AND (   a.old_data IS DISTINCT FROM redact_jsonb_columns(a.old_data, audit_redacted_columns(a.table_name))
         OR a.new_data IS DISTINCT FROM redact_jsonb_columns(a.new_data, audit_redacted_columns(a.table_name)));
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE cardinality(audit_redacted_columns(a.table_name)) > 0
      AND (   a.old_data IS DISTINCT FROM redact_jsonb_columns(a.old_data, audit_redacted_columns(a.table_name))
           OR a.new_data IS DISTINCT FROM redact_jsonb_columns(a.new_data, audit_redacted_columns(a.table_name)))
  ) THEN
    RAISE EXCEPTION 'scrub incomplete: raw values remain in audit_logs after redacting % rows', v_rows;
  END IF;
  RAISE NOTICE 'redacted % audit rows; none left raw', v_rows;
END $$;

ROLLBACK;  -- dry run; change to COMMIT to keep the scrub
