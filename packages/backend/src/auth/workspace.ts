/**
 * The workspace: a firm, its people, and what they have spent.
 *
 * Role is derived from ownership, never stored: `workspaces.owner_id` is the
 * admin and everyone else is a member. A stored role column would be a second
 * source of truth about permissions, and the first thing to disagree in a
 * permissions model is the thing that gets exploited.
 *
 * Membership comes from two places and they are deliberately different shapes:
 *   members  — accounts, with usage, who can be detached
 *   invitees — rows in `invitations` with nobody attached yet, who can be revoked
 * An invitee is not a user. Showing them in one list with a "pending" badge is a
 * presentation choice; conflating them in the data would mean inventing an
 * account for someone who has not registered.
 */
import { db } from '../db/pool.js';
import { allowanceFor, normaliseEmail, type User } from './users.js';

/**
 * How many people one workspace may hold, invitations included.
 *
 * Distinct from `MAX_INVITES` (4), which caps the registration step because
 * four empty boxes is as much as that screen should ask for. A firm of thirty
 * is a real customer, so the workspace ceiling is the size of the largest band
 * the signup form offers, plus room to grow into it.
 */
export const MAX_WORKSPACE_SIZE = 40;

export interface Member {
  id: string;
  name: string | null;
  email: string;
  role: 'admin' | 'member';
}

export interface Invitee {
  id: string;
  name: string | null;
  email: string;
  invitedAt: string;
}

export interface WorkspaceView {
  id: string;
  name: string | null;
  /** The caller's own role, so the UI can decide what to offer without guessing. */
  role: 'admin' | 'member';
  members: Member[];
  invitees: Invitee[];
}

/**
 * The caller's workspace, creating one if they somehow have none.
 *
 * The backfill gave every existing account a workspace and registration creates
 * one, so the repair path should never run — but an account with no workspace
 * would otherwise see an empty page with no way out of it, and a self-healing
 * read is cheaper than a support conversation.
 */
