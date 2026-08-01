-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================
-- ROLES & PERMISSIONS (RBAC)
-- Data-driven roles instead of enums.
-- Scopes: 'global' (platform-wide), 'organization' (per-org)
-- =============================================
CREATE TYPE role_scope AS ENUM ('global', 'organization');

CREATE TABLE roles (
  id    integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name  varchar(50) UNIQUE NOT NULL,
  scope role_scope NOT NULL
);

CREATE TABLE permissions (
  id   integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  key  varchar(50) UNIQUE NOT NULL
);

CREATE TABLE role_permissions (
  role_id       integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id integer NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- =============================================
-- USERS
-- Core user table linked to Supabase Auth.
-- The id matches auth.users.id
-- The password itself is managed by Supabase Auth (auth.users.encrypted_password);
-- we never store our own copy. is_verified gates login until email is confirmed.
-- =============================================
-- auth_user_id is the ONLY link to Supabase Auth. Never compare auth.uid() to
-- users.id — resolve it through app_user_id() (003_functions_triggers.sql).
-- The indirection means users.id is stable for the life of the record: a player
-- row can exist before it has an auth account, and can later be adopted by one,
-- without rewriting the id across registrations/payments/refunds/audit_logs.
-- NULL = a record with no login yet. Today every row has one (written by
-- handle_new_user), so nothing depends on the nullability yet.
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid UNIQUE,
  email         varchar(255) NOT NULL,  -- uniqueness enforced via partial index in 002_indexes.sql
  first_name    varchar(255) NOT NULL,
  last_name     varchar(255) NOT NULL,
  avatar_url    varchar(255),
  is_verified   boolean NOT NULL DEFAULT false,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

-- Global roles (e.g. platform admin)
CREATE TABLE user_global_roles (
  user_id uuid NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);

-- =============================================
-- PLAYER PROFILES
-- Chess-specific info. All chess IDs optional.
-- =============================================
CREATE TYPE gender AS ENUM ('male', 'female');
CREATE TYPE chess_title AS ENUM ('GM', 'WGM', 'IM', 'WIM', 'FM', 'WFM', 'CM', 'WCM');
-- OKU (Orang Kurang Upaya / disabled) verification state. Admin-verified via an
-- uploaded card, never self-declared; 'verified' is what gates OKU fee tiers.
CREATE TYPE oku_status AS ENUM ('none', 'pending', 'verified', 'rejected');

CREATE TABLE player_profiles (
  user_id               uuid PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth         date,
  gender                gender,
  nationality           varchar(100),
  fide_id               integer,
  -- fide_rating/title are fetched from ratings.fide.com when a fide_id is first
  -- saved and refreshed monthly. The *_synced_at / name-verification columns
  -- record when that last ran and whether the stored name matched the FIDE
  -- profile ("Last, First"); fide_name_verified NULL = not yet checked.
  fide_rating           jsonb,  -- {"standard": 1800, "rapid": 1750, "blitz": 1700}
  fide_rating_synced_at timestamptz,
  fide_name_verified    boolean,
  fide_verified_name    text,
  title                 chess_title,
  mcf_id                integer,
  national_rating       integer,
  bank_name             varchar(100),
  bank_account_holder   varchar(255),
  bank_account_number   varchar(50),
  -- OKU verification. The card is uploaded to the private oku-documents bucket
  -- (path in oku_document_path); a platform admin sets oku_status.
  oku_status            oku_status NOT NULL DEFAULT 'none',
  oku_document_path     text,
  oku_reviewed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  oku_reviewed_at       timestamptz,
  oku_rejection_reason  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- ORGANIZATIONS
-- Schools, chess clubs, or any organizing body.
-- =============================================
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE organizations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  varchar(255) NOT NULL,
  description           text,
  avatar_url            varchar(255),
  links                 jsonb,  -- {"website": "https://...", "facebook": "...", "twitter": "..."}
  email                 varchar(255),
  phone                 varchar(20),
  -- No bank columns here by design. The "Public can view approved organizations"
  -- SELECT policy (004_rls.sql) has no column restriction, so anything stored on
  -- this row is readable by anon through PostgREST. Payout bank details live in
  -- organization_bank_accounts, which is RLS-gated on bank_account.manage and
  -- superseded (not updated) on change so verification can't go stale.
  past_tournament_refs  text,
  approval_status       approval_status NOT NULL DEFAULT 'pending',
  reviewed_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  rejection_reason      text,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);

-- =============================================
-- ORGANIZATION MEMBERSHIPS
-- Links users to organizations with data-driven roles.
-- =============================================
CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id         integer NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- =============================================
-- TOURNAMENTS
-- The main event, created by approved organizers.
-- =============================================
CREATE TYPE tournament_status AS ENUM ('draft', 'published', 'cancelled');

CREATE TABLE tournaments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid REFERENCES organizations(id) ON DELETE SET NULL,
  name                        varchar(255) NOT NULL,
  slug                        varchar(255), -- public URL identity; assigned at publish (NULL for drafts). Unique index in 002_indexes.sql.
  description                 text,
  venue_name                  varchar(255) NOT NULL,
  venue_state                 varchar(50) NOT NULL,
  venue_address               text NOT NULL,
  -- ISO 3166-1 alpha-2 of the venue. Deliberately separate from `timezone`
  -- below: the country decides which payout rails and currency a tournament's
  -- money moves on, the timezone decides how its dates read. A country can span
  -- several zones, so neither derives from the other.
  -- The set an organizer may pick from is enforced in the app
  -- (SUPPORTED_COUNTRIES in src/lib/venues.ts), which also owns venue_state.
  venue_country               varchar(2)  NOT NULL DEFAULT 'MY',
  -- IANA timezone of the venue: a tournament's times belong to where it is played, not to whoever is reading them.
  -- start_date/end_date are calendar dates in this zone, timestamptz columns are instants displayed in it,
  -- and ongoing/upcoming/past is judged against "now" here.
  -- The set an organizer may pick from is enforced in the app (VENUE_TIME_ZONES in src/lib/datetime.ts).
  timezone                    varchar(64) NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  start_date                  date NOT NULL,
  end_date                    date NOT NULL,
  registration_deadline       timestamptz NOT NULL,
  format                      jsonb NOT NULL, -- {"type": "classical", "rounds": 9, "system": "swiss"}
  time_control                jsonb NOT NULL, -- {"base_minutes": 90,"delay_seconds": 0,"increment_seconds": 30}
  is_fide_rated               boolean NOT NULL DEFAULT false,
  is_mcf_rated                boolean NOT NULL DEFAULT false,
  entry_fees                  jsonb NOT NULL, -- {"standard": {"amount_cents": 4000},"additional": [{"type": "early_bird","valid_until": "2026-02-19T00:00:00+00:00","valid_for":20,"amount_cents": 3200},{"type": "age_based","age_max": 12,"age_min": 0,"amount_cents": 2400}]}
  prizes                      jsonb,          -- {"categories": [{"name": "Open","entries": [{"place": "1st","amount_cents": 80000},{"place": "2nd","amount_cents": 48000},{"place": "3rd","amount_cents": 32000}]}],"subcategories": [{"name": "Best Under-1500","entries": [{"place": "1st","amount_cents": 20000}],"conditions": {"max_rating": 1499}},{"name": "Best Female Player","entries": [{"place": "1st","amount_cents": 20000}],"conditions": {"gender": "female"}}]}
  restrictions                jsonb,          -- {"age": {"max": 18}} or {"gender": "female"}
  max_participants            integer NOT NULL,
  commission_rate             smallint NOT NULL DEFAULT 10, -- platform's cut (%)
  organizer_commission_pct    smallint NOT NULL DEFAULT 0,  -- % organizer absorbs (0=pass all to player, 10=absorb all, 3=split 3%/7%)
  status                      tournament_status NOT NULL DEFAULT 'draft',
  published_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  published_at                timestamptz,
  registration_closed_at      timestamptz,                        -- effective registration close time. NULL for drafts; defaults to registration_deadline at publish; moved earlier (to now()) when the organizer closes registration early. Never exceeds registration_deadline. Early close is irreversible.
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_dates_order
    CHECK (end_date >= start_date),
  CONSTRAINT chk_registration_deadline
    CHECK (registration_deadline <= start_date::timestamptz),
  CONSTRAINT chk_commission_rate
    CHECK (commission_rate BETWEEN 0 AND 10),
  CONSTRAINT chk_organizer_commission_pct
    CHECK (organizer_commission_pct BETWEEN 0 AND 10),
  CONSTRAINT chk_published_at
    CHECK (published_at IS NULL OR (published_at <= registration_deadline AND published_at <= start_date::timestamptz)),
  -- The effective close time can never be after the deadline. Sync-on-edit
  -- (application code) keeps this true when the deadline moves.
  CONSTRAINT chk_registration_closed_at
    CHECK (
      registration_closed_at IS NULL
      OR registration_closed_at <= registration_deadline
    )
);

