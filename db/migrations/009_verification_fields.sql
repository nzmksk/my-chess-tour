-- Add email verification tracking to users table
ALTER TABLE users ADD COLUMN is_verified boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN verified_at timestamptz;
