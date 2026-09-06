/**
 * Invitation parsing tests.
 *
 * Bonus questions are real spend, so the parser is the first place a referral
 * scheme leaks money: duplicates, junk addresses, and an unbounded list all
 * turn into free API credit if they get through.
 *
 * The award TIMING — +10 on send, +5 only when the invited address actually
 * registers — is enforced in SQL (`claimInvitation` guards on
 * `accepted_user_id IS NULL`), so it is covered by the end-to-end check rather
 * than here.
 *
 * Run: npx tsx --test packages/backend/src/auth/invitations.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInvites,
  MAX_INVITES,
  BONUS_FOR_INVITING,
  BONUS_PER_ACCEPTED,
} from './invitations.js';

describe('parseInvites', () => {
  test('keeps well-formed invitations, with names', () => {
    const out = parseInvites([
      { email: 'a@firm.am', name: 'Անի' },
      { email: 'b@firm.am', name: 'Բագրատ' },
    ]);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { email: 'a@firm.am', name: 'Անի' });
  });

  test('caps at the maximum, however many are sent', () => {
    // Without this, a scripted body of 500 addresses is 500 rows and a bonus.
    const many = Array.from({ length: 50 }, (_, i) => ({ email: `x${i}@firm.am` }));
    assert.equal(parseInvites(many).length, MAX_INVITES);
  });

  test('drops duplicates, case- and whitespace-insensitively', () => {
    const out = parseInvites([
      { email: 'same@firm.am' },
      { email: 'SAME@firm.am' },
      { email: '  same@firm.am  ' },
    ]);
    assert.equal(out.length, 1);
  });

  test('drops junk instead of failing the whole registration', () => {
    // A typo in the fourth invitation must not cost someone their account:
    // they can invite again later, they cannot un-abandon a signup.
    const out = parseInvites([
      { email: 'good@firm.am' },
      { email: 'not-an-email' },
      { email: '' },
      { email: 42 },
      null,
      { name: 'no address at all' },
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.email, 'good@firm.am');
  });

  test('a missing or non-array field is simply no invitations', () => {
    for (const bad of [undefined, null, 'a@b.c', 7, {}]) {
      assert.deepEqual(parseInvites(bad), []);
    }
  });

  test('a name is optional', () => {
    assert.equal(parseInvites([{ email: 'a@firm.am' }])[0]!.name, null);
    assert.equal(parseInvites([{ email: 'a@firm.am', name: '   ' }])[0]!.name, null);
  });

  test('the rewards are the advertised numbers', () => {
    // The form promises these to the user; a drift here makes the product lie.
    assert.equal(BONUS_FOR_INVITING, 10);
    assert.equal(BONUS_PER_ACCEPTED, 5);
    assert.equal(MAX_INVITES, 4);
  });

  test('the most anyone can earn from one signup is bounded', () => {
    // 10 for inviting + 5 x 4 if every invitee joins = 30. Worth stating as a
    // test, because this number is the exposure per account.
    assert.equal(BONUS_FOR_INVITING + BONUS_PER_ACCEPTED * MAX_INVITES, 30);
  });
});
