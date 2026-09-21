-- Posts drafted by the model, waiting for a person to approve them.
--
-- A draft is sent to the team's Telegram chat with Publish / Skip buttons;
-- nothing reaches the channel, Facebook or Instagram without that tap.

CREATE TABLE social_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The question or subject the post was written from.
  topic         text NOT NULL,
  headline      text NOT NULL,
  subline       text NOT NULL,
  -- The full post text, including the source line added by code.
  body          text NOT NULL,
  -- «ՀՀ հարկային օրենսգիրք · Հոդված 258» and its ARLIS link.
  source_label  text NOT NULL,
  source_url    text,
  image_name    text NOT NULL,
  -- Numbers the checker could not find in the law, for the approver to see.
  warnings      text,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'publishing', 'published', 'skipped', 'failed')),
  model         text NOT NULL,
  results       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);

CREATE INDEX social_drafts_created_idx ON social_drafts (created_at DESC);
