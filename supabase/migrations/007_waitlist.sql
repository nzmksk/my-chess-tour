CREATE TABLE waitlist (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      varchar(255) UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
