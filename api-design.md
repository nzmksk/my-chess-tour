# MY Chess Tour — API Design

## Table of Contents

1. Authentication & Authorization
2. Role-Based Access Control
3. API Conventions
4. Endpoints
   - Auth
   - Player Profile
   - Tournaments (Public)
   - Registration & Payments
   - Organizer Applications
   - Organizer Dashboard
   - Organizer Tournaments
   - Organizer Members
   - Organizer Payouts
   - Admin: Dashboard
   - Admin: Applications
   - Admin: Tournaments
   - Admin: Transactions
5. Webhooks (CHIP)
6. Error Handling

---

## 1. Authentication & Authorization

**Provider:** Supabase Auth (built into the stack)

**Methods supported for MVP:**
- Email + password (primary)
- Magic link (passwordless email)
- Google OAuth (optional, low effort with Supabase)

**Session management:**
- Supabase issues a JWT on login, refreshed automatically by the Supabase client SDK.
- The JWT contains `user_id` and is verified server-side on every API request via Supabase's `getUser()`.
- No custom token management needed for MVP.

**Auth flow:**
1. User signs up or logs in via Supabase Auth (client-side SDK).
2. Supabase returns a JWT stored in an HTTP-only cookie (Next.js middleware).
3. Every API route extracts the user from the cookie using `createServerClient()`.
4. If the route requires a specific role, the API checks the user's role(s) before proceeding.

---

## 2. Role-Based Access Control

A single user can hold multiple roles simultaneously. Roles are not stored on the `users` table — they are derived from the existence of related records.

| Role | How it's determined | Capabilities |
|---|---|---|
| **Player** | Has a row in `player_profiles` | Browse, register, pay, view own registrations |
| **Organizer (owner)** | Has a row in `organizer_members` with `role = 'owner'` for an approved organization | Full org management, create/edit tournaments, manage members, view payouts |
| **Organizer (admin)** | Has a row in `organizer_members` with `role = 'admin'` | Create/edit tournaments, view participants and payouts |
| **Organizer (member)** | Has a row in `organizer_members` with `role = 'member'` | View tournaments and participants only |
| **Platform Admin** | `users.role = 'admin'` | Full platform access: approve/reject organizers, view all tournaments, transactions, users |

**Permission check helper (server-side):**

```typescript
// lib/permissions.ts

type OrgRole = 'owner' | 'admin' | 'member';

async function getUserOrgRole(userId: string, organizerId: string): Promise<OrgRole | null> {
  const { data } = await supabase
    .from('organizer_members')
    .select('role')
    .eq('user_id', userId)
    .eq('organizer_id', organizerId)
    .single();
  return data?.role ?? null;
}

async function requireOrgRole(userId: string, organizerId: string, minRole: OrgRole): Promise<void> {
  const role = await getUserOrgRole(userId, organizerId);
  const hierarchy: OrgRole[] = ['member', 'admin', 'owner'];
  if (!role || hierarchy.indexOf(role) < hierarchy.indexOf(minRole)) {
    throw new ForbiddenError('Insufficient permissions');
  }
}

async function requireAdmin(userId: string): Promise<void> {
  const { data } = await supabase
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();
  if (data?.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }
}
```

---

## 3. API Conventions

**Base URL:** `/api/v1`

**Format:** JSON request and response bodies. All timestamps in ISO 8601 UTC. All money values in **sen** (integer cents).

**Pagination:** Cursor-based for lists. Returns `data[]`, `next_cursor`, and `has_more`.

```json
{
  "data": [...],
  "next_cursor": "abc123",
  "has_more": true
}
```

Query params: `?cursor=abc123&limit=20` (default limit: 20, max: 100).

**Filtering:** Query parameters with comma-separated values for multi-select. Example: `?status=published,draft&search=penang`

**Sorting:** `?sort=start_date&order=asc` (default varies by endpoint).

**Standard response envelope:**

```json
// Success
{ "data": { ... } }

// Success (list)
{ "data": [...], "next_cursor": "...", "has_more": true }

// Error
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }
```

---

## 4. Endpoints

### Auth

