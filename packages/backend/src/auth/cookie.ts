/**
 * The signed session cookie.
 *
 * Stateless by design, exactly as the shared-password cookie was: the cookie
 * carries the user id and an expiry, signed with SESSION_SECRET, so there is no
 * session table to query on every request and a deploy does not sign everyone
 * out. What changed is that it now identifies WHO, not merely that somebody
 * knew a password.
 *
 *     <userId>.<expiresAtMs>.<hmac of "<userId>.<expiresAtMs>">
 *
 * The trade is revocation: signing out clears the cookie in the browser, but a
 * copied cookie stays valid until it expires. That is the same property the
 * previous gate had, and the fix — a token table, or a per-user token version
 * column — is worth adding the day an account needs to be locked out, not
 * before.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'armlex_session';

/** 30 days. This is a tool people return to; a weekly sign-in teaches nothing. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function secret(): string {
  return process.env['SESSION_SECRET'] ?? '';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('hex');
}

function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function issue(userId: string): string {
  const expires = Date.now() + MAX_AGE_MS;
  const payload = `${userId}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

/** The user id a cookie proves, or null for anything unsigned, tampered or expired. */
export function verify(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;

  const [userId, expiresRaw, signature] = parts as [string, string, string];
  if (!sameSignature(signature, sign(`${userId}.${expiresRaw}`))) return null;

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  // Signed, unexpired — but the id still has to be shaped like one before it
  // reaches a query.
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  return userId;
}

function flags(): string {
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  // httpOnly keeps it away from any script on the page; SameSite=Lax stops it
  // riding along on cross-site requests while still surviving the return leg
  // of the Google OAuth redirect.
  return `HttpOnly; SameSite=Lax; Path=/${secure}`;
}

export function setCookie(userId: string): string {
  return `${COOKIE}=${issue(userId)}; ${flags()}; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; ${flags()}; Max-Age=0`;
}

export function readCookie(header: string | undefined, name = COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return undefined;
}
