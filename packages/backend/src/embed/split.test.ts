import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isEnumeration, splitEnumerated, splitCorpus } from './split.js';
import type { CorpusChunk } from './corpus.js';

const HEADER = '[Document] ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ\n[Location] ԳԼՈՒԽ 3 › Հոդված 64\n---\n';

/** A prose enumeration shaped like Հոդված 64: parts with numbered points. */
function proseEnumeration(points: number): string {
  const lines = ['1. ԱԱՀ-ից ազատելը Օրենսգրքի 60-րդ հոդվածով սահմանված գործարքների համար կիրառվում է սույն հոդվածով:'];
  lines.push('2. ԱԱՀ-ից ազատվում են Օրենսգրքի 60-րդ հոդվածով սահմանված հետևյալ գործարքները և գործառնությունները.');
  for (let i = 1; i <= points; i++) {
    lines.push(`${i}) ${'ծառայությունների մատուցումը, որոնք իրականացվում են սահմանված կարգով և ենթակա են ազատման '.repeat(3)}կետ ${i}.`);
  }
  return lines.join('\n');
}

/** A rate table shaped like Հոդված 258. */
function rateTable(rows: number): string {
  const lines = ['1. Շրջանառության հարկը հաշվարկվում է հետևյալ դրույքաչափերով.'];
  lines.push('| | Եկամտի տեսակը | Դրույքաչափը (տոկոս) |');
  lines.push('| --- | --- | --- |');
  for (let i = 1; i <= rows; i++) {
    // Wide rows, so the fixture clears ENUM_MIN_CHARS the way real rate tables
    // do (Հոդված 258 is 7,860 characters).
    lines.push(`| ${i}) | ${'գործունեությունից ստացվող եկամուտներ տեսակ '.repeat(7)}${i} | ${i} |`);
  }
  lines.push('2. Հաշվետու ժամանակաշրջանի համար հարկի գումարը նվազեցվում է սույն հոդվածի աղյուսակի համաձայն հաշվարկված գումարով:');
  return lines.join('\n');
}

const chunk = (body: string, id = '109017#Հոդված 64'): CorpusChunk =>
  ({ id, arlisId: 109017, ref: id.split('#')[1]!, text: HEADER + body }) as CorpusChunk;

describe('isEnumeration', () => {
  test('a long numbered list qualifies', () => {
    assert.equal(isEnumeration(proseEnumeration(20)), true);
  });
  test('a rate table qualifies', () => {
    assert.equal(isEnumeration(rateTable(10)), true);
  });
  test('short text never qualifies, however it is numbered', () => {
    assert.equal(isEnumeration('1. կարճ\n2. կարճ\n3. կարճ\n4. կարճ'), false);
  });
  test('long prose without markers does not qualify', () => {
    assert.equal(isEnumeration('Սովորական տեքստ առանց համարակալման։ '.repeat(200)), false);
  });
});

describe('splitEnumerated — prose enumeration', () => {
  const slices = splitEnumerated(chunk(proseEnumeration(20)));

  test('produces roughly one slice per point, not one per 7000 tokens', () => {
    assert.ok(slices.length >= 18, `expected ~20 slices, got ${slices.length}`);
  });

  test('every slice resolves to the parent chunk', () => {
    for (const s of slices) assert.equal(s.parentId, '109017#Հոդված 64');
  });

  test('every slice carries the metadata header', () => {
    for (const s of slices) assert.ok(s.text.startsWith('[Document]'), s.id);
  });

  test('a point slice carries the lead-in of its governing part', () => {
    // «8) …» alone says nothing about VAT; with «2. ԱԱՀ-ից ազատվում են…» it does.
    const point8 = slices.find((s) => /\n8\) /.test(s.text));
    assert.ok(point8, 'point 8 slice missing');
    assert.match(point8.text, /2\. ԱԱՀ-ից ազատվում են/);
  });

  test('slice ids are unique', () => {
    assert.equal(new Set(slices.map((s) => s.id)).size, slices.length);
  });
});

describe('splitEnumerated — rate table', () => {
  const slices = splitEnumerated(chunk(rateTable(10), '109017#Հոդված 258'));

  test('one slice per data row', () => {
    const rows = slices.filter((s) => /\|\s*\d+\)\s*\|/.test(s.text));
    assert.equal(rows.length, 10);
  });

  test('each row slice repeats the column header, so "1" still means a rate', () => {
    for (const s of slices.filter((r) => /\|\s*\d+\)\s*\|/.test(r.text))) {
      assert.match(s.text, /Դրույքաչափը/, s.id);
    }
  });

  test('no slice is only the table header', () => {
    for (const s of slices) {
      const body = s.text.slice(s.text.indexOf('\n---\n') + 5).trim();
      assert.notEqual(body, '| | Եկամտի տեսակը | Դրույքաչափը (տոկոս) |\n| --- | --- | --- |');
    }
  });
});

describe('splitCorpus with the enum policy', () => {
  test('small chunks pass through untouched as a single slice', () => {
    const small = chunk('1. Կարճ դրույթ։\n2. Երկրորդ դրույթ։', '109017#Հոդված 5');
    const out = splitCorpus([small], 7000, 8000, 'enum');
    assert.equal(out.length, 1);
    assert.equal(out[0]!.id, '109017#Հոդված 5');
  });

  test('the token policy is unchanged by the new code path', () => {
    // cl100k tokenises Armenian expensively, so even a 20-point fixture may
    // exceed 7000 tokens and split legitimately. The invariant that matters:
    // the token policy never emits enumeration slices.
    const big = chunk(proseEnumeration(20));
    const tokenSlices = splitCorpus([big], 7000, 8000, 'token');
    assert.ok(tokenSlices.every((s) => !s.id.includes('::e')));
    assert.ok(tokenSlices.every((s) => s.parentId === '109017#Հոդված 64'));
  });

  test('the token cap still holds under the enum policy', () => {
    const big = chunk(proseEnumeration(60));
    for (const s of splitCorpus([big], 7000, 8000, 'enum')) assert.ok(s.tokens <= 8000);
  });
});
