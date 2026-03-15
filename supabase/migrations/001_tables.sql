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
-- =============================================
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         varchar(255) UNIQUE NOT NULL,
  password      varchar(255) NOT NULL,
  first_name    varchar(255) NOT NULL,
  last_name     varchar(255) NOT NULL,
  avatar_url    varchar(255),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Global roles (e.g. platform admin)
CREATE TABLE user_global_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id integer NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

-- =============================================
-- PLAYER PROFILES
-- Chess-specific info. All chess IDs optional.
-- =============================================
CREATE TYPE gender AS ENUM ('male', 'female');
CREATE TYPE chess_title AS ENUM ('GM', 'WGM', 'IM', 'WIM', 'FM', 'WFM', 'CM', 'WCM');

CREATE TABLE player_profiles (
  user_id               uuid PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_of_birth         date,
  gender                gender,
  nationality           varchar(100),
  is_oku                boolean NOT NULL DEFAULT false,
  fide_id               integer,
  fide_rating           jsonb,  -- {"standard": 1800, "rapid": 1750, "blitz": 1700}
  title                 chess_title,
  mcf_id                integer,
  national_rating       integer,
  bank_name             varchar(100),
  bank_account_holder   varchar(255),
  bank_account_number   varchar(50),
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
  email                 varchar(255) NOT NULL,
  phone                 varchar(20),
  bank_name             varchar(100),
  bank_account_holder   varchar(255),
  bank_account_number   varchar(50),
  past_tournament_refs  text,
  approval_status       approval_status NOT NULL DEFAULT 'pending',
  reviewed_by           uuid REFERENCES users(id),
  reviewed_at           timestamptz,
  rejection_reason      text,
  created_by            uuid NOT NULL REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- ORGANIZATION MEMBERSHIPS
-- Links users to organizations with data-driven roles.
-- =============================================
CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id         integer NOT NULL REFERENCES roles(id),
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
  organization_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                        varchar(255) NOT NULL,
  description                 text,
  venue_name                  varchar(255) NOT NULL,
  venue_state                 varchar(50) NOT NULL,
  venue_address               text NOT NULL,
  start_date                  date NOT NULL,
  end_date                    date NOT NULL,
  registration_deadline       timestamptz NOT NULL,
  format                      jsonb NOT NULL, -- {"type": "classical", "rounds": 9, "system": "swiss"}
  time_control                jsonb NOT NULL, -- {"base_minutes": 90,"delay_seconds": 0,"increment_seconds": 30}
  is_fide_rated               boolean NOT NULL DEFAULT false,
  is_mcf_rated                boolean NOT NULL DEFAULT false,
  entry_fees                  jsonb NOT NULL, -- {"standard": {"amount_cents": 4000},"additional": [{"type": "early_bird","valid_until": "2026-02-19T00:00:00+00:00","valid_for":20,"amount_cents": 3200},{"type": "age_based","age_max": 12,"age_min": 0,"amount_cents": 2400}]}
  prizes                      jsonb,          -- {"categories": [{"name": "Open","entries": [{"place": "1st","amount_cents": 80000},{"place": "2nd","amount_cents": 48000},{"place": "3rd","amount_cents": 32000}]}],"subcategories": [{"name": "Best Under-1500","entries": [{"place": "1st","amount_cents": 20000}],"conditions": {"max_rating": 1499}},{"name": "Best Female Player","entries": [{"place": "1st","amount_cents": 20000}],"conditions": {"gender": "female"}}]}
  restrictions                jsonb,          -- {"age_max": 18} or {"gender": "female"}
  max_participants            integer NOT NULL,
  commission_rate             smallint NOT NULL DEFAULT 10, -- platform's cut (%)
  organizer_commission_pct    smallint NOT NULL DEFAULT 0,  -- % organizer absorbs (0=pass all to player, 10=absorb all, 3=split 3%/7%)
  status                      tournament_status NOT NULL DEFAULT 'draft',
  published_by                uuid REFERENCES users(id),
  published_at                timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- REGISTRATIONS
-- A player's registration for a tournament.
-- =============================================
CREATE TYPE registration_status AS ENUM ('pending_payment', 'failed_payment', 'cancelled_payment', 'confirmed', 'forfeited');
-- pending_payment: just registered, awaiting payment
-- failed_payment: payment attempted but failed (e.g. card declined)
-- cancelled_payment: player cancelled before payment
-- confirmed: payment successful and registration confirmed
-- forfeited: player confirmed (paid) but later forfeited (no refund)

CREATE TABLE registrations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id         uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  fee_tier              varchar(50) NOT NULL,
  status                registration_status NOT NULL DEFAULT 'pending_payment',
  registered_at         timestamptz NOT NULL DEFAULT now(),
  confirmed_at          timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  UNIQUE (user_id, tournament_id)
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
CREATE TYPE payment_type AS ENUM ('registration', 'refund', 'organizer_payout', 'player_prize');
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed');

CREATE TABLE payments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                        payment_type NOT NULL,
  tournament_id               uuid NOT NULL REFERENCES tournaments(id),
  registration_id             uuid REFERENCES registrations(id),  -- for registration/refund types
  user_id                     uuid REFERENCES users(id),          -- player paying or receiving prize/refund
  organization_id             uuid REFERENCES organizations(id),  -- org receiving payout
  gross_amount_cents          integer NOT NULL,                   -- what the payer actually paid
  platform_fee_cents          integer NOT NULL DEFAULT 0,         -- platform's cut. platform_fee = organizer_commission + player_commission
  organizer_commission_cents  integer NOT NULL DEFAULT 0,         -- organizer's absorbed share of commission
  player_commission_cents     integer NOT NULL DEFAULT 0,         -- player's share of commission
  net_amount_cents            integer NOT NULL,                   -- what the recipient nets. net_amount = gross_amount - platform_fee
  currency                    varchar(3) NOT NULL DEFAULT 'MYR',
  payment_method              varchar(50),
  chip_transaction_id         varchar(255),
  status                      payment_status NOT NULL DEFAULT 'pending',
  paid_at                     timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- REFUNDS
-- Approval workflow for refund requests.
-- When processed, a payment record of type 'refund' is created.
-- =============================================
CREATE TYPE refund_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE refunds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id       uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  refund_amount_cents   integer NOT NULL,
  reason                text NOT NULL,
  status                refund_status NOT NULL DEFAULT 'pending',
  requested_by          uuid NOT NULL REFERENCES users(id),
  reviewed_by           uuid REFERENCES users(id),
  requested_at          timestamptz NOT NULL DEFAULT now(),
  reviewed_at           timestamptz,
  chip_refund_id        varchar(255),
  processed_at          timestamptz
);

-- =============================================
-- TOURNAMENT PAYOUT SUMMARY
-- Computed on demand from payments table.
-- net_payout = total_collected - total_platform_fees - total_prizes
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
WITH totals AS (
  SELECT
    tournament_id,
    organization_id,

    SUM(
      CASE
        WHEN type = 'registration' AND status = 'paid'
        THEN gross_amount_cents
        ELSE 0
      END
    ) AS total_collected_cents,

    SUM(
      CASE
        WHEN type = 'registration' AND status = 'paid'
        THEN platform_fee_cents
        ELSE 0
      END
    ) AS total_platform_fees_cents,

    SUM(
      CASE
        WHEN type = 'player_prize' AND status = 'paid'
        THEN gross_amount_cents
        ELSE 0
      END
    ) AS total_prizes_cents

  FROM payments
  GROUP BY tournament_id, organization_id
)

SELECT
  *,
  total_collected_cents
    - total_platform_fees_cents
    - total_prizes_cents AS net_payout_cents
FROM totals;
