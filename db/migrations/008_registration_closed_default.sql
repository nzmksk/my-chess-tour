-- =============================================
-- REGISTRATION_CLOSED_AT BECOMES THE EFFECTIVE CLOSE TIME
-- Previously registration_closed_at was NULL until an organizer manually closed
-- registration early, and "closed early" was signalled by IS NOT NULL. It now
-- holds the effective close time for every published tournament: defaulted to
-- registration_deadline at publish and moved earlier (to now()) on manual close.
-- "Closed early" is therefore derived as registration_closed_at < registration_deadline.
-- =============================================

-- Backfill already-published tournaments that predate this change. Rows that were
-- already closed early keep their earlier timestamp; only the never-closed ones
-- (NULL) adopt the deadline as their default close time. Drafts stay NULL.
UPDATE public.tournaments
SET registration_closed_at = registration_deadline
WHERE status = 'published'
  AND registration_closed_at IS NULL;

-- Enforce the invariant: the effective close time can never be after the deadline.
-- Sync-on-edit (application code) keeps this true when the deadline moves.
ALTER TABLE public.tournaments
  ADD CONSTRAINT chk_registration_closed_at
  CHECK (
    registration_closed_at IS NULL
    OR registration_closed_at <= registration_deadline
  );

COMMENT ON COLUMN public.tournaments.registration_closed_at IS
  'Effective registration close time. NULL for drafts; defaults to registration_deadline at publish; moved earlier (to now()) when the organizer closes registration early. Never exceeds registration_deadline. Early close is irreversible.';
