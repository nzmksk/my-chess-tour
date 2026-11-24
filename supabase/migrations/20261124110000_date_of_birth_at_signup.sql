-- =============================================
-- #710: signup asks for a date of birth and refuses anyone under 18 (part of
-- #705).
--
-- Accounts people hold themselves are for 18 and over; someone under 18 takes
-- part as a guardian's dependent (#709's Terms). Signup used to collect no date
-- of birth (progressive profiling). It now asks for one, so the age is checked
-- against a date rather than a tick box, and the date can't be changed later
-- without support: PATCH /api/v1/profile treats date_of_birth as set-once.
--
-- The signup route validates the date, refuses anyone under 18 with 422
-- UNDER_18, and puts date_of_birth in the auth metadata. handle_new_user writes
-- it to player_profiles.date_of_birth in the statement that creates the row,
-- and refuses an under-18 date itself, so an account created another way (a
-- direct Auth API call) can't carry one either. Under 18 means
-- date_of_birth > today in Malaysia (Asia/Kuala_Lumpur) - 18 years, the same
-- rule as isUnderAdultAge in src/lib/auth/adult-age.ts and #711's
-- self_managed_minor(). A date that isn't a date fails the cast, which refuses
-- the signup too.
--
-- No date_of_birth in the metadata leaves it NULL, as before: accounts from
-- before this and rows created outside signup. #711 covers those at the profile
-- route and at checkout.
--
-- Otherwise handle_new_user is as in 003_functions_triggers.sql.
-- =============================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_terms_version varchar(20) := NULLIF(NEW.raw_user_meta_data->>'terms_version', '');
  v_date_of_birth date        := NULLIF(NEW.raw_user_meta_data->>'date_of_birth', '')::date;
BEGIN
  IF v_date_of_birth >
     ((now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date - interval '18 years')::date THEN
    RAISE EXCEPTION 'UNDER_18: an account holder must be 18 or over; under-18s take part through a parent or guardian''s account'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.users (
    id, auth_user_id, email, first_name, last_name,
    terms_version, terms_accepted_at
  )
  VALUES (
    NEW.id,
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    v_terms_version,
    CASE WHEN v_terms_version IS NULL THEN NULL ELSE now() END
  );

  INSERT INTO public.player_profiles (user_id, date_of_birth)
  VALUES (NEW.id, v_date_of_birth);

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'handle_new_user failed: % (SQLSTATE: %)', SQLERRM, SQLSTATE
      USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
