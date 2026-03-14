-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON player_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tournaments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Important: This function uses SECURITY DEFINER
-- so it can write to the users table even when RLS is enabled.
-- Trigger function: create user + player_profile on auth signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, password, first_name, last_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'password_hash', ''),
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    '{player}'
  );

  -- Auto-create an empty player_profile
  INSERT INTO public.player_profiles (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Enforces max_participants capacity at the DB level to prevent race conditions.
-- Runs as a BEFORE INSERT trigger on registrations.
-- Uses SELECT ... FOR UPDATE to lock the tournament row, ensuring concurrent
-- inserts are serialized and the count is always accurate.
CREATE OR REPLACE FUNCTION check_tournament_capacity()
RETURNS TRIGGER AS $$
DECLARE
  v_max  integer;
  v_current integer;
BEGIN
  SELECT max_participants INTO v_max
  FROM tournaments
  WHERE id = NEW.tournament_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_current
  FROM registrations
  WHERE tournament_id = NEW.tournament_id
    AND status IN ('pending_payment', 'confirmed');

  IF v_current >= v_max THEN
    RAISE EXCEPTION 'Tournament is full (% / % participants)', v_current, v_max
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_tournament_capacity
  BEFORE INSERT ON registrations
  FOR EACH ROW EXECUTE FUNCTION check_tournament_capacity();

-- Returns confirmed registration counts for a set of tournament IDs.
-- Used by the tournaments list API to avoid fetching all rows and counting in JS.
CREATE OR REPLACE FUNCTION get_participant_counts(tournament_ids uuid[])
RETURNS TABLE(tournament_id uuid, count bigint) AS $$
  SELECT tournament_id, COUNT(*)
  FROM registrations
  WHERE tournament_id = ANY(tournament_ids)
    AND status = 'confirmed'
  GROUP BY tournament_id;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