-- =============================================
-- TOURNAMENT CANCELLATION REQUESTS
-- Approval workflow for cancelling a PUBLISHED tournament.
-- An organizer files a request; the tournament stays 'published' until a
-- platform admin approves it, at which point review_tournament_cancellation()
-- flips tournaments.status to 'cancelled' and queues a pending refund per
-- confirmed player (settled via settle_refund). Reuses the shared approval_status enum.
-- =============================================
CREATE TABLE tournament_cancellation_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id         uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  requested_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  reason                text NOT NULL,                          -- organizer's reason for cancelling
  status                approval_status NOT NULL DEFAULT 'pending',
  reviewed_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  rejection_reason      text,                                   -- admin's reason when the request is rejected
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT chk_cancellation_reviewed_at
    CHECK (reviewed_at IS NULL OR reviewed_at >= created_at)
);

-- =============================================
-- REGISTRATIONS
-- A player's registration for a tournament.
-- =============================================
CREATE TYPE registration_status AS ENUM ('pending_payment', 'failed_payment', 'cancelled_payment', 'confirmed', 'forfeited');
-- pending_payment: just registered, awaiting payment
-- failed_payment: payment attempted but failed (e.g. card declined, or user cancelled on CHIP)
-- cancelled_payment: system-cancelled when the payment window (hold) expired without payment
-- confirmed: payment successful and registration confirmed
-- forfeited: reserved — player confirmed (paid) but later forfeited (no refund); not set by any code yet

