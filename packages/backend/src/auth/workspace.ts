/**
 * The workspace: a firm, its people, and what they have spent.
 *
 * A firm may have several admins. `users.is_workspace_admin` grants the role and
 * `workspaces.owner_id` keeps one person who cannot be demoted — which is what
 * guarantees a workspace can never end up with nobody able to appoint anyone.
 * A single role column with no protected owner allows exactly that state, and
 * it is unrecoverable from inside the product.
 *
 * The allowance is ONE WEEKLY POOL for the firm, summed from every seat: each
 * member contributes their own plan and bonuses, and anyone may spend the
 * total. It renews Monday 00:00 Yerevan. See `workspaceQuota`.
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
import { sendInvite } from '../mail/invite.js';
import { hashInviteToken, newInviteToken } from './invitations.js';

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
  /** The one admin who cannot be demoted. */
  owner: boolean;
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

/**
 * Owner, or anyone the owner has promoted.
 *
 * Ownership is still its own fact and still cannot be revoked — that is what
 * guarantees a workspace always has at least one admin, which a plain role
 * column would not.
 */
export async function isAdmin(userId: string, workspaceId: string): Promise<boolean> {
  const rows = await db()<{ ok: boolean }[]>`
    SELECT (w.owner_id = ${userId} OR u.is_workspace_admin) AS ok
      FROM workspaces w
      JOIN users u ON u.id = ${userId}
     WHERE w.id = ${workspaceId}
       AND u.workspace_id = ${workspaceId}`;
  return Boolean(rows[0]?.ok);
}

/**
 * Promote or demote a colleague.
 *
 * The owner is refused in both directions: demoting them could leave a
 * workspace with no admin and no way to appoint one, and promoting them is a
 * no-op that only invites the UI to offer a button that does nothing.
 */
export async function setMemberAdmin(
  workspaceId: string,
  memberId: string,
  admin: boolean,
): Promise<boolean> {
  const rows = await db()<{ id: string }[]>`
    UPDATE users u
       SET is_workspace_admin = ${admin}
      FROM workspaces w
     WHERE u.id = ${memberId}
       AND u.workspace_id = ${workspaceId}
       AND w.id = ${workspaceId}
       AND w.owner_id <> ${memberId}
    RETURNING u.id`;
  return rows.length > 0;
}

