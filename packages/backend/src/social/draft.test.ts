/**
 * Drafting and approval: parsing the model's reply, the text as published,
 * the buttons, and the guard against reposting the bot's own posts.
 *
 * Run: npx tsx --test packages/backend/src/social/draft.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { composeBody, parseDraft, sourceLabel, sourceUrl } from './draft.js';
import { readAction } from './publish.js';
import { isOwnPost, markOwnPost } from './channel.js';
import { actTitle } from './titles.js';
import { wrap } from './card.js';

describe('parseDraft', () => {
  test('reads the fields, even inside a code fence', () => {
    const r = parseDraft('```json\n{"headline":"Ա","subline":"Բ","body":"Գ","sourceIndex":2}\n```');
    assert.deepEqual(r, { headline: 'Ա', subline: 'Բ', body: 'Գ', sourceIndex: 2 });
  });

  test('passes on the model declining', () => {
    assert.deepEqual(parseDraft('{"skip":"fragments do not cover it"}'), { skip: 'fragments do not cover it' });
  });

  test('refuses incomplete or broken replies', () => {
    assert.ok('skip' in parseDraft('{"headline":"Ա","body":"Գ","sourceIndex":1}'));
    assert.ok('skip' in parseDraft('no json here'));
    assert.ok('skip' in parseDraft('{"headline": broken'));
  });
});

describe('the published text', () => {
  const chunk = {
    documentTitle: 'ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ',
    ref: 'Հոդված 258',
    arlisId: 109017,
    text: '[Document] ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ\n[Source] https://www.arlis.am/hy/acts/109017/latest\n---\n1. ...',
  };

  test('the source comes from the fragment, not the model', () => {
    assert.equal(sourceLabel(chunk), 'ՀՀ հարկային օրենսգիրք · Հոդված 258');
    assert.equal(sourceUrl(chunk), 'https://www.arlis.am/hy/acts/109017/latest');
    assert.equal(sourceUrl({ ...chunk, text: 'no header' }), 'https://www.arlis.am/hy/acts/109017/latest');
  });

  test('body, then source and link, then the site', () => {
    const body = composeBody('Տեքստ։', 'Ակտ · Հոդված 1', 'https://x');
    assert.ok(body.startsWith('Տեքստ։\n\nԱղբյուր՝ Ակտ · Հոդված 1\nhttps://x'));
    assert.ok(body.endsWith('matyanai.am'));
  });

  test('act titles keep their abbreviations', () => {
    assert.equal(actTitle('ՀՀ ԿԱՌԱՎԱՐՈՒԹՅԱՆ ՈՐՈՇՈՒՄԸ ՀՀ-ՈՒՄ ԱԱՀ-Ի ՄԱՍԻՆ'), 'ՀՀ կառավարության որոշումը ՀՀ-ում ԱԱՀ-ի մասին');
  });
});

describe('buttons and guards', () => {
  const id = '0d8f6a2e-4b1c-4a5e-9f3d-2c7b8e1a6d90';

  test('only our two actions on a real id are read', () => {
    assert.deepEqual(readAction(`pub:${id}`), { action: 'pub', draftId: id });
    assert.deepEqual(readAction(`skip:${id}`), { action: 'skip', draftId: id });
    assert.equal(readAction(`delete:${id}`), null);
    assert.equal(readAction('pub:1; DROP TABLE'), null);
    assert.equal(readAction(undefined), null);
  });

  test('a post the bot published itself is recognised for ten minutes', () => {
    markOwnPost('Տեքստ  մի\nքանի տողով', 1_000);
    assert.equal(isOwnPost('Տեքստ մի քանի տողով', 1_000 + 60_000), true);
    assert.equal(isOwnPost('Տեքստ մի քանի տողով', 1_000 + 11 * 60_000), false);
    assert.equal(isOwnPost('Այլ տեքստ', 1_000), false);
  });

  test('card lines wrap, and overflow ends in an ellipsis', () => {
    const lines = wrap('բառ '.repeat(60), 400, 40, false, 3);
    assert.equal(lines.length, 3);
    assert.ok(lines[2]!.endsWith('…'));
  });
});

test('the delete buttons are read, and only on a real id', () => {
  const id = '0d8f6a2e-4b1c-4a5e-9f3d-2c7b8e1a6d90';
  assert.deepEqual(readAction(`del:${id}`), { action: 'del', draftId: id });
  assert.deepEqual(readAction(`delyes:${id}`), { action: 'delyes', draftId: id });
  assert.deepEqual(readAction(`delno:${id}`), { action: 'delno', draftId: id });
  assert.equal(readAction('delyes:everything'), null);
});
