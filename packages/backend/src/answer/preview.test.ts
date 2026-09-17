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
import { actTitle, previewSources, splitAnswer } from './preview.js';
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

describe('preview sources', () => {
  const TAX = { documentTitle: 'ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ', ref: 'Հոդված 150' };
  const TAX_3 = { documentTitle: 'ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ', ref: 'Հոդված 15' };
  const DECISION = {
    documentTitle: 'ՀՀ ԿԱՌԱՎԱՐՈՒԹՅԱՆ ՈՐՈՇՈՒՄԸ ՀՀ-ՈՒՄ ԱԱՀ-Ի ՎԵՐԱԴԱՐՁՄԱՆ ՄԱՍԻՆ',
    ref: 'Կետ 5',
  };

  test('titles come out in sentence case with abbreviations kept', () => {
    assert.equal(actTitle('ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ'), 'ՀՀ հարկային օրենսգիրք');
    assert.equal(
      actTitle(DECISION.documentTitle),
      'ՀՀ կառավարության որոշումը ՀՀ-ում ԱԱՀ-ի վերադարձման մասին',
    );
  });

  test('never carries a provision number', () => {
    // The number is withheld with the rest of the apparatus; anything sent to
    // the browser can be read, so it must not be sent at all.
    const out = previewSources([TAX, DECISION], 'Տե՛ս (ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 150)։');
    assert.ok(!JSON.stringify(out).match(/[0-9]/), JSON.stringify(out));
  });

  test('lists only what the answer names, bounded on the right', () => {
    // «Հոդված 15» is a prefix of «Հոդված 150» and is not named here.
    const out = previewSources([TAX, TAX_3], 'Համաձայն Հոդված 150-ի, դրույքաչափը 10 տոկոս է։');
    assert.deepEqual(out, [{ act: 'ՀՀ հարկային օրենսգիրք', kind: 'Հոդված' }]);
  });

  test('a naming in lowercase still counts', () => {
    // Observed: the preview model writes «(ՀՀ աշխատանքային օրենսգիրք, հոդված 169, մաս 1)».
    const out = previewSources([TAX, TAX_3], '(ՀՀ հարկային օրենսգիրք, հոդված 150, մաս 1)։');
    assert.equal(out.length, 1);
  });

  test('an answer that names nothing lists everything it was given', () => {
    const out = previewSources([TAX, DECISION], 'Պատասխան առանց հղումների։');
    assert.equal(out.length, 2);
    assert.equal(out[1]!.kind, 'Կետ');
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
