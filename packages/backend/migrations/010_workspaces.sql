-- Workspaces: a firm, and the people in it.
--
-- The invitation graph already implied this — someone invites colleagues, the
-- colleagues register — but it was only ever a list of rewards. Nothing could
-- answer "who is in my firm", "who is the admin", or "how many questions has
-- the firm used", which is the unit an accounting firm actually buys.
--
-- ROLE IS DERIVED, NOT STORED. `workspaces.owner_id = users.id` is the admin;
-- everyone else in the workspace is a member. A stored role column would be a
-- second source of truth that can disagree with ownership, and the first thing
-- to disagree in a permissions model is the thing that gets exploited.

CREATE TABLE workspaces (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Seeded from the owner's company name; editable from the workspace page.
  name       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Nullable, and ON DELETE SET NULL rather than CASCADE: deleting a workspace
-- must never take its members' accounts — or their conversations — with it.
ALTER TABLE users ADD COLUMN workspace_id uuid REFERENCES workspaces (id) ON DELETE SET NULL;

CREATE INDEX workspaces_owner_idx ON workspaces (owner_id);
CREATE INDEX users_workspace_idx ON users (workspace_id);

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Every existing account owns a workspace, because every account that was not
-- invited is an admin of its own firm of one.

INSERT INTO workspaces (owner_id, name)
SELECT id, company_name FROM users;

UPDATE users u SET workspace_id = w.id
  FROM workspaces w WHERE w.owner_id = u.id;

-- Then anyone who arrived through an invitation joins the inviter's workspace
-- instead. One level only: the invite flow has no notion of an invitee inviting
-- on their own behalf into someone else's firm, so there is no chain to walk.
UPDATE users u
   SET workspace_id = inviter.workspace_id
  FROM invitations i
  JOIN users inviter ON inviter.id = i.inviter_id
 WHERE i.accepted_user_id = u.id
   AND inviter.workspace_id IS DISTINCT FROM u.workspace_id;

-- The workspaces those invitees owned are now empty. Delete them rather than
-- leaving rows nothing points at — an empty workspace is not a firm of zero, it
-- is a backfill artefact.
DELETE FROM workspaces w
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.workspace_id = w.id);
