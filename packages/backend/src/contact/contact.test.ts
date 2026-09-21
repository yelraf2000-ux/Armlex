/**
 * Contact form tests: what is accepted, what the team sees, and that the
 * limit binds — the form is open to anyone and posts into the team's Telegram.
 *
 * Run: npx tsx --test packages/backend/src/contact/contact.test.ts
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { allowContact, formatForTeam, readContact, resetContactLimits } from './contact.js';

describe('readContact', () => {
  test('accepts and trims a complete message', () => {
    const r = readContact({ name: ' Արամ ', contact: '+374 99 123456', message: ' Ի՞նչ արժե։ ', page: '/' });
    assert.deepEqual(r, { name: 'Արամ', contact: '+374 99 123456', message: 'Ի՞նչ արժե։', page: '/' });
  });

  test('names the missing field', () => {
    assert.deepEqual(readContact({ contact: 'a@b.am', message: 'x' }), { error: 'name_required' });
    assert.deepEqual(readContact({ name: 'A', message: 'x' }), { error: 'contact_required' });
    assert.deepEqual(readContact({ name: 'A', contact: 'a@b.am', message: '   ' }), { error: 'message_required' });
  });

  test('refuses oversized fields and non-strings', () => {
    assert.deepEqual(readContact({ name: 'A', contact: 'c', message: 'x'.repeat(2001) }), { error: 'too_long' });
    assert.deepEqual(readContact({ name: 42, contact: 'c', message: 'x' }), { error: 'name_required' });
    assert.deepEqual(readContact(null), { error: 'name_required' });
  });
});

describe('formatForTeam', () => {
  test('carries the visitor’s words verbatim, and the account when signed in', () => {
    const text = formatForTeam(
      { name: 'Արամ', contact: '@aram', message: 'Քանի՞ արժե 20 հոգու համար։', page: '/' },
      'aram@firm.am',
    );
    assert.match(text, /Անուն: Արամ/);
    assert.match(text, /Կապ: @aram/);
    assert.match(text, /Հաշիվ: aram@firm.am/);
    assert.ok(text.endsWith('Քանի՞ արժե 20 հոգու համար։'));
  });

  test('omits what is not known', () => {
    const text = formatForTeam({ name: 'A', contact: 'c', message: 'm', page: null }, null);
    assert.ok(!text.includes('Հաշիվ'));
    assert.ok(!text.includes('Էջ'));
  });
});

describe('allowContact', () => {
  beforeEach(() => resetContactLimits());

  test('five an hour per address, then refuses', () => {
    for (let i = 0; i < 5; i++) assert.equal(allowContact('ip', 1000 + i), true);
    assert.equal(allowContact('ip', 1010), false);
    assert.equal(allowContact('other', 1010), true);
  });

  test('the window rolls', () => {
    for (let i = 0; i < 5; i++) allowContact('ip', 1000);
    assert.equal(allowContact('ip', 1000 + 60 * 60 * 1000 + 1), true);
  });
});
