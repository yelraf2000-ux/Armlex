/**
 * Number-validation tests.
 *
 * The important cases come in pairs. `8.8` and `9.2` are the same shape, sit in
 * the same sentence position, and are labelled identically — one is in the
 * fragment and one was invented. A guard that cannot separate those two is not
 * worth wiring in, and a guard that fires on the legitimate half of each pair
 * (a threshold the fragment writes with different separators, a figure the user
 * supplied) teaches the reader to ignore it.
 *
 * Run: npx tsx --test packages/backend/src/answer/validateNumbers.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateNumbers, type NumberValidation } from './validateNumbers.js';

/**
 * The fragment the turnover-tax line question actually delivers. `կետ 63` names
 * the points whose calculation is `[Գ] = [Ա] x [Բ]`; it does NOT say which line
 * a fixed-asset sale goes on. Every wrong answer to that question so far was
 * derived from exactly this text.
 */
const KET_63 =
  'Հավելված 1, կետ 63. 12-րդ, 13-րդ, 15-րդ, 18-20-րդ կետերում [Գ] = [Ա] x [Բ]։ ' +
  'Հաշվարկի 5.10, 6.10, 7.10, 8.8, 9.10 տողերը լրացվում են ամփոփիչ կարգով։';

const unsourced = (v: NumberValidation): string[] =>
  v.checks.filter((c) => !c.valid).map((c) => c.text);

describe('the fabricated line number', () => {
  test('flags 9.2, asserted three times and appearing nowhere', () => {
    const v = validateNumbers('Հիմնական միջոցի օտարումը լրացվում է հաշվարկի 9.2 տողում։', [KET_63]);
    assert.ok(unsourced(v).includes('9.2'));
    assert.equal(v.legalCount, 1);
  });

  test('flags 9.1 — a section that exists is not a line that exists', () => {
    assert.ok(unsourced(validateNumbers('Լրացրեք 9.1 տողը։', [KET_63])).includes('9.1'));
  });

  test('does NOT flag 8.8, which the fragment genuinely contains', () => {
    assert.deepEqual(unsourced(validateNumbers('Հաշվարկի 8.8 տողը լրացվում է։', [KET_63])), []);
  });

  test('a bare `92` in a fragment does not vouch for line `9.2`', () => {
    const v = validateNumbers('Լրացրեք 9.2 տողը։', ['սույն օրենսգրքի 92 հոդվածը']);
    assert.ok(unsourced(v).includes('9.2'));
  });
});

describe('numbers that must NOT fire', () => {
  test('a rate written verbatim in the fragment', () => {
    const v = validateNumbers('Դրույքաչափը 5 տոկոս է։', ['շրջանառության հարկը 5 տոկոս է']);
    assert.deepEqual(unsourced(v), []);
  });

  test('a threshold the fragment separates differently', () => {
    const v = validateNumbers('Շեմը 115,000,000 դրամ է։', ['շեմը կազմում է 115 000 000 դրամ']);
    assert.deepEqual(unsourced(v), []);
  });

  test('`24 մլն` against a fragment writing 24 000 000', () => {
    assert.deepEqual(unsourced(validateNumbers('Շեմը 24 մլն դրամ է։', ['24 000 000 դրամ'])), []);
  });

  test('a figure the USER stated, which the answer may repeat', () => {
    const v = validateNumbers(
      'Ձեր 30 000 000 դրամ շրջանառությամբ…',
      ['դրույքաչափը 5 տոկոս'],
      ['Իմ շրջանառությունը 30 000 000 դրամ է'],
    );
    assert.deepEqual(unsourced(v), []);
    assert.equal(v.checks.find((c) => c.digits === '30000000')?.source, 'user');
  });

  test('the enumerators of the answer’s own list', () => {
    const v = validateNumbers('Երկու պայման՝\n1. գրանցում\n2. հաշվետվություն', ['ոչ մի թիվ']);
    assert.equal(v.checks.length, 0);
  });
});

describe('whole-run matching', () => {
  test('a year in the fragment does not vouch for a filing deadline', () => {
    const v = validateNumbers('Ներկայացվում է մինչև ամսվա 20-ը։', ['2026 թվականի հունվարի 1-ից']);
    assert.ok(unsourced(v).includes('20'));
    // «մինչև»/«ամսվա» make it a deadline claim, not stray arithmetic.
    assert.equal(v.legalCount, 1);
  });

  test('an article number the fragments never mention', () => {
    const v = validateNumbers('Տե՛ս Հոդված 288-ը։', ['Հոդված 267. Միկրոձեռնարկատիրություն']);
    assert.ok(unsourced(v).includes('288'));
    assert.equal(v.legalCount, 1);
  });
});

describe('severity', () => {
  test('a label binds to the number beside it, not across a comma', () => {
    const v = validateNumbers('Հարկը կկազմի 1500000 դրամ, տես 9.2 տողը։', ['դրույքաչափը 5 տոկոս']);
    assert.equal(v.legalCount, 1);
    assert.equal(v.otherCount, 1);
  });
});
