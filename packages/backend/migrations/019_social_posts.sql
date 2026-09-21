-- Posts made in the Telegram channel, and where each was reposted.
--
-- One row per channel post. The (chat, message) pair makes a repeated webhook
-- delivery — Telegram retries — a no-op instead of a second Facebook post.

CREATE TABLE social_posts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tg_chat_id       bigint NOT NULL,
  tg_message_id    bigint NOT NULL,
  -- Albums arrive as one update per photo sharing this id; only the first is
  -- reposted, the rest are recognised and skipped.
  tg_media_group   text,
  text             text NOT NULL DEFAULT '',
  -- File name under the media directory, served at /media/<name>.
  image_name       text,
  fb_post_id       text,
  fb_error         text,
  ig_media_id      text,
  ig_error         text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tg_chat_id, tg_message_id)
);

CREATE INDEX social_posts_group_idx ON social_posts (tg_chat_id, tg_media_group)
  WHERE tg_media_group IS NOT NULL;