These are handled primarily by Supabase's client-side SDK. The API layer provides a few helpers.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | Public | Supabase signup (email + password). Also creates a `player_profiles` row. |
| POST | `/auth/login` | Public | Supabase login. Returns session. |
| POST | `/auth/logout` | Authenticated | Destroys session. |
| GET | `/auth/me` | Authenticated | Returns current user with all roles. |

#### `GET /auth/me`

Returns the current user's profile and all associated roles.

**Response `200`:**
```json
{
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "first_name": "Wei Hao",
    "last_name": "Lee",
    "role": "user",
    "player_profile": {
      "fide_id": "5834567",
      "mcf_id": null,
      "fide_rating": 1923,
      "national_rating": null,
      "date_of_birth": "1995-06-15",
      "gender": "male",
      "state": "Penang",
      "nationality": "Malaysian"
    },
    "organizations": [
      {
        "organizer_id": "uuid",
        "organization_name": "Penang Chess Club",
        "role": "owner",
        "approval_status": "approved"
      }
    ],
    "is_platform_admin": false
  }
}
```

---

### Player Profile

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/player/profile` | Player | Get own player profile |
| PATCH | `/player/profile` | Player | Update own player profile |

#### `PATCH /player/profile`

**Request:**
```json
{
  "fide_id": "5834567",
  "mcf_id": "MCF1234",
  "fide_rating": 1923,
  "national_rating": 1850,
  "date_of_birth": "1995-06-15",
  "gender": "male",
  "state": "Penang",
  "nationality": "Malaysian"
}
```

All fields optional — only provided fields are updated.

**Response `200`:** Returns the full updated `player_profile` object.

---

### Tournaments (Public)

Public endpoints for browsing and viewing tournaments. No authentication required.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/tournaments` | Public | Browse published tournaments |
| GET | `/tournaments/:id` | Public | Get tournament details |

#### `GET /tournaments`

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `search` | string | Full-text search on tournament name and venue |
| `format` | string | Comma-separated: `rapid,blitz,classical` |
| `state` | string | Comma-separated: `selangor,penang,johor` |
| `rating` | string | Comma-separated rating categories |
| `date` | string | `upcoming`, `this_week`, `this_month`, `past` |
| `sort` | string | `start_date` (default), `created_at`, `name` |
| `order` | string | `asc` (default), `desc` |
| `cursor` | string | Pagination cursor |
| `limit` | integer | Results per page (default 20) |

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "KL Open Rapid Championship 2026",
      "venue_name": "Kuala Lumpur Convention Centre",
      "state": "Kuala Lumpur",
      "start_date": "2026-03-15",
      "end_date": "2026-03-16",
      "registration_deadline": "2026-03-10T23:59:59Z",
      "format": { "type": "rapid", "system": "swiss", "rounds": 7 },
      "is_fide_rated": true,
      "is_mcf_rated": false,
      "entry_fees": { "standard": { "amount_cents": 5000 }, "additional": [...] },
      "max_participants": 120,
      "current_participants": 78,
      "poster_url": "https://...",
      "status": "published",
      "organizer": {
        "id": "uuid",
        "organization_name": "KL Chess Association",
        "links": [...]
      }
    }
  ],
  "next_cursor": "abc123",
  "has_more": true
}
```

Note: `current_participants` is fetched from Redis cache (count of confirmed registrations). Falls back to a DB count query if cache miss.

#### `GET /tournaments/:id`

Returns full tournament detail including prizes, restrictions, and time control.

**Response `200`:**
```json
{
  "data": {
    "id": "uuid",
    "name": "KL Open Rapid Championship 2026",
    "description": "Full Markdown description...",
    "venue_name": "Kuala Lumpur Convention Centre",
    "venue_address": "Jalan Pinang, 50088 KL",
    "start_date": "2026-03-15",
    "end_date": "2026-03-16",
    "registration_deadline": "2026-03-10T23:59:59Z",
    "format": { "type": "rapid", "system": "swiss", "rounds": 7 },
    "time_control": { "base_minutes": 10, "increment_seconds": 5, "delay_seconds": 0 },
    "is_fide_rated": true,
    "is_mcf_rated": false,
    "entry_fees": {
      "standard": { "amount_cents": 5000 },
      "additional": [
        { "type": "early_bird", "amount_cents": 3500, "valid_until": "2026-03-01" },
        { "type": "titled_players", "amount_cents": 0, "titles": ["GM", "IM", "FM"] }
      ]
    },
    "prizes": { "categories": [...], "special": [...] },
    "restrictions": [
      { "type": "max_rating", "value": 1500 }
    ],
    "max_participants": 120,
    "current_participants": 78,
    "poster_url": "https://...",
    "status": "published",
    "organizer": {
      "id": "uuid",
      "organization_name": "KL Chess Association",
      "description": "...",
      "links": [...],
      "contact_email": "info@klchess.org"
    },
    "commission_rate": 0.10
  }
}
```

The `commission_rate` is included so the client can compute and display "Player pays" amounts.

---

### Registration & Payments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/tournaments/:id/register` | Player | Start registration + initiate payment |
| GET | `/player/registrations` | Player | List own registrations |
| GET | `/player/registrations/:id` | Player | Get single registration detail |
| POST | `/player/registrations/:id/cancel` | Player | Cancel a registration |

