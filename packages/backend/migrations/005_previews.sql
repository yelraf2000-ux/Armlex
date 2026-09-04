-- Anonymous previews: the question a visitor asks before they have an account.
--
-- Kept for two reasons beyond making the feature work. First, conversion is the
-- number that decides whether the teaser earns its cost — `converted_user_id`
-- is set when the asker registers, so "previews shown" and "previews that
-- became accounts" are one query rather than a guess.
--
-- Second, and more valuable: THIS IS THE ONLY RECORD OF WHAT PEOPLE ASK BEFORE
-- THEY COMMIT. Every other question in this database was asked by someone who
-- had already decided to sign up. What a stranger types into an empty box is
-- the actual demand signal, and it is worth more to the marketing than to the
-- product.
--
-- The question text is stored; the IP is not. A truncated SHA-256 is enough to
-- rate-limit and to spot abuse, and keeping the address itself would be
-- collecting personal data this product has no use for.

CREATE TABLE previews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question          text NOT NULL,
  -- What the visitor was actually shown, so a conversion can be read back
  -- against the teaser that produced it.
  shown             text NOT NULL,
  -- Length of the answer that was generated, to see how much was withheld.
  full_length       int  NOT NULL,
  model             text NOT NULL,
  ip_hash           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  converted_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  converted_at      timestamptz
);

CREATE INDEX previews_created_idx ON previews (created_at DESC);
CREATE INDEX previews_ip_idx ON previews (ip_hash, created_at DESC);
