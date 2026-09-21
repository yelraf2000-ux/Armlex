-- A published post can be deleted from everywhere with the 🗑 button in the
-- team chat (social/remove.ts); the draft keeps the record, marked deleted.

ALTER TABLE social_drafts DROP CONSTRAINT IF EXISTS social_drafts_status_check;
ALTER TABLE social_drafts ADD CONSTRAINT social_drafts_status_check
  CHECK (status IN ('pending', 'publishing', 'published', 'skipped', 'failed', 'deleted'));
