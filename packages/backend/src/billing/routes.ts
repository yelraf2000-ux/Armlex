/**
 * Billing endpoints: start a checkout, and receive what the provider sends back.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db/pool.js';
import {
  billingEnabled,
  checkoutUrl,
  entitlesToPlan,
  parseEvent,
  planForVariant,
  verifySignature,
  type PaidPlan,
} from './lemonsqueezy.js';

/** Where a signed-in user goes to upgrade. */
export async function startCheckout(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!billingEnabled()) return reply.code(404).send({ error: 'billing_not_configured' });

  const plan = (req.query as { plan?: string })?.plan;
  if (plan !== 'pro' && plan !== 'firm') {
    return reply.code(400).send({ error: 'unknown_plan' });
  }

  const url = checkoutUrl(plan as PaidPlan, req.user!.id, req.user!.email);
  if (!url) return reply.code(404).send({ error: 'plan_not_for_sale' });
  return reply.send({ url });
}

/**
 * The webhook.
 *
 * Public — the provider has no session — and therefore verified by signature
 * before anything is read out of it. Without that check this endpoint is an
 * open door: anyone who guesses the URL could post `subscription_created` and
 * upgrade themselves for nothing.
 *
 * Always answers 200 once the signature is good, even when the event is one we
 * do nothing with. A non-2xx makes the provider retry the same payload for
 * hours, so an unknown event name must be acknowledged, not rejected.
 */
export async function webhook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? '';
  const signature = req.headers['x-signature'];

  if (!verifySignature(raw, typeof signature === 'string' ? signature : undefined)) {
    req.log.warn('[billing] webhook with a bad or missing signature — rejected');
    return reply.code(401).send({ error: 'bad_signature' });
  }

  // The provider's own event id, used to make replays harmless.
  const eventId =
    (req.headers['x-event-name'] && typeof req.headers['x-event-name'] === 'string'
      ? `${req.headers['x-event-name']}:`
      : '') + (raw.length > 0 ? hash(raw) : String(Date.now()));

  const event = parseEvent(req.body, eventId);
  if (!event) {
    req.log.warn('[billing] webhook shape not recognised — acknowledged and ignored');
    return reply.send({ ok: true, ignored: true });
  }

  // Webhooks arrive more than once by design. Recording the id first means a
  // retry is a no-op rather than a second upgrade or a double downgrade.
  const inserted = await db()<{ id: string }[]>`
    INSERT INTO billing_events (id, event_name, user_id, payload)
    VALUES (${event.eventId}, ${event.eventName}, ${event.userId}, ${JSON.stringify(req.body)}::jsonb)
    ON CONFLICT (id) DO NOTHING
    RETURNING id`;
  if (!inserted[0]) return reply.send({ ok: true, duplicate: true });

  if (!event.userId) {
    // No `custom_data.user_id` — a checkout that did not come through our own
    // link. Recorded above so it can be reconciled by hand; nothing to apply.
    req.log.warn(`[billing] ${event.eventName} with no user_id — recorded, not applied`);
    return reply.send({ ok: true, unattributed: true });
  }

  const plan = planForVariant(event.variantId);
  const keeps = entitlesToPlan(event.status);

  if (plan && keeps) {
    await db()`
      UPDATE users
         SET plan = ${plan},
             subscription_id = ${event.subscriptionId},
             subscription_status = ${event.status},
             plan_expires_at = ${event.endsAt}
       WHERE id = ${event.userId}`;
    req.log.info(`[billing] ${event.userId} -> ${plan} (${event.status})`);
  } else {
    // Expired, refunded, or a variant we do not sell: back to free. The status
    // is kept so the reason is legible afterwards.
    await db()`
      UPDATE users
         SET plan = 'free',
             subscription_status = ${event.status},
             plan_expires_at = ${event.endsAt}
       WHERE id = ${event.userId}`;
    req.log.info(`[billing] ${event.userId} -> free (${event.status})`);
  }

  return reply.send({ ok: true });
}

/** Short, stable id for a payload, so a retry of the same body is recognised. */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
