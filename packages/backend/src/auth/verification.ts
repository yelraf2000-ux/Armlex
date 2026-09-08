/**
 * Email verification for password sign-ups.
 *
 * The gate exists only when mail can actually be sent. `isRequired()` is
 * `mailer.isEnabled()`, so a deployment without RESEND_API_KEY keeps the old
 * behaviour — register, get a cookie, start asking — rather than accepting
 * accounts and stranding every one of them behind a link nobody could send.
 * That is the shape google.ts and lemonsqueezy.ts already use for their own
 * credentials, and it is what makes this safe to ship before the key exists.
 *
 * Google accounts are never gated: Google has already proved the address.
 */
import { createHash, randomBytes } from 'node:crypto';
import { db } from '../db/pool.js';
import type { User } from './users.js';
import * as mailer from '../mail/mailer.js';

/**
 * 24 hours. Long enough to survive a link opened the next morning, short
 * enough that an address abandoned mid-signup does not stay claimable for a
 * week.
 */
const TTL_HOURS = 24;

/** Base64url so it survives a URL unescaped; 32 bytes is 256 bits. */
function newToken(): string {
  return randomBytes(32).toString('base64url');
}

function hash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isRequired(): boolean {
  return mailer.isEnabled();
}

function origin(): string {
  return (process.env['PUBLIC_ORIGIN'] ?? 'http://localhost:5173').replace(/\/+$/, '');
}

type Lang = 'hy' | 'ru' | 'en';

function normaliseLang(raw: unknown): Lang {
  return raw === 'ru' || raw === 'en' ? raw : 'hy';
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

const COPY: Record<Lang, Copy> = {
  hy: {
    subject: 'MatyanAI — հաստատեք Ձեր էլ. հասցեն',
    heading: 'Հաստատեք Ձեր էլ. հասցեն',
    body: 'Սեղմեք ներքևի կոճակը՝ Ձեր MatyanAI հաշիվն ակտիվացնելու համար։',
    button: 'Հաստատել հասցեն',
    fallback: 'Եթե կոճակը չի աշխատում, պատճենեք այս հղումը Ձեր դիտարկիչ․',
    expiry: 'Հղումը գործում է 24 ժամ։',
    ignore: 'Եթե Դուք չեք գրանցվել, պարզապես անտեսեք այս նամակը։',
  },
  ru: {
    subject: 'MatyanAI — подтвердите ваш адрес',
    heading: 'Подтвердите ваш адрес',
    body: 'Нажмите кнопку ниже, чтобы активировать вашу учётную запись MatyanAI.',
    button: 'Подтвердить адрес',
    fallback: 'Если кнопка не работает, скопируйте эту ссылку в браузер:',
    expiry: 'Ссылка действует 24 часа.',
    ignore: 'Если вы не регистрировались, просто проигнорируйте это письмо.',
  },
  en: {
    subject: 'MatyanAI — confirm your email',
    heading: 'Confirm your email',
    body: 'Click the button below to activate your MatyanAI account.',
    button: 'Confirm email',
    fallback: 'If the button does not work, copy this link into your browser:',
    expiry: 'The link is valid for 24 hours.',
    ignore: 'If you did not register, simply ignore this message.',
  },
};

/*
 * Inline styles, no <style> block, no flexbox. Gmail strips <style>, Outlook
 * ignores much of modern layout, and a verification mail that degrades to
 * plain text still works — one that needs a stylesheet to make the link
 * findable does not.
 */
function render(link: string, lang: Lang): { html: string; text: string } {
  const c = COPY[lang];
  const html = [
    '<div style="margin:0;padding:32px 16px;background:#EDE8DC;font-family:Georgia,serif;color:#33191E">',
    '<div style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:10px;padding:32px">',
    `<h1 style="margin:0 0 16px;font-size:22px;font-weight:normal">${c.heading}</h1>`,
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#4A3524">${c.body}</p>`,
    `<p style="margin:0 0 24px"><a href="${link}" style="display:inline-block;background:#A8142B;color:#EDE8DC;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:15px">${c.button}</a></p>`,
    `<p style="margin:0 0 8px;font-size:13px;color:#8B8474">${c.fallback}</p>`,
    `<p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${link}" style="color:#A8142B">${link}</a></p>`,
    `<p style="margin:0 0 4px;font-size:13px;color:#8B8474">${c.expiry}</p>`,
    `<p style="margin:0;font-size:13px;color:#8B8474">${c.ignore}</p>`,
    '</div></div>',
  ].join('');
  const text = `${c.heading}\n\n${c.body}\n\n${link}\n\n${c.expiry}\n${c.ignore}`;
  return { html, text };
}

/**
 * Mint a link for this account and send it.
 *
 * Any outstanding token for the account is consumed first, so a resend cannot
 * leave two live links behind. The older one arriving second and still working
 * is exactly how someone ends up verified by a link they were told was
 * replaced.
 */
export async function issueFor(
  user: Pick<User, 'id' | 'email'>,
  lang: unknown = 'hy',
): Promise<{ sent: boolean; error?: string }> {
  if (!isRequired()) return { sent: false, error: 'mail_disabled' };

  const token = newToken();
  await db()`
    UPDATE email_verifications SET consumed_at = now()
    WHERE user_id = ${user.id} AND consumed_at IS NULL`;
  await db()`
    INSERT INTO email_verifications (token_hash, user_id, expires_at)
    VALUES (${hash(token)}, ${user.id}, now() + make_interval(hours => ${TTL_HOURS}))`;

  const chosen = normaliseLang(lang);
  const { html, text } = render(`${origin()}/verify/${token}`, chosen);
  const res = await mailer.send({
    to: user.email,
    subject: COPY[chosen].subject,
    html,
    text,
  });
  return res.ok ? { sent: true } : { sent: false, error: res.error ?? 'send_failed' };
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'already_used' };

/**
 * Spend a token.
 *
 * `already_used` is kept distinct from `invalid` on purpose. A second click on
 * the same link — a mail client prefetching it, a forwarded message, a double
 * tap — is not an error, and telling that person their link is invalid reads
 * as a fault they caused.
 */
export async function consume(token: string): Promise<ConsumeResult> {
  if (!token || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) return { ok: false, reason: 'invalid' };

  const rows = await db()<
    { user_id: string; expires_at: string; consumed_at: string | null }[]
  >`
    SELECT user_id, expires_at, consumed_at
    FROM email_verifications WHERE token_hash = ${hash(token)}`;

  const row = rows[0];
  if (!row) return { ok: false, reason: 'invalid' };
  if (row.consumed_at) return { ok: false, reason: 'already_used' };
  if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };

  await db()`
    UPDATE email_verifications SET consumed_at = now() WHERE token_hash = ${hash(token)}`;
  await db()`
    UPDATE users SET email_verified_at = now()
    WHERE id = ${row.user_id} AND email_verified_at IS NULL`;

  return { ok: true, userId: row.user_id };
}

/** Whether this account may sign in. Unverified blocks only when the gate is on. */
export async function isVerified(userId: string): Promise<boolean> {
  if (!isRequired()) return true;
  const rows = await db()<{ verified: boolean }[]>`
    SELECT (email_verified_at IS NOT NULL) AS verified FROM users WHERE id = ${userId}`;
  return rows[0]?.verified ?? false;
}
