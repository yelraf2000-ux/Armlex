-- Password reset links.
--
-- Shaped like `email_verifications` because it is the same kind of thing: a
-- single-use bearer token sent to an address, hashed at rest so a leaked
-- backup does not hand over the accounts it refers to.
--
-- One difference matters. A verification link proves a mailbox; a reset link
-- GRANTS ACCOUNT ACCESS to whoever holds it. It is the stronger credential of
-- the two, which is why it lives for one hour rather than twenty-four.
CREATE TABLE password_resets (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  -- Kept rather than deleted, so a second click can say "already used" instead
  -- of "invalid link" — the latter reads as a fault to someone who did nothing
  -- wrong, and here that someone is already having a bad day.
  consumed_at timestamptz
);

CREATE INDEX password_resets_user ON password_resets (user_id);
