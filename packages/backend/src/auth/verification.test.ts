/**
 * Email verification tests.
 *
 * These cover the two properties that decide whether shipping this before the
 * mail key exists is safe, and one that decides whether a leaked link is:
 *
 *   1. With no mail credentials the gate is OFF. If this inverted, an
 *      unconfigured deployment would accept registrations and strand every one
 *      of them behind a link nobody could send — an outage that looks like
 *      working software.
 *   2. With the gate off, nothing touches the database. `issueFor` must not
 *      write a token row it has no way to deliver.
 *   3. A malformed token is rejected BEFORE any query runs. The guard is what
 *      keeps an attacker from using the endpoint as a way to probe the
 *      database with arbitrary strings.
 *
 * The rest — expiry, single use, the already_used distinction — is enforced in
 * SQL and covered end to end, in the same way invitations.test.ts leaves the
 * award timing to its own guard.
 *
 * Run: npx tsx --test packages/backend/src/auth/verification.test.ts
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { consume, isRequired, issueFor } from './verification.js';
import { isEnabled, send } from '../mail/mailer.js';

const KEY = 'RESEND_API_KEY';
const FROM = 'EMAIL_FROM';

let savedKey: string | undefined;
let savedFrom: string | undefined;

beforeEach(() => {
  savedKey = process.env[KEY];
  savedFrom = process.env[FROM];
  delete process.env[KEY];
  delete process.env[FROM];
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY];
  else process.env[KEY] = savedKey;
  if (savedFrom === undefined) delete process.env[FROM];
  else process.env[FROM] = savedFrom;
});

describe('the gate follows the mail credentials', () => {
  test('off when neither is set', () => {
    assert.equal(isEnabled(), false);
    assert.equal(isRequired(), false);
  });

  test('off when only one is set — a key with no sender cannot send', () => {
    process.env[KEY] = 're_test';
    assert.equal(isRequired(), false);
    delete process.env[KEY];
    process.env[FROM] = 'MatyanAI <noreply@matyanai.am>';
    assert.equal(isRequired(), false);
  });

  test('on only when both are set', () => {
    process.env[KEY] = 're_test';
    process.env[FROM] = 'MatyanAI <noreply@matyanai.am>';
    assert.equal(isRequired(), true);
  });
});

describe('disabled mail never throws and never writes', () => {
  test('send reports the reason instead of raising', async () => {
    const res = await send({ to: 'a@firm.am', subject: 's', html: 'h', text: 't' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'mail_disabled');
  });

  /*
   * No database is running in this test process. Reaching one would hang or
   * throw — so completing at all is the proof that `issueFor` returned before
   * inserting a token row it could never deliver.
   */
  test('issueFor returns before touching the database', async () => {
    const res = await issueFor({ id: 'a3f1c2d4-5e6f-4071-8a92-b3c4d5e6f708', email: 'a@firm.am' });
    assert.equal(res.sent, false);
    assert.equal(res.error, 'mail_disabled');
  });
});

describe('malformed tokens are rejected before any query', () => {
  for (const [label, token] of [
    ['empty', ''],
    ['too short', 'abc'],
    ['SQL-ish', "' OR 1=1 --"],
    ['path traversal', '../../etc/passwd'],
    ['non-base64url characters', 'a'.repeat(30) + '!@#$'],
    ['absurdly long', 'a'.repeat(500)],
  ] as const) {
    test(label, async () => {
      const res = await consume(token);
      assert.deepEqual(res, { ok: false, reason: 'invalid' });
    });
  }
});
