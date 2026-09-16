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

  test('a turn with no text yet keeps every provision', () => {
    const candidates = [chunk('Հոդված 8')];
    assert.deepEqual(citedIndexes(candidates, ''), [0]);
  });
});
