# 0021. The roster shows only what organizers may see

- Status: Accepted
- Date: 2026-11-21
- Issue: #470, #675

## Context

Organizers see who has registered on the manage page and can export it as a
participant list. The privacy policy's "Sharing of Data" section lists what
organizers receive about a player.

## Decision

`loadRoster` (`src/services/registrations/roster.ts`) is the one source for
both the manage page and the export, so they always agree on who's on it.

- **Only what the policy lists**: name, title, FIDE and MCF ids and ratings,
  gender, date of birth, nationality and whether the player is verified OKU,
  plus the registration's own fields. Never contact details. OKU is true only
  for a verified card; a pending or rejected application reads as false, so an
  organizer learns only the outcome that counts, as on the public profile.
- **A live registration** is confirmed or pending payment. Lapsed checkouts are
  expired first, so a `pending_payment` row is one that can still be paid; CHIP
  sends no expiry event. The sweep skips the per-row CHIP cancel, since the
  purchase's `due` already makes the link unpayable, and a failed sweep never
  blocks the roster. It runs in its own audit scope with no actor, so the
  expiries aren't attributed to whoever opened the roster (#470).
- **Seeding rating**: `pickFideRating` takes the rating for the tournament's
  time control, falling back to the next slower one for a blitz or rapid player
  without one, as FIDE's own lists are commonly used for seeding.
- **A roster with every name missing is an error.** An organizer exporting it
  would seed pairings with "Unknown". A single player whose account is gone
  shows as "Unknown".
- `loadRoster` performs no access check; callers gate first.

## Consequences

- Adding a field to the roster or the export means checking it against the
  privacy policy first; `roster.test.ts` asserts contact details stay out.
