/**
 * The checks that decide whether an automatic post goes out.
 *
 * Run: npx tsx --test packages/backend/src/social/autopost.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { demoParts, firstSentence, partText } from './demoPost.js';
import { promoProblems, ROTATION } from './autopost.js';
import { ALLOWED_NUMBERS, OVERCLAIMS } from './facts.js';

// The live answer of 2026-09-21 to «Քանի՞ օր է տրվում ամենամյա արձակուրդը։».
const ANSWER =
  'Ամենամյա նվազագույն արձակուրդի տևողությունը կազմում է.\n- հնգօրյա աշխատանքային շաբաթվա դեպքում՝ 20 աշխատանքային օր,\n- վեցօրյա աշխատանքային շաբաթվա դեպքում՝ 24 աշխատանքային օր\n\n(ՀՀ ԱՇԽԱՏԱՆՔԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 159, մաս 1)։\n\nԱռանձին կատեգորիաների համար…';
const ARTICLE =
  '[Document] ՀՀ ԱՇԽԱՏԱՆՔԱՅԻՆ ՕՐԵՆՍԳԻՐՔ\n[Source] https://www.arlis.am/hy/acts/x/latest\n---\n1. Ամենամյա նվազագույն արձակուրդի տևողությունը հնգօրյա աշխատանքային շաբաթվա դեպքում 20 աշխատանքային օր է, իսկ վեցօրյա աշխատանքային շաբաթվա դեպքում` 24 աշխատանքային օր:\n2. Երկրորդ մաս։';
const CHUNKS = [
  { documentTitle: 'ՀՀ ԱՇԽԱՏԱՆՔԱՅԻՆ ՕՐԵՆՍԳԻՐՔ', ref: 'Հոդված 163', text: 'other' },
  { documentTitle: 'ՀՀ ԱՇԽԱՏԱՆՔԱՅԻՆ ՕՐԵՆՍԳԻՐՔ', ref: 'Հոդված 159', text: ARTICLE },
];

describe('a live answer becomes a card by code', () => {
  test('lines up to the first citation, the cited part, a verbatim quote', () => {
    const p = demoParts(ANSWER, CHUNKS);
    assert.ok(!('skip' in p), JSON.stringify(p));
    if ('skip' in p) return;
    assert.deepEqual(p.lines, [
      'Ամենամյա նվազագույն արձակուրդի տևողությունը կազմում է.',
      '• հնգօրյա աշխատանքային շաբաթվա դեպքում՝ 20 աշխատանքային օր,',
      '• վեցօրյա աշխատանքային շաբաթվա դեպքում՝ 24 աշխատանքային օր',
    ]);
    assert.equal(p.source, 'ՀՀ աշխատանքային օրենսգիրք · Հոդված 159, մաս 1');
    assert.ok(ARTICLE.includes(p.quote), 'the quote must be verbatim from the article');
  });

  test('no citation, or a cited article not delivered, means no post', () => {
    assert.ok('skip' in demoParts('Պատասխան առանց հղման։', CHUNKS));
    assert.ok('skip' in demoParts('Տեքստ (ՀՀ ԱՇԽԱՏԱՆՔԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 999)։', CHUNKS));
  });

  test('parts and sentences are cut from the stored text', () => {
    assert.match(partText(ARTICLE, '2') ?? '', /^Երկրորդ մաս/);
    assert.equal(partText(ARTICLE, '7'), null);
    assert.equal(firstSentence('Առաջին նախադասություն։ Երկրորդը։'), 'Առաջին նախադասություն');
    assert.ok(firstSentence('բառ '.repeat(100), 50).endsWith('…'));
  });
});

describe('promotional text is held to the facts', () => {
  const good = {
    headline: 'Պատասխան, որը կարող եք ստուգել',
    points: ['Ակտով և հոդվածով', 'Բառացի մեջբերում', 'Հղում ARLIS-ին'],
    body: 'Յուրաքանչյուր պատասխան հղում է կոնկրետ ակտին և հոդվածին։ '.repeat(4),
  };

  test('a post within the facts passes', () => {
    assert.deepEqual(promoProblems(good), []);
  });

  test('invented numbers, prices, links and overclaims are refused', () => {
    assert.ok(promoProblems({ ...good, headline: '30 հարց անվճար' }).some((p) => p.startsWith('numbers')));
    assert.ok(promoProblems({ ...good, body: `${good.body} Ընդամենը 2500 դրամ։` }).length > 0);
    assert.ok(promoProblems({ ...good, body: `${good.body} https://example.com` }).includes('link or price'));
    assert.ok(promoProblems({ ...good, points: ['Պատասխան 10 վայրկյանում', 'x', 'y'] }).length > 0);
    assert.ok(OVERCLAIMS.test('MatyanAI-ը փոխարինում է հաշվապահին'));
  });

  test('the facts allow the free-plan numbers', () => {
    assert.ok(ALLOWED_NUMBERS.has('5'));
  });
});

test('the rotation is 11 posts: 4 live answers, 4 features, one of each other kind', () => {
  assert.equal(ROTATION.length, 11);
  const count = (k: string) => ROTATION.filter((x) => x === k).length;
  assert.deepEqual([count('demo'), count('feature'), count('problem'), count('offer'), count('difference')], [4, 4, 1, 1, 1]);
});
