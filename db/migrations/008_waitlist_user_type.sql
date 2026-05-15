ALTER TABLE waitlist
  ADD COLUMN user_type text NOT NULL DEFAULT 'player'
    CHECK (user_type IN ('player', 'organizer'));