CREATE TABLE registrations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES users(id)                ON DELETE SET NULL,
  tournament_id         uuid NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  fee_tier              varchar(50) NOT NULL,
  status                registration_status NOT NULL DEFAULT 'pending_payment',
  registered_at         timestamptz NOT NULL DEFAULT now(), -- imply when player initiates registration (payment could be pending)
  confirmed_at          timestamptz,                        -- when payment is confirmed and registration is finalized
  cancelled_at          timestamptz,                        -- when the system cancels the registration due to timeout or player cancels (before payment) or forfeiture (after payment)
  cancellation_reason   text,
  UNIQUE (user_id, tournament_id),

  CONSTRAINT chk_confirmed_at
    CHECK (confirmed_at IS NULL OR confirmed_at >= registered_at),
  CONSTRAINT chk_cancelled_at
    CHECK (cancelled_at IS NULL OR cancelled_at >= registered_at)
);

-- =============================================
-- PAYMENTS
-- Generic ledger for all money movements.
-- gross = base_fee + player_commission
-- platform_fee = commission_rate% of base_fee
-- organizer_commission = organizer's absorbed share
-- player_commission = player's share of platform fee
-- net = gross - platform_fee
-- =============================================
CREATE TYPE payment_type AS ENUM ('registration', 'refund', 'organizer_payout', 'player_prize', 'adjustment');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed');

CREATE TABLE payments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                        payment_type NOT NULL,
  tournament_id               uuid NOT NULL REFERENCES tournaments(id) ON DELETE RESTRICT,
  registration_id             uuid REFERENCES registrations(id)        ON DELETE RESTRICT,                          -- for registration/refund types
  user_id                     uuid REFERENCES users(id)                ON DELETE SET NULL,                          -- player paying or receiving prize/refund
  organization_id             uuid REFERENCES organizations(id)        ON DELETE SET NULL,                          -- org paying or receiving payout
  gross_amount_cents          integer NOT NULL,                   -- what the payer actually paid
  platform_fee_cents          integer NOT NULL DEFAULT 0,         -- platform's cut. platform_fee = organizer_commission + player_commission
  organizer_commission_cents  integer NOT NULL DEFAULT 0,         -- organizer's absorbed share of commission
  player_commission_cents     integer NOT NULL DEFAULT 0,         -- player's share of commission
  net_amount_cents            integer NOT NULL,                   -- what the recipient nets. net_amount = gross_amount - platform_fee
  currency                    varchar(3) NOT NULL DEFAULT 'MYR',
  payment_method              varchar(50),
  chip_transaction_id         varchar(255),
  checkout_url                text,                               -- CHIP checkout link, reused while the attempt is live
  status                      payment_status NOT NULL DEFAULT 'pending',
  paid_at                     timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- A registration's active payment attempt. payments is an append-only ledger
-- (one row per attempt); this points at the live one. Added after the payments
-- table because the registrations→payments FK is circular. ON DELETE SET NULL:
-- the pointer simply clears if its payment is ever removed (payments aren't
-- deleted in practice; never cascade-delete the registration). Settlement only
-- terminalizes the registration for its current attempt — see
-- 007_payment_functions.sql.
ALTER TABLE registrations
  ADD COLUMN current_payment_id uuid REFERENCES payments(id) ON DELETE SET NULL;

-- =============================================
-- REFUNDS
-- Approval workflow for refund requests.
-- When processed, a payment record of type 'refund' is created.
-- =============================================
CREATE TYPE refund_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE refunds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id       uuid NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
  refund_amount_cents   integer NOT NULL,
  reason                text NOT NULL,
  status                refund_status NOT NULL DEFAULT 'pending',
  requested_by          uuid REFERENCES users(id) ON DELETE SET NULL,
  requested_at          timestamptz NOT NULL DEFAULT now(),
  reviewed_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at           timestamptz,
  chip_refund_id        varchar(255),
  processed_at          timestamptz,

  CONSTRAINT chk_reviewed_at
    CHECK (reviewed_at IS NULL OR reviewed_at >= requested_at)
);

