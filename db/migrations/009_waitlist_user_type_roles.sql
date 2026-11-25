-- #764: the waitlist asks for a role from a wider list. The fixed set of
-- values becomes a Postgres enum in place of text + CHECK, so a bad value is
-- refused with 22P02. Existing rows keep their 'player' / 'organizer' value;
-- 'organizer' now covers organizers, chess clubs and chess academies.
-- The default is dropped because the form makes the visitor pick a role.
-- Production only: staging no longer has a waitlist table.

CREATE TYPE waitlist_user_type AS ENUM (
  'player',
  'organizer',
  'parent',
  'coach',
  'arbiter',
  'other'
);

ALTER TABLE waitlist DROP CONSTRAINT waitlist_user_type_check;
ALTER TABLE waitlist ALTER COLUMN user_type DROP DEFAULT;
ALTER TABLE waitlist
  ALTER COLUMN user_type TYPE waitlist_user_type
  USING user_type::waitlist_user_type;
