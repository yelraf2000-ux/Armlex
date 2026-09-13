/**
 * The signed session cookie.
 *
 * Stateless by design, exactly as the shared-password cookie was: the cookie
 * carries the user id and an expiry, signed with SESSION_SECRET, so there is no
 * session table to query on every request and a deploy does not sign everyone
 * out. What changed is that it now identifies WHO, not merely that somebody
 * knew a password.
 *
 *     <userId>.<version>.<expiresAtMs>.<hmac of the three>
 *
 * `version` is `users.session_version`, and it is what makes signing out mean
 * something. The cookie is still stateless in the sense that matters — no
 * session table, nothing extra read per request — but a request is refused when
 * the number in the cookie and the number on the account disagree, and signing
 * out increments the account's. Every copy of that cookie dies at once.
 *
 * The window is IDLE time, not time since signing in. It used to be a fixed 30
 * days from the moment of sign-in and never extended, which had it backwards in
 * both directions: somebody using this every day was signed out on day 30
 * anyway, and somebody who signed in once and vanished kept a live cookie for a
 * month. `refreshed` below slides it forward as the account is used.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'armlex_session';

/** Seven days away and you sign in again. Using it at all resets the clock. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How much of the window must be gone before a request extends it.
 *
 * Re-issuing on every request would attach a Set-Cookie header to every API
 * call for no gain; never re-issuing would make the window absolute again.
 * Halfway is the usual compromise: an account in daily use is refreshed every
 * few days, and one used once a week is refreshed on that one visit.
 */
const REFRESH_AFTER = MAX_AGE_MS / 2;

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

export function issue(userId: string, version = 0): string {
  const expires = Date.now() + MAX_AGE_MS;
  const payload = `${userId}.${version}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

/** What a cookie proves, or null for anything unsigned, tampered or expired. */
export interface Session {
  userId: string;
  /** Compared against the account's own; a mismatch is a signed-out cookie. */
  version: number;
  expiresAt: number;
}

export function verify(value: string | undefined): Session | null {
  if (!value) return null;
  const parts = value.split('.');
  // Three parts is the old format, from before sessions could be revoked.
  // Rejected rather than accepted with version 0: honouring it would leave a
  // month of unrevokable cookies in circulation, which is the thing being
  // fixed. It costs everyone one sign-in, once.
  if (parts.length !== 4) return null;

  const [userId, versionRaw, expiresRaw, signature] = parts as [string, string, string, string];
  if (!sameSignature(signature, sign(`${userId}.${versionRaw}.${expiresRaw}`))) return null;

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Date.now()) return null;
  const version = Number(versionRaw);
  if (!Number.isInteger(version) || version < 0) return null;
  // Signed, unexpired — but the id still has to be shaped like one before it
  // reaches a query.
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
  return { userId, version, expiresAt: expires };
}

/**
 * A replacement cookie if this one is far enough through its window, else null.
 *
 * Null is the common answer — most requests change nothing — and the caller
 * simply sets no header.
 */
export function refreshed(session: Session, userId: string, version: number): string | null {
  const remaining = session.expiresAt - Date.now();
  if (remaining > MAX_AGE_MS - REFRESH_AFTER) return null;
  return `${COOKIE}=${issue(userId, version)}; ${flags()}; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`;
}

function flags(): string {
  const secure = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  // httpOnly keeps it away from any script on the page; SameSite=Lax stops it
  // riding along on cross-site requests while still surviving the return leg
  // of the Google OAuth redirect.
  return `HttpOnly; SameSite=Lax; Path=/${secure}`;
}

export function setCookie(userId: string, version = 0): string {
  return `${COOKIE}=${issue(userId, version)}; ${flags()}; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`;
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
