/**
 * Channel-post parsing and the bot's report lines.
 *
 * Run: npx tsx --test packages/backend/src/social/channel.test.ts
 */
import { test, describe as suite } from 'node:test';
import assert from 'node:assert/strict';
import { describe, readChannelPost } from './channel.js';
import { publishInstagram } from './meta.js';

const post = (extra: Record<string, unknown>, chat: Record<string, unknown> = {}) => ({
  update_id: 1,
  channel_post: {
    message_id: 42,
    chat: { id: -100123, type: 'channel', username: 'matyanAI_channel', ...chat },
    ...extra,
  },
});

suite('readChannelPost', () => {
  test('reads a text post from our channel, whatever the case of the name', () => {
    const p = readChannelPost(post({ text: ' Նոր փոփոխություն ' }), '@matyanai_channel');
    assert.deepEqual(p, { chatId: -100123, messageId: 42, text: 'Նոր փոփոխություն', photoFileId: null, mediaGroupId: null });
  });

  test('takes the caption and the largest photo size', () => {
    const p = readChannelPost(
      post({
        caption: 'Նկարով',
        photo: [
          { file_id: 'small', width: 90, height: 90 },
          { file_id: 'large', width: 1280, height: 1600 },
          { file_id: 'mid', width: 320, height: 400 },
        ],
        media_group_id: 'g1',
      }),
      'matyanAI_channel',
    );
    assert.equal(p?.text, 'Նկարով');
    assert.equal(p?.photoFileId, 'large');
    assert.equal(p?.mediaGroupId, 'g1');
  });

  test('ignores other channels, private messages and unconfigured setups', () => {
    assert.equal(readChannelPost(post({ text: 'x' }, { username: 'someone_else' }), 'matyanAI_channel'), null);
    assert.equal(readChannelPost({ message: { text: 'hi', chat: { type: 'private' } } }, 'matyanAI_channel'), null);
    assert.equal(readChannelPost(post({ text: 'x' }), undefined), null);
    assert.equal(readChannelPost(null, 'matyanAI_channel'), null);
  });
});

suite('report lines', () => {
  test('say what happened on each platform', () => {
    assert.equal(describe('Facebook', { id: '1' }), 'Facebook: ✅');
    assert.match(describe('Instagram', { skipped: 'no_image' }), /առանց նկարի/);
    assert.match(describe('Instagram', { skipped: 'not_configured' }), /միացված չէ/);
    assert.equal(describe('Facebook', { error: 'Invalid token (190)' }), 'Facebook: ❌ Invalid token (190)');
  });

  test('Instagram without Meta settings is skipped, not attempted', async () => {
    delete process.env['META_IG_USER_ID'];
    assert.deepEqual(await publishInstagram('x', 'https://example.invalid/a.jpg'), { skipped: 'not_configured' });
  });
});
