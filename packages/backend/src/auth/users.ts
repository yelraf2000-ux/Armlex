/**
 * User records and the monthly question allowance.
 *
 * The allowance is the reason this file exists alongside the identity code.
 * The old shared password was never a privacy control — it was a spending
 * control, because every answer costs roughly $0.10 of API credit. Opening
 * registration removes that control, so it has to be replaced in the same
 * change or the first crawler to find the signup form drains the balance.
 *
 * Usage is COUNTED, not tracked: the number of questions a user has asked this
 * calendar month is a query over `messages`, so it cannot drift away from what
 * actually happened the way an incremented counter can.
 */
import { db } from '../db/pool.js';
import { hashPassword } from './password.js';

export interface User {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  password_hash: string | null;
  google_sub: string | null;
}

/** Questions per calendar month, by plan. `null` means no ceiling. */
const ALLOWANCE: Record<string, number | null> = {
  free: 5,
  pro: 50,
  firm: 150,
  unlimited: null,
};

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function findByEmail(email: string): Promise<User | null> {
  const rows = await db()<User[]>`
    SELECT id, email, name, plan, password_hash, google_sub
      FROM users WHERE email = ${normaliseEmail(email)} LIMIT 1`;
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<User | null> {
  const rows = await db()<User[]>`
    SELECT id, email, name, plan, password_hash, google_sub
      FROM users WHERE id = ${id} LIMIT 1`;
  return rows[0] ?? null;
}

export async function createWithPassword(
  email: string,
  password: string,
  name: string | null,
): Promise<User> {
  const hash = await hashPassword(password);
  const rows = await db()<User[]>`
    INSERT INTO users (email, name, password_hash)
    VALUES (${normaliseEmail(email)}, ${name}, ${hash})
    RETURNING id, email, name, plan, password_hash, google_sub`;
  return rows[0]!;
}

/**
 * Sign in or register through Google.
 *
 * Matching is by EMAIL first, then subject id. Someone who registered with a
 * password and later clicks "Continue with Google" on the same address should
 * land in their existing account with their existing conversations — not a
 * second, empty account that looks like data loss. The subject id is then
 * attached so later sign-ins match on it directly, since an email can change
 * and `sub` cannot.
 */
export async function upsertGoogleUser(
  sub: string,
  email: string,
  name: string | null,
): Promise<User> {
  const address = normaliseEmail(email);

  const bySub = await db()<User[]>`
    SELECT id, email, name, plan, password_hash, google_sub
      FROM users WHERE google_sub = ${sub} LIMIT 1`;
  if (bySub[0]) return bySub[0];

  const existing = await findByEmail(address);
  if (existing) {
    const rows = await db()<User[]>`
      UPDATE users
         SET google_sub = ${sub},
             name = COALESCE(name, ${name})
       WHERE id = ${existing.id}
      RETURNING id, email, name, plan, password_hash, google_sub`;
    return rows[0]!;
  }

  const rows = await db()<User[]>`
    INSERT INTO users (email, name, google_sub)
    VALUES (${address}, ${name}, ${sub})
    RETURNING id, email, name, plan, password_hash, google_sub`;
  return rows[0]!;
}

export async function touchLastSeen(id: string): Promise<void> {
  await db()`UPDATE users SET last_seen_at = now() WHERE id = ${id}`;
}

export interface Usage {
  used: number;
  limit: number | null;
  remaining: number | null;
}

/**
 * Questions asked this calendar month, against the plan's allowance.
 *
 * Counts USER messages — one row per question actually asked — over sessions
 * the user owns. A failed turn that never persisted a message does not count
 * against them, which is the fair reading of "questions asked".
 */
export async function monthlyUsage(user: User): Promise<Usage> {
  const limit = ALLOWANCE[user.plan] ?? null;
  const rows = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM messages m JOIN sessions s ON s.id = m.session_id
     WHERE s.user_id = ${user.id}
       AND m.role = 'user'
       AND m.created_at >= date_trunc('month', now())`;
  const used = rows[0]?.n ?? 0;
  return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
}
