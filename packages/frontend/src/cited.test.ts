/**
 * The rule that decides what a reader is shown as the basis of an answer.
 *
 * Worth testing rather than eyeballing: both failure directions are real. A
 * provision presented as the basis of an answer that never used it is
 * something a professional would act on; a provision hidden that the answer
 * does rest on breaks the checking the apparatus exists for.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { citedIndexes } from './cited.js';

const chunk = (ref: string, text = 'ԱՆՀԱՏ ՁԵՌՆԱՐԿԱՏԵՐԵՐԸ ՀԱՐԿՎՈՒՄ ԵՆ ՇՐՋԱՆԱՌՈՒԹՅԱՆ ՀԱՐԿՈՎ') => ({ ref, text });

describe('citedIndexes', () => {
  test('keeps the provisions the answer names', () => {
    const candidates = [chunk('Հոդված 8'), chunk('Հոդված 267'), chunk('Հոդված 39')];
    const answer = 'Ըստ (ՀՀ Հարկային օրենսգիրք, Հոդված 8) և (Հոդված 39)։';
    assert.deepEqual(citedIndexes(candidates, answer), [0, 2]);
  });

  test('«Հոդված 3» is not cited by an answer that says «Հոդված 30»', () => {
    // The failure this guards: a neighbouring article presented as the basis
    // of an answer, because its number is a prefix of the one actually cited.
    const candidates = [chunk('Հոդված 3'), chunk('Հոդված 30')];
    assert.deepEqual(citedIndexes(candidates, 'տես Հոդված 30-ը'), [1]);
  });

  test('a short reference is not evidence on its own', () => {
    // «կետ 1» occurs inside any answer discussing point 1 of anything at all,
    // including a different act's point 1.
    const candidates = [chunk('կետ 1'), chunk('Հոդված 254')];
    const answer = '(ՀՀ Հարկային օրենսգիրք, Հոդված 254, մաս 3, կետ 1)';
    assert.deepEqual(citedIndexes(candidates, answer), [1]);
  });

  test('a quoted passage counts, whatever the reference looks like', () => {
    const candidates = [
      chunk('կետ 1', 'ԷԼԵԿՏՐՈՆԱՅԻՆ ԾԱՌԱՅՈՒԹՅՈՒՆՆԵՐԻ ՄԱՏՈՒՑՄԱՆ ՎԱՅՐԸ ՈՐՈՇՎՈՒՄ Է ԳՆՈՐԴԻ ՀԱՍՑԵՈՎ'),
      chunk('Հոդված 77'),
    ];
    const answer = 'Կանոնն այսպիսին է. «ԷԼԵԿՏՐՈՆԱՅԻՆ ԾԱՌԱՅՈՒԹՅՈՒՆՆԵՐԻ ՄԱՏՈՒՑՄԱՆ ՎԱՅՐԸ ՈՐՈՇՎՈՒՄ Է ԳՆՈՐԴԻ ՀԱՍՑԵՈՎ»։';
    assert.deepEqual(citedIndexes(candidates, answer), [0]);
  });

  test('an answer that names nothing recognisable keeps every provision', () => {
    // Failing towards more evidence: an unfamiliar citation style must not
    // leave the reader with an empty column.
    const candidates = [chunk('Հոդված 8'), chunk('Հոդված 39')];
    assert.deepEqual(citedIndexes(candidates, 'Հասանելի հատվածները չեն պարունակում պատասխանը։'), [0, 1]);
  });

  test('a turn that settled with no text shows no provisions', () => {
    // The failed turn: generation died, the answer is empty, and the column
    // used to present every retrieved provision as its basis.
    const candidates = [chunk('Հոդված 8')];
    assert.deepEqual(citedIndexes(candidates, ''), []);
  });
});

describe('citedIndexes while the answer is still being written', () => {
  const candidates = [chunk('Հոդված 150'), chunk('Հոդված 258'), chunk('Հոդված 19')];

  test('an answer that has cited nothing yet shows nothing yet', () => {
    // Not everything. Showing all sixteen retrieved provisions and then
    // collapsing to two is the reader watching sources be taken away.
    assert.deepEqual(citedIndexes(candidates, '', false), []);
    assert.deepEqual(citedIndexes(candidates, 'Այս արտոնությունը', false), []);
  });

  test('the set only ever grows as the text arrives', () => {
    const stream = [
      '',
      'Այս արտոնությունը (ՀՀ Հարկային օրենսգիրք, ',
      'Այս արտոնությունը (ՀՀ Հարկային օրենսգիրք, Հոդված 150, մաս 1.1) սահմանում է',
      'Այս արտոնությունը (ՀՀ Հարկային օրենսգիրք, Հոդված 150, մաս 1.1) սահմանում է․ տես նաև Հոդված 19։',
    ];
    let previous: number[] = [];
    for (const text of stream) {
      const now = citedIndexes(candidates, text, false);
      assert.ok(
        previous.every((i) => now.includes(i)),
        `nothing is taken back: had ${previous} then ${now}`,
      );
      previous = now;
    }
    assert.deepEqual(previous, [0, 2]);
  });

  test('a settled answer still falls back to everything', () => {
    assert.deepEqual(citedIndexes(candidates, 'Պատասխան առանց վկայակոչման։', true), [0, 1, 2]);
  });
});

describe('the end of a growing answer is not a right boundary', () => {
  test('a half-typed number does not name the article it is a prefix of', () => {
    // «Հոդված 125» passes through «Հոդված 12» on its way in. Counting that as
    // a naming put article 12 in the column for one frame and took it away.
    const candidates = [chunk('Հոդված 12'), chunk('Հոդված 125')];
    assert.deepEqual(citedIndexes(candidates, 'տես Հոդված 12', false), []);
    // And «Հոդված 125» at the tail waits too — it shows as soon as anything
    // follows it, which in a streamed answer is the next frame.
    assert.deepEqual(citedIndexes(candidates, 'տես Հոդված 125', false), []);
    assert.deepEqual(citedIndexes(candidates, 'տես Հոդված 125-ով', false), [1]);
  });

  test('once something follows it, a naming at the end counts', () => {
    const candidates = [chunk('Հոդված 12')];
    assert.deepEqual(citedIndexes(candidates, 'տես Հոդված 12 ', false), [0]);
  });

  test('a finished answer ending on a citation still counts', () => {
    // Nothing more is coming, so the end of the text IS a boundary.
    const candidates = [chunk('Հոդված 12')];
    assert.deepEqual(citedIndexes(candidates, 'տես Հոդված 12', true), [0]);
  });

  test('a whole streamed answer never takes an entry back', () => {
    const candidates = [chunk('Հոդված 12'), chunk('Հոդված 125'), chunk('Հոդված 258')];
    const full = 'Շահութահարկը սահմանված է Հոդված 125-ով, շրջանառության հարկը՝ Հոդված 258-ով։';
    let previous: number[] = [];
    for (let n = 0; n <= full.length; n++) {
      const now = citedIndexes(candidates, full.slice(0, n), n === full.length);
      assert.ok(
        previous.every((i) => now.includes(i)),
        `at ${n} chars: had ${previous}, now ${now}`,
      );
      previous = now;
    }
    assert.deepEqual(previous, [1, 2]);
  });
});
