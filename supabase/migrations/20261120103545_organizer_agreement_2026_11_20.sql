-- =============================================
-- ORGANIZER AGREEMENT 2026-11-20 (#663)
-- The Agreement now allows early payouts while registration is open, says an
-- unpaid claw-back can end in legal action, and no longer names Kuala Lumpur
-- for disputes. Bumping the version is the re-acceptance mechanism: an
-- organization still on 2026-11-18 is asked to accept the new version, and
-- payout_recipient_problem refuses to pay it (agreement_not_current) until it
-- does.
-- =============================================

-- =============================================
-- CURRENT ORGANIZER AGREEMENT VERSION
-- The database has to refuse a stale agreement itself, even if a route is
-- bypassed, and the money functions take no version argument to trust. This is
-- the SQL twin of ORGANIZER_AGREEMENT_VERSION in src/lib/reference/legal.ts;
-- bumping that constant means a new migration replacing this function, and
-- src/lib/reference/__tests__/legal.test.ts fails until the newest definition
-- matches.
-- =============================================
CREATE OR REPLACE FUNCTION current_organizer_agreement_version()
RETURNS varchar(20)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT '2026-11-20'::varchar(20);
$$;
