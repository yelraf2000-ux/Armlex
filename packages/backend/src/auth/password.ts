/**
 * Password hashing with `node:crypto`'s scrypt.
 *
 * scrypt rather than bcrypt or argon2 because it is in the standard library:
 * this project deploys to Render from a plain `npm ci`, and a native-addon
 * dependency is a build that can break on a platform bump for no benefit the
 * threat model here can name. scrypt is memory-hard and is what Node itself
 * recommends for passwords.
 *
 * Format stored in `users.password_hash`:
 *
 *     scrypt$<N>$<r>$<p>$<salt-hex>$<key-hex>
 *
 * The parameters travel WITH the hash rather than living in a constant, so
 * raising the cost later does not invalidate every existing password — an old
 * hash still verifies under its own parameters, and can be re-hashed on the
 * next successful sign-in.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Cost parameters. N=2^15 puts a single hash at roughly 100ms on the small
 * instances this runs on — slow enough to make offline guessing expensive,
 * fast enough that a sign-in does not feel broken.
 *
 * `maxmem` must be raised explicitly: Node's default 32 MB rejects N=32768 at
 * r=8 with an opaque "Invalid scrypt params" error, which reads like a bug in
 * the call rather than a memory ceiling.
 */
const PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 32;

/** Shortest password accepted. Length beats composition rules; no character classes. */
export const MIN_PASSWORD = 8;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, PARAMS);
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('hex'),
    key.toString('hex'),
  ].join('$');
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash: a corrupt row must
 * deny access, not crash the sign-in route for everyone else.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, 'hex');
    expected = Buffer.from(parts[5]!, 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  const actual = await scrypt(password, salt, expected.length, {
    N,
    r,
    p,
    maxmem: Math.max(PARAMS.maxmem, 128 * N * r * 2),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
