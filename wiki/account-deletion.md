# Account deletion runbook

How support deletes a player's account when they ask. There is no self-serve deletion yet ([launch-readiness](./launch-readiness.md) P5), so this is a manual process run by a platform admin with Supabase dashboard access.

`/privacy` promises that personal profile data is gone **within 30 days of the request**. Start the clock when the request arrives.

## What goes and what stays

| Data | What happens | Why |
| -- | -- | -- |
| `users` row, `player_profiles` row | Deleted | Personal profile data |
| Auth account (`auth.users`), sign-in identities | Deleted | Holds the email and the name given at signup |
| Avatar, OKU card (storage) | Deleted | Personal files |
| `users` / `player_profiles` audit history | Kept as rows, every personal field replaced with `[anonymised]` | The history of *when* the account changed survives; the content does not |
| Other audit rows the user wrote (`changed_by`) | Kept, `changed_by` cleared | They record changes to other records, not to the user |
| `registrations`, `payments`, `refunds`, `payouts` and their audit rows | Kept, `user_id` set to NULL by the foreign key | Financial records, kept 7 years (Income Tax Act). This overrides the deletion request |
| Organisation documents the user uploaded | Kept | Business verification documents, kept 7 years after the organiser relationship ends |
| `waitlist` entry for their email | Deleted | Pre-launch email capture |

Every foreign key to `users` is `ON DELETE SET NULL` or `ON DELETE CASCADE`, so the whole thing is one `DELETE` plus the audit-log step. The audit-log step is the part that is easy to forget: deleting the rows does **not** reach `audit_logs`, which still holds full copies of them (#503).

## 1. Check the request

1. Confirm the request came from the account's own email address. If it didn't, reply to that address and wait for confirmation.
2. Look up the account and note its `users.id` and `auth_user_id`:

   ```sql
   SELECT id, auth_user_id, email, first_name, last_name, deleted_at
   FROM users WHERE lower(email) = lower('<their email>');
   ```

## 2. Check nothing is in flight

Run with the `users.id` from step 1. Every count should be 0. If one isn't, deal with it first: deleting the account would leave money or an organisation half-handled.

```sql
SELECT
  -- A payment attempt the player may still complete. Wait for it to expire
  -- (10 minutes) or settle.
  (SELECT count(*) FROM registrations
    WHERE user_id = '<users.id>' AND status = 'pending_payment')            AS pending_payments,
  -- A refund not yet settled. Let it finish first.
  (SELECT count(*) FROM refunds f JOIN registrations r ON r.id = f.registration_id
    WHERE r.user_id = '<users.id>' AND f.status = 'pending')                AS pending_refunds,
  -- A confirmed entry in a tournament that hasn't ended. Ask the player
  -- whether they are withdrawing; refunds follow the tournament's policy.
  (SELECT count(*) FROM registrations r JOIN tournaments t ON t.id = r.tournament_id
    WHERE r.user_id = '<users.id>' AND r.status = 'confirmed'
      AND t.end_date >= current_date)                                        AS upcoming_entries,
  -- Organisations they belong to. If they are the only admin, someone else
  -- has to be made admin first or the organisation is left unmanaged.
  (SELECT count(*) FROM organization_memberships WHERE user_id = '<users.id>') AS org_memberships,
  -- Platform roles. Remove deliberately rather than as a side effect.
  (SELECT count(*) FROM user_global_roles WHERE user_id = '<users.id>')        AS global_roles;
```

## 3. Delete the auth account

Supabase dashboard → **Authentication → Users** → find the user by email → **Delete user**. (Or `supabaseAdmin.auth.admin.deleteUser(auth_user_id)`.)

Do this first, so they cannot sign in and write new data halfway through. It has no effect on the `public` schema: `users.auth_user_id` has no foreign key to `auth.users`.

## 4. Delete their files

Supabase dashboard → **Storage**:

- `avatars` → delete the folder `users/<users.id>/`
- `oku-documents` → delete the folder `users/<users.id>/`

Use the dashboard or the Storage API, not SQL: Supabase blocks direct deletes from `storage.objects`. Leave `organization-documents` alone (see the table above).

## 5. Delete the rows and anonymise the audit history

One transaction, in this order. `anonymise_user_audit_logs` has to run **after** the delete, because the delete itself writes one more audit row carrying the full pre-delete row.

```sql
BEGIN;

DELETE FROM waitlist WHERE lower(email) = lower('<their email>');

-- Cascades to player_profiles, organization_memberships and user_global_roles;
-- sets user_id / *_by to NULL everywhere else.
DELETE FROM users WHERE id = '<users.id>';

-- Expect snapshots_anonymised > 0. changed_by_cleared is usually 0 here,
-- because the delete above already nulled changed_by through the foreign key.
SELECT * FROM anonymise_user_audit_logs('<users.id>');

COMMIT;
```

The function refuses (`USER_NOT_DELETED`) if the `users` row still exists without `deleted_at`, so it cannot strip the history of a live account. Running it again is safe and reports zero rows.

## 6. Verify

```sql
-- All three should return 0.
SELECT count(*) FROM users WHERE id = '<users.id>';
SELECT count(*) FROM auth.users WHERE id = '<auth_user_id>';
SELECT count(*) FROM audit_logs
WHERE table_name IN ('users', 'player_profiles')
  AND record_id = '<users.id>'
  AND concat(old_data::text, new_data::text) ILIKE '%<their email>%';
```

## 7. Close the request

Reply to the requester that their account has been deleted, and note that payment records are kept for 7 years as the law requires. Record only the ticket and the completion date. Don't copy their personal details into the ticket or anywhere else.

## Outside this database

These hold some of the same data under their own retention and are not touched by this runbook:

- **CHIP** keeps payment records under its own obligations as the payment processor.
- **Resend** keeps delivery logs for emails we sent the user.
