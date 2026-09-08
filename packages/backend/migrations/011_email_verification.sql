-- Email verification for password sign-ups.
--
-- Google accounts never need this: Google has already proved the address, and
-- asking a second time would be a step that teaches the user nothing.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

-- Backfill every existing account as verified. These were created when no
-- verification existed, so treating them as unverified would lock real people
-- out over a rule they were never given the chance to satisfy — the classic
-- way this migration breaks production.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

-- One row per outstanding link.
--
-- The token itself is NEVER stored, only its SHA-256. A verification token is
-- a bearer credential for an account: anyone holding one can complete the
-- sign-up. Storing them in the clear would mean a leaked database backup hands
-- over every pending account, which is the same reason password_hash exists
-- rather than a password column.
CREATE TABLE email_verifications (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  -- Set on use. Kept rather than deleted so a second click on the same link
  -- can say "already verified" instead of "invalid link", which reads as a
  -- fault to someone who did nothing wrong.
  consumed_at timestamptz
);

CREATE INDEX email_verifications_user ON email_verifications (user_id);
