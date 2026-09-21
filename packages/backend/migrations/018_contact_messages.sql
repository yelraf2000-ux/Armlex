-- Messages from the website's «Հարց ունե՞ք» form.
--
-- Kept here as well as sent to the team's Telegram group: a message that
-- Telegram failed to deliver must not be lost, and this is the record of which
-- conversations started on the site.

CREATE TABLE contact_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  -- Whatever the visitor chose to leave: a phone, an email or a Telegram name.
  contact      text NOT NULL,
  message      text NOT NULL,
  -- The page the form was sent from, e.g. "/" or "/registration".
  page         text,
  -- Set when the account that sent it was signed in.
  user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  ip_hash      text,
  -- Whether the Telegram notification went through.
  delivered    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX contact_messages_created_idx ON contact_messages (created_at DESC);
