# Chess Tournament Platform — MVP Document

## Overview

A platform that connects chess tournament organizers with players, replacing the current manual process of tournament advertising, registration, and payment collection with a streamlined, self-service experience.

## Problem Statement

Organizing and joining physical chess tournaments currently involves significant manual effort and friction:

- Players must contact organizers to check if registration is still open.
- Players fill in Google Forms, make bank transfers, and submit payment receipts.
- Organizers manually verify payments and maintain participant lists.
- Tournament advertising is scattered across Facebook posts, WhatsApp groups, and word of mouth.

This platform eliminates the back-and-forth by centralizing discovery, registration, and payment into a single flow.

## Target Market

- **Primary:** Malaysia
- **Future expansion:** South East Asia, then globally
- **Users:** Chess tournament organizers (supply side) and chess players (demand side)

## Revenue Model

- **MVP:** 10% platform commission added on top of the organizer's entry fee and charged to the player. The organizer sets their desired revenue per registration; the player pays that amount plus the platform fee. For example, if the organizer sets RM 50, the player pays RM 55 (RM 50 to organizer + RM 5 platform fee). The organizer receives 100% of their set fee.
- **Future:** Subscription plans for organizers and players, unlocking premium features as the platform matures.

## MVP Scope

### Player Features

| Feature | Description |
|---|---|
| Browse tournaments | View a list of all published tournaments ordered by start date. |
| Tournament details | View full tournament information including name, date, location, format, time control, entry fee, max participants, spots remaining, and registration deadline. |
| Register and pay | One-step registration with integrated payment. Player is automatically added to the participant list upon successful payment. |
| My tournaments | Dashboard showing upcoming registered tournaments and past participation history. |
| Payment history | View past payments and download receipts. |

### Organizer Features

| Feature | Description |
|---|---|
| Apply for account | Submit application with name, organization/club affiliation, contact details, and optional references to past tournaments. |
| Create tournament | Form to input tournament details: name, date, location, format (rapid, blitz, classical, etc.), time control, max participants, entry fee, registration deadline, and description. |
| Manage tournament | Edit tournament details, close registration manually, or cancel a tournament. |
| View participants | See list of registered and paid players for each tournament. |
| Export participant list | Download participant list as CSV/Excel for use in pairing software. |
| Payout tracking | View expected and completed payouts (organizer receives full entry fee amount; platform commission is charged separately to players). |

### Admin Features

| Feature | Description |
|---|---|
| Organizer approval | Review, approve, or reject organizer applications. |
| Transaction monitoring | Overview of all transactions on the platform. |
| Platform oversight | Basic dashboard with key metrics (active tournaments, total registrations, revenue). |

## Payment Integration

