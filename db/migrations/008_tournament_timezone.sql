-- =============================================
-- PER-TOURNAMENT VENUE TIMEZONE
-- Tournament dates/times belong to the venue, not the viewer: an organizer
-- enters them in the venue's local time and every viewer sees them in that same
-- timezone. Bucketing (ongoing/upcoming/past) is likewise judged against "now"
-- in the venue's timezone.
--
-- Until now that was a single platform-wide constant (Asia/Kuala_Lumpur),
-- correct only while every venue is in Malaysia. This column carries it per
-- tournament so the ASEAN expansion can host venues in other zones.
--
-- Values are IANA timezone names ('Asia/Kuala_Lumpur', 'Asia/Bangkok', …);
-- the set an organizer may pick from is enforced in the application
-- (VENUE_TIME_ZONES in src/lib/datetime.ts).
-- =============================================

-- NOT NULL + DEFAULT backfills every existing row to the Malaysian zone they
-- were all implicitly created in.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS timezone varchar(64) NOT NULL DEFAULT 'Asia/Kuala_Lumpur';

COMMENT ON COLUMN public.tournaments.timezone IS
  'IANA timezone of the venue (e.g. Asia/Kuala_Lumpur). start_date/end_date are calendar dates in this zone; timestamptz columns are instants displayed in it.';
