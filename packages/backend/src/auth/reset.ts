/**
 * Forgotten passwords.
 *
 * Deliberately close to `verification.ts` — same token shape, same hashing,
 * same mail structure — because they are the same mechanism pointed at a
 * different question. Two divergences are on purpose:
 *
 *   ONE HOUR, not twenty-four. A verification link proves a mailbox; a reset
 *   link grants account access to whoever holds it. The stronger credential
 *   gets the shorter life.
 *
 *   NO ADDRESS ORACLE. The request endpoint answers identically whether or not
 *   the address is registered. It takes no password, so a distinguishing
 *   response would turn it into a way to test which of a leaked address list
 *   have accounts here — which is precisely what `login`'s shared
 *   `bad_credentials` message exists to prevent.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/pool.js';
import { hashPassword } from './password.js';
import * as mailer from '../mail/mailer.js';

const TTL_MINUTES = 60;

function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isEnabled(): boolean {
  return mailer.isEnabled();
}

function origin(): string {
  return (process.env['PUBLIC_ORIGIN'] ?? 'http://localhost:5173').replace(/\/+$/, '');
}

interface Copy {
  subject: string;
  heading: string;
  body: string;
  button: string;
  fallback: string;
  expiry: string;
  ignore: string;
}

/** One language. The interface is Armenian only, so the post is too. */
const COPY: Copy = {
  subject: 'MatyanAI — գաղտնաբառի վերականգնում',
  heading: 'Նոր գաղտնաբառ',
  body: 'Սեղմեք ներքևի կոճակը՝ նոր գաղտնաբառ սահմանելու համար։',
  button: 'Սահմանել նոր գաղտնաբառ',
  fallback: 'Եթե կոճակը չի աշխատում, պատճենեք այս հղումը Ձեր դիտարկիչ․',
  expiry: 'Հղումը գործում է 1 ժամ։',
  ignore:
    'Եթե Դուք չեք պահանջել վերականգնում, անտեսեք այս նամակը — գաղտնաբառը մնում է անփոփոխ։',
};

function render(link: string): { html: string; text: string } {
  const c = COPY;
  const html = [
    '<div style="margin:0;padding:32px 16px;background:#F7F8FA;font-family:-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#111418">',
    '<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:8px;padding:32px">',
    `<h1 style="margin:0 0 16px;font-size:22px;font-weight:600">${c.heading}</h1>`,
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#444C57">${c.body}</p>`,
    `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#2250DC;color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px">${c.button}</a></p>`,
    `<p style="margin:0 0 8px;font-size:13px;color:#79818E">${c.fallback}</p>`,
    `<p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${link}" style="color:#2250DC">${link}</a></p>`,
    `<p style="margin:0 0 4px;font-size:13px;color:#79818E">${c.expiry}</p>`,
    `<p style="margin:0;font-size:13px;color:#79818E">${c.ignore}</p>`,
    '</div></div>',
  ].join('');
  const text = `${c.heading}\n\n${c.body}\n\n${link}\n\n${c.expiry}\n${c.ignore}`;
  return { html, text };
}

/**
 * Mint a reset link for an address, if it has an account.
 *
 * Any outstanding reset for the account is consumed first: two live links
 * means the older one still works after the person has been told it was
 * replaced, and for a credential this strong that window should not exist.
 */
export async function issueFor(email: string): Promise<{ sent: boolean }> {
  if (!isEnabled()) return { sent: false };

  const rows = await db()<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
  const user = rows[0];
  // No account. The caller returns success regardless — see the header.
  if (!user) return { sent: false };

  const token = newToken();
  await db()`
    UPDATE password_resets SET consumed_at = now()
    WHERE user_id = ${user.id} AND consumed_at IS NULL`;
  await db()`
    INSERT INTO password_resets (token_hash, user_id, expires_at)
    VALUES (${hash(token)}, ${user.id}, now() + make_interval(mins => ${TTL_MINUTES}))`;

  const { html, text } = render(`${origin()}/reset/${token}`);
  const res = await mailer.send({ to: email, subject: COPY.subject, html, text });
  return { sent: res.ok };
}

export type ResetResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'already_used' };

/**
 * Spend a reset token and set the new password.
 *
 * Also marks the address verified. Clicking a link sent to it proves exactly
 * what verification proves, and refusing to acknowledge that would strand
 * anyone who registered, never verified, and then forgot their password —
 * they would set a password successfully and still be unable to sign in.
 */
export async function consume(token: string, password: string): Promise<ResetResult> {
  if (!token || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) return { ok: false, reason: 'invalid' };

  const rows = await db()<
    { user_id: string; expires_at: string; consumed_at: string | null }[]
  >`
    SELECT user_id, expires_at, consumed_at
    FROM password_resets WHERE token_hash = ${hash(token)}`;

  const row = rows[0];
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.consumed_at) return { ok: false, reason: 'already_used' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  const hashed = await hashPassword(password);
  await db()`
    UPDATE password_resets SET consumed_at = now() WHERE token_hash = ${hash(token)}`;
  await db()`
    UPDATE users
       SET password_hash = ${hashed},
           email_verified_at = COALESCE(email_verified_at, now())
     WHERE id = ${row.user_id}`;

  return { ok: true, userId: row.user_id };
}
