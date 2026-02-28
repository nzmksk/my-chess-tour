-- Replace the free-form varchar status column with a strict enum.
--
-- Old values outside the new enum (completed, ongoing,
-- registration_closed) are coerced to 'published' before the
-- column type is changed so existing data is preserved.
--
-- The "Public can view published tournaments" policy references the
-- status column and must be dropped before the ALTER and recreated
-- after, otherwise Postgres raises error 0A000.

CREATE TYPE tournament_status AS ENUM ('draft', 'published');

UPDATE tournaments
SET status = 'published'
WHERE status NOT IN ('draft', 'published');

DROP POLICY IF EXISTS "Public can view published tournaments" ON tournaments;

ALTER TABLE tournaments
  ALTER COLUMN status DROP DEFAULT;

ALTER TABLE tournaments
  ALTER COLUMN status TYPE tournament_status
  USING status::tournament_status;

ALTER TABLE tournaments
  ALTER COLUMN status SET DEFAULT 'draft'::tournament_status;

CREATE POLICY "Public can view published tournaments"
ON tournaments FOR SELECT
USING (status = 'published'::tournament_status);
