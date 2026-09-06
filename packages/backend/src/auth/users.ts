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
  plan_expires_at: string | null;
  company_name: string | null;
  company_size: string | null;
  bonus_questions: number;
}

export interface CompanyProfile {
  companyName?: string | null;
  /**
   * Deliberately `unknown`: this arrives straight off a request body, and
   * `validSize` is the one place it becomes a string. Typing it as `string`
   * here would push the cast to every call site, where it would eventually be
   * done without the check.
   */
  companySize?: unknown;
}

/**
 * The sizes the form offers.
 *
 * A closed set rather than a number, because "10-30" is something a person can
 * pick without thinking while "17" is a precision they would have invented.
 * Anything outside the set is stored as null rather than accepted — the column
 * has the same CHECK, so a bad value would fail the insert and lose the signup.
 */
export const COMPANY_SIZES = ['1-5', '5-10', '10-30', '30+'] as const;

export function validSize(size: unknown): string | null {
  return typeof size === 'string' && (COMPANY_SIZES as readonly string[]).includes(size)
    ? size
    : null;
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
    SELECT id, email, name, plan, password_hash, google_sub, plan_expires_at,
           company_name, company_size, bonus_questions
      FROM users WHERE email = ${normaliseEmail(email)} LIMIT 1`;
  return rows[0] ?? null;
}

export async function findById(id: string): Promise<User | null> {
  const rows = await db()<User[]>`
    SELECT id, email, name, plan, password_hash, google_sub, plan_expires_at,
           company_name, company_size, bonus_questions
      FROM users WHERE id = ${id} LIMIT 1`;
  return rows[0] ?? null;
}

export async function createWithPassword(
  email: string,
  password: string,
  name: string | null,
  profile: CompanyProfile = {},
): Promise<User> {
  const hash = await hashPassword(password);
  const rows = await db()<User[]>`
    INSERT INTO users (email, name, password_hash, company_name, company_size)
    VALUES (${normaliseEmail(email)}, ${name}, ${hash},
            ${profile.companyName ?? null}, ${validSize(profile.companySize)})
    RETURNING id, email, name, plan, password_hash, google_sub, plan_expires_at,
              company_name, company_size, bonus_questions`;
  return rows[0]!;
}

/**
 * Fill in a profile after the fact.
 *
 * Google sign-up redirects away from the page, so the answers collected before
 * that round trip cannot ride along in the registration call — the browser
 * holds them and posts them here once the account exists. Also the repair path
 * for any account that predates this form.
 *
 * Only fills EMPTY fields: someone returning through Google should not have a
 * company name they later corrected silently overwritten by a stale value the
 * browser was still holding.
 */
export async function fillProfile(id: string, profile: CompanyProfile): Promise<User | null> {
  const rows = await db()<User[]>`
    UPDATE users
       SET company_name = COALESCE(company_name, ${profile.companyName ?? null}),
           company_size = COALESCE(company_size, ${validSize(profile.companySize)})
     WHERE id = ${id}
    RETURNING id, email, name, plan, password_hash, google_sub, plan_expires_at,
              company_name, company_size, bonus_questions`;
  return rows[0] ?? null;
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
    SELECT id, email, name, plan, password_hash, google_sub, plan_expires_at,
           company_name, company_size, bonus_questions
      FROM users WHERE google_sub = ${sub} LIMIT 1`;
  if (bySub[0]) return bySub[0];

  const existing = await findByEmail(address);
  if (existing) {
    const rows = await db()<User[]>`
      UPDATE users
         SET google_sub = ${sub},
             name = COALESCE(name, ${name})
       WHERE id = ${existing.id}
      RETURNING id, email, name, plan, password_hash, google_sub, plan_expires_at, company_name, company_size, bonus_questions`;
    return rows[0]!;
  }

  const rows = await db()<User[]>`
    INSERT INTO users (email, name, google_sub)
    VALUES (${address}, ${name}, ${sub})
    RETURNING id, email, name, plan, password_hash, google_sub, plan_expires_at, company_name, company_size, bonus_questions`;
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
 * The plan actually in force right now.
 *
 * A cancelled subscription keeps its plan until the paid period ends — someone
 * who paid through the end of the month has paid through the end of the month —
 * so the webhook leaves `plan` alone and sets `plan_expires_at`. Which means the
 * stored column is a claim about the past and this is the reading of the
 * present: past the expiry, the allowance is free again, whatever the row says.
 *
 * Enforced here rather than by a nightly job, so there is no window in which an
 * expired plan is still being honoured because a cron has not run yet.
 */
export function effectivePlan(user: User): string {
  if (!user.plan_expires_at) return user.plan;
  return new Date(user.plan_expires_at).getTime() > Date.now() ? user.plan : 'free';
}

/**
 * Questions asked this calendar month, against the plan's allowance.
 *
 * Counts USER messages — one row per question actually asked — over sessions
 * the user owns. A failed turn that never persisted a message does not count
 * against them, which is the fair reading of "questions asked".
 */
export async function monthlyUsage(user: User): Promise<Usage> {
  const base = ALLOWANCE[effectivePlan(user)] ?? null;
  /*
    Bonus questions from invitations sit on top of the plan, and recur monthly
    rather than being spent once. That is the generous reading, chosen because
    the alternative — a one-off pot that silently drains — is the kind of thing
    a user discovers only when it is gone, and the amounts are small enough
    (10 + 5 per referral) that the cost is bounded by design.

    `null` stays `null`: there is nothing to add to no limit.
  */
  const limit = base === null ? null : base + (user.bonus_questions ?? 0);
  const rows = await db()<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM messages m JOIN sessions s ON s.id = m.session_id
     WHERE s.user_id = ${user.id}
       AND m.role = 'user'
       AND m.created_at >= date_trunc('month', now())`;
  const used = rows[0]?.n ?? 0;
  return { used, limit, remaining: limit === null ? null : Math.max(0, limit - used) };
}
