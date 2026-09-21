/**
 * The website's «Հարց ունե՞ք» form: a visitor leaves a question and a way to
 * reach them, the team gets it in Telegram within seconds, and answers them
 * personally.
 *
 * A person answers, not the model. These are questions about the product —
 * price, coverage, a demo — and a generated wrong price is worse than a slow
 * reply.
 */
import { createHash } from 'node:crypto';
import { db } from '../db/pool.js';
import { sendToTeam } from './telegram.js';

export const LIMITS = { name: 100, contact: 200, message: 2000, page: 200 } as const;

export interface ContactInput {
  name: string;
  contact: string;
  message: string;
  page: string | null;
}

/** Trimmed and bounded, or the name of the field that is wrong. */
export function readContact(body: unknown): ContactInput | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = (key: keyof typeof LIMITS): string =>
    typeof b[key] === 'string' ? (b[key] as string).trim() : '';

  const name = text('name');
  const contact = text('contact');
  const message = text('message');
  const page = text('page');

  if (!name) return { error: 'name_required' };
  if (!contact) return { error: 'contact_required' };
  if (!message) return { error: 'message_required' };
  if (name.length > LIMITS.name || contact.length > LIMITS.contact || message.length > LIMITS.message) {
    return { error: 'too_long' };
  }
  return { name, contact, message, page: page ? page.slice(0, LIMITS.page) : null };
}

/** What lands in the team group. Plain text; the visitor's words verbatim. */
export function formatForTeam(c: ContactInput, signedInEmail: string | null): string {
  return [
    'Նոր հարց կայքից',
    `Անուն: ${c.name}`,
    `Կապ: ${c.contact}`,
    signedInEmail ? `Հաշիվ: ${signedInEmail}` : null,
    c.page ? `Էջ: ${c.page}` : null,
    '',
    c.message,
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/*
 * Per address, in memory — the same reasoning as the preview limit
 * (`answer/rateLimit.ts`): one small instance, and a form anyone can post to.
 * Generous for a person, useless for a script filling the team's Telegram.
 */
const PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const sent = new Map<string, number[]>();

export function allowContact(key: string, now = Date.now()): boolean {
  const recent = (sent.get(key) ?? []).filter((t) => t > now - HOUR_MS);
  if (recent.length >= PER_HOUR) {
    sent.set(key, recent);
    return false;
  }
  recent.push(now);
  sent.set(key, recent);
  if (sent.size > 20_000) {
    for (const [k, times] of sent) if (times.every((t) => t <= now - HOUR_MS)) sent.delete(k);
  }
  return true;
}

export function resetContactLimits(): void {
  sent.clear();
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

/** Store, then notify. Returns whether Telegram took it. */
export async function submitContact(
  c: ContactInput,
  who: { userId: string | null; email: string | null; ip: string },
): Promise<{ delivered: boolean }> {
  const rows = await db()<{ id: string }[]>`
    INSERT INTO contact_messages (name, contact, message, page, user_id, ip_hash)
    VALUES (${c.name}, ${c.contact}, ${c.message}, ${c.page}, ${who.userId}, ${hashIp(who.ip)})
    RETURNING id`;
  const delivered = await sendToTeam(formatForTeam(c, who.email));
  if (delivered) {
    await db()`UPDATE contact_messages SET delivered = true WHERE id = ${rows[0]!.id}`;
  }
  return { delivered };
}
