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
import { parseInvites, MAX_INVITES } from './invitations.js';
import { allowanceFor } from './users.js';

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

  test('one signup may invite at most four colleagues', () => {
    assert.equal(MAX_INVITES, 4);
  });
});

/*
 * The free allowance, as specified: the creator 5 (10 until 2026-09-17), every
 * colleague 5, and the firm's weekly pool is the sum. The form and the landing
 * promise these numbers, so a drift here makes the product say something untrue.
 */
describe('free seats', () => {
  test('the creator of a workspace gets 5 a week', () => {
    assert.equal(allowanceFor('free', null, 0, true), 5);
  });

  test('a colleague who joins gets 5', () => {
    assert.equal(allowanceFor('free', null, 0, false), 5);
  });

  test('admin 5 + user 5 + user 5 = 15', () => {
    const seats = [true, false, false].map((owner) => allowanceFor('free', null, 0, owner)!);
    assert.equal(seats.reduce((a, b) => a + b, 0), 15);
  });

  test('a full signup — creator plus four colleagues — is bounded at 25', () => {
    // The exposure per account once every invitee joins: no referral bonus
    // stacks on top of the seats any more.
    const seats = [true, false, false, false, false].map((o) => allowanceFor('free', null, 0, o)!);
    assert.equal(seats.reduce((a, b) => a + b, 0), 5 + 5 * MAX_INVITES);
  });

  test('ownership only changes the FREE seat', () => {
    assert.equal(allowanceFor('pro', null, 0, true), 50);
    assert.equal(allowanceFor('pro', null, 0, false), 50);
  });

  test('bonuses already credited still count on top of the seat', () => {
    assert.equal(allowanceFor('free', null, 15, true), 20);
  });
});