#### `POST /tournaments/:id/register`

Creates a registration and initiates a CHIP payment session. The client redirects the player to the CHIP payment URL.

**Request:**
```json
{
  "fee_tier": "early_bird"
}
```

Valid `fee_tier` values: `"standard"`, `"early_bird"`, `"titled_players"`, `"rating_based"`, `"age_based"`. The server validates that the player qualifies for the selected tier.

**Server-side logic:**
1. Validate tournament is published and registration is open (not past deadline, not full).
2. Validate player doesn't already have an active registration.
3. Validate player qualifies for the selected fee tier (check title, rating, age, date).
4. Calculate amounts: `entry_fee` (organizer's amount) + `commission` (10%) = `total`.
5. Create `registration` (status: `pending_payment`).
6. Create `payment` (status: `pending`).
7. Call CHIP API to create a purchase with `total` amount and callback URLs.
8. Return CHIP's payment URL for client redirect.

**Response `201`:**
```json
{
  "data": {
    "registration_id": "uuid",
    "payment_id": "uuid",
    "fee_tier": "early_bird",
    "entry_fee_cents": 3500,
    "commission_cents": 350,
    "total_cents": 3850,
    "payment_url": "https://gate.chip-in.asia/...",
    "expires_at": "2026-02-22T15:30:00Z"
  }
}
```

#### `GET /player/registrations`

**Query parameters:** `?status=confirmed,pending_payment&sort=registered_at&order=desc`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "tournament": {
        "id": "uuid",
        "name": "KL Open Rapid Championship 2026",
        "start_date": "2026-03-15",
        "venue_name": "KLCC",
        "status": "published"
      },
      "fee_tier": "early_bird",
      "entry_fee_cents": 3500,
      "total_paid_cents": 3850,
      "status": "confirmed",
      "registered_at": "2026-02-22T12:00:00Z",
      "confirmed_at": "2026-02-22T12:01:30Z"
    }
  ],
  "next_cursor": null,
  "has_more": false
}
```

#### `POST /player/registrations/:id/cancel`

**Request:**
```json
{
  "reason": "Schedule conflict"
}
```

**Server-side logic:** Only allowed if registration status is `confirmed` or `pending_payment`. If `pending_payment`, simply cancels. If `confirmed`, marks for refund (organizer or admin reviews).

**Response `200`:**
```json
{
  "data": {
    "id": "uuid",
    "status": "cancelled",
    "refund_status": "pending_review",
    "cancelled_at": "2026-02-23T09:00:00Z"
  }
}
```

---

### Organizer Applications

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/organizer/apply` | Authenticated | Submit an organizer application |
| GET | `/organizer/application` | Authenticated | Check own application status |

#### `POST /organizer/apply`

**Request:**
```json
{
  "organization_name": "Penang Chess Club",
  "description": "Community chess club in Georgetown since 2015...",
  "links": [
    { "type": "website", "url": "https://penangchess.org" },
    { "type": "facebook", "url": "https://facebook.com/penangchessclub" }
  ],
  "email": "penangchess@gmail.com",
  "phone": "+60123456789",
  "past_tournament_refs": "Penang Monthly Rapid #1-12 (2025)..."
}
```

