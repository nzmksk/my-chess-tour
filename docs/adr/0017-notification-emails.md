# 0017. Notification emails

- Status: Accepted
- Date: 2026-11-21
- Issue: #675

## Context

Most actions in the app email someone: reviews, payouts, prizes,
invitations, registrations. The email reports an action that has already
happened, goes to an inbox we don't control, and may carry values a user typed
or a webhook sent.

## Decision

**Best-effort, after the commit.** A `notify*` function runs after the action
it reports has committed (usually through `afterResponse`, ADR 0008) and never
throws: the action stands whether or not the email goes out. It reads the
outcome back from the database rather than trusting its caller.
`sendToRecipients` (`src/services/email/recipients.ts`) sends one email per
recipient and logs failures. An invitation's email resolves to whether it was
sent, so the inviter can be told, and the invitation can be resent.

**Once per event.** Where several paths can race to the same outcome, only
the one that changed it emails. The registration confirmation goes out only
when `settle_registration_payment` reports `newly_confirmed`, which exactly one
of the webhook, the success page's reconcile and a free checkout sees.
Invitation answers notify the inviter only for a fresh answer, not an
`already_accepted` / `already_declined` repeat.

**One email per person.** Recipients are keyed by lowercased address, keeping
the first entry, so someone reached two ways (a member who's also the
organization's contact address) gets one email, by their own name. An
application's approval also goes to the contact address it gave, where the
organization expects mail; the applicant is added first. A rejection goes only
to the applicant (#691): only they can amend and resubmit, and the contact
address is one they typed and nobody has checked, so the reviewer's reason
shouldn't land there.

**Nothing unsafe in the HTML.** `src/services/email/email.ts`:

- Every interpolated value is HTML-escaped, so a player name or tournament
  title can't inject markup.
- An account number is never more than its last four digits. Callers pass
  only those, and each sender cuts whatever it gets to four again: an email is
  a copy of the data we no longer control.
- A URL from CHIP (a receipt, a checkout link) comes from a webhook or API
  body, so it becomes a link only if it's really `https`.

**Templates are static HTML** in `src/services/email/templates`.
`templates.test.ts` reads each from disk to catch one cut short, a placeholder
the template doesn't have (which silently drops what the caller passed), and
any support address other than `SUPPORT_EMAIL`, which they can't import. The
role descriptions in invitation emails mirror the `role_permissions` rows in
`007_rbac.sql`.

## Consequences

- An email can fail without failing the request, and the failure is in Sentry.
- A new email reporting a race-prone outcome needs a "did this call change
  it?" signal from the database before it can promise "once".
