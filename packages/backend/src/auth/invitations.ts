/**
 * Invitations and the bonus questions they earn.
 *
 * The bonus is real spend — every question costs API credit — so the two awards
 * are paid at different moments on purpose:
 *
 *   +10  once, for completing the step with at least one invitation
 *   +5   per invitation, only when that person actually registers
 *
 * Paying the per-invite bonus on SEND would be free money: four throwaway
 * addresses would mint 20 questions. Paying it on registration ties the reward
 * to the thing the referral exists for. The +10 is safe to pay up front because
 * it is capped at once per account.
 *
 * The invitation is now MAILED as well as recorded, but the record remains what
 * counts: `claimInvitation` matches on the address at registration, so a bonus
 * settles whether or not the mail arrived. Sending is therefore best-effort and
 * never allowed to fail the invitation — losing the row to save the email would
 * be the wrong way round.
 */
import { db } from '../db/pool.js';
import { normaliseEmail } from './users.js';
import { sendInvite } from '../mail/invite.js';

/** Most invitations one account may record. */
export const MAX_INVITES = 4;

/** Paid once, for completing the step with at least one invitation. */
export const BONUS_FOR_INVITING = 10;

/** Paid per invitation, when that address registers. */
export const BONUS_PER_ACCEPTED = 5;

export interface InviteInput {
  email: string;
  name?: string | null;
}

/**
 * Read invitations off a request body, keeping only the usable ones.
 *
 * Silently drops malformed entries rather than rejecting the whole
 * registration: a typo in the fourth invitation must not cost someone their
 * account. They can invite again later; they cannot un-abandon a signup.
 */
export function parseInvites(raw: unknown): InviteInput[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: InviteInput[] = [];

  for (const entry of raw) {
    const e = entry as { email?: unknown; name?: unknown };
    const email = typeof e?.email === 'string' ? normaliseEmail(e.email) : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({
      email,
      name: typeof e?.name === 'string' && e.name.trim() ? e.name.trim() : null,
    });
    if (out.length >= MAX_INVITES) break;
  }
  return out;
}

/**
 * Record invitations for a new account and pay the joining bonus.
 *
 * Returns how many questions were added, so the UI can say the true number
 * rather than repeating what the form promised.
 */
export async function recordInvites(
  inviterId: string,
  invites: InviteInput[],
  lang?: unknown,
): Promise<number> {
  if (invites.length === 0) return 0;

  for (const invite of invites) {
    // An inviter re-inviting the same address is not a second reward.
    const rows = await db()<{ id: string }[]>`
      INSERT INTO invitations (inviter_id, email, name)
      VALUES (${inviterId}, ${invite.email}, ${invite.name ?? null})
      ON CONFLICT (inviter_id, email) DO NOTHING
      RETURNING id`;
    // No row means the conflict clause swallowed it — this address was already
    // invited by this person, and mailing them a second time would be the
    // reward-free half of a duplicate invitation arriving as spam.
    if (rows.length > 0) await mailInvite(inviterId, invite.email, lang);
  }

  await db()`
    UPDATE users SET bonus_questions = bonus_questions + ${BONUS_FOR_INVITING}
     WHERE id = ${inviterId}`;
  return BONUS_FOR_INVITING;
}

/**
 * Send one invitation, having already recorded it.
 *
 * Recorded first, sent second, and a failure to send is swallowed: the
 * invitation exists either way, the inviter has already been paid for it, and
 * the bonus settles on the address at registration regardless of whether the
 * mail arrived. Throwing here would lose the invitation to save the email.
 */
async function mailInvite(inviterId: string, to: string, lang: unknown): Promise<void> {
  const rows = await db()<{ name: string | null; company_name: string | null }[]>`
    SELECT name, company_name FROM users WHERE id = ${inviterId}`;
  const row = rows[0];
  // Falls back to the firm when the person left their own name blank, since
  // "someone invited you" persuades nobody.
  const inviter = row?.name?.trim() || row?.company_name?.trim() || '';
  await sendInvite({ to, inviter, kind: 'referral', lang });
}

/**
 * A new account has appeared — did somebody invite this address?
 *
 * Called once, as part of registration. Marking the invitation and paying the
 * inviter happen in one statement guarded by `accepted_user_id IS NULL`, so two
 * simultaneous registrations of the same address cannot pay the bonus twice.
 *
 * Self-invitation is refused: inviting your own address and registering it
 * again would otherwise be a loop that prints questions.
 */
export async function claimInvitation(newUserId: string, email: string): Promise<void> {
  const address = normaliseEmail(email);

  const claimed = await db()<{ inviter_id: string }[]>`
    UPDATE invitations
       SET accepted_user_id = ${newUserId}, accepted_at = now()
     WHERE id = (
       SELECT id FROM invitations
        WHERE email = ${address}
          AND accepted_user_id IS NULL
          AND inviter_id <> ${newUserId}
        ORDER BY created_at ASC
        LIMIT 1
     )
    RETURNING inviter_id`;

  const inviter = claimed[0]?.inviter_id;
  if (!inviter) return;

  await db()`
    UPDATE users SET bonus_questions = bonus_questions + ${BONUS_PER_ACCEPTED}
     WHERE id = ${inviter}`;

  /*
    And join the inviter's firm.

    This is what makes the invitation more than a referral bonus: the colleague
    who accepts appears in the admin's workspace, and their questions count
    against the firm's total. Done here rather than at registration because this
    is the only place that knows an invitation was actually claimed — the
    registration route calls it before it knows whether one existed.

    Guarded on the inviter actually having a workspace: if the backfill missed
    them, leaving the new account in its own workspace is a better failure than
    setting it to NULL.
  */
  await db()`
    UPDATE users u
       SET workspace_id = inviter.workspace_id
      FROM users inviter
     WHERE u.id = ${newUserId}
       AND inviter.id = ${inviter}
       AND inviter.workspace_id IS NOT NULL`;
}
