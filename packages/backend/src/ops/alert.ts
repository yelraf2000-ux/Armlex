/**
 * Outage alerts to the team's Telegram group.
 *
 * Twice now a provider stopped serving and the product went on looking like a
 * product. On 2026-08-25 the embedding balance ran out and retrieval degraded
 * until a user was told no norm existed for their question; on 2026-09-16 the
 * Anthropic balance ran out and answers simply stopped. Both were discovered by
 * a person using the site, hours later. Nothing was wrong with the code — what
 * was missing is that nobody was told.
 *
 * So: the failures that mean "the product is down, and no deploy will fix it"
 * are named here and reported once to the same group that already receives the
 * contact form. Deliberately NOT a monitoring system — no thresholds, no
 * dashboards, no second service to keep awake. One message when the money or
 * the key runs out, one when it works again.
 *
 * An alert must never turn one failure into two: everything here swallows its
 * own errors, and the caller is never asked to await it.
 */
import { sendToTeam } from '../contact/telegram.js';

/**
 * The three ways a provider stops answering that a deploy cannot fix.
 *
 * `search` — the vector leg is unavailable, so no question can be answered
 *   (the embedding key, quota or balance; `VectorLegUnavailableError`).
 * `balance` — a generation provider refuses on money: Anthropic's "credit
 *   balance is too low", OpenAI's `insufficient_quota`, Gemini's depleted
 *   prepayment credits.
 * `auth` — a key is rejected. Rotating a key and forgetting the server is the
 *   likeliest cause, and it presents exactly like an outage.
 */
export type Outage = 'search' | 'balance' | 'auth';

/** How long one kind stays quiet after it has been reported. */
export const SILENCE_MS = 30 * 60 * 1000;

/*
  Every question that fails hits the same wall, so an un-deduplicated alert
  would send one message per user per attempt — and a group that buzzes forty
  times is a group that gets muted before the next real outage.
*/
const lastAlertAt = new Map<Outage, number>();
const outstanding = new Set<Outage>();

/**
 * What kind of outage is this error, if any.
 *
 * Matched on the shape of the error rather than on its class, so this module
 * stays free of the retrieval stack (and therefore of the database) and can be
 * tested on its own. `VectorLegUnavailableError` sets `name`, which is the
 * contract relied on here.
 *
 * Returns null for everything else — a context-limit failure, a parse error, a
 * dropped connection. Those are bugs or one-offs, and paging the owner for them
 * is how an alert channel stops being read.
 */
export function classify(err: unknown): Outage | null {
  const e = (err ?? {}) as { name?: unknown; status?: unknown; message?: unknown };
  if (e.name === 'VectorLegUnavailableError') return 'search';

  const status = typeof e.status === 'number' ? e.status : undefined;
  const text = typeof e.message === 'string' ? e.message : String(err ?? '');

  if (status === 402) return 'balance';
  if (/credit balance is too low/i.test(text)) return 'balance';
  if (/insufficient_quota/i.test(text)) return 'balance';
  if (/prepayment credits are depleted/i.test(text)) return 'balance';
  if (/RESOURCE_EXHAUSTED/.test(text) && /credit|balance|quota|billing/i.test(text)) return 'balance';

  if (status === 401 || status === 403) return 'auth';
  if (/invalid x-api-key|authentication_error|API key not valid|API_KEY_INVALID/i.test(text)) return 'auth';

  return null;
}

/** Armenian, and specific enough to act on without opening a laptop. */
export function formatAlert(kind: Outage, where: string, detail: string): string {
  const head: Record<Outage, string> = {
    search: '🔴 matyanai.am — որոնումը չի աշխատում',
    balance: '🔴 matyanai.am — մատակարարի հաշվեկշիռը սպառված է',
    auth: '🔴 matyanai.am — API բանալին չի ընդունվում',
  };
  const what: Record<Outage, string> = {
    search: 'Ոչ մի հարցի պատասխան չի տրվում. ստուգեք ներդրման (embeddings) ծառայության հաշիվը։',
    balance: 'Պատասխանները դադարել են։ Համալրեք մատակարարի հաշիվը։',
    auth: 'Պատասխանները դադարել են։ Ստուգեք սերվերի .env բանալիները և վերագործարկեք։',
  };
  return [head[kind], what[kind], `Որտեղ: ${where}`, detail ? `Սխալը: ${detail.slice(0, 300)}` : null]
    .filter((line) => line !== null)
    .join('\n');
}

/** Whether this kind may speak now; records the decision when it may. */
export function shouldAlert(kind: Outage, now = Date.now()): boolean {
  const last = lastAlertAt.get(kind);
  if (last !== undefined && now - last < SILENCE_MS) return false;
  lastAlertAt.set(kind, now);
  outstanding.add(kind);
  return true;
}

/**
 * Report an error if it is an outage. Returns the kind it reported, or null —
 * either because the error was ordinary or because that kind is still silenced.
 *
 * `where` is the route, so the message says whether the site or a background
 * job hit it. Never throws; callers pass it as `void reportOutage(...)`.
 */
export async function reportOutage(err: unknown, where: string): Promise<Outage | null> {
  const kind = classify(err);
  if (!kind) return null;
  if (!shouldAlert(kind)) return null;
  const detail = ((err as { message?: string })?.message ?? String(err ?? '')).trim();
  await sendToTeam(formatAlert(kind, where, detail)).catch(() => false);
  return kind;
}

/**
 * A question went through. If an outage had been reported, say it is over —
 * without this, the only way to learn that the site works again is to open it,
 * which is the habit the alert exists to replace.
 */
export async function noteHealthy(): Promise<boolean> {
  if (outstanding.size === 0) return false;
  outstanding.clear();
  lastAlertAt.clear();
  await sendToTeam('🟢 matyanai.am — վերականգնվել է. հարցերը կրկին պատասխանվում են։').catch(() => false);
  return true;
}

/** Tests only. */
export function resetAlerts(): void {
  lastAlertAt.clear();
  outstanding.clear();
}
