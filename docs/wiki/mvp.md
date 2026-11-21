# Chess Tournament Platform — MVP Document

> **This is the original MVP specification**, kept as the record of what the product set out to
> do. It is not a description of the code. For what is built, partial or missing today, see
> [launch-readiness.md](./launch-readiness.md); for the API, [api-design.md](./api-design.md); for
> the schema, `supabase/migrations/`. Notes in *italics* mark where the build went a different way.

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

| Feature            | Description                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browse tournaments | View a list of all published tournaments ordered by start date.                                                                                                 |
| Tournament details | View full tournament information including name, date, location, format, time control, entry fee, max participants, spots remaining, and registration deadline. |
| Register and pay   | One-step registration with integrated payment. Player is automatically added to the participant list upon successful payment.                                   |
| My tournaments     | Dashboard showing upcoming registered tournaments and past participation history.                                                                               |
| Payment history    | View past payments and download receipts.                                                                                                                       |

### Organizer Features

| Feature                 | Description                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Apply for account       | Submit application with name, organization/club affiliation, contact details, and optional references to past tournaments.                                                         |
| Create tournament       | Form to input tournament details: name, date, location, format (rapid, blitz, classical, etc.), time control, max participants, entry fee, registration deadline, and description. |
| Manage tournament       | Edit tournament details, close registration manually, or cancel a tournament.                                                                                                      |
| View participants       | See list of registered and paid players for each tournament.                                                                                                                       |
| Export participant list | Download participant list as CSV/Excel for use in pairing software.                                                                                                                |
| Payout tracking         | View expected and completed payouts (organizer receives full entry fee amount; platform commission is charged separately to players).                                              |

### Admin Features

| Feature                | Description                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Organizer approval     | Review, approve, or reject organizer applications.                                   |
| Transaction monitoring | Overview of all transactions on the platform.                                        |
| Platform oversight     | Basic dashboard with key metrics (active tournaments, total registrations, revenue). |

## Payment Integration

