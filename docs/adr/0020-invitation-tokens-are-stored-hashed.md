# 0020. Invitation tokens are stored hashed

- Status: Accepted
- Date: 2026-11-21
- Issue: #121, #675

## Context

An organization invitation is a link emailed to an address that may not have
an account yet. Whoever holds the link can open it, so the token in it is a
credential.

## Decision

`generateInvitationToken` (`src/services/organizations/invitations.ts`) makes
32 random bytes, base64url-encoded: always 43 characters of `[A-Za-z0-9_-]`
(`INVITATION_TOKEN_RE`). The email carries the token; `organization_invitations`
stores only its SHA-256 (`hashInvitationToken`), so a leaked row can't be
turned back into a working link. The link is outbound, so it's built from
`NEXT_PUBLIC_SITE_URL`.

`expired` is derived, never stored: a row still `pending` whose `expires_at`
has passed, which is exactly when the accept and decline functions start
refusing it. The invitations a signed-in user can answer are matched on
`users.email`, the same address `accept_organization_invitation_by_id` checks.

Lookups throw on a database error rather than returning `null`, so callers can
tell "no such invitation" from "couldn't check".

## Consequences

- A lost link can't be recovered from the database, only replaced by
  re-inviting.
- Bug reports mask invitation tokens in page paths for the same reason
  ([0018](0018-bug-reports-are-written-for-a-public-repo.md)).