export async function readWorkspace(user: User): Promise<WorkspaceView> {
  const id = await workspaceIdFor(user);

  const meta = await db()<{ name: string | null; owner_id: string }[]>`
    SELECT name, owner_id FROM workspaces WHERE id = ${id}`;
  const ownerId = meta[0]?.owner_id ?? user.id;

  /*
    Members are VERIFIED accounts only.

    Someone who has set a password from an invitation link but not yet clicked
    the verification mail has an account, a workspace and a seat — but nobody
    has yet shown they read that mailbox, and a colleague's belief about an
    address is not the same as proof of it. They stay in the pending list until
    they click, which is also what makes that list mean "not in yet" rather
    than "not registered yet".

    The owner is exempt: a workspace whose admin vanished from its own member
    list would be a page that appears to belong to nobody.
  */
  const members = await db()<
    { id: string; name: string | null; email: string; is_workspace_admin: boolean }[]
  >`
    SELECT id, name, email, is_workspace_admin FROM users
     WHERE workspace_id = ${id}
       AND (email_verified_at IS NOT NULL OR id = ${ownerId})
     -- The owner first, then admins, then by name; a list whose order changes
     -- with the last sign-in makes people re-read it every time.
     ORDER BY (id = ${ownerId}) DESC, is_workspace_admin DESC, lower(coalesce(name, email))`;

  /*
    Pending invitations sent by anyone already in this workspace.

    Scoped by inviter rather than by a workspace column on `invitations`: the
    invitation predates workspaces, registration writes rows before the invitee
    has an account, and the inviter is the one fact that has always been there.
  */
  /*
    Not accepted, OR accepted by an account that has not verified yet.

    The second half is what stops someone falling out of both lists. Setting a
    password marks the invitation accepted, which used to remove them from
    here — while the verification gate above kept them out of `members`. For
    the stretch between those two clicks the admin would have watched a
    colleague simply disappear.
  */
  const invitees = await db()<
    { id: string; name: string | null; email: string; created_at: string }[]
  >`
    SELECT i.id, i.name, i.email, i.created_at::text
      FROM invitations i
      JOIN users u ON u.id = i.inviter_id
      LEFT JOIN users a ON a.id = i.accepted_user_id
     WHERE u.workspace_id = ${id}
       AND (i.accepted_user_id IS NULL OR a.email_verified_at IS NULL)
     ORDER BY i.created_at DESC`;

  return {
    id,
    name: meta[0]?.name ?? null,
    // The caller's own role must agree with the row describing them below, or a
    // promoted admin gets a page that lists them as an admin and offers them
    // nothing an admin can do.
    role: ownerId === user.id || members.some((m) => m.id === user.id && m.is_workspace_admin)
      ? 'admin'
      : 'member',
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: (m.id === ownerId || m.is_workspace_admin ? 'admin' : 'member') as 'admin' | 'member',
      // Reported separately from the role so the UI can withhold the demote
      // control rather than offering one the server will refuse.
      owner: m.id === ownerId,
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
  /**
   * This person's share of the firm's spending — NOT a ceiling of their own.
   * There is one pool, and `workspaceQuota` holds the only limit there is.
   */
  used: number;
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
/**
 * The firm's allowance for THIS WEEK, and what it has spent.
 *
 * One pool, summed from every seat: each member contributes their own plan
 * plus their own bonus questions, and anyone may spend the total. A firm of
 * three on the free plan has fifteen a week between them, not five each.
 *
 * Everything renews at `armlex_period_start()` — Monday 00:00 in Yerevan — and
 * the same function is what the count is measured from, so the number shown
 * and the number enforced can never describe different weeks.
 *
 * Uncapped anywhere is uncapped: one `unlimited` member removes the ceiling
 * rather than contributing a number to it, because a total that quietly
 * excluded them would be a limit nothing could enforce.
 */
export async function workspaceQuota(user: User): Promise<{ used: number; limit: number | null }> {
  const id = await workspaceIdFor(user);

  const rows = await db()<
    {
      plan: string;
      plan_expires_at: string | null;
      bonus_questions: number;
    }[]
  >`
    SELECT plan, plan_expires_at::text, bonus_questions
      FROM users WHERE workspace_id = ${id}`;

  // A workspace with nobody in it cannot happen through the product, but a
  // zero ceiling would refuse every question rather than fail visibly — so
  // fall back to this member's own allowance.
  if (rows.length === 0) {
    return { used: 0, limit: allowanceFor(user.plan, user.plan_expires_at, user.bonus_questions) };
  }

  const seats = rows.map((r) => allowanceFor(r.plan, r.plan_expires_at, r.bonus_questions));
  const limit = seats.some((s) => s === null)
    ? null
    : seats.reduce((n: number, s) => n + (s ?? 0), 0);

  const spent = await db()<{ used: string }[]>`
    SELECT (
      COALESCE((
        SELECT count(*) FROM messages m
          JOIN sessions s ON s.id = m.session_id
          JOIN users mu ON mu.id = s.user_id
         WHERE mu.workspace_id = ${id}
           AND m.role = 'user'
           AND m.created_at >= armlex_period_start()
      ), 0)
      + COALESCE((
        SELECT sum(l.questions) FROM usage_ledger l
          JOIN users lu ON lu.id = l.user_id
         WHERE lu.workspace_id = ${id}
           AND l.period_start = armlex_period_start()
      ), 0)
    )::text AS used`;

  return { used: Number(spent[0]?.used ?? 0), limit };
}

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
                  AND m.created_at >= armlex_period_start()
             ), 0)
             + COALESCE((
               SELECT questions FROM usage_ledger l
                WHERE l.user_id = u.id
                  AND l.period_start = armlex_period_start()
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
  }));

  /*
    The totals come from the POOL, not from adding the seats up.

    The per-member numbers below are still worth showing — an admin wants to
    know who is spending the firm's allowance — but they are a breakdown of one
    shared figure, not quotas of their own. Summing them would report a
    different ceiling than the one actually enforced on the next question.
  */
  const pool = await workspaceQuota(user);
  return { members, used: pool.used, limit: pool.limit };
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
  lang?: unknown,
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

  const token = newInviteToken();
  await db()`
    INSERT INTO invitations (inviter_id, email, name, token_hash)
    VALUES (${user.id}, ${email}, ${name}, ${hashInviteToken(token)})
    ON CONFLICT (inviter_id, email) DO NOTHING`;
  void id;

  /*
   * Recorded first, mailed second, and a send failure does not fail the
   * invite. The row is what admits them — `claimInvitation` matches on the
   * address at registration — so an unsent mail costs the admin a re-send,
   * while a thrown error would cost them the invitation itself.
   */
  const inviter = user.name?.trim() || user.company_name?.trim() || '';
  await sendInvite({ to: email, inviter, kind: 'workspace', token, lang });

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