**Server-side logic:**
1. Validate user doesn't already have a pending or approved application.
2. Create `organizer_profiles` row with `approval_status: 'pending'`.
3. Create `organizer_members` row linking the user as `role: 'owner'`.
4. Notify admins (email or in-app).

**Response `201`:**
```json
{
  "data": {
    "organizer_id": "uuid",
    "organization_name": "Penang Chess Club",
    "approval_status": "pending",
    "created_at": "2026-02-22T14:34:00Z"
  }
}
```

#### `GET /organizer/application`

Returns the current user's organizer application status. Returns `null` if they haven't applied.

**Response `200`:**
```json
{
  "data": {
    "organizer_id": "uuid",
    "organization_name": "Penang Chess Club",
    "approval_status": "pending",
    "rejection_reason": null,
    "created_at": "2026-02-22T14:34:00Z"
  }
}
```

---

### Organizer Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/organizer/:orgId/dashboard` | Org member+ | Dashboard stats |

#### `GET /organizer/:orgId/dashboard`

**Permission:** Any `organizer_members` role (member, admin, owner) for the given `orgId`. Organization must be approved.

**Response `200`:**
```json
{
  "data": {
    "organization": {
      "id": "uuid",
      "name": "KL Chess Association",
      "approval_status": "approved"
    },
    "stats": {
      "active_tournaments": 2,
      "total_registrations": 110,
      "total_revenue_cents": 442000,
      "pending_payout_cents": 346000
    },
    "recent_tournaments": [
      {
        "id": "uuid",
        "name": "KL Open Rapid Championship 2026",
        "start_date": "2026-03-15",
        "current_participants": 78,
        "max_participants": 120,
        "status": "published"
      }
    ]
  }
}
```

---

