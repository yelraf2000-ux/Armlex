/**
 * The refusals `inviteToWorkspace` makes before it touches the database.
 *
 * Only the ones decided from the input alone are covered here — an address,
 * a name, a rank, and the admin's own address. Everything past those reads the
 * workspace, so it belongs to the end-to-end check.
 *
 * Run: npx tsx --test packages/backend/src/auth/workspaceInvite.test.ts
 */
import { test, describe as suite } from 'node:test';
import assert from 'node:assert/strict';
import { inviteToWorkspace } from './workspace.js';
import type { User } from './users.js';

const admin = { id: 'u1', email: 'me@firm.am' } as unknown as User;
const invite = (email: unknown, extra: Record<string, unknown> = {}) =>
  inviteToWorkspace(admin, { email, name: 'Աննա', admin: false, ...extra });

suite('inviting yourself', () => {
  test('is refused in its own words, not as "already here"', async () => {
    assert.deepEqual(await invite('me@firm.am'), { ok: false, reason: 'yourself' });
  });

  test('is refused however the address is typed', async () => {
    assert.deepEqual(await invite('  ME@Firm.AM '), { ok: false, reason: 'yourself' });
  });
});

suite('what the form is checked for anyway', () => {
  test('an address that is not one', async () => {
    assert.deepEqual(await invite('not-an-address'), { ok: false, reason: 'invalid_email' });
  });

  test('a colleague with no name — the invitee never gets to supply one', async () => {
    assert.deepEqual(await invite('anna@firm.am', { name: '  ' }), {
      ok: false,
      reason: 'name_required',
    });
  });

  test('no rank chosen', async () => {
    assert.deepEqual(await invite('anna@firm.am', { admin: 'yes' }), {
      ok: false,
      reason: 'role_required',
    });
  });
});
