-- =============================================
-- #710: signup asks the person to confirm they are 18 or over (part of #705).
--
-- Accounts people hold themselves are for 18 and over; someone under 18 takes
-- part as a guardian's dependent (#709's Terms). Signup collects no date of
-- birth (progressive profiling), so the confirmation is the record.
--
-- users.adult_confirmed_at is when the holder confirmed it. The signup route
-- refuses a request without the confirmation and then puts adult_confirmed in
-- the auth metadata from its own check, the way it puts terms_version there.
-- handle_new_user stamps the time itself, in the statement that creates the
-- row, so there's no window where the account exists without it. Like
-- terms_accepted_at, the time is never taken from metadata. Only the JSON
-- boolean true counts: the route always sends a boolean, and ->> would read
-- the string "true" the same way, so the value is compared as jsonb.
--
-- NULL on accounts from before this, on rows created outside signup, and on
-- every managed account: a dependent didn't confirm anything, their guardian
-- did. chk_users_adult_confirmed_self_only keeps it that way. When a managed
-- account is claimed (#720) the holder confirms then, in the same UPDATE that
-- flips it to 'self'.
--
-- Otherwise handle_new_user is as in 003_functions_triggers.sql.
-- =============================================
ALTER TABLE users
  ADD COLUMN adult_confirmed_at timestamptz,
  ADD CONSTRAINT chk_users_adult_confirmed_self_only
    CHECK (adult_confirmed_at IS NULL OR account_type = 'self');

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_terms_version varchar(20) := NULLIF(NEW.raw_user_meta_data->>'terms_version', '');
  v_adult         boolean     := COALESCE(NEW.raw_user_meta_data->'adult_confirmed' = 'true'::jsonb, false);
BEGIN
  INSERT INTO public.users (
    id, auth_user_id, email, first_name, last_name,
    terms_version, terms_accepted_at, adult_confirmed_at
  )
  VALUES (
    NEW.id,
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    v_terms_version,
    CASE WHEN v_terms_version IS NULL THEN NULL ELSE now() END,
    CASE WHEN v_adult THEN now() END
  );

  INSERT INTO public.player_profiles (user_id)
  VALUES (NEW.id);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'handle_new_user failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE
      USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