### Organizer Tournaments

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/organizer/:orgId/upload` | Org admin+ | Upload a file (poster image) |
| GET | `/organizer/:orgId/tournaments` | Org member+ | List org's tournaments |
| POST | `/organizer/:orgId/tournaments` | Org admin+ | Create tournament |
| GET | `/organizer/:orgId/tournaments/:id` | Org member+ | Get tournament detail (management view) |
| PATCH | `/organizer/:orgId/tournaments/:id` | Org admin+ | Update tournament |
| POST | `/organizer/:orgId/tournaments/:id/publish` | Org admin+ | Publish a draft tournament |
| POST | `/organizer/:orgId/tournaments/:id/close-registration` | Org admin+ | Close registration early |
| POST | `/organizer/:orgId/tournaments/:id/cancel` | Org owner | Cancel the tournament |
| GET | `/organizer/:orgId/tournaments/:id/participants` | Org member+ | List registered players |
| GET | `/organizer/:orgId/tournaments/:id/participants/export` | Org admin+ | Export participants as CSV |
| GET | `/organizer/:orgId/tournaments/:id/stats` | Org member+ | Registration stats |

#### `POST /organizer/:orgId/upload`

**Permission:** `admin` or `owner` role.

Uploads a file to Supabase Storage and returns a public URL. Used for tournament poster images.

**Request:** `multipart/form-data` with a `file` field. Max 5MB. Accepted types: `image/jpeg`, `image/png`, `image/webp`.

**Response `200`:**
```json
{
  "data": {
    "url": "https://your-project.supabase.co/storage/v1/object/public/posters/uuid.jpg"
  }
}
```

#### `POST /organizer/:orgId/tournaments`

**Permission:** `admin` or `owner` role. Organization must be approved.

**Request:**
```json
{
  "name": "KL Open Rapid Championship 2026",
  "description": "Annual open rapid tournament...",
  "venue_name": "Kuala Lumpur Convention Centre",
  "venue_address": "Jalan Pinang, 50088 KL",
  "state": "Kuala Lumpur",
  "start_date": "2026-03-15",
  "end_date": "2026-03-16",
  "registration_deadline": "2026-03-10T23:59:59Z",
  "format": { "type": "rapid", "system": "swiss", "rounds": 7 },
  "time_control": { "base_minutes": 10, "increment_seconds": 5, "delay_seconds": 0 },
  "is_fide_rated": true,
  "is_mcf_rated": false,
  "entry_fees": {
    "standard": { "amount_cents": 5000 },
    "additional": [
      { "type": "early_bird", "amount_cents": 3500, "valid_until": "2026-03-01" },
      { "type": "titled_players", "amount_cents": 0, "titles": ["GM", "IM", "FM"] }
    ]
  },
  "prizes": { "categories": [...], "special": [...] },
  "restrictions": [],
  "max_participants": 120,
  "poster_url": "https://...",
  "status": "draft"
}
```

**Response `201`:** Returns the full tournament object.

#### `PATCH /organizer/:orgId/tournaments/:id`

Same shape as POST, but all fields optional. Only provided fields are updated. Cannot update a `completed` or `cancelled` tournament. If tournament is `published`, only certain fields can be changed (description, poster, registration deadline, max participants).

#### `POST /organizer/:orgId/tournaments/:id/publish`

**Permission:** `admin` or `owner`. Tournament must be in `draft` status and pass validation (all required fields present, dates in the future, at least one fee tier).

**Response `200`:**
```json
{
  "data": {
    "id": "uuid",
    "status": "published",
    "published_at": "2026-02-22T16:00:00Z"
  }
}
```

#### `GET /organizer/:orgId/tournaments/:id/participants`

**Permission:** Any org role.

**Query parameters:** `?search=ahmad&status=confirmed,pending_payment&sort=registered_at&order=desc`

**Response `200`:**
```json
{
  "data": [
    {
      "registration_id": "uuid",
      "player": {
        "id": "uuid",
        "first_name": "Ahmad",
        "last_name": "Hassan",
        "fide_id": "5801234",
        "fide_rating": 1756,
        "state": "Selangor"
      },
      "fee_tier": "early_bird",
      "entry_fee_cents": 3500,
      "total_paid_cents": 3850,
      "status": "confirmed",
      "registered_at": "2026-02-20T10:00:00Z"
    }
  ],
  "next_cursor": "...",
  "has_more": true
}
```

#### `GET /organizer/:orgId/tournaments/:id/stats`

**Response `200`:**
```json
{
  "data": {
    "total_registered": 78,
    "confirmed": 72,
    "pending_payment": 4,
    "cancelled": 2,
    "total_revenue_cents": 346000,
    "total_commission_cents": 34600,
    "by_fee_tier": [
      { "tier": "standard", "count": 40, "revenue_cents": 200000 },
      { "tier": "early_bird", "count": 25, "revenue_cents": 87500 },
      { "tier": "titled_players", "count": 5, "revenue_cents": 0 },
      { "tier": "rating_based", "count": 8, "revenue_cents": 24000 }
    ]
  }
}
```

---

### Organizer Members

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/organizer/:orgId/members` | Org member+ | List members |
| POST | `/organizer/:orgId/members/invite` | Org owner | Invite a new member |
| PATCH | `/organizer/:orgId/members/:memberId` | Org owner | Change member role |
| DELETE | `/organizer/:orgId/members/:memberId` | Org owner | Remove a member |

#### `POST /organizer/:orgId/members/invite`

**Permission:** `owner` only.

**Request:**
```json
{
  "email": "colleague@example.com",
  "role": "admin"
}
```

**Server-side logic:**
1. Look up user by email. If no account exists, create a pending invitation.
2. If account exists, add to `organizer_members` directly.
3. Send invitation email.

**Response `201`:**
```json
{
  "data": {
    "id": "uuid",
    "email": "colleague@example.com",
    "role": "admin",
    "status": "pending",
    "invited_at": "2026-02-22T16:00:00Z"
  }
}
```

#### `PATCH /organizer/:orgId/members/:memberId`

**Request:**
```json
{
  "role": "member"
}
```

Cannot change the `owner` role. Cannot promote someone to `owner`.

---

