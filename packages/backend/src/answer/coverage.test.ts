import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CoverageParser } from './coverage.js';

/** Stream a whole response one character at a time — worst-case chunking. */
function streamCharwise(text: string): { out: string; parser: CoverageParser } {
  const parser = new CoverageParser();
  let out = '';
  for (const ch of text) out += parser.feed(ch);
  out += parser.flush();
  return { out, parser };
}

describe('CoverageParser', () => {
  test('strips the header and reports the verdict', () => {
    const { out, parser } = streamCharwise('COVERAGE: full\nОтвет начинается тут.');
    assert.equal(parser.coverage, 'full');
    assert.equal(out, 'Ответ начинается тут.');
  });

  test('recognises all three verdicts', () => {
    for (const v of ['full', 'partial', 'none'] as const) {
      const { parser } = streamCharwise(`COVERAGE: ${v}\nтекст`);
      assert.equal(parser.coverage, v);
    }
  });

  test('is case-insensitive and tolerates stray spacing', () => {
    const { out, parser } = streamCharwise('  coverage:   PARTIAL  \nтекст');
    assert.equal(parser.coverage, 'partial');
    assert.equal(out, 'текст');
  });

  test('no header — the answer is passed through intact', () => {
    // The model failing to comply must never cost the user their answer.
    const answer = 'Согласно норме, отчёт подаётся до 20 числа.\nВторая строка.';
    const { out, parser } = streamCharwise(answer);
    assert.equal(parser.coverage, null);
    assert.equal(out, answer);
  });

  test('a long first line is released rather than buffered indefinitely', () => {
    const long = 'Очень длинный первый абзац без переноса строки, который явно не является заголовком coverage.';
    const { out, parser } = streamCharwise(long);
    assert.equal(parser.coverage, null);
    assert.equal(out, long);
  });

  test('nothing is withheld after the header is settled', () => {
    const parser = new CoverageParser();
    parser.feed('COVERAGE: none\n');
    assert.equal(parser.feed('первая '), 'первая ');
    assert.equal(parser.feed('вторая'), 'вторая');
  });

  test('header split across deltas is still recognised', () => {
    const parser = new CoverageParser();
    let out = '';
    for (const part of ['COVER', 'AGE: par', 'tial', '\nтекст ответа']) out += parser.feed(part);
    assert.equal(parser.coverage, 'partial');
    assert.equal(out, 'текст ответа');
  });

  test('blank lines after the header are trimmed', () => {
    const { out } = streamCharwise('COVERAGE: full\n\n\nОтвет.');
    assert.equal(out, 'Ответ.');
  });

  test('a response that is only a header emits no text', () => {
    const { out, parser } = streamCharwise('COVERAGE: none');
    assert.equal(parser.coverage, 'none');
    assert.equal(out, '');
  });

  test('the word COVERAGE later in the answer is not treated as a header', () => {
    const { out, parser } = streamCharwise('Первая строка.\nCOVERAGE: full\nещё');
    assert.equal(parser.coverage, null);
    assert.match(out, /COVERAGE: full/);
  });
});
