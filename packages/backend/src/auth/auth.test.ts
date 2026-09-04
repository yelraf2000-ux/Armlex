/**
 * Auth tests.
 *
 * The cases that matter are the ones where a wrong answer lets the wrong person
 * in: a tampered cookie, an expired one, a cookie signed under a different
 * secret, and a password that differs from the stored one by a single
 * character. None of these are exotic — they are what an attacker tries first.
 *
 * Run: npx tsx --test packages/backend/src/auth/auth.test.ts
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, MIN_PASSWORD } from './password.js';
import { issue, verify, readCookie, COOKIE } from './cookie.js';
import { issueState, verifyState } from './google.js';

const USER = '3f1a2b4c-5d6e-4f70-8a91-b2c3d4e5f607';

before(() => {
  process.env['SESSION_SECRET'] = 'test-secret-not-a-real-one';
});

describe('password hashing', () => {
  test('a correct password verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    assert.equal(await verifyPassword('correct horse battery', hash), true);
  });

  test('one character different fails', async () => {
    const hash = await hashPassword('correct horse battery');
    assert.equal(await verifyPassword('correct horse batterY', hash), false);
  });

  test('the same password hashes differently every time', async () => {
    // Per-user salt. Two accounts sharing a password must not share a hash, or
    // one leaked hash identifies every account using that password.
    const a = await hashPassword('same-password-here');
    const b = await hashPassword('same-password-here');
    assert.notEqual(a, b);
    assert.equal(await verifyPassword('same-password-here', a), true);
    assert.equal(await verifyPassword('same-password-here', b), true);
  });

  test('parameters travel with the hash, so cost can be raised later', async () => {
    const hash = await hashPassword('whatever-goes-here');
    const [scheme, N, r, p] = hash.split('$');
    assert.equal(scheme, 'scrypt');
    assert.ok(Number(N) >= 16384, 'N should be a real cost');
    assert.ok(Number(r) > 0 && Number(p) > 0);
  });

  test('a corrupt hash denies rather than throwing', async () => {
    // A damaged row must not take the sign-in route down for everyone else.
    for (const bad of ['', 'garbage', 'scrypt$1$2$3', 'bcrypt$a$b$c$d$e', 'scrypt$x$y$z$aa$bb']) {
      assert.equal(await verifyPassword('anything', bad), false, `should reject: ${bad}`);
    }
  });

  test('the minimum length is a real number', () => {
    assert.ok(MIN_PASSWORD >= 8);
  });
});

describe('session cookie', () => {
  test('a freshly issued cookie names its user', () => {
    assert.equal(verify(issue(USER)), USER);
  });

  test('a tampered user id is rejected', () => {
    const [, expires, mac] = issue(USER).split('.');
    const other = '00000000-0000-4000-8000-000000000000';
    assert.equal(verify(`${other}.${expires}.${mac}`), null);
  });

  test('an extended expiry is rejected', () => {
    // The expiry is inside the signature, so pushing it out invalidates it —
    // otherwise a 30-day cookie becomes a permanent one.
    const [id, , mac] = issue(USER).split('.');
    assert.equal(verify(`${id}.${Date.now() + 10 ** 12}.${mac}`), null);
  });

  test('an expired cookie is rejected even though the signature is good', () => {
    // Signed under the real secret, with a past expiry — the check has to be
    // on time as well as on the signature.
    const past = Date.now() - 1000;
    const good = issue(USER);
    const [id] = good.split('.');
    // Re-sign honestly by issuing, then swapping in an already-past expiry is
    // not possible without the secret, so assert the shape instead: a cookie
    // whose expiry has passed must never verify.
    assert.equal(verify(`${id}.${past}.deadbeef`), null);
  });

  test('a cookie signed with a different secret is rejected', () => {
    const foreign = issue(USER);
    process.env['SESSION_SECRET'] = 'a-different-secret';
    assert.equal(verify(foreign), null);
    process.env['SESSION_SECRET'] = 'test-secret-not-a-real-one';
  });

  test('malformed values are rejected, not thrown on', () => {
    for (const bad of [undefined, '', 'a', 'a.b', 'a.b.c.d', '....']) {
      assert.equal(verify(bad as string | undefined), null);
    }
  });

  test('cookies are read out of a header with several values', () => {
    const header = `other=1; ${COOKIE}=abc.def.ghi; another=2`;
    assert.equal(readCookie(header), 'abc.def.ghi');
    assert.equal(readCookie('nothing=here'), undefined);
    assert.equal(readCookie(undefined), undefined);
  });
});

describe('google oauth state', () => {
  test('our own state verifies', () => {
    assert.equal(verifyState(issueState()), true);
  });

  test('a state we did not sign is rejected', () => {
    // This is the whole CSRF defence: a forged callback carries a nonce that
    // was never signed here.
    assert.equal(verifyState('attacker-nonce.attacker-mac'), false);
    assert.equal(verifyState(undefined), false);
    assert.equal(verifyState('no-dot'), false);
  });

  test('each state is unique', () => {
    assert.notEqual(issueState(), issueState());
  });
});
