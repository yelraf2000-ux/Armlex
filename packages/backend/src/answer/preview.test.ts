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
import { closeReferences, splitAnswer } from './preview.js';
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

describe('closeReferences', () => {
  test('closes the citation forms real previews produced', () => {
    // Both observed on 2026-09-17, from the preview model.
    assert.equal(
      closeReferences('(ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 132, մաս 1)։'),
      '(ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված [XX], մաս [XX])։',
    );
    assert.equal(
      closeReferences('(ՀՀ աշխատանքային օրենսգիրք, հոդված 169, մաս 1.1)'),
      '(ՀՀ աշխատանքային օրենսգիրք, հոդված [XX], մաս [XX])',
    );
  });

  test('closes ordinals written before the word', () => {
    assert.equal(
      closeReferences('Օրենսգրքի 125-րդ հոդվածի 4-րդ մասով սահմանված'),
      'Օրենսգրքի [XX]-րդ հոդվածի [XX]-րդ մասով սահմանված',
    );
    assert.equal(closeReferences('1-ին մասի 2-րդ կետում'), '[XX]-ին մասի [XX]-րդ կետում');
    assert.equal(closeReferences('18-20-րդ կետերում'), '[XX]-րդ կետերում');
    assert.equal(closeReferences('Հավելված 1, աղյուսակ 3'), 'Հավելված [XX], աղյուսակ [XX]');
  });

  test('closes every item of a list, and order numbers', () => {
    // All from real answers in data/eval/numbers-sample-answers.jsonl.
    assert.equal(closeReferences('(Հոդվածներ 105, 109, 115, 126)'), '(Հոդվածներ [XX], [XX], [XX], [XX])');
    assert.equal(closeReferences('Օրենսգրքի 71-րդ, 72-րդ հոդվածներ'), 'Օրենսգրքի [XX]-րդ, [XX]-րդ հոդվածներ');
    assert.equal(closeReferences('38-րդ և 39-րդ հոդվածներով'), '[XX]-րդ և [XX]-րդ հոդվածներով');
    assert.equal(closeReferences('են 2-րդ բաժնի'), 'են [XX]-րդ բաժնի');
    assert.equal(closeReferences('N 298-Ն հրամանի, Հավելված N 1'), 'N [XX]-Ն հրամանի, Հավելված N [XX]');
  });

  test('a citation at the end of a sentence is closed', () => {
    assert.equal(closeReferences('տե՛ս Հոդված 132.'), 'տե՛ս Հոդված [XX].');
    assert.equal(closeReferences('տե՛ս մաս 1.1։'), 'տե՛ս մաս [XX]։');
  });

  test('a citation followed by a date is not a list', () => {
    assert.equal(
      closeReferences('Հոդված 132, 2023 թվականի հունվարի 1-ից'),
      'Հոդված [XX], 2023 թվականի հունվարի 1-ից',
    );
  });

  test('leaves rates, amounts, dates and form lines alone', () => {
    // These are the answer, not where it comes from.
    for (const s of [
      'հաշվարկվում է 10 տոկոս դրույքաչափով',
      '115 միլիոն դրամը չգերազանցող',
      'Հարկերի և վճարների մասին 2023 թվականի հունվարի 1-ից',
      '20 աշխատանքային օր',
      'լրացվում է 20-րդ տողում',
    ]) {
      assert.equal(closeReferences(s), s);
    }
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
