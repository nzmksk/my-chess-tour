-- Waitlist for the coming-soon landing page. Consolidates the former
-- 007_waitlist, 008_waitlist_user_type and 009_waitlist_user_type_roles
-- into the table's current shape. The role list is a Postgres enum, so a
-- bad value is refused with 22P02; it mirrors src/lib/waitlist-roles.ts.

CREATE TYPE waitlist_user_type AS ENUM (
  'player',
  'organizer',
  'parent',
  'coach',
  'arbiter',
  'other'
);

CREATE TABLE waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      varchar(255) UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_type  waitlist_user_type NOT NULL
);