- **Payment gateway:** CHIP (chip-in.asia) — a Malaysian-built digital finance platform with zero setup fees, no monthly charges, and a pay-per-transaction model.
- **Supported methods:** FPX (online banking), credit/debit cards, e-wallets (Touch 'n Go, GrabPay), DuitNow QR, and cross-border QR payments (Indonesia, Thailand, Singapore).
- **Developer experience:** RESTful API with detailed documentation, sandbox testing environment, and open-source API docs on GitHub.
- **Why CHIP:** Malaysian-first, budget-friendly (no upfront cost), supports regional SEA expansion via cross-border QR, and PCI-DSS Level 1 compliant.
- **Flow:** Player pays during registration (entry fee + 10% platform commission) → CHIP confirms payment via webhook → player automatically added to participant list → organizer receives full entry fee amount → platform retains commission.

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript | Single language across the full stack minimizes context-switching for a solo developer. |
| Frontend + API | Next.js (App Router) | SSR for SEO (tournament pages discoverable on Google), built-in API routes (no separate backend needed for MVP), and clean layout support for three distinct user roles. |
| Database | PostgreSQL via Supabase | Managed hosting with a generous free tier (500MB, 50k MAU). Includes built-in auth (email, Google, etc.) and row-level security, eliminating the need to build auth from scratch. |
| ORM | Prisma or Drizzle | Type-safe database queries with excellent TypeScript integration. |
| Payment | CHIP | Malaysian-first, zero setup/monthly fees, pay-per-transaction, RESTful API with sandbox environment. |
| Hosting | Netlify | Free tier with Git-based deployments. Good Next.js support via adapter. |
| Email | Resend | Free tier (3,000 emails/month). Clean API for registration confirmations and payout notifications. |
| File Storage | Supabase Storage | Included in the free tier. Handles tournament images, receipts, and organizer documents. |

### Estimated MVP Infrastructure Cost

RM0–30/month until meaningful traffic is reached. All core services offer free tiers sufficient for the MVP phase.

### Future Considerations

- **Background workers:** If the platform later needs background processing (batch payouts, email digests, report generation), Go is a strong candidate for lightweight, efficient microservices.
- **Hosting alternative:** If Netlify's Next.js support proves limiting, Coolify (self-hosted on a VPS) or Railway are budget-friendly alternatives.

## Database Design

### Entity Relationship Overview

```
users 1──1 player_profiles
users 1──* organizer_members
organizer_profiles 1──* organizer_members
organizer_profiles 1──* tournaments
tournaments 1──* registrations
users 1──* registrations
registrations 1──1 payments
payments 1──0..1 refunds
tournaments 1──* payouts
```

### Tables

#### users

Core user table linked to Supabase Auth. A single user can hold multiple roles (player, organizer, admin).

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | Matches Supabase Auth user ID |
| email | varchar(255) | unique, not null | User's email address |
| password | varchar(255) | not null | User's password |
| first_name | varchar(255) | not null | First name |
| last_name | varchar(255) | not null | Last name |
| role | varchar(20)[] | not null, default '{player}' | Array of roles: player, organizer, admin |
| avatar_url | text | nullable | Profile photo URL |
| created_at | timestamptz | not null, default now() | Account creation timestamp |
| updated_at | timestamptz | not null, default now() | Last update timestamp |

#### player_profiles

Chess-specific information for players. All chess ID fields are optional to lower the barrier to registration.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| user_id | uuid | FK → users.id, unique, not null | One profile per user |
| fide_id | varchar(20) | nullable | FIDE player ID |
| mcf_id | varchar(20) | nullable | Malaysian Chess Federation ID |
| national_rating | integer | nullable | National chess rating |
| fide_rating | integer | nullable | FIDE rating (standard) |
| date_of_birth | date | nullable | For age-category eligibility |
| gender | varchar(10) | nullable | For gender-category eligibility |
| state | varchar(50) | nullable | State of residence (relevant for state-level events) |
| nationality | varchar(100) | nullable | Player's nationality |
| created_at | timestamptz | not null, default now() | |
| updated_at | timestamptz | not null, default now() | |

#### organizer_profiles

Organization profile and approval data. An organization can be managed by multiple users via the `organizer_members` table.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| organization_name | varchar(255) | not null | Club or organization name |
| description | text | nullable | About the organization |
| links | jsonb | nullable | Social and web links (see example below) |
| email | varchar(255) | not null | Official email |
| phone | varchar(20) | nullable | Official number |
| past_tournament_refs | text | nullable | References to previously organized tournaments |
| approval_status | varchar(20) | not null, default 'pending' | pending, approved, rejected |
| approved_by | uuid | FK → users.id, nullable | Admin who approved/rejected |
| approved_at | timestamptz | nullable | Timestamp of approval/rejection |
| rejection_reason | text | nullable | Reason if rejected |
| created_at | timestamptz | not null, default now() | |
| updated_at | timestamptz | not null, default now() | |

**`links` JSON example:**
```json
[
  { "type": "facebook", "url": "https://facebook.com/klchess" },
  { "type": "website", "url": "https://klchess.org" },
  { "type": "instagram", "url": "https://instagram.com/klchess" }
]
```

Supported link types: `website`, `facebook`, `instagram`, `x`, `youtube`, `whatsapp`, `telegram`, `other`.

#### organizer_members

Join table linking users to organizations with permission levels.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| organizer_id | uuid | FK → organizer_profiles.id, not null | The organization |
| user_id | uuid | FK → users.id, not null | The user |
| role | varchar(20) | not null, default 'member' | owner, admin, member |
| created_at | timestamptz | not null, default now() | |
| updated_at | timestamptz | not null, default now() | |

**Unique constraint:** (organizer_id, user_id) — a user can only have one role per organization.

**Permission levels:**
- **owner** — Full control. Can manage tournament listings, members, payouts, and organization settings. One per organization (the user who created it).
- **admin** — Can create/manage tournaments and view participants and payouts. Cannot manage members or organization settings.
- **member** — Can view tournaments and participants. Cannot create or edit.

#### tournaments

The main event. Created by an approved organizer.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| organizer_id | uuid | FK → organizer_profiles.id, not null | Organizing entity |
| name | varchar(255) | not null | Tournament name |
| description | text | nullable | Full description and rules |
| venue_name | varchar(255) | not null | Name of the venue |
| venue_state | varchar(50) | not null | State where the venue is located (for filtering) |
| venue_address | text | not null | Full address |
| start_date | date | not null | Tournament start date |
| end_date | date | not null | Tournament end date |
| registration_deadline | timestamptz | not null | Cutoff for new registrations |
| format | jsonb | not null | Tournament format details (see example below) |
| is_fide_rated | boolean | not null, default false | Whether the tournament is FIDE rated |
| is_mcf_rated | boolean | not null, default false | Whether the tournament is MCF rated |
| time_control | jsonb | not null | Time control details (see example below) |
| entry_fees | jsonb | not null | Flexible fee structure (see example below) |
| prizes | jsonb | nullable | Prize breakdown (see example below) |
| restrictions | jsonb | nullable | Eligibility restrictions (see example below) |
| max_participants | integer | not null | Tournament-wide maximum capacity |
| poster_url | text | nullable | Tournament poster image (portrait format) |
| status | tournament_status enum | not null, default 'draft' | draft, published |
| created_at | timestamptz | not null, default now() | |
| updated_at | timestamptz | not null, default now() | |

**`format` JSON example:**
```json
{
  "type": "rapid",
  "system": "swiss",
  "rounds": 7
}
```

**`time_control` JSON example:**
```json
{
  "base_minutes": 10,
  "increment_seconds": 5,
  "delay_seconds": 0
}
```

**`entry_fees` JSON example:**
```json
{
  "standard": { "amount_cents": 5000 },
  "additional": [
    { "type": "early_bird", "amount_cents": 3500, "valid_until": "2026-03-01" },
    { "type": "titled_players", "amount_cents": 0, "titles": ["GM", "IM", "FM"] },
    { "type": "rating_based", "amount_cents": 3000, "rating_min": 0, "rating_max": 1500 },
    { "type": "age_based", "amount_cents": 2500, "age_min": 0, "age_max": 12 }
  ]
}
```

**`prizes` JSON example:**
```json
{
  "categories": [
    {
      "name": "Open",
      "prizes": [
        { "place": "1st", "amount": "RM 3,000" },
        { "place": "2nd", "amount": "RM 2,000" },
        { "place": "3rd", "amount": "RM 1,000" }
      ]
    },
    {
      "name": "Under-12",
      "prizes": [
        { "place": "1st", "amount": "RM 500" },
        { "place": "2nd", "amount": "RM 300" },
        { "place": "3rd", "amount": "RM 200" }
      ]
    }
  ],
  "special": [
    { "name": "Best Female Player", "amount": "RM 500" },
    { "name": "Best Veteran (50+)", "amount": "RM 300" }
  ]
}
```

**`restrictions` JSON example:**
```json
[
  { "type": "max_age", "value": 12 },
  { "type": "max_rating", "value": 1500 },
  { "type": "gender", "value": "female" }
]
```

Supported restriction types: `max_age`, `min_age`, `max_rating`, `min_rating`, `gender`, `state`, `nationality`, `custom`.

#### registrations

A player's registration for a tournament.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| user_id | uuid | FK → users.id, not null | The registering player |
| tournament_id | uuid | FK → tournaments.id, not null | The tournament being registered for |
| fee_tier | varchar(50) | not null | Which fee tier was applied: standard, early_bird, titled_players, rating_based, age_based |
| status | varchar(20) | not null, default 'pending_payment' | pending_payment, confirmed, cancelled, refunded |
| registered_at | timestamptz | not null, default now() | |
| confirmed_at | timestamptz | nullable | When payment was confirmed |
| cancelled_at | timestamptz | nullable | When registration was cancelled |
| cancellation_reason | text | nullable | Reason for cancellation |

**Unique constraint:** (user_id, tournament_id) — a player can only register once per tournament.

#### payments

Financial record for each registration. One payment per registration.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| registration_id | uuid | FK → registrations.id, unique, not null | Linked registration |
| amount_cents | integer | not null | Total amount charged in sen |
| platform_fee_cents | integer | not null | Platform commission in sen (charged to player on top of entry fee) |
| net_amount_cents | integer | not null | Organizer's share (equal to entry fee amount set by organizer) |
| currency | varchar(3) | not null, default 'MYR' | Currency code |
| payment_method | varchar(50) | nullable | FPX, card, e-wallet, DuitNow QR, etc. |
| chip_purchase_id | varchar(255) | nullable | CHIP's transaction/purchase reference |
| status | varchar(20) | not null, default 'pending' | pending, completed, failed |
| paid_at | timestamptz | nullable | When payment was confirmed by CHIP |
| created_at | timestamptz | not null, default now() | |

#### refunds

Refund records linked to a payment. Initiated by organizer or admin.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| payment_id | uuid | FK → payments.id, not null | Original payment being refunded |
| refund_amount_cents | integer | not null | Refund amount in sen (can be partial) |
| reason | text | not null | Reason for refund |
| status | varchar(20) | not null, default 'pending' | pending, approved, processed, rejected |
| requested_by | uuid | FK → users.id, not null | User who initiated the refund |
| approved_by | uuid | FK → users.id, nullable | Admin/organizer who approved |
| chip_refund_id | varchar(255) | nullable | CHIP's refund transaction reference |
| requested_at | timestamptz | not null, default now() | |
| processed_at | timestamptz | nullable | When refund was processed by CHIP |

#### payouts

Tracks money owed and paid to organizers. One payout record per tournament.

| Column | Type | Constraints | Description |
|---|---|---|---|
| id | uuid | PK, default gen_random_uuid() | |
| tournament_id | uuid | FK → tournaments.id, not null | |
| organizer_id | uuid | FK → organizer_profiles.id, not null | Receiving organizer |
| total_collected_cents | integer | not null, default 0 | Sum of all confirmed payments |
| total_commission_cents | integer | not null, default 0 | Sum of platform fees |
| total_refunded_cents | integer | not null, default 0 | Sum of processed refunds |
| net_payout_cents | integer | not null, default 0 | Amount to be paid to organizer |
| status | varchar(20) | not null, default 'pending' | pending, processing, completed |
| paid_at | timestamptz | nullable | When payout was sent |
| created_at | timestamptz | not null, default now() | |
| updated_at | timestamptz | not null, default now() | |

### Key Indexes

| Table | Index | Purpose |
|---|---|---|
| tournaments | (status, start_date) | Browse upcoming published tournaments |
| tournaments | (organizer_id) | Organizer's tournament list |
| tournaments | (venue_state) | Filter tournaments by state |
| organizer_members | (user_id) | Find all organizations a user belongs to |
| organizer_members | (organizer_id) | List all members of an organization |
| registrations | (user_id) | Player's registration history |
| registrations | (tournament_id, status) | Participant list per tournament |
| payments | (chip_purchase_id) | Webhook lookup by CHIP reference |
| payments | (registration_id) | Payment lookup by registration |
| payouts | (tournament_id) | Payout lookup by tournament |

### Design Notes

- **Money in cents (sen):** All monetary values in structured columns are stored as integers in sen to avoid floating-point precision issues. RM25.50 is stored as 2550. For JSON fields (entry_fees), amounts are also stored in sen.
- **JSON fields:** `time_control`, `entry_fees`, and `prizes` use JSONB for flexibility. This allows organizers to define custom fee tiers, time control variations, and prize structures without schema changes. The application layer validates the JSON shape on write.
- **Participant count:** Not stored in the tournaments table. Current participant count is derived from confirmed registrations and cached using Redis (or similar) to avoid frequent count queries. The cache is invalidated when a registration status changes.
- **Organization membership:** `organizer_members` enables multiple users to manage an organization with role-based permissions (owner, admin, member).
- **Soft deletes:** Not used in the MVP. Statuses (cancelled, refunded) serve as logical indicators. Hard deletes are avoided.
- **Timestamps:** All tables use `timestamptz` (timestamp with time zone) to handle future multi-timezone expansion.
- **Row-level security:** Supabase RLS policies will enforce that players can only see their own registrations, organizer members can only manage their organization's tournaments (based on role), and platform admins have full access.

## User Flows & Wireframes

### Player Flows

Interactive wireframes are provided as a companion HTML file (`player-wireframes.html`).

#### Flow 1: Browse & Discover Tournaments

**Screen: Landing / Tournament Listing**

- **Top bar:** Logo ("MY Chess Tour"), navigation (Tournaments, My Tournaments, Profile), login/signup button.
- **Hero section:** Headline ("Find Your Next Tournament"), brief value proposition. Shown on first visit or when scrolling to top.
- **Search & filter bar:** Full-width search input on its own line. Below it, a row of filter dropdowns with checkboxes for multi-select on format (Rapid, Blitz, Classical), state/location, and rating type (FIDE Rated, MCF Rated, Unrated). Date filter is a standard single-select dropdown (This Week, This Month, Next Month). A "Filter" button is aligned to the right end of the filter row to apply selections. Dropdown buttons update to show selected options or a count badge when multiple are selected.
- **Tournament grid:** Responsive card grid with horizontal layout. Each card shows:
  - Tournament poster in portrait format (left side of card)
  - Spots remaining badge on the poster (color-coded: green = open, amber = few left, red = full)
  - Format badge and rating badges (FIDE Rated, MCF Rated, or Unrated) grouped together in the card body above the tournament name
  - Tournament name
  - Date, venue, time control
  - Starting price ("RM 50 from") — shows the lowest available entry fee
  - "View" button
- Cards are clickable, linking to the tournament detail page.
- Full tournaments show a "Full" badge and disabled state.

#### Flow 2: View Tournament Details

**Screen: Tournament Detail**

- **Two-column layout** (single column on mobile):
  - **Left column (scrollable):** Poster image (portrait format), tournament name, organizer name, tags (format, rating type with color-coded FIDE/MCF badges, eligibility), details grid (date, venue, format, time control, deadline, capacity), entry fee table (all tiers with the currently applicable one highlighted), prizes list (grouped by category + special prizes), and full description.
  - **Right column (sticky sidebar):** Registration card showing the current applicable fee, "Register Now" button, spots remaining count, and registration deadline warning.
- On mobile, the registration card appears at the top of the page for immediate access.

#### Flow 3: Register & Pay

**Screen: Registration & Payment (Single Page Checkout)**

- **Tournament summary** at the top (name, date, venue).
- **Fee tier selector:** Radio-style cards showing all available fee tiers. The applicable tier is auto-selected based on the current date (early bird check) and the player's profile (titled player check). Player can override.
- **Order summary:** Line items showing entry fee, processing fee, and total.
- **Payment method selector:** Cards for FPX, DuitNow QR, Credit/Debit Card, and E-Wallet. These map to CHIP's available payment methods.
- **"Pay" button** with the total amount displayed. Clicking initiates the CHIP payment flow (redirect to CHIP's payment page or modal, depending on integration method).
- On successful payment, CHIP redirects back to the confirmation page. A webhook also fires server-side to confirm the registration.

#### Flow 4: Payment Confirmation

**Screen: Confirmation**

- **Success icon and headline** ("Registration Confirmed!").
- **Confirmation message** with the player's email (confirmation email is also sent).
- **Payment receipt card:** Tournament name, date, fee tier applied, payment method, CHIP transaction ID, and total amount paid.
- **Action buttons:** "My Tournaments" (navigate to dashboard) and "Browse More" (back to listing).

#### Flow 5: Player Dashboard

**Screen: My Tournaments**

- **Sidebar navigation:** My Tournaments (default), Payment History, Profile, Settings.
- **Tabs:** Upcoming, Past, Cancelled — with counts.
- **Registration list:** Cards showing:
  - Date block (month abbreviation + day number, color-coded)
  - Tournament name, venue, format, time control
  - Status badge (Confirmed, Pending Payment, Completed, Cancelled)
- Cards are clickable, linking back to the tournament detail page.
- **Payment History screen** (sidebar nav): Table of all transactions with date, tournament name, amount, payment method, status, and a download receipt link.
- **Profile screen** (sidebar nav): Edit personal details (name, email, password) and chess-specific info (FIDE ID, MCF ID, ratings, date of birth, nationality, state).

### Organizer Flows

Interactive wireframes are provided as a companion HTML file (`organizer-wireframes.html`).

#### Flow 1: Apply as Organizer

**Navigation:** Players can access the application page via two entry points: a "Become an Organizer" link in the top navigation bar (visible to logged-in users who are not yet organizers), and a "Become an Organizer" link at the bottom of the player dashboard sidebar.

**Screen: Application Form**

- Form fields: Organization Name, Description, Links (dynamic — user selects a platform type from a dropdown such as Website, Facebook, Instagram, X, YouTube, WhatsApp, Telegram, then enters the URL; additional links can be added with a "+" button), Email, Phone, Past Tournament References (optional).
- On submission, the screen transitions to a pending state showing the organization name and a message that the application is under review (typically 1–2 business days).
- Admin approval triggers an email notification and unlocks the organizer dashboard.

#### Flow 2: Organizer Dashboard

**Screen: Dashboard**

- **Top navigation** includes links to Tournaments (public browse), My Tournaments (player dashboard), Organizer Dashboard (current), and Profile.
- **Sidebar navigation:** Dashboard (default), Create Tournament, Payouts, Members, Organization Settings.
- **Organization header** in the sidebar showing the organization name with a green verified checkmark icon (✓) for approved organizations.
- **Stats row:** Active Tournaments, Total Registrations, Revenue, Pending Payouts — quick overview cards.
- **Tournaments table:** Lists all tournaments (published, draft) with columns for name, date, registration count vs. capacity, status badge, and a "Manage" button.
- **"Create Tournament" button** prominently placed at the top right.
- Clicking "Manage" on any tournament navigates to the tournament management screen.

#### Flow 3: Create Tournament (Multi-Step Wizard)

**Screen: 5-Step Wizard**

**Step 1 — Basic Information:** Tournament name, description, poster upload (portrait format recommended), venue name, state, and venue address.

**Step 2 — Format & Schedule:** Format type (rapid, blitz, classical), system (Swiss, round robin, knockout), number of rounds, time control (base time, increment, delay), start/end dates, registration deadline, max participants, FIDE/MCF rated checkboxes, and optional restrictions (dynamic rows with type dropdown — max age, max rating, min rating, gender, state, nationality, custom — and value input).

**Step 3 — Entry Fees:** One fixed "Standard" fee (amount only, cannot be removed). Below it, an "Additional Fee Tiers" section where organizers add tiers from a menu of four types: Early Bird (amount + valid-until date), Titled Players (amount + checkbox grid of applicable titles: GM, IM, FM, WGM, WIM, WFM, CM, WCM, NM), Rating-Based (amount + rating range from/to), and Age-Based (amount + age range from/to). Each additional tier can be removed. The "+ Add Fee Tier" button opens a dropdown menu to select which tier type to add. An info banner at the top explains the 10% commission model. Each fee tier displays a net breakdown showing: "Your revenue" + "Commission (10%)" = "Player pays", so the organizer can see exactly what the player will be charged.

**Step 4 — Prizes:** Prize categories (e.g., Open, Under-12) each with dynamic prize rows (placement + amount). Special prizes section below (e.g., Best Female Player, Best Veteran). Categories and rows can be added or removed.

**Step 5 — Review & Publish:** Read-only summary of all previous steps, each with an "Edit" button to jump back. Two actions: "Save as Draft" and "Publish Tournament". Draft is available at every step via the footer.

The wizard footer shows "Back", "Save as Draft", and "Next" buttons. Steps are shown in a horizontal progress bar with done/active/upcoming states.

#### Flow 4: Tournament Management

**Screen: Tournament Detail (Organizer View)**

- **Header:** Tournament name, date, venue, status badge, and action buttons (Edit Tournament, Close Registration, Cancel).
- **Tabs:** Participants, Registration Stats, Payout.
- **Stats row:** Registered count, Confirmed (paid), Pending payment, Revenue collected.
- **Participants table:** Searchable, sortable table with columns: #, Player name (with avatar initials), FIDE ID, Rating, Fee Tier, Status (Confirmed/Pending), Registration date, and an actions menu (⋯). Export buttons for CSV and Excel above the table.
- The "⋯" action menu on each row allows the organizer to view player details, initiate a refund, or cancel a registration.

#### Flow 5: Payout Tracking

**Screen: Payouts**

- One payout card per tournament showing:
  - Tournament name and payout status badge (Pending, Processing, Completed).
  - Financial breakdown: Total Collected, Platform Commission, Refunds, Net Payout.
  - For completed payouts: payment date and reference number.
  - For pending payouts: note that payout will be processed after the tournament is completed.

#### Flow 6: Member Management

**Screen: Members**

- **Invite bar:** Email input, role selector (Admin/Member), and "Invite" button.
- **Role permissions reference:** Displayed inline so the owner understands what each role can do.
- **Member list:** Cards for each member showing avatar initials, name, email, and role. The owner sees a non-editable "Owner" badge on their own card. Other members have a role dropdown (to change role) and a "Remove" button. Pending invitations are shown in a dashed/dimmed card with a "Resend" option.

### Admin Flows

Interactive wireframes are provided as a companion HTML file (`admin-wireframes.html`).

The admin panel uses a dark sidebar with a distinct "Admin Panel" label to visually distinguish it from the organizer and player interfaces.

#### Screen 1: Admin Dashboard

- **Dark sidebar navigation:** Dashboard, Applications (with pending count badge), Tournaments, Transactions, Users, Settings.
- **Stats row:** Total Players (with month-over-month growth), Active Organizers, Total Tournaments (broken down by published/draft), Commission Earned at 10% (with growth trend).
- **Revenue detail row:** Total Registration Volume (all amounts charged to players) and Net Revenue (commission earned minus CHIP's transaction fee) side by side.
- **Registrations chart:** Bar chart showing registration trend over the past 30 days.
- **Quick action panels:** Two side-by-side tables — Pending Applications (clickable rows to review) and Recent Transactions.

#### Screen 2: Organizer Applications

- **Tabs:** Pending (with count), Approved, Rejected, All — filtering the table below.
- **Searchable table:** Columns for Organization name + description snippet, Contact info (email + phone), Applied date (with relative time), Status badge, and a "Review" action button.
- Clicking a row or the "Review" button navigates to the application detail screen.

#### Screen 3: Application Review Detail

- **Header:** Back button, organization name, and current status badge.
- **Action bar:** Shows who applied and when. Two action buttons: "Reject" (opens inline rejection panel) and "Approve" (primary action).
- **Rejection panel:** Slides open inline when "Reject" is clicked. Contains a textarea for the rejection reason (sent to the applicant via email) and Cancel/Confirm buttons.
- **Organization Details card:** Name, description, links (with platform icons), email, phone.
- **Past Tournament References card:** Free-text references provided by the applicant during the application.
- **Applicant Account card:** The user account that submitted the application — name, email, account creation date, and player profile details (FIDE ID, rating) if available.

#### Screen 4: Tournaments Overview

- **Full-width search bar** on its own line, indexing by tournament name or organizer name.
- **Status filter** below the search bar as a dropdown with checkboxes for multi-select (Published, Draft).
- **Table:** All tournaments across the platform with columns: Tournament name + format/rating details, Organizer name, Date, Registrations (current/max), Revenue (organizer's total), Commission (platform's 10%), and Status badge.
- Draft tournaments are visually dimmed.

#### Screen 5: Transactions

- **Stats row:** Total Transactions (count), Total Volume (amount charged to players), Platform Commission (10% earned), Refunds (count + amount).
- **Full-width search bar** on its own line, searchable by player name or CHIP reference.
- **Table:** All payment transactions with columns: Date + time, Player name, Tournament, Fee Tier, Player Paid (total charged), Organizer share, Commission (platform's share, highlighted in accent green), Payment Method, Status badge, and CHIP Reference. Refunded transactions show the original amount with a strikethrough.

## Out of MVP Scope

> **See also:** `api-design.md` for the full API specification including 41 endpoints, auth flows, permission checks, request/response shapes, CHIP webhook handling, and error conventions.

The following features are intentionally excluded from the MVP to keep the build focused and to be introduced as the platform matures:

- Pairing and bracket generation
- Live scoring and results
- Player ratings and ranking tracking
- In-platform messaging or chat
- Review and rating system for organizers/tournaments
- Social features (following organizers, sharing results)
- Subscription plans and premium features
- Multi-currency support (MVP is MYR only)
- Mobile app (MVP is web-only, mobile-responsive)

## Key Assumptions to Validate

1. **Organizer adoption:** Are organizers willing to list tournaments on the platform instead of (or alongside) their existing channels (Facebook, WhatsApp)?
2. **Player convenience:** Do players find enough value in centralized discovery and one-step registration to adopt the platform?
3. **Payment willingness:** Are players comfortable paying through the platform rather than direct bank transfers?
4. **Commission tolerance:** Is the commission rate acceptable to organizers given the convenience the platform provides?

## Go-to-Market Strategy (MVP Phase)

> **See also:** `README.md` for the full sprint plan with 6 milestones, weekly tasks, hour estimates, risk mitigation, and launch checklist.

- Launch with a small group of organizers personally known within the Malaysian chess community.
- Seed the platform with real upcoming tournaments to provide immediate value to players.
- Gather feedback from both organizers and players to inform the next iteration.
- Focus on building trust and reliability before scaling.
