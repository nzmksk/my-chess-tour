# 0028. A FIDE ID must carry the player's name

- Status: Accepted
- Date: 2026-11-25
- Issue: #755

## Context

[ADR 0019](0019-fide-ratings-are-scraped.md) had the name check only record a
flag. A new FIDE ID's ratings and title were imported whatever the FIDE
profile's name was, and `fide_name_verified = false` changed nothing. So any
player could enter a stronger player's ID and pick up that player's ratings
and title for eligibility and seeding. `fide_id` is set-once, so the borrowed
ID then stuck. When FIDE couldn't be reached, the ID was saved unchecked and
left for the monthly cron.

## Decision

A FIDE ID is accepted only when the FIDE profile's name matches the player's
name. The matcher stays as 0019 describes it: `matchesFideName` in
`src/services/fide/fide.ts`.

- **On save** (`resolveNewFideId` in `src/services/profile/profile-fields.ts`,
  used by `PATCH /api/v1/profile` and `PATCH /api/v1/me/dependents/[id]`):
  - A mismatch is refused with 422 `FIDE_NAME_MISMATCH` and nothing is saved.
    The message names the FIDE profile's name, which is public on
    ratings.fide.com, so a typo is easy to spot. Players can't edit their own
    names, so a genuine ID under a different spelling goes to support.
  - When FIDE can't be reached, the save is refused with 503
    `FIDE_UNAVAILABLE`. An unchecked ID is never stored.
- **Monthly sync** (`buildFideProfileUpdate` via `syncFidePlayer`): on a
  mismatch it records `fide_name_verified = false` and `fide_verified_name`,
  sets `fide_rating` to null, and leaves `title` alone, since an admin may
  have entered it. `fide_id` is kept, so a FIDE-side rename doesn't wipe a
  player's real ID. Support decides what happens to it.

## Consequences

- Names that FIDE spells differently from the player's IC, for example `Mohd`
  against `Muhammad`, are refused and need support. Loosening the matcher
  loosens this gate too.
- A FIDE outage blocks anyone setting a FIDE ID, along with the rest of that
  profile save, until FIDE is back.
- IDs saved before this change aren't re-checked until the next monthly sync.
  That sync clears their ratings if the name doesn't match, but their
  `fide_id` stays, and `checkRatedRequirements` only checks that a `fide_id`
  exists.
