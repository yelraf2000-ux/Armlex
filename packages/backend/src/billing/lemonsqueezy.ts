/**
 * Subscriptions through Lemon Squeezy.
 *
 * A Merchant of Record, chosen for one reason above the others: Stripe does not
 * cover Armenia, and an MoR is the seller of record — it collects and remits
 * VAT worldwide and pays out to the account holder. Nothing about a card ever
 * reaches this codebase, which is also why the integration is this small.
 *
 * Checkout is a plain URL rather than an API call, so no API key is needed to
 * SELL anything — only the webhook secret, to verify what comes back. Fewer
 * secrets in the environment is fewer secrets to leak.
 *
 * Configuration, all dormant until set:
 *
 *   LEMONSQUEEZY_STORE          store subdomain, e.g. "matyanai"
 *   LEMONSQUEEZY_VARIANT_PRO    variant id of the Pro plan
 *   LEMONSQUEEZY_VARIANT_FIRM   variant id of the Firm plan
 *   LEMONSQUEEZY_WEBHOOK_SECRET the signing secret from the webhook settings
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type PaidPlan = 'pro' | 'firm';

export function billingEnabled(): boolean {
  return Boolean(process.env['LEMONSQUEEZY_STORE'] && process.env['LEMONSQUEEZY_WEBHOOK_SECRET']);
}

function variantFor(plan: PaidPlan): string | undefined {
  return plan === 'pro'
    ? process.env['LEMONSQUEEZY_VARIANT_PRO']
    : process.env['LEMONSQUEEZY_VARIANT_FIRM'];
}

/**
 * Where to send someone who wants to pay.
 *
 * `custom[user_id]` is the whole attribution mechanism: it rides through the
 * checkout untouched and comes back on every webhook for that subscription, so
 * a payment can be matched to an account without trusting an email address the
 * buyer typed. Emails get typo'd and shared; the id does not.
 */
export function checkoutUrl(plan: PaidPlan, userId: string, email: string): string | null {
  const store = process.env['LEMONSQUEEZY_STORE'];
  const variant = variantFor(plan);
  if (!store || !variant) return null;

  const params = new URLSearchParams({
    'checkout[email]': email,
    'checkout[custom][user_id]': userId,
    // Send them back to the app rather than leaving them on a receipt page.
    'checkout[success_url]': `${process.env['PUBLIC_ORIGIN'] ?? ''}/?billing=success`,
  });
  return `https://${store}.lemonsqueezy.com/buy/${variant}?${params.toString()}`;
}

/**
 * Is this webhook really from the provider?
 *
 * HMAC-SHA256 of the RAW request body under the webhook secret. The raw bytes
 * matter: re-serialising the parsed JSON changes key order and whitespace, the
 * signature stops matching, and the failure looks like a provider bug rather
 * than ours. `server.ts` keeps the raw body for this route alone.
 *
 * Without this check the endpoint is an open door — anyone who guesses the URL
 * could post "subscription_created" and upgrade themselves for free.
 */
export function verifySignature(rawBody: string, signature: string | undefined): boolean {
  const secret = process.env['LEMONSQUEEZY_WEBHOOK_SECRET'];
  if (!secret || !signature) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SubscriptionEvent {
  eventId: string;
  eventName: string;
  userId: string | null;
  subscriptionId: string;
  status: string;
  /** End of the paid period — a cancelled plan stays active until this. */
  endsAt: string | null;
  variantId: string | null;
}

/**
 * Read the parts of a webhook this application acts on.
 *
 * Returns null rather than throwing on anything unexpected: a provider adding a
 * field or sending an event shape we do not know must not take down the
 * endpoint, because a 500 makes them retry the same broken payload for hours.
 */
export function parseEvent(body: unknown, eventId: string): SubscriptionEvent | null {
  const b = body as {
    meta?: { event_name?: string; custom_data?: { user_id?: string } };
    data?: {
      id?: string;
      attributes?: { status?: string; ends_at?: string | null; variant_id?: number | string };
    };
  };

  const eventName = b?.meta?.event_name;
  const subscriptionId = b?.data?.id;
  if (!eventName || !subscriptionId) return null;

  return {
    eventId,
    eventName,
    userId: b.meta?.custom_data?.user_id ?? null,
    subscriptionId: String(subscriptionId),
    status: b.data?.attributes?.status ?? 'unknown',
    endsAt: b.data?.attributes?.ends_at ?? null,
    variantId:
      b.data?.attributes?.variant_id != null ? String(b.data.attributes.variant_id) : null,
  };
}

/** Which plan a variant id corresponds to, or null if we do not sell it. */
export function planForVariant(variantId: string | null): PaidPlan | null {
  if (!variantId) return null;
  if (variantId === process.env['LEMONSQUEEZY_VARIANT_PRO']) return 'pro';
  if (variantId === process.env['LEMONSQUEEZY_VARIANT_FIRM']) return 'firm';
  return null;
}

/**
 * Statuses under which the paid plan still applies.
 *
 * `cancelled` is deliberately included: cancelling stops the renewal, it does
 * not refund the current period. Downgrading immediately would be taking back
 * something already paid for, and `plan_expires_at` is what ends it.
 *
 * `past_due` is also included — a failed card is usually an expiry, the
 * provider retries for days, and locking someone out on the first failure
 * punishes the customer for their bank's timing.
 */
export function entitlesToPlan(status: string): boolean {
  return status === 'active' || status === 'on_trial' || status === 'cancelled' || status === 'past_due';
}
