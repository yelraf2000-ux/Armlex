-- Pin, rename, delete: the three things missing from the conversation list.
--
-- Rename needs nothing new — `sessions.title` has existed since 004 and has
-- never been written to. Pin and delete each need something.

-- A timestamp rather than a boolean, so several pinned conversations have an
-- order among themselves and the most recently pinned surfaces first. Nothing
-- in the UI exposes that ordering as a choice; it just behaves sensibly.
ALTER TABLE sessions ADD COLUMN pinned_at timestamptz;

-- Deleting a conversation must not refund the month's questions.
--
-- `monthlyUsage` counts rows in `messages` joined to `sessions`, so a hard
-- delete un-asks the questions: ask five, delete the conversation, ask five
-- more, forever. The obvious fix is a soft delete, but for a tool people paste
-- client facts into, "delete" that keeps the text is the wrong promise.
--
-- So the content is genuinely destroyed and the COUNT is preserved separately.
-- One row per user per month, incremented at the moment of deletion; the usage
-- query adds it to what is still on disk.
CREATE TABLE usage_ledger (
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- First day of the month the questions were asked in — a deletion in
  -- September must not consume August's allowance.
  month     date NOT NULL,
  questions integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

-- Pinned first, and the list is scanned by user.
CREATE INDEX sessions_pinned_idx
  ON sessions (user_id, pinned_at DESC NULLS LAST, created_at DESC);
