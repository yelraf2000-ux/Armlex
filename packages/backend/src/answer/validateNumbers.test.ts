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

describe('part and point citations', () => {
  /**
   * The law labels its parts by position. An answer that writes «մաս 13» is
   * citing something the fragment calls `13.`, and demanding the word made
   * every part citation in a 40-answer sample fire falsely.
   */
  const ARTICLE_55 =
    'Հոդված 55. Հաշվարկային փաստաթղթեր\n' +
    '12. Հաշվարկային փաստաթուղթը դուրս է գրվում։\n' +
    '13. Ապրանքի մատակարարման դեպքում կիրառվում է հարկային հաշիվ։\n';

  test('a part written as a bare enumerator vouches for «մաս 13»', () => {
    const v = validateNumbers('(ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 55, մաս 13)', [ARTICLE_55], [], [
      '109017#Հոդված 55',
    ]);
    assert.deepEqual(unsourced(v), []);
  });

  test('a part the article does not have is still caught', () => {
    const v = validateNumbers('(ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 55, մաս 41)', [ARTICLE_55], [], [
      '109017#Հոդված 55',
    ]);
    assert.ok(unsourced(v).includes('41'));
  });

  test('an article number is sourced by the delivered REF, not its body text', () => {
    const v = validateNumbers('Տե՛ս Հոդված 298-ը։', ['Հաշվարկային փաստաթղթեր։'], [], [
      '109017#Հոդված 298',
    ]);
    assert.deepEqual(unsourced(v), []);
  });

  test('a form LINE gets no such latitude — 9.2 is still caught', () => {
    const v = validateNumbers('Լրացրեք 9.2 տողը։', ['9.2. Այլ դրույթներ\n'], [], []);
    assert.ok(unsourced(v).includes('9.2'));
  });
});

describe('labels found by measurement, not by reasoning', () => {
  test('an act number is recognised by its `N …-Ն` form, not by nearby words', () => {
    // The threshold, not the code, is what «115 միլիոն դրամը (ՀՀ ՕՐԵՆՍԳԻՐՔ)» is about.
    const v = validateNumbers('չի գերազանցել 115 միլիոն դրամը (ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 254)', [
      'շեմը կազմում է 115 000 000 դրամ',
    ], [], ['109017#Հոդված 254']);
    assert.deepEqual(unsourced(v), []);
  });

  test('a year is not a labelled legal quantity', () => {
    const v = validateNumbers('ՆԱԽԱԳԱՀԻ 2016 ԹՎԱԿԱՆԻ ՀՐԱՄԱՆԻ (Հավելված 1, կետ 5)', [
      'Հավելված 1\n2016 թվականին ընդունված հրաման։\n5. Սյունակները լրացվում են։',
    ]);
    assert.deepEqual(unsourced(v), []);
  });

  test('every member of an enumerated citation shares its trailing label', () => {
    const v = validateNumbers('(ՀՀ Հարկային օրենսգրքի 71-րդ, 72-րդ, 73-րդ հոդվածներ)', [''], [], [
      '109017#Հոդված 71',
      '109017#Հոդված 72',
      '109017#Հոդված 73',
    ]);
    assert.deepEqual(unsourced(v), []);
  });

  test('a table row number is vouched for by the row itself', () => {
    const v = validateNumbers('աղյուսակ 3-ի «9. Այլ գործունեությունից» տողը', [
      'Հավելված 1, աղյուսակ 3\n9. Այլ գործունեությունից ստացվող եկամուտներ\n',
    ]);
    assert.deepEqual(unsourced(v), []);
  });
});

describe('severity', () => {
  test('a label binds to the number beside it, not across a comma', () => {
    const v = validateNumbers('Հարկը կկազմի 1500000 դրամ, տես 9.2 տողը։', ['դրույքաչափը 5 տոկոս']);
    assert.equal(v.legalCount, 1);
    assert.equal(v.otherCount, 1);
  });
});
