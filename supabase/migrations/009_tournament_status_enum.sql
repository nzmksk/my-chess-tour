-- Replace the free-form varchar status column with a strict enum.
--
-- Old values outside the new enum (completed, ongoing,
-- registration_closed) are coerced to 'published' before the
-- column type is changed so existing data is preserved.

CREATE TYPE tournament_status AS ENUM ('draft', 'published');

UPDATE tournaments
SET status = 'published'
WHERE status NOT IN ('draft', 'published');

ALTER TABLE tournaments
  ALTER COLUMN status TYPE tournament_status
  USING status::tournament_status;

ALTER TABLE tournaments
  ALTER COLUMN status SET DEFAULT 'draft'::tournament_status;
