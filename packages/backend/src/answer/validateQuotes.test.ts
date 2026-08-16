/**
 * Quote-validation tests.
 *
 * The important cases are the near-misses: a quote that differs from the
 * source by a single digit or a negation is both nearly identical and
 * completely wrong, and is exactly what a fuzzy matcher would wave through.
 *
 * Run: npx tsx --test packages/backend/src/answer/validateQuotes.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateQuotes, extractQuotes } from './validateQuotes.js';

const SOURCE = `[Document] ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ
---
Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 20-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ:`;

describe('extractQuotes', () => {
  test('picks up Armenian quotes in « »', () => {
    const q = extractQuotes('Норма гласит: «Շրջանառության հարկ վճարողները ներկայացնում են հաշվարկներ» — вот так.');
    assert.equal(q.length, 1);
    assert.match(q[0]!, /Շրջանառության/);
  });

  test('ignores short spans — those are terms, not quotations', () => {
    assert.deepEqual(extractQuotes('термин «հարկ» означает налог'), []);
  });

  test('ignores non-Armenian quotes — model prose, not a claim about the law', () => {
    assert.deepEqual(
      extractQuotes('Это называется «налог с оборота» в русской терминологии.'),
      [],
    );
  });
});

describe('validateQuotes', () => {
  test('accepts a verbatim quote', () => {
    const answer =
      'Согласно норме: «Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 20-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ» (ՀՕԳ, Հոդված 261).';
    const r = validateQuotes(answer, [SOURCE]);
    assert.equal(r.invalidCount, 0);
    assert.equal(r.checks[0]?.valid, true);
    assert.equal(r.sanitized, answer, 'valid answers must pass through untouched');
  });

  test('accepts despite harmless whitespace and dash variants', () => {
    const answer =
      'Норма: «Շրջանառության   հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 20‑ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ».';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 0);
  });

  test('REJECTS a changed number — the dangerous near-miss', () => {
    // "20-ը" -> "25-ը": a deadline a taxpayer could act on, and wrong.
    const answer =
      'Норма: «Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 25-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ».';
    const r = validateQuotes(answer, [SOURCE]);
    assert.equal(r.invalidCount, 1);
    assert.equal(r.checks[0]?.valid, false);
  });

  test('REJECTS an inserted negation', () => {
    const answer =
      'Норма: «Շրջանառության հարկ վճարողները չեն ներկայացնում շրջանառության հարկի հաշվարկներ մինչև ամսվա 20-ը ներառյալ որևէ դեպքում».';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 1);
  });

  test('REJECTS a fabricated quote entirely', () => {
    const answer =
      'Норма: «Միկրոձեռնարկատիրության սուբյեկտները ազատվում են բոլոր հարկերից և վճարներից ամբողջությամբ».';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 1);
  });

  test('drops the quote but leaves surrounding prose and the citation', () => {
    const answer =
      'Согласно норме: «Միկրոձեռնարկատիրության սուբյեկտները ազատվում են բոլոր հարկերից ամբողջությամբ» (ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 267).';
    const r = validateQuotes(answer, [SOURCE]);
    assert.match(r.sanitized, /Հոդված 267/, 'citation must survive');
    assert.match(r.sanitized, /Согласно норме/, 'prose must survive');
    assert.doesNotMatch(r.sanitized, /ազատվում են բոլոր հարկերից/, 'bad quote must be gone');
  });

  test('matches against any of several supplied chunks', () => {
    const other = '[Document] Другой акт\n---\nԱյլ տեքստ։';
    const answer =
      'Норма: «Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 20-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ».';
    const r = validateQuotes(answer, [other, SOURCE]);
    assert.equal(r.invalidCount, 0);
    assert.equal(r.checks[0]?.matchedChunk, 1);
  });

  test('an answer with no quotes is unchanged', () => {
    const answer = 'В предоставленных фрагментах нет нормы, отвечающей на этот вопрос.';
    const r = validateQuotes(answer, [SOURCE]);
    assert.equal(r.checks.length, 0);
    assert.equal(r.sanitized, answer);
  });
});

describe('elided quotes', () => {
  test('accepts «X ... Y» when both segments are verbatim and in order', () => {
    const answer =
      'Норма: «Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ... ներկայացնում են շրջանառության հարկի հաշվարկներ».';
    const r = validateQuotes(answer, [SOURCE]);
    assert.equal(r.invalidCount, 0, 'legitimate elision must not be rejected');
  });

  test('accepts the … character and a bracketed […] as elision markers', () => {
    for (const marker of ['…', '[…]', '[...]']) {
      const answer = `Норма: «Շրջանառության հարկ վճարողները մինչև ${marker} ներկայացնում են շրջանառության հարկի հաշվարկներ».`;
      assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 0, `marker ${marker}`);
    }
  });

  test('rejects segments that appear OUT OF ORDER', () => {
    // Reordering can invert a condition, so this is not a quotation of anything
    // — the elision path must not become a way to reassemble the law.
    const answer =
      'Норма: «ներկայացնում են շրջանառության հարկի հաշվարկներ ... Շրջանառության հարկ վճարողները մինչև».';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 1);
  });

  test('rejects a fabricated segment even when the other half is verbatim', () => {
    const answer =
      'Норма: «Շրջանառության հարկ վճարողները մինչև ... ազատվում են բոլոր հարկերից ամբողջությամբ».';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 1);
  });

  test('rejects segments too short to be more than coincidence', () => {
    const answer = 'Норма: «Շրջանառության ... հարկի ... 20-ը».';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 1);
  });
});

describe('sentence-final punctuation', () => {
  test('accepts a verbatim quote closed with . where the corpus has :', () => {
    // The real case from the live app: the model reproduced the article exactly
    // and ended its own sentence with a period.
    const answer =
      'Норма: «Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 20-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ.»';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 0);
  });

  test('treats U+0589 ARMENIAN FULL STOP and ASCII colon as the same mark', () => {
    const answer =
      'Норма: «Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 20-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ։»';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 0);
  });

  test('still rejects a changed number even when only punctuation differs too', () => {
    const answer =
      'Норма: «Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 25-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ.»';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 1);
  });

  test('interior punctuation is still exact', () => {
    const answer =
      'Норма: «Շրջանառության հարկ վճարողները, մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 20-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ»';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 1);
  });
});

describe('enumerator prefixes', () => {
  test('accepts «1. ...verbatim» — a numbered part quoted from partway in', () => {
    const answer =
      'Норма: «1. ...ժամանակաշրջանին հաջորդող ամսվա 20-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ»';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 0);
  });

  test('an enumerator does not license a fabricated remainder', () => {
    const answer = 'Норма: «1. ...ազատվում են բոլոր հարկերից ամբողջությամբ ընդմիշտ»';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 1);
  });
});

describe('relaxations apply to quotes without any elision', () => {
  test('accepts a part number the model restored plus a . for the corpus :', () => {
    // Both relaxations at once, on a single-segment quote — the exact live case.
    const answer =
      'Норма: «1. Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 20-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ.»';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 0);
  });

  test('a restored part number does not license a fabricated body', () => {
    const answer = 'Норма: «1. Միկրոձեռնարկատիրության սուբյեկտները ազատվում են բոլոր հարկերից.»';
    assert.equal(validateQuotes(answer, [SOURCE]).invalidCount, 1);
  });
});
