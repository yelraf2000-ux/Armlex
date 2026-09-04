-- Real user accounts, replacing the single shared password.
--
-- The shared gate was never about privacy — it was about money, since every
-- answer spends API credit. Opening registration removes that protection, so
-- this migration carries the replacement: a plan per user and a monthly
-- question allowance counted from `messages`, rather than a counter column
-- that can drift away from the truth.
--
-- Two identity routes, either sufficient on its own:
--   password_hash  scrypt, salted per user (see auth/password.ts)
--   google_sub     Google's stable subject id, never the email
-- The email is the account's identity in both cases, so Google sign-in on an
-- address that already registered with a password attaches to that account
-- rather than creating a second one.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored lowercased and trimmed by the application. Postgres `citext` would
  -- enforce it in the database, but it is an extension the Neon instance would
  -- have to carry for one column.
  email         text NOT NULL UNIQUE,
  name          text,
  password_hash text,
  google_sub    text UNIQUE,
  plan          text NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'pro', 'firm', 'unlimited')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,

  -- An account with neither credential could never be signed in to; it would
  -- be a row that looks like a user and is not one.
  CONSTRAINT users_has_a_credential
    CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL)
);

-- Ownership. NULLABLE on purpose: 151 conversations predate accounts, and
-- deleting them would destroy the only record of how the tool behaved before
-- this change. They stay readable through `eval/review.ts` and invisible in
-- the app, which is the correct outcome for both.
ALTER TABLE sessions ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE CASCADE;

-- The session list shows one line per conversation; without a title it can
-- only show a truncated first question, which for these users is often three
-- lines of situation before the actual question appears.
ALTER TABLE sessions ADD COLUMN title text;

-- Sharing is a capability the owner grants and can withdraw, so it is a
-- nullable token rather than a boolean: revoking sets it back to NULL and any
-- link already sent stops resolving.
ALTER TABLE sessions ADD COLUMN share_token text UNIQUE;
ALTER TABLE sessions ADD COLUMN shared_at timestamptz;

CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);
CREATE INDEX sessions_share_idx ON sessions (share_token) WHERE share_token IS NOT NULL;