- **Payment gateway:** CHIP (chip-in.asia) — a Malaysian-built digital finance platform with zero setup fees, no monthly charges, and a pay-per-transaction model.
- **Supported methods:** FPX (online banking), credit/debit cards, e-wallets (Touch 'n Go, GrabPay), DuitNow QR, and cross-border QR payments (Indonesia, Thailand, Singapore).
- **Developer experience:** RESTful API with detailed documentation, sandbox testing environment, and open-source API docs on GitHub.
- **Why CHIP:** Malaysian-first, budget-friendly (no upfront cost), supports regional SEA expansion via cross-border QR, and PCI-DSS Level 1 compliant.
- **Flow:** Player pays during registration (entry fee + 10% platform commission) → CHIP confirms payment via webhook → player automatically added to participant list → organizer receives full entry fee amount → platform retains commission.

## Tech Stack

| Layer          | Choice                  | Rationale                                                                                                                                                                         |
| -------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language       | TypeScript              | Single language across the full stack minimizes context-switching for a solo developer.                                                                                           |
| Frontend + API | Next.js (App Router)    | SSR for SEO (tournament pages discoverable on Google), built-in API routes (no separate backend needed for MVP), and clean layout support for three distinct user roles.          |
| Database       | PostgreSQL via Supabase | Managed hosting with a generous free tier (500MB, 50k MAU). Includes built-in auth (email, Google, etc.) and row-level security, eliminating the need to build auth from scratch. |
| ORM            | Prisma or Drizzle       | Type-safe database queries with excellent TypeScript integration. *As built: no ORM. `@supabase/supabase-js` plus SQL functions, with migrations applied by the Supabase CLI.*      |
| Payment        | CHIP                    | Malaysian-first, zero setup/monthly fees, pay-per-transaction, RESTful API with sandbox environment.                                                                              |
| Hosting        | Netlify                 | Free tier with Git-based deployments. Good Next.js support via adapter. *As built: plain `next build`/`next start` on Netlify; scheduled jobs are GitHub Actions workflows.*      |
| Cache / limits | Upstash Redis           | *Added during the build:* signup codes, login lockout and API rate limits.                                                                                                        |
| Monitoring     | Sentry                  | *Added during the build (#125):* error reporting, inert until the DSN is set. See [error-monitoring.md](./error-monitoring.md).                                                  |
| Email          | Resend                  | Free tier (3,000 emails/month). Clean API for registration confirmations and payout notifications.                                                                                |
| File Storage   | Supabase Storage        | Included in the free tier. Handles tournament images, receipts, and organizer documents.                                                                                          |

### Estimated MVP Infrastructure Cost

RM0–30/month until meaningful traffic is reached. All core services offer free tiers sufficient for the MVP phase.

### Future Considerations

- **Background workers:** If the platform later needs background processing (batch payouts, email digests, report generation), Go is a strong candidate for lightweight, efficient microservices.
- **Hosting alternative:** If Netlify's Next.js support proves limiting, Coolify (self-hosted on a VPS) or Railway are budget-friendly alternatives.

## Database Design

> The original column-by-column design that stood here (`organizer_profiles`, `organizer_members`, a
> per-tournament `payouts` total, `refunds` keyed on `payment_id`) was superseded during the build
> and has been removed so nobody codes against it. The schema's source of truth is
> `supabase/migrations/` (start with `001_tables.sql`, whose comments explain each table); how it
> changes is in [database-migrations.md](./database-migrations.md). Below is the as-built map.

### As built

| Area | Tables | Notes |
| -- | -- | -- |
| Identity | `users`, `player_profiles` | `users.auth_user_id` is the only link to Supabase Auth; RLS resolves the caller with `app_user_id()`. A `player_profiles` row is created empty at signup and filled in just in time. |
| Access control | `roles`, `permissions`, `role_permissions`, `user_global_roles`, `organization_memberships` | Data-driven roles (`platform_admin`, `owner`, `admin`, `member`) mapped to permission keys. See [roles-and-permissions.md](./roles-and-permissions.md). |
| Organizations | `organizations`, `organization_documents`, `organization_bank_accounts`, `organization_invitations` | An application *is* the `organizations` row (`approval_status`), with KYB documents in a private bucket and a payout account verified through CHIP Send. |
| Tournaments | `tournaments`, `tournament_cancellation_requests` | `format`, `time_control`, `entry_fees`, `prizes` and `restrictions` are JSONB. Dates are in the venue's `timezone`. `status`: `draft`, `pending_funding`, `published`, `cancelled`. |
| Registration & money in | `registrations`, `payments` | One immutable `payments` row per attempt; `registrations.current_payment_id` points at the live one. See [payment-flow.md](./payment-flow.md). |
| Money back and out | `refunds`, `payouts`, `player_bank_accounts` | Every settled movement is also a `payments` row (`type` = `refund`, `organizer_payout`, `player_prize`, …), so the ledger is one table. See [refund-flow.md](./refund-flow.md), [payout-flow.md](./payout-flow.md). |
| Prize pool | `prize_funder_contacts`, `prize_fundings`, `prize_awards` | Platform-distributed prizes only. See [prize-flow.md](./prize-flow.md). |
| Compliance & ops | `sensitive_data_consents`, `audit_logs`, `bug_reports`, `waitlist` | Append-only consent log (#451); trigger-written audit trail with redaction (#503); in-app bug reports (#616); the pre-launch waitlist (form removed in #615, table kept). |
| Views | `tournament_payout_summary` | Per-tournament ledger projection: revenue, refunds, `net_payout_cents`, `prize_pool_balance_cents`. |

### Design notes that held

- **Money in sen:** every amount, in columns and in JSONB, is an integer in sen (RM25.50 is 2550).
- **Participant count** isn't stored. It is counted from confirmed registrations plus live checkout holds (`count_taken_seats`, `get_participant_counts`). Capacity is enforced inside Postgres.
- **Money state lives in Postgres:** `SECURITY DEFINER` functions with row locks own every state change, so concurrent webhooks and retries can't corrupt it. Network calls happen outside those transactions.
- **Timestamps** are `timestamptz`. Calendar dates belong to the venue's timezone.
- **Row-level security** is on for every table except `waitlist`, and nearly every table has a "Platform admins full access" policy (`supabase/migrations/004_rls.sql`).

## User Flows

*The HTML wireframes that accompanied these flows have been removed from the repo; the built
screens are now the reference.*

### Player Flows

#### Flow 1: Browse & Discover Tournaments

**Screen: Landing / Tournament Listing**

- **Top bar:** Logo ("MY Chess Tour"), navigation (Tournaments, My Tournaments, Profile), login/signup button.
- **Hero section:** Headline ("Find Your Next Tournament"), brief value proposition. Shown on first visit or when scrolling to top.
- **Search & filter bar:** Full-width search input on its own line. Below it, a row of filter dropdowns with checkboxes for multi-select on format (Rapid, Blitz, Classical), state/location, and rating type (FIDE Rated, MCF Rated, Unrated). Date filter is a standard single-select dropdown (This Week, This Month, Next Month). A "Filter" button is aligned to the right end of the filter row to apply selections. Dropdown buttons update to show selected options or a count badge when multiple are selected.
- **Tournament grid:** Responsive card grid with horizontal layout. Each card shows:
  - Tournament poster in portrait format (left side of card)
  - Spots remaining badge on the poster (color-coded: green = open, amber = few left, red = full)
  - *As built: cards have no poster; the spots badge sits on the card.*
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

**Step 1 — Basic Information:** Tournament name, description, poster upload (portrait format recommended), venue name, state, and venue address. *As built: no poster upload; tournament cards show no image.*

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
- The "⋯" action menu on each row allows the organizer to view player details, initiate a refund, or cancel a registration. *(Not built — #510. The roster itself and the Cancel action in the header are built; so is CSV/Excel export (#90); the per-row menu is not.)*

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

*(Not built as a list — #107 was closed as a duplicate and #108 as not planned. Admins reach a
tournament's read-only manage view, `/admin/tournaments/[id]` (#557), from the dashboard,
cancellations, refunds and prizes pages.)*

- **Full-width search bar** on its own line, indexing by tournament name or organizer name.
- **Status filter** below the search bar as a dropdown with checkboxes for multi-select (Published, Draft).
- **Table:** All tournaments across the platform with columns: Tournament name + format/rating details, Organizer name, Date, Registrations (current/max), Revenue (organizer's total), Commission (platform's 10%), and Status badge.
- Draft tournaments are visually dimmed.

#### Screen 5: Transactions

*(Not built — #109 was closed as not planned; #110 is open. This is the only place the spec surfaces refunds across tournaments, so
until it exists an operator sees one tournament's refunds at a time, on its read-only manage page
(#511).)*

- **Stats row:** Total Transactions (count), Total Volume (amount charged to players), Platform Commission (10% earned), Refunds (count + amount).
- **Full-width search bar** on its own line, searchable by player name or CHIP reference.
- **Table:** All payment transactions with columns: Date + time, Player name, Tournament, Fee Tier, Player Paid (total charged), Organizer share, Commission (platform's share, highlighted in accent green), Payment Method, Status badge, and CHIP Reference. Refunded transactions show the original amount with a strikethrough.

## Out of MVP Scope

> **See also:** [api-design.md](./api-design.md) for the API as built: every route, its auth, and the error, rate-limit and CORS conventions.

The following features are intentionally excluded from the MVP to keep the build focused and to be introduced as the platform matures:

- Pairing and bracket generation (*still out of scope: organizers export the roster, #90, and pair in Swiss-Manager or Vega*)
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

> **See also:** [launch-readiness.md](./launch-readiness.md) for what is built and the pre-launch checklist. (The original week-by-week roadmap that lived in `README.md` is in git history.)

- Launch with a small group of organizers personally known within the Malaysian chess community.
- Seed the platform with real upcoming tournaments to provide immediate value to players.
- Gather feedback from both organizers and players to inform the next iteration.
- Focus on building trust and reliability before scaling.
