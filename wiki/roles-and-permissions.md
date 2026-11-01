# MY Chess Tour — Roles & Permissions (RBAC)

> Reference for the platform's access-control model: the roles, the permission
> keys, how they map, and where each is enforced. Authorization is **data-driven**
> (roles + permission keys in tables), not hard-coded enums — read this alongside
> [authentication-flow.md](./authentication-flow.md) (§7 covers the permission
> gates) and the SQL source of truth in `db/migrations/`.
>
> **Source of truth:** roles/permissions/mappings are seeded in
> `db/migrations/006_seed.sql`; the check functions live in
> `db/migrations/003_functions_triggers.sql`; the row-level policies that consume
> them are in `db/migrations/004_rls.sql`. This doc reflects that code — if it ever
> disagrees with the migrations, the migrations win.

## Table of contents

1. [The model](#1-the-model)
2. [Roles](#2-roles)
3. [Permissions](#3-permissions)
4. [Role → permission matrix](#4-role--permission-matrix)
5. [How a check is evaluated](#5-how-a-check-is-evaluated)
6. [How roles are assigned](#6-how-roles-are-assigned)
7. [Notes, nuances & gaps](#7-notes-nuances--gaps)

---

## 1. The model

Three tables define the entire scheme:

| Table | What it holds |
|---|---|
| `roles` | Named roles, each with a **scope**: `global` or `organization`. |
| `permissions` | Named permission **keys** (e.g. `tournament.edit`). |
| `role_permissions` | Many-to-many: which permission keys each role grants. |

Roles are attached to users in two places, one per scope:

- **`user_global_roles`** — grants a **global** role platform-wide (the platform
  admin). Not tied to any organization.
- **`organization_memberships`** — grants an **organization** role *within one
  org*. The same user can hold different org roles in different orgs.

A permission is therefore always evaluated **in a scope**: globally (do you have
this platform-wide?) or per-org (do you have this *in org X*?).

---

## 2. Roles

Seeded in `006_seed.sql`. There are **4 roles**:

| Role | Scope | Attached via | Who has it |
|---|---|---|---|
| `platform_admin` | `global` | `user_global_roles` | MY Chess Tour staff — reviews organizer applications, OKU verifications, tournament cancellations. |
| `owner` | `organization` | `organization_memberships` | The person who applied for and created the organization. Full control of the org. |
| `admin` | `organization` | `organization_memberships` | A trusted org member with almost all org powers (see matrix). |
| `member` | `organization` | `organization_memberships` | View-only org member. |

There is exactly **one** global role today (`platform_admin`). The other three are
organization-scoped and only mean anything inside the org they were granted in.

---

## 3. Permissions

**11 permission keys**, seeded in `006_seed.sql`:

| Key | Scope it's used in | Meaning |
|---|---|---|
| `platform.manage` | global | Platform administration. Treated as the master key — the "Platform admins full access" RLS policies and every `/admin` gate check this. |
| `org.manage` | organization | Edit the organization itself (profile, settings) and manage its members' roles. |
| `org.invite` | organization | Invite/add members to the organization. |
| `tournament.create` | organization | Create tournaments (drafts) for the org. |
| `tournament.edit` | organization | Edit the org's tournaments (and publish them). |
| `tournament.delete` | organization | Destructive tournament actions — cancel/close. Gates the cancellation-request RLS. |
| `tournament.view` | organization | View the org's tournaments, including drafts. |
| `registration.view` | organization | View the participant roster for the org's tournaments. |
| `payment.view` | organization | View the payments/payout figures for the org's tournaments. |
| `refund.manage` | organization | Manage refunds for the org's tournaments. |
| `bank_account.manage` | organization | Read and replace the org's payout bank account. **Owner only** — narrower than `org.manage` on purpose (see below). |

---

## 4. Role → permission matrix

Straight from the `role_permissions` inserts in `006_seed.sql`:

| Permission | platform_admin | owner | admin | member |
|---|:---:|:---:|:---:|:---:|
| `platform.manage`   | ✅ | — | — | — |
| `org.manage`        | — | ✅ | — | — |
| `org.invite`        | — | ✅ | ✅ | — |
| `tournament.create` | — | ✅ | ✅ | — |
| `tournament.edit`   | — | ✅ | ✅ | — |
| `tournament.delete` | — | ✅ | — | — |
| `tournament.view`   | — | ✅ | ✅ | ✅ |
| `registration.view` | — | ✅ | ✅ | ✅ |
| `payment.view`      | — | ✅ | ✅ | — |
| `refund.manage`     | — | ✅ | ✅ | — |
| `bank_account.manage` | — | ✅ | — | — |

**Reading the matrix:**

- **`platform_admin`** holds only `platform.manage`. It does **not** hold any
  org-scoped keys — cross-org admin access comes from the dedicated "Platform
  admins full access" RLS policies and app-layer `platform.manage` checks, *not*
  from the org permission tables. (The seed comment "implies all" is conceptual,
  not a table row.)
- **`owner`** holds every organization permission — full control of its org.
- **`admin`** = owner **minus `org.manage`, `tournament.delete` and
  `bank_account.manage`**. So an org admin can run tournaments and manage
  members/refunds, but cannot change the organization's own settings/roles,
  cannot cancel/close a tournament, and cannot see or redirect where the
  organization's money is paid out.
- **`member`** is view-only: `tournament.view` + `registration.view`.

**Why `bank_account.manage` is separate from `org.manage`.** The two are held by
the same role today, so the split buys nothing at runtime — it buys something
the first time the roles diverge. `org.manage` is "edit the organization"; being
able to point its payouts at a different account is a materially different
power, and payout redirection is the fraud this whole area is defending against.
Folding it into `org.manage` would mean any future role granted profile editing
silently inherits it. The RLS policy on `organization_bank_accounts`
(`004_rls.sql`) and both `/bank-account` API verbs check this key and no other,
and there is deliberately **no general org-member SELECT** on that table.

---

## 5. How a check is evaluated

### 5.1 The two DB functions (`003_functions_triggers.sql`)

```
has_global_permission(user_id, permission_key)
  → EXISTS user_global_roles → role_permissions → permissions WHERE key = permission_key
has_org_permission(user_id, org_id, permission_key)
  → EXISTS organization_memberships (in that org) → role_permissions → permissions WHERE key = permission_key
```

Both are `SECURITY DEFINER STABLE` so they can be safely called from RLS without
recursion. Supporting helpers: `is_org_member(user_id, org_id)` (membership of any
role, used to break RLS recursion) and `is_org_approved(org_id)` (used by the
tournament-INSERT policy so the DB — not just the API — enforces org approval).

### 5.2 Two enforcement layers

1. **Row-Level Security (`004_rls.sql`)** — the database itself. Policies call
   `has_org_permission` / `has_global_permission`. Every table has a "Platform
   admins full access" policy keyed on `platform.manage`. Example: a published
   tournament is publicly selectable, but drafts are visible only to members with
   `tournament.view`.
2. **App layer (`src/services/supabase/permission.ts`)** — `hasOrgPermission`,
   `hasGlobalPermission`, and their `require*` throwing variants wrap the same
   RPCs for use in API routes and server components. `/admin/*` pages and API
   routes gate on `has_global_permission(..., 'platform.manage')`.

> ⚠️ **Not every route checks a permission *key*.** Several
> organizer/tournament routes gate on the **role name directly** (owner/admin)
> rather than a permission key — e.g. `publish`, `PATCH` (edit),
> `close-registration`, and `cancel` all require `roles.name IN ('owner','admin')`.
> This is why an org **admin can cancel/close a tournament via the API even
> though they lack `tournament.delete`**: the permission key only governs the
> cancellation-request **RLS** policy (a defense-in-depth layer), while the
> primary API path is role-name gated. If cancel should be owner-only, tighten
> those routes to check `tournament.delete`.

At the app layer, only a subset of keys are actually consulted (`platform.manage`,
`org.manage`, `org.invite`, `tournament.create`, `tournament.edit`); the rest
(`tournament.view`, `tournament.delete`, `registration.view`, `payment.view`,
`refund.manage`) are enforced primarily through **RLS**.

## Whose id is being checked (#501)

Every permission helper and every RLS policy takes a **`public.users.id`** — never
an `auth.uid()`. The two are different identifier spaces bridged only by
`users.auth_user_id`:

- **`app_user_id()`** (`003_functions_triggers.sql`) resolves the caller's JWT
  `sub` to their `users.id`. It is `STABLE`, so Postgres evaluates it once per
  statement rather than once per row. It returns NULL for an unauthenticated or
  unlinked session, which makes every comparison fail closed. **`auth.uid()`
  appears nowhere else in the schema** — not in a policy, not in a storage
  policy. The app-side twin is `lookupAppUserId`
  (`src/services/supabase/identity.ts`).
- **`can_act_for(p_user_id)`** answers "may the caller act on this user's
  behalf". Today it is exactly `p_user_id = app_user_id()`, so it changes
  nothing — it exists so that when guardianships arrive (#504) the widening is
  one function body rather than another policy sweep. Used by the
  `player_profiles`, `registrations`, `payments`, and `refunds` policies.

> ⚠️ **Four policy groups deliberately do NOT use `can_act_for()`** and must not
> start: `users`, `user_global_roles`, `organization_memberships`, and the
> own-account `audit_logs` policy. Acting on someone's behalf must never confer
> their platform-admin role or org membership. Each carries a comment saying so
> at the policy site; `db/tests/identity_indirection.sql` scenario I5 is the
> regression guard.

### `users` is read-only to clients

There is **no client UPDATE/INSERT/DELETE on `users`** — `004_rls.sql` revokes
those grants from `anon` and `authenticated`, and no UPDATE policy exists. Every
application write (signup, verification, profile PATCH, rollback) goes through
the service-role client, which bypasses RLS, so nothing needs the capability.

This replaced a blanket `USING (app_user_id() = id)` UPDATE policy with no column
restriction. Postgres reuses an UPDATE policy's `USING` as its `WITH CHECK` when
none is given, and `app_user_id()` is `STABLE` (resolved against the pre-update
snapshot), so that check only ever pinned `id`. Every other column was writable
through PostgREST by anyone holding that user's JWT — including `auth_user_id`
(null it and the account is orphaned; app_user_id() returns NULL forever) and
`is_verified` (self-verify, skipping the emailed code).

`guard_users_identity_columns` (003) is the backstop: a BEFORE UPDATE trigger
rejecting changes to `id` or `auth_user_id` whenever `auth.uid()` is non-NULL,
i.e. whenever a user JWT is driving the statement. Service-role and SECURITY
DEFINER writes have no `sub` and pass, so `handle_new_user` and the future claim
flow (#505) still work. Scenario I6 covers all of it.

In application code, `AuthIdentity.id` is the **`users.id`** and
`AuthIdentity.authUserId` is the auth id. Only calls into Supabase Auth itself
(`auth.admin.deleteUser`, `updateUserById`) take the latter.

---

## 6. How roles are assigned

| Role | How a user gets it |
|---|---|
| `platform_admin` | Inserted into `user_global_roles` directly (no self-serve path). The seed grants it to `chip-review@gmail.com`; in production it's a manual grant. |
| `owner` | Granted **atomically on organizer-application approval**: `review_organization_application()` inserts the applicant's `owner` membership when a platform admin approves the org (see [launch-readiness.md](./launch-readiness.md) O1). |
| `admin` / `member` | Granted via the org's member-invite flow (`POST .../members/invite`) — needs `org.invite`. Existing users get an active membership directly; new users get a pending membership + Supabase invite. Role changes go through `PATCH .../members/[id]` (needs `org.manage`). |

Constraints worth knowing: you cannot change or remove **yourself**, and `owner`
is **not assignable** through the members UI (it's set only by the approval RPC).

---

## 7. Notes, nuances & gaps

- **`platform.manage` is the master key by convention**, implemented as a
  per-table "full access" RLS policy + app-layer checks — not as a role that
  literally holds all other keys. Adding a new table means adding its own admin
  policy; there is no automatic inheritance.
- **`admin` ≠ `owner`.** The two differences are `org.manage` (org settings +
  role management) and `tournament.delete` (cancel/close). Everything else is
  identical.
- **`member` is genuinely read-only** — it cannot create, edit, invite, or see
  payments; only tournaments (incl. drafts) and rosters.
- **One global role only.** There is no finer-grained platform staff role (e.g. a
  read-only auditor); `platform_admin` is all-or-nothing.
- **`refund.manage` is seeded but never checked by application code.** It gates the
  refund RLS policies, yet the one path that actually moves money back —
  cancellation refunds ([refund-flow.md](./refund-flow.md)) — is authorised as a
  *platform* admin approving a cancellation and executes through `supabaseAdmin`
  (service role), which bypasses RLS entirely. Its first real consumer would be an
  organizer-initiated refund from the participant roster (#510). Payout execution
  has no permission key at all and remains schema/manual (see the money-out gaps
  in [launch-readiness.md](./launch-readiness.md) §9).
- **Roles are fixed data.** The four roles and ten permissions are seeded, not
  user-editable; changing them means a migration, not a UI action.
