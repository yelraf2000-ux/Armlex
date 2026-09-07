/**
 * Billing tests.
 *
 * The signature check is the whole security of this feature: without it the
 * webhook is an open door and anyone who guesses the URL can post
 * `subscription_created` and upgrade themselves for free. Everything else here
 * is about not taking away something already paid for.
 *
 * Run: npx tsx --test packages/backend/src/billing/billing.test.ts
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  billingEnabled,
  checkoutUrl,
  entitlesToPlan,
  parseEvent,
  planForVariant,
  verifySignature,
} from './lemonsqueezy.js';
import { effectivePlan, type User } from '../auth/users.js';

const SECRET = 'test-webhook-secret';
const sign = (body: string): string => createHmac('sha256', SECRET).update(body).digest('hex');

before(() => {
  process.env['LEMONSQUEEZY_WEBHOOK_SECRET'] = SECRET;
  process.env['LEMONSQUEEZY_STORE'] = 'matyanai';
  process.env['LEMONSQUEEZY_VARIANT_PRO'] = '111';
  process.env['LEMONSQUEEZY_VARIANT_FIRM'] = '222';
  process.env['PUBLIC_ORIGIN'] = 'https://armlex.onrender.com';
});

describe('webhook signature', () => {
  const body = '{"meta":{"event_name":"subscription_created"}}';

  test('a correctly signed body is accepted', () => {
    assert.equal(verifySignature(body, sign(body)), true);
  });

  test('a forged upgrade is rejected', () => {
    // The attack this exists for: post a subscription event without the secret.
    assert.equal(verifySignature(body, 'deadbeef'), false);
    assert.equal(verifySignature(body, undefined), false);
    assert.equal(verifySignature(body, ''), false);
  });

  test('a body altered after signing is rejected', () => {
    const signature = sign(body);
    const tampered = body.replace('subscription_created', 'subscription_updated');
    assert.equal(verifySignature(tampered, signature), false);
  });

  test('byte-for-byte matters — reserialised JSON does not verify', () => {
    // Why the raw body is kept: JSON.parse then JSON.stringify changes spacing
    // and key order, and the signature stops matching.
    const reserialised = JSON.stringify(JSON.parse(body.replace('{"meta"', '{ "meta"')));
    const signature = sign(body.replace('{"meta"', '{ "meta"'));
    assert.equal(verifySignature(reserialised, signature), false);
  });

  test('with no secret configured, nothing verifies', () => {
    const saved = process.env['LEMONSQUEEZY_WEBHOOK_SECRET'];
    delete process.env['LEMONSQUEEZY_WEBHOOK_SECRET'];
    assert.equal(verifySignature(body, sign(body)), false);
    process.env['LEMONSQUEEZY_WEBHOOK_SECRET'] = saved;
  });
});

describe('event parsing', () => {
  const event = (over: Record<string, unknown> = {}): unknown => ({
    meta: { event_name: 'subscription_created', custom_data: { user_id: 'u-1' } },
    data: { id: 'sub_9', attributes: { status: 'active', ends_at: null, variant_id: 111, ...over } },
  });

  test('reads the account, the subscription and the plan', () => {
    const e = parseEvent(event(), 'evt-1')!;
    assert.equal(e.userId, 'u-1');
    assert.equal(e.subscriptionId, 'sub_9');
    assert.equal(e.status, 'active');
    assert.equal(planForVariant(e.variantId), 'pro');
  });

  test('a variant we do not sell maps to no plan', () => {
    const e = parseEvent(event({ variant_id: 999 }), 'evt-2')!;
    assert.equal(planForVariant(e.variantId), null);
  });

  test('an unrecognised shape returns null instead of throwing', () => {
    // A 500 here makes the provider retry the same broken payload for hours.
    for (const bad of [{}, null, { meta: {} }, { data: { id: 'x' } }]) {
      assert.equal(parseEvent(bad, 'evt'), null);
    }
  });

  test('a checkout not started from our link has no account attached', () => {
    const e = parseEvent(
      { meta: { event_name: 'subscription_created' }, data: { id: 's', attributes: {} } },
      'evt-3',
    )!;
    assert.equal(e.userId, null);
  });
});

describe('what still entitles someone to their plan', () => {
  test('active and trialling do', () => {
    assert.equal(entitlesToPlan('active'), true);
    assert.equal(entitlesToPlan('on_trial'), true);
  });

  test('cancelled still does — the period was paid for', () => {
    assert.equal(entitlesToPlan('cancelled'), true);
  });

  test('past_due still does — a failed card is usually an expiry, not a refusal', () => {
    assert.equal(entitlesToPlan('past_due'), true);
  });

  test('expired and refunded do not', () => {
    assert.equal(entitlesToPlan('expired'), false);
    assert.equal(entitlesToPlan('refunded'), false);
  });
});

describe('effectivePlan', () => {
  const user = (over: Partial<User>): User => ({
    id: 'u',
    email: 'a@b.c',
    name: null,
    plan: 'pro',
    password_hash: null,
    google_sub: null,
    plan_expires_at: null,
    company_name: null,
    company_size: null,
    bonus_questions: 0,
    workspace_id: null,
    ...over,
  });

  test('a plan with no expiry simply applies', () => {
    assert.equal(effectivePlan(user({})), 'pro');
  });

  test('a cancelled plan holds until the paid period ends', () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    assert.equal(effectivePlan(user({ plan_expires_at: tomorrow })), 'pro');
  });

  test('and falls back to free the moment it passes', () => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    assert.equal(effectivePlan(user({ plan_expires_at: yesterday })), 'free');
  });
});

describe('checkout link', () => {
  test('carries the account id, so a payment can be attributed', () => {
    const url = checkoutUrl('pro', 'user-42', 'a@b.c')!;
    assert.ok(url.includes('matyanai.lemonsqueezy.com/buy/111'));
    assert.ok(decodeURIComponent(url).includes('checkout[custom][user_id]=user-42'));
    assert.ok(decodeURIComponent(url).includes('checkout[email]=a@b.c'));
  });

  test('is null for a plan with no variant configured', () => {
    const saved = process.env['LEMONSQUEEZY_VARIANT_FIRM'];
    delete process.env['LEMONSQUEEZY_VARIANT_FIRM'];
    assert.equal(checkoutUrl('firm', 'u', 'a@b.c'), null);
    process.env['LEMONSQUEEZY_VARIANT_FIRM'] = saved;
  });

  test('billing stays dormant until it is configured', () => {
    assert.equal(billingEnabled(), true);
    const saved = process.env['LEMONSQUEEZY_STORE'];
    delete process.env['LEMONSQUEEZY_STORE'];
    assert.equal(billingEnabled(), false);
    process.env['LEMONSQUEEZY_STORE'] = saved;
  });
});
