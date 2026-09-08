-- More than one admin per firm.
--
-- Role was derived from `workspaces.owner_id` alone, which made exactly one
-- person able to manage seats and the subscription. That is fine for a firm of
-- two and a support problem for a firm of thirty, where the one admin is on
-- holiday the week a colleague needs adding.
--
-- The owner column stays and stays authoritative for one thing: who cannot be
-- demoted. Everything else is this flag. Keeping ownership as its own fact
-- avoids the state where a workspace has no admin at all, which is the failure
-- a plain role column invites.
ALTER TABLE users ADD COLUMN is_workspace_admin boolean NOT NULL DEFAULT false;

-- Every current owner is already acting as an admin; the flag has to agree
-- with what the product has been doing, or the migration silently demotes
-- every existing admin.
UPDATE users u
   SET is_workspace_admin = true
  FROM workspaces w
 WHERE w.owner_id = u.id;
