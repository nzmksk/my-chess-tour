-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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
  role          varchar(20)[] NOT NULL DEFAULT '{player}',
  avatar_url    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- PLAYER PROFILES
-- Chess-specific info. All chess IDs optional.
-- =============================================
CREATE TABLE player_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_oku          boolean NOT NULL DEFAULT false,
  fide_id         varchar(20),
  mcf_id          varchar(20),
  fide_rating     integer,
  national_rating integer,
  date_of_birth   date,
  gender          varchar(10),
  state           varchar(50),
  nationality     varchar(100),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- ORGANIZER PROFILES
-- Organization data + approval workflow.
-- =============================================
CREATE TABLE organizer_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_name     varchar(255) NOT NULL,
  description           text,
  links                 jsonb,
  email                 varchar(255) NOT NULL,
  phone                 varchar(20),
  past_tournament_refs  text,
  approval_status       varchar(20) NOT NULL DEFAULT 'pending',
  approved_by           uuid REFERENCES users(id),
  approved_at           timestamptz,
  rejection_reason      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- ORGANIZER MEMBERS
-- Links users to organizations with roles.
-- =============================================
CREATE TABLE organizer_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  uuid NOT NULL REFERENCES organizer_profiles(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          varchar(20) NOT NULL DEFAULT 'member',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organizer_id, user_id)
);

-- =============================================
-- TOURNAMENTS
-- The main event, created by approved organizers.
-- =============================================
CREATE TYPE tournament_status AS ENUM ('draft', 'published');

CREATE TABLE tournaments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id            uuid NOT NULL REFERENCES organizer_profiles(id) ON DELETE CASCADE,
  name                    varchar(255) NOT NULL,
  description             text,
  venue_name              varchar(255) NOT NULL,
  venue_state             varchar(50) NOT NULL,
  venue_address           text NOT NULL,
  start_date              date NOT NULL,
  end_date                date NOT NULL,
  registration_deadline   timestamptz NOT NULL,
  format                  jsonb NOT NULL,
  is_fide_rated           boolean NOT NULL DEFAULT false,
  is_mcf_rated            boolean NOT NULL DEFAULT false,
  time_control            jsonb NOT NULL,
  entry_fees              jsonb NOT NULL,
  prizes                  jsonb,
  restrictions            jsonb,
  max_participants        integer NOT NULL,
  poster_url              text,
  status                  tournament_status NOT NULL DEFAULT 'draft',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- REGISTRATIONS
-- A player's registration for a tournament.
-- =============================================
CREATE TABLE registrations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tournament_id         uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  fee_tier              varchar(50) NOT NULL,
  status                varchar(20) NOT NULL DEFAULT 'pending_payment',
  registered_at         timestamptz NOT NULL DEFAULT now(),
  confirmed_at          timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  UNIQUE (user_id, tournament_id)
);

-- =============================================
-- PAYMENTS
-- One payment per registration.
-- =============================================
CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id     uuid UNIQUE NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  amount_cents        integer NOT NULL,
  platform_fee_cents  integer NOT NULL,
  net_amount_cents    integer NOT NULL,
  currency            varchar(3) NOT NULL DEFAULT 'MYR',
  payment_method      varchar(50),
  chip_purchase_id    varchar(255),
  status              varchar(20) NOT NULL DEFAULT 'pending',
  paid_at             timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- REFUNDS
-- Linked to a payment. Initiated by organizer/admin.
-- =============================================
CREATE TABLE refunds (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id            uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  refund_amount_cents   integer NOT NULL,
  reason                text NOT NULL,
  status                varchar(20) NOT NULL DEFAULT 'pending',
  requested_by          uuid NOT NULL REFERENCES users(id),
  approved_by           uuid REFERENCES users(id),
  chip_refund_id        varchar(255),
  requested_at          timestamptz NOT NULL DEFAULT now(),
  processed_at          timestamptz
);

-- =============================================
-- PAYOUTS
-- One payout record per tournament.
-- =============================================
CREATE TABLE payouts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id           uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  organizer_id            uuid NOT NULL REFERENCES organizer_profiles(id) ON DELETE CASCADE,
  total_collected_cents   integer NOT NULL DEFAULT 0,
  total_commission_cents  integer NOT NULL DEFAULT 0,
  total_refunded_cents    integer NOT NULL DEFAULT 0,
  net_payout_cents        integer NOT NULL DEFAULT 0,
  status                  varchar(20) NOT NULL DEFAULT 'pending',
  paid_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- =============================================
-- WAITLIST
-- Pre-launch email capture.
-- =============================================
CREATE TABLE waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      varchar(255) UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
