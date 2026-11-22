# 0027. One account per mailbox

- Status: Accepted
- Date: 2026-11-23
- Issue: #286

## Context

`idx_users_email_active` compared addresses as typed, after lower-casing. Gmail
delivers `test@gmail.com`, `test+123@gmail.com` and `t.e.s.t@googlemail.com`
to the same inbox, so one person could open as many accounts as they liked
with one mailbox, each passing email verification.

## Decision

- **Uniqueness is on the mailbox, not the address.** `canonical_email()`
  (`supabase/migrations/20261123090000_canonical_user_email.sql`) lower-cases
  and trims the address, and drops a `+tag` sub-address on every domain. For
  `gmail.com` and `googlemail.com` only, it also drops dots and reads
  `googlemail.com` as `gmail.com`. A trigger stores the result in
  `users.email_canonical` on insert and whenever `email` changes, and
  `idx_users_email_canonical_active` keeps it unique among active users.
- **The address as typed is kept.** `users.email` and the auth user hold what the
  person entered. It's where mail goes and what they sign in with; the
  canonical form is only for comparing.
- **`+` is stripped on every domain, dots only on Gmail.** Outlook, iCloud,
  Fastmail, Proton, Zoho and Google Workspace all deliver `+tag` to the base
  address, and a mailbox whose name really contains `+` is vanishingly rare.
  Dots are significant everywhere except consumer Gmail, including Google
  Workspace domains. Yahoo's `-` disposable addresses aren't folded: hyphens are
  common in real addresses.
- **The database is the guard; the route asks first.** The signup route
  (`src/app/api/v1/auth/signup/create-account/route.ts`) calls
  `email_registered()` before creating the auth user, so a variant gets the
  usual `EMAIL_EXISTS` 409. If two variants race past that check, the unique
  index fails `handle_new_user`, which rolls the auth user back. That signup
  gets a 500, but no second account is created.
- **Existing duplicates were grandfathered, not merged.** The migration gave the
  oldest active account of each mailbox the canonical address and left the
  rest at `NULL`, which the index ignores. They keep working. Changing one's
  email recomputes it, so it can't be moved onto a taken mailbox.

## Consequences

- A canonical rule lives in SQL only. Anything else that needs to compare
  mailboxes (invitations, the waitlist) should call `canonical_email()` rather
  than reimplement it.
- Someone who really has two mailboxes differing only by `+tag` on a server that
  doesn't treat `+` as a sub-address can register only one of them.
- A support change of a user's email goes through the trigger, so it's refused
  if the new address's mailbox already has an active account.
