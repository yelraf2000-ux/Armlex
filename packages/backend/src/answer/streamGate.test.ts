import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { QuoteStreamGate } from './streamGate.js';

const SOURCE = `[Document] ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ
---
Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 20-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ:`;

const VERBATIM =
  'Շրջանառության հարկ վճարողները մինչև յուրաքանչյուր հաշվետու ժամանակաշրջանին հաջորդող ամսվա 20-ը ներառյալ ներկայացնում են շրջանառության հարկի հաշվարկներ';

/** Feed a whole answer one character at a time — the worst-case chunking. */
function streamCharwise(answer: string, gate: QuoteStreamGate): string {
  let out = '';
  for (const ch of answer) out += gate.feed(ch);
  out += gate.flush();
  return out;
}

describe('QuoteStreamGate', () => {
  test('prose passes through unchanged', () => {
    const gate = new QuoteStreamGate([SOURCE], 'ru');
    const answer = 'Согласно норме, отчёт подаётся до 20 числа.';
    assert.equal(streamCharwise(answer, gate), answer);
    assert.equal(gate.invalidCount, 0);
  });

  test('a verbatim quote survives streaming, delimiters intact', () => {
    const gate = new QuoteStreamGate([SOURCE], 'ru');
    const answer = `Норма: «${VERBATIM}» — вот так.`;
    assert.equal(streamCharwise(answer, gate), answer);
    assert.equal(gate.invalidCount, 0);
  });

  test('a fabricated quote never reaches the output', () => {
    const gate = new QuoteStreamGate([SOURCE], 'ru');
    const fake = 'Միկրոձեռնարկատիրության սուբյեկտները ազատվում են բոլոր հարկերից ամբողջությամբ';
    const out = streamCharwise(`Норма: «${fake}» — конец.`, gate);
    assert.doesNotMatch(out, /ազատվում են բոլոր հարկերից/, 'fabricated text leaked');
    assert.match(out, /[…]/);
    assert.equal(gate.invalidCount, 1);
  });

  test('quote content is never emitted before the closing delimiter', () => {
    // The point of the gate: at no moment is unverified Armenian on screen.
    const gate = new QuoteStreamGate([SOURCE], 'ru');
    const fake = 'Ամբողջովին հորինված իրավական դրույթ որը գոյություն չունի օրենքում';
    let emittedSoFar = '';
    for (const ch of `Норма: «${fake}`) emittedSoFar += gate.feed(ch);
    assert.doesNotMatch(emittedSoFar, /հորինված/, 'quote body leaked while still open');
    assert.equal(emittedSoFar, 'Норма: ');
  });

  test('delta boundaries falling inside a quote do not matter', () => {
    const gate = new QuoteStreamGate([SOURCE], 'ru');
    const answer = `Норма: «${VERBATIM}».`;
    // Split into arbitrary 7-character deltas, as a real stream would.
    let out = '';
    for (let i = 0; i < answer.length; i += 7) out += gate.feed(answer.slice(i, i + 7));
    out += gate.flush();
    assert.equal(out, answer);
  });

  test('an unterminated quote is still checked, not released', () => {
    const gate = new QuoteStreamGate([SOURCE], 'ru');
    const fake = 'Հորինված դրույթ որը ոչ մի տեղ գրված չէ և չի կարող հաստատվել';
    let out = '';
    for (const ch of `Норма: «${fake}`) out += gate.feed(ch);
    out += gate.flush();
    assert.doesNotMatch(out, /Հորինված/, 'unterminated quote leaked at flush');
    assert.equal(gate.invalidCount, 1);
  });

  test('an unterminated but verbatim quote is released at flush', () => {
    const gate = new QuoteStreamGate([SOURCE], 'ru');
    let out = '';
    for (const ch of `Норма: «${VERBATIM}`) out += gate.feed(ch);
    out += gate.flush();
    assert.match(out, /ներկայացնում են շրջանառության հարկի հաշվարկներ/);
    assert.equal(gate.invalidCount, 0);
  });

  test('short spans and Russian prose in quotes pass through untouched', () => {
    const gate = new QuoteStreamGate([SOURCE], 'ru');
    const answer = 'Термин «շրջանառություն» и фраза «это важно» остаются.';
    assert.equal(streamCharwise(answer, gate), answer);
    assert.equal(gate.invalidCount, 0);
  });

  test('the removal notice matches the answer language', () => {
    const gate = new QuoteStreamGate([SOURCE], 'hy');
    const fake = 'Ամբողջովին հորինված իրավական դրույթ որը գոյություն չունի օրենքում';
    const out = streamCharwise(`Նորմ՝ «${fake}»։`, gate);
    assert.match(out, /[…]/);
  });

  test('text accumulates exactly what was emitted', () => {
    const gate = new QuoteStreamGate([SOURCE], 'ru');
    const answer = `Норма: «${VERBATIM}» — конец.`;
    const out = streamCharwise(answer, gate);
    assert.equal(gate.text, out);
  });

  test('several quotes in one answer are judged independently', () => {
    const gate = new QuoteStreamGate([SOURCE], 'ru');
    const fake = 'Միկրոձեռնարկատիրության սուբյեկտները ազատվում են բոլոր հարկերից ամբողջությամբ';
    const out = streamCharwise(`Первая: «${VERBATIM}». Вторая: «${fake}».`, gate);
    assert.match(out, /ներկայացնում են շրջանառության հարկի հաշվարկներ/, 'good quote kept');
    assert.doesNotMatch(out, /ազատվում են բոլոր հարկերից/, 'bad quote kept');
    assert.equal(gate.invalidCount, 1);
  });
});