### Organizer Payouts

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/organizer/:orgId/payouts` | Org admin+ | List payouts |
| GET | `/organizer/:orgId/payouts/:id` | Org admin+ | Get payout detail |

#### `GET /organizer/:orgId/payouts`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "tournament": {
        "id": "uuid",
        "name": "New Year Blitz Bash 2026",
        "start_date": "2026-01-18"
      },
      "total_collected_cents": 138000,
      "total_refunded_cents": 6000,
      "net_payout_cents": 132000,
      "status": "completed",
      "paid_at": "2026-01-25T10:00:00Z"
    },
    {
      "id": "uuid",
      "tournament": {
        "id": "uuid",
        "name": "KL Open Rapid Championship 2026",
        "start_date": "2026-03-15"
      },
      "total_collected_cents": 346000,
      "total_refunded_cents": 0,
      "net_payout_cents": 346000,
      "status": "pending",
      "paid_at": null
    }
  ]
}
```

Note: `total_commission_cents` is not shown to organizers in payouts (commission is charged to the player, not deducted from the organizer). The organizer sees only their revenue.

---

### Admin: Dashboard

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/dashboard` | Platform admin | Dashboard stats |

**Permission:** `users.role = 'admin'`

#### `GET /admin/dashboard`

**Response `200`:**
```json
{
  "data": {
    "total_players": 1247,
    "active_organizers": 18,
    "total_tournaments": 42,
    "tournaments_breakdown": { "upcoming": 12, "completed": 28, "draft": 2 },
    "commission_earned_cents": 842000,
    "total_volume_cents": 9262000,
    "net_revenue_cents": 757800,
    "pending_applications": 3,
    "registrations_30d": [
      { "date": "2026-01-24", "count": 12 },
      { "date": "2026-01-25", "count": 18 }
    ]
  }
}
```

---

### Admin: Applications

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/applications` | Platform admin | List organizer applications |
| GET | `/admin/applications/:id` | Platform admin | Get application detail |
| POST | `/admin/applications/:id/approve` | Platform admin | Approve application |
| POST | `/admin/applications/:id/reject` | Platform admin | Reject application |

#### `GET /admin/applications`

**Query parameters:** `?status=pending&search=penang&sort=created_at&order=desc`

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "organization_name": "Penang Chess Club",
      "description": "Community chess club...",
      "email": "penangchess@gmail.com",
      "phone": "+60123456789",
      "approval_status": "pending",
      "applicant": {
        "id": "uuid",
        "first_name": "Wei Hao",
        "last_name": "Lee",
        "email": "weihao.lee@gmail.com"
      },
      "created_at": "2026-02-22T14:34:00Z"
    }
  ]
}
```

#### `GET /admin/applications/:id`

Returns the full application detail including organization info, links, past tournament references, and the applicant's account and player profile.

#### `POST /admin/applications/:id/approve`

**Server-side logic:**
1. Set `organizer_profiles.approval_status = 'approved'`.
2. Set `approved_by` and `approved_at`.
3. Send approval notification email to the applicant.

**Response `200`:**
```json
{
  "data": {
    "id": "uuid",
    "approval_status": "approved",
    "approved_at": "2026-02-22T17:00:00Z"
  }
}
```

#### `POST /admin/applications/:id/reject`

**Request:**
```json
{
  "reason": "Insufficient tournament history. Please reapply with more references."
}
```

**Server-side logic:**
1. Set `organizer_profiles.approval_status = 'rejected'`.
2. Set `rejection_reason`, `approved_by`, `approved_at`.
3. Send rejection notification email with the reason.

---

### Admin: Tournaments

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/tournaments` | Platform admin | List all tournaments |
| GET | `/admin/tournaments/:id` | Platform admin | Get tournament detail (admin view) |

#### `GET /admin/tournaments`

**Query parameters:** `?search=klchess&status=published,draft&sort=start_date&order=desc`

The `search` parameter indexes both tournament name and organizer name.

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "KL Open Rapid Championship 2026",
      "format": { "type": "rapid", "system": "swiss", "rounds": 7 },
      "is_fide_rated": true,
      "is_mcf_rated": false,
      "organizer": {
        "id": "uuid",
        "organization_name": "KL Chess Association"
      },
      "start_date": "2026-03-15",
      "current_participants": 78,
      "max_participants": 120,
      "revenue_cents": 346000,
      "commission_cents": 34600,
      "status": "published"
    }
  ],
  "next_cursor": "...",
  "has_more": true
}
```

---

### Admin: Transactions

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/transactions` | Platform admin | List all transactions |
| GET | `/admin/transactions/stats` | Platform admin | Transaction summary stats |