export async function workspaceIdFor(user: User): Promise<string> {
  if (user.workspace_id) return user.workspace_id;

  const created = await db()<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name) VALUES (${user.id}, ${user.company_name})
    RETURNING id`;
  const id = created[0]!.id;
  await db()`UPDATE users SET workspace_id = ${id} WHERE id = ${user.id}`;
  return id;
}

export async function isAdmin(userId: string, workspaceId: string): Promise<boolean> {
  const rows = await db()<{ id: string }[]>`
    SELECT id FROM workspaces WHERE id = ${workspaceId} AND owner_id = ${userId}`;
  return Boolean(rows[0]);
}

export async function readWorkspace(user: User): Promise<WorkspaceView> {
  const id = await workspaceIdFor(user);

  const meta = await db()<{ name: string | null; owner_id: string }[]>`
    SELECT name, owner_id FROM workspaces WHERE id = ${id}`;
  const ownerId = meta[0]?.owner_id ?? user.id;

  const members = await db()<{ id: string; name: string | null; email: string }[]>`
    SELECT id, name, email FROM users
     WHERE workspace_id = ${id}
     -- The admin first, then by name; a list whose order changes with the last
     -- sign-in makes people re-read it every time.
     ORDER BY (id = ${ownerId}) DESC, lower(coalesce(name, email))`;

  /*
    Pending invitations sent by anyone already in this workspace.

    Scoped by inviter rather than by a workspace column on `invitations`: the
    invitation predates workspaces, registration writes rows before the invitee
    has an account, and the inviter is the one fact that has always been there.
  */
  const invitees = await db()<
    { id: string; name: string | null; email: string; created_at: string }[]
  >`
    SELECT i.id, i.name, i.email, i.created_at::text
      FROM invitations i
      JOIN users u ON u.id = i.inviter_id
     WHERE u.workspace_id = ${id}
       AND i.accepted_user_id IS NULL
     ORDER BY i.created_at DESC`;

  return {
    id,
    name: meta[0]?.name ?? null,
    role: ownerId === user.id ? 'admin' : 'member',
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.id === ownerId ? 'admin' : 'member',
    })),
    invitees: invitees.map((i) => ({
      id: i.id,
      name: i.name,
      email: i.email,
      invitedAt: i.created_at,
    })),
  };
}

export interface MemberUsage {
  id: string;
  name: string | null;
  email: string;
  used: number;
  limit: number | null;
}

export interface WorkspaceUsage {
  members: MemberUsage[];
  used: number;
  /** `null` when anyone in the workspace is on an uncapped plan. */
  limit: number | null;
}

/**
 * What the firm has spent this month, and what it may spend.
 *
 * Per member the same count `monthlyUsage` reports — questions still on disk
 * PLUS questions whose conversation was deleted (`usage_ledger`), because
 * deleting a conversation must not refund the month. Duplicated here as one
 * grouped query rather than looping `monthlyUsage` per member: a forty-person
 * firm would otherwise be forty round trips to Neon for one page.
 */
export async function readUsage(user: User): Promise<WorkspaceUsage> {
  const id = await workspaceIdFor(user);

  const rows = await db()<
    {
      id: string;
      name: string | null;
      email: string;
      plan: string;
      plan_expires_at: string | null;
      bonus_questions: number;
      used: string;
    }[]
  >`
    SELECT u.id, u.name, u.email, u.plan, u.plan_expires_at::text, u.bonus_questions,
           (
             COALESCE((
               SELECT count(*) FROM messages m
                 JOIN sessions s ON s.id = m.session_id
                WHERE s.user_id = u.id
                  AND m.role = 'user'
                  AND m.created_at >= date_trunc('month', now())
             ), 0)
             + COALESCE((
               SELECT questions FROM usage_ledger l
                WHERE l.user_id = u.id
                  AND l.month = date_trunc('month', now())::date
             ), 0)
           )::text AS used
      FROM users u
     WHERE u.workspace_id = ${id}
     ORDER BY lower(coalesce(u.name, u.email))`;

  const members: MemberUsage[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    used: Number(r.used),
    limit: allowanceFor(r.plan, r.plan_expires_at, r.bonus_questions),
  }));

  // One uncapped member makes the firm's ceiling meaningless, so it is reported
  // as no ceiling rather than as a number that quietly excludes them.
  const uncapped = members.some((m) => m.limit === null);
  return {
    members,
    used: members.reduce((n, m) => n + m.used, 0),
    limit: uncapped ? null : members.reduce((n, m) => n + (m.limit ?? 0), 0),
  };
}

export type InviteResult =
  | { ok: true }
  | { ok: false; reason: 'invalid_email' | 'already_here' | 'workspace_full' };

/**
 * Invite someone into the workspace.
 *
 * Writes the same `invitations` row registration writes, so the existing
 * acceptance path picks it up unchanged — but WITHOUT the +10 joining bonus.
 * That award is "once, for completing the invitation step"; paying it again per
 * invitation from this page would turn a referral scheme into a printing press.
 * The +5 on acceptance still applies, and still requires a real registration.
 */
export async function inviteToWorkspace(
  user: User,
  input: { email: unknown; name: unknown },
): Promise<InviteResult> {
  const email = typeof input.email === 'string' ? normaliseEmail(input.email) : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, reason: 'invalid_email' };

  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : null;
  const id = await workspaceIdFor(user);

  const view = await readWorkspace(user);
  if (view.members.length + view.invitees.length >= MAX_WORKSPACE_SIZE) {
    return { ok: false, reason: 'workspace_full' };
  }
  // Already a colleague, or already invited — either way, say so rather than
  // silently doing nothing and leaving the admin to wonder.
  if (
    view.members.some((m) => m.email === email) ||
    view.invitees.some((i) => i.email === email)
  ) {
    return { ok: false, reason: 'already_here' };
  }

  await db()`
    INSERT INTO invitations (inviter_id, email, name)
    VALUES (${user.id}, ${email}, ${name})
    ON CONFLICT (inviter_id, email) DO NOTHING`;
  void id;
  return { ok: true };
}

/** Withdraw an invitation that has not been accepted. Admin only, checked by the route. */
export async function revokeInvite(workspaceId: string, inviteId: string): Promise<boolean> {
  const rows = await db()<{ id: string }[]>`
    DELETE FROM invitations i
     USING users u
     WHERE i.id = ${inviteId}
       AND u.id = i.inviter_id
       AND u.workspace_id = ${workspaceId}
       -- An accepted invitation is a record of how a colleague arrived.
       -- Removing the person is removeMember; this must not quietly do both.
       AND i.accepted_user_id IS NULL
    RETURNING i.id`;
  return Boolean(rows[0]);
}

/**
 * Remove a colleague from the workspace.
 *
 * They keep their account, their conversations and their own allowance — they
 * simply stop being part of this firm, and get a workspace of their own where
 * they are the admin. Deleting the account instead would let one admin destroy
 * a colleague's work, which is not what "remove from workspace" says.
 *
 * The owner cannot be removed: a workspace with no admin is unadministrable,
 * and nothing in this UI can appoint a new one yet.
 */
export async function removeMember(workspaceId: string, memberId: string): Promise<boolean> {
  const owner = await db()<{ owner_id: string }[]>`
    SELECT owner_id FROM workspaces WHERE id = ${workspaceId}`;
  if (!owner[0] || owner[0].owner_id === memberId) return false;

  const inWorkspace = await db()<{ id: string; company_name: string | null }[]>`
    SELECT id, company_name FROM users
     WHERE id = ${memberId} AND workspace_id = ${workspaceId}`;
  if (!inWorkspace[0]) return false;

  const fresh = await db()<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name)
    VALUES (${memberId}, ${inWorkspace[0].company_name})
    RETURNING id`;
  await db()`UPDATE users SET workspace_id = ${fresh[0]!.id} WHERE id = ${memberId}`;

  /*
    Delete the invitation that brought them here — do not merely un-accept it.

    Something has to happen to that row: left as "accepted" it holds the
    UNIQUE (inviter_id, email) slot, so re-inviting the same address silently
    does nothing. Clearing `accepted_user_id` was the first fix and it was
    worse: the row becomes pending again, so the person the admin just removed
    reappears one table lower as an invitee, and removal reads as half-failed.

    Deleting it leaves the workspace saying what happened — they are gone — and
    a fresh invitation can be sent. The inviter keeps the +5 already paid: it
    was earned by a real registration, and clawing it back would make the bonus
    a loan.
  */
  await db()`DELETE FROM invitations WHERE accepted_user_id = ${memberId}`;
  return true;
}

/** Rename the workspace. Admin only, checked by the route. */
export async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
  await db()`UPDATE workspaces SET name = ${name.trim().slice(0, 120) || null} WHERE id = ${workspaceId}`;
}
