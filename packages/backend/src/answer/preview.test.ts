/**
 * Preview tests.
 *
 * Two things have to hold. The cut must never land mid-sentence — a visitor who
 * thinks the tool broke does not register, so a bad cut costs the conversion the
 * feature exists for. And the rate limit must actually bind, because this is the
 * one endpoint anybody on the internet can spend money through.
 *
 * Run: npx tsx --test packages/backend/src/answer/preview.test.ts
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { splitAnswer } from './preview.js';
import { checkRate, resetRateLimits, PREVIEW_LIMIT } from './rateLimit.js';

const PARA = (n: number): string =>
  Array.from({ length: n }, (_, i) => `Սա ${i + 1}-րդ պարբերությունն է, որը բավական երկար է որպես իրական տեքստ։`).join(
    '\n\n',
  );

describe('splitAnswer', () => {
  test('cuts at a paragraph break, not mid-word', () => {
    const { shown, withheld } = splitAnswer(PARA(8));
    assert.ok(withheld > 0, 'something should be withheld');
    assert.ok(!shown.endsWith('է'), 'should not end mid-sentence');
    assert.ok(shown.endsWith('։'), `should end on a full stop, got: ${shown.slice(-30)}`);
  });

  test('shows enough to be worth reading and withholds enough to be worth registering', () => {
    const full = PARA(10);
    const { shown } = splitAnswer(full);
    assert.ok(shown.length >= 200, `too little shown: ${shown.length}`);
    assert.ok(shown.length < full.length * 0.75, 'too much given away');
  });

  test('a short answer is shown whole rather than teased', () => {
    // Withholding two sentences of a three-sentence answer is a bait, not a
    // preview. Below the floor there is nothing worth withholding.
    const short = 'Այո, կարող եք։ Դրույքաչափը 5 տոկոս է։';
    const { shown, withheld } = splitAnswer(short);
    assert.equal(withheld, 0);
    assert.equal(shown, short);
  });

  test('the shown part is always a prefix of the real answer', () => {
    // Nothing is invented or rewritten for the teaser: what the visitor reads is
    // literally the opening of the answer they will get.
    const full = PARA(9);
    const { shown } = splitAnswer(full);
    assert.ok(full.startsWith(shown), 'shown text must be a genuine prefix');
  });

  test('a wall of text with no paragraph breaks still cuts on a sentence', () => {
    const wall = Array.from({ length: 30 }, (_, i) => `Նախադասություն ${i + 1}։`).join(' ');
    const { shown } = splitAnswer(wall);
    assert.ok(shown.endsWith('։'));
  });
});

describe('preview rate limit', () => {
  beforeEach(() => resetRateLimits());

  test('allows the daily allowance and then refuses', () => {
    for (let i = 0; i < PREVIEW_LIMIT; i++) {
      assert.equal(checkRate('visitor').allowed, true, `request ${i + 1} should pass`);
    }
    assert.equal(checkRate('visitor').allowed, false, 'one past the limit must be refused');
  });

  test('one address running out does not affect another', () => {
    for (let i = 0; i < PREVIEW_LIMIT; i++) checkRate('noisy');
    assert.equal(checkRate('noisy').allowed, false);
    assert.equal(checkRate('someone-else').allowed, true);
  });

  test('the window rolls, so a refusal is not permanent', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < PREVIEW_LIMIT; i++) checkRate('roller', t0);
    assert.equal(checkRate('roller', t0).allowed, false);
    // A day and a second later.
    assert.equal(checkRate('roller', t0 + 24 * 60 * 60 * 1000 + 1000).allowed, true);
  });

  test('a refusal reports when to come back', () => {
    for (let i = 0; i < PREVIEW_LIMIT; i++) checkRate('waiter');
    const v = checkRate('waiter');
    assert.equal(v.allowed, false);
    assert.ok(v.resetMs > 0 && v.resetMs <= 24 * 60 * 60 * 1000);
  });
});