#### `GET /admin/transactions`

**Query parameters:** `?search=ahmad&sort=created_at&order=desc`

The `search` parameter indexes player name and CHIP reference.

**Response `200`:**
```json
{
  "data": [
    {
      "id": "uuid",
      "date": "2026-02-22T14:15:00Z",
      "player": {
        "id": "uuid",
        "first_name": "Ahmad",
        "last_name": "Hassan"
      },
      "tournament": {
        "id": "uuid",
        "name": "KL Open Rapid Championship 2026"
      },
      "fee_tier": "early_bird",
      "amount_cents": 3850,
      "net_amount_cents": 3500,
      "commission_cents": 350,
      "payment_method": "fpx",
      "status": "completed",
      "chip_purchase_id": "CHIP-8X4K2M"
    }
  ],
  "next_cursor": "...",
  "has_more": true
}
```

#### `GET /admin/transactions/stats`

**Response `200`:**
```json
{
  "data": {
    "total_count": 312,
    "total_volume_cents": 9262000,
    "total_commission_cents": 842000,
    "total_refunds_cents": 48000,
    "refund_count": 8
  }
}
```

---

## 5. Webhooks (CHIP)

CHIP sends payment status updates via webhooks to a public endpoint on our server.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/webhooks/chip` | CHIP signature | Payment status callback |

#### `POST /webhooks/chip`

**Verification:** CHIP signs every webhook with an HMAC SHA-256 signature in the `X-Signature` header. The server verifies this signature using the CHIP webhook secret before processing.

**Payload (from CHIP):**
```json
{
  "id": "purchase_id",
  "status": "paid",
  "payment": {
    "method": "fpx",
    "amount": 3850,
    "currency": "MYR"
  },
  "reference": "our_payment_uuid"
}
```

**Server-side logic on `status: "paid"`:**
1. Verify webhook signature.
2. Look up `payment` by `chip_purchase_id`.
3. Idempotency check: if payment already `completed`, return `200` and do nothing.
4. Update `payment.status = 'completed'`, set `paid_at`.
5. Update `registration.status = 'confirmed'`, set `confirmed_at`.
6. Invalidate the Redis participant count cache for the tournament.
7. Send confirmation email to the player.
8. Return `200`.

**On `status: "failed"` or `status: "expired"`:**
1. Update `payment.status = 'failed'`.
2. Update `registration.status = 'cancelled'`.
3. Return `200`.

---

## 6. Error Handling

**Standard error codes:**

| HTTP | Code | Description |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Request body fails validation |
| 401 | `UNAUTHORIZED` | Missing or invalid auth token |
| 403 | `FORBIDDEN` | User lacks required permission |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Duplicate registration, application already exists, etc. |
| 422 | `UNPROCESSABLE` | Business logic violation (tournament full, deadline passed, etc.) |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

**Error response shape:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Entry fee tier 'early_bird' is no longer valid.",
    "details": [
      {
        "field": "fee_tier",
        "message": "Early bird deadline has passed (was 2026-03-01)"
      }
    ]
  }
}
```

**Validation library:** Zod for all request body and query parameter validation. Schemas are defined adjacent to route handlers and reused between client and server via a shared `types/` package.

---

## Endpoint Summary

| Area | Endpoints | Auth Level |
|---|---|---|
| Auth | 4 | Public / Authenticated |
| Player Profile | 2 | Player |
| Tournaments (Public) | 2 | Public |
| Registration & Payments | 4 | Player |
| Organizer Applications | 2 | Authenticated |
| Organizer Dashboard | 1 | Org member+ |
| Organizer Tournaments | 11 | Org member+ / admin+ / owner |
| Organizer Members | 4 | Org member+ / owner |
| Organizer Payouts | 2 | Org admin+ |
| Admin Dashboard | 1 | Platform admin |
| Admin Applications | 4 | Platform admin |
| Admin Tournaments | 2 | Platform admin |
| Admin Transactions | 2 | Platform admin |
| Webhooks | 1 | CHIP signature |
| **Total** | **42** | |
