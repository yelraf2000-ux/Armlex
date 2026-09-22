/**
 * Outage classification and the silence window.
 *
 * Run: npx tsx --test packages/backend/src/ops/alert.test.ts
 */
import { test, describe as suite, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { classify, formatAlert, shouldAlert, reportOutage, noteHealthy, resetAlerts, SILENCE_MS } from './alert.js';

beforeEach(() => resetAlerts());

suite('classify', () => {
  test('the vector leg being down is a search outage', () => {
    const err = Object.assign(new Error('embedding API returned HTTP 429'), {
      name: 'VectorLegUnavailableError',
    });
    assert.equal(classify(err), 'search');
  });

  test('names the three providers\' ways of saying "no money"', () => {
    assert.equal(classify({ status: 400, message: 'Your credit balance is too low to access the Anthropic API' }), 'balance');
    assert.equal(classify({ status: 429, message: 'You exceeded your current quota (insufficient_quota)' }), 'balance');
    assert.equal(classify({ message: '429 RESOURCE_EXHAUSTED — Your prepayment credits are depleted.' }), 'balance');
    assert.equal(classify({ status: 402, message: 'Payment Required' }), 'balance');
  });

  test('a rejected key is its own case — the fix is the .env, not the balance', () => {
    assert.equal(classify({ status: 401, message: 'invalid x-api-key' }), 'auth');
    assert.equal(classify({ message: 'API key not valid. Please pass a valid API key.' }), 'auth');
  });

  test('ordinary failures are not outages', () => {
    assert.equal(classify(new Error('prompt is too long: 214000 tokens > 200000 maximum')), null);
    assert.equal(classify({ status: 500, message: 'Internal server error' }), null);
    assert.equal(classify({ status: 429, message: 'rate_limit_error: too many requests' }), null);
    assert.equal(classify(undefined), null);
    assert.equal(classify('some string'), null);
  });
});

suite('the silence window', () => {
  test('speaks once, then stays quiet for half an hour', () => {
    const t0 = 1_000_000;
    assert.equal(shouldAlert('balance', t0), true);
    assert.equal(shouldAlert('balance', t0 + 60_000), false);
    assert.equal(shouldAlert('balance', t0 + SILENCE_MS - 1), false);
    assert.equal(shouldAlert('balance', t0 + SILENCE_MS), true);
  });

  test('each kind is silenced on its own', () => {
    const t0 = 1_000_000;
    assert.equal(shouldAlert('balance', t0), true);
    assert.equal(shouldAlert('search', t0), true);
    assert.equal(shouldAlert('auth', t0), true);
    assert.equal(shouldAlert('search', t0 + 1), false);
  });

  test('recovery reopens the window, so a relapse is reported at once', async () => {
    const t0 = 1_000_000;
    assert.equal(shouldAlert('search', t0), true);
    assert.equal(await noteHealthy(), true);
    assert.equal(shouldAlert('search', t0 + 1), true);
  });

  test('nothing to recover from says nothing', async () => {
    assert.equal(await noteHealthy(), false);
  });
});

suite('reportOutage', () => {
  test('reports an outage once and ignores ordinary errors', async () => {
    const err = { status: 400, message: 'Your credit balance is too low' };
    assert.equal(await reportOutage(err, 'chat'), 'balance');
    assert.equal(await reportOutage(err, 'chat'), null);
    assert.equal(await reportOutage(new Error('chat failed'), 'chat'), null);
  });
});

suite('the message', () => {
  test('says what broke, where, and what to do about it', () => {
    const text = formatAlert('balance', 'chat', 'Your credit balance is too low');
    assert.match(text, /հաշվեկշիռը սպառված/);
    assert.match(text, /Որտեղ: chat/);
    assert.match(text, /credit balance is too low/);
  });

  test('never carries more than a glance of the provider text', () => {
    const text = formatAlert('search', 'preview', 'x'.repeat(1000));
    assert.ok(text.length < 700, text.length.toString());
  });
});