-- =============================================
-- AUDIT LOGS
-- Trigger-based audit trail for PDPA compliance.
-- Captures full row snapshots for regulated tables.
-- organization_id denormalized for efficient RLS scoping.
-- =============================================
CREATE TABLE audit_logs (
  id               bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  table_name       varchar(50)  NOT NULL,
  record_id        text         NOT NULL,  -- text to support composite PKs
  action           varchar(10)  NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_by       uuid         REFERENCES users(id)         ON DELETE SET NULL,
  organization_id  uuid         REFERENCES organizations(id) ON DELETE SET NULL,
  context          varchar(100) NOT NULL DEFAULT 'trigger',
  old_data         jsonb,
  new_data         jsonb,
  created_at       timestamptz  NOT NULL DEFAULT now()
);

-- =============================================
-- WAITLIST
-- Pre-launch email capture. user_type segments players vs organizers.
-- =============================================
CREATE TABLE waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      varchar(255) UNIQUE NOT NULL,
  user_type  text NOT NULL DEFAULT 'player' CHECK (user_type IN ('player', 'organizer')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- TOURNAMENT PAYOUT SUMMARY
-- Computed on demand from the payments ledger.
-- Every amount is read straight from the per-payment ledger columns
-- (gross_amount_cents / platform_fee_cents / net_amount_cents) rather than
-- re-derived from tournaments.commission_rate, so the figures always match
-- what was actually charged and split at payment time.
--   net_revenue = organizer's portion (net of platform fee AND refunds)
--   net_payout  = net_revenue - prizes paid - payouts already executed
-- =============================================

-- Why view is preferred over materialized view:
-- 1. Financial accuracy matters: Always up-to-date with latest payments/refunds. No risk of stale data.
-- 2. Small dataset: payments per tournament are bounded by max_participants (typically hundreds).
-- The SUM aggregation is cheap.
-- 3. Infrequent reads: this is a dashboard/admin query, not a hot path hit on every page load.
-- There's no read performance problem to solve.
-- 4. Refresh complexity: we'd need a trigger on payments to keep it fresh,
-- which adds complexity for no real gain.
CREATE VIEW tournament_payout_summary AS
WITH payment_totals AS (
  SELECT
    tournament_id,
    organization_id,

    -- Registrations (paid): gross = what the player paid,
    -- platform_fee = platform's cut, net = organizer's portion.
    SUM(CASE WHEN type = 'registration' AND status = 'paid'
        THEN gross_amount_cents ELSE 0 END
    ) AS total_registration_cents,
    SUM(CASE WHEN type = 'registration' AND status = 'paid'
        THEN platform_fee_cents ELSE 0 END
    ) AS registration_fee_cents,
    SUM(CASE WHEN type = 'registration' AND status = 'paid'
        THEN net_amount_cents ELSE 0 END
    ) AS net_registration_cents,

    -- Refunds (paid): reverse the corresponding registration amounts.
    SUM(CASE WHEN type = 'refund' AND status = 'paid'
        THEN gross_amount_cents ELSE 0 END
    ) AS total_refunded_cents,
    SUM(CASE WHEN type = 'refund' AND status = 'paid'
        THEN platform_fee_cents ELSE 0 END
    ) AS refunded_fee_cents,
    SUM(CASE WHEN type = 'refund' AND status = 'paid'
        THEN net_amount_cents ELSE 0 END
    ) AS net_refunded_cents,

    -- Prizes paid out to players.
    SUM(CASE WHEN type = 'player_prize' AND status = 'paid'
        THEN gross_amount_cents ELSE 0 END
    ) AS total_prizes_cents,

    -- Payouts already executed to the organizer.
    SUM(CASE WHEN type = 'organizer_payout' AND status = 'paid'
        THEN gross_amount_cents ELSE 0 END
    ) AS total_payouts_cents

  FROM payments
  GROUP BY tournament_id, organization_id
)

SELECT
  tournament_id,
  organization_id,
  total_registration_cents,
  total_refunded_cents,
  total_prizes_cents,
  total_payouts_cents,

  -- Gross collected from players, net of refunds (kept for reference).
  total_registration_cents - total_refunded_cents AS net_collected_cents,

  -- Platform's actual revenue, summed from the ledger (not re-derived).
  registration_fee_cents - refunded_fee_cents AS effective_platform_fee_cents,

  -- Organizer's revenue: net of platform fee and net of refunds.
  net_registration_cents - net_refunded_cents AS net_revenue_cents,

  -- Amount still owed to the organizer.
  (net_registration_cents - net_refunded_cents)
    - total_prizes_cents
    - total_payouts_cents AS net_payout_cents
FROM payment_totals;
