/**
 * Reposting: a post in the Telegram channel goes out to the Facebook Page and
 * Instagram, and the bot reports how it went.
 *
 * The bot is an admin of the channel, so Telegram delivers each new post to
 * our webhook as a `channel_post` update. Which channel is ours comes from
 * `TELEGRAM_CHANNEL` (its username, e.g. matyanAI_channel); posts from anywhere
 * else are ignored.
 *
 * First version, on purpose: text and ONE photo. An album reposts its first
 * photo; video, edits and deletions are not carried over.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../db/pool.js';
import { sendToTeam } from '../contact/telegram.js';
import { publishFacebook, publishInstagram, type PublishResult } from './meta.js';

export const MEDIA_DIR = process.env['SOCIAL_MEDIA_DIR'] ?? join(process.cwd(), 'media');
const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'https://matyanai.am';

export interface ChannelPost {
  chatId: number;
  messageId: number;
  text: string;
  /** The largest size Telegram offers of the post's photo, if it has one. */
  photoFileId: string | null;
  mediaGroupId: string | null;
}

interface TgPhotoSize {
  file_id: string;
  width: number;
  height: number;
}

/** The post, if this update is a new post in OUR channel. */
export function readChannelPost(update: unknown, channel: string | undefined): ChannelPost | null {
  const post = (update as { channel_post?: Record<string, unknown> } | null)?.channel_post;
  if (!post || !channel) return null;
  const chat = post['chat'] as { id?: number; username?: string; type?: string } | undefined;
  if (chat?.type !== 'channel' || !chat.username) return null;
  if (chat.username.toLowerCase() !== channel.replace(/^@/, '').toLowerCase()) return null;

  const photos = (post['photo'] as TgPhotoSize[] | undefined) ?? [];
  const largest = photos.reduce<TgPhotoSize | null>(
    (best, p) => (!best || p.width * p.height > best.width * best.height ? p : best),
    null,
  );
  const text = String(post['text'] ?? post['caption'] ?? '').trim();
  return {
    chatId: Number(chat.id),
    messageId: Number(post['message_id']),
    text,
    photoFileId: largest?.file_id ?? null,
    mediaGroupId: typeof post['media_group_id'] === 'string' ? post['media_group_id'] : null,
  };
}

/** A line per platform for the bot's report. */
export function describe(platform: string, r: PublishResult): string {
  if (r.id) return `${platform}: ✅`;
  if (r.skipped === 'no_image') return `${platform}: — առանց նկարի չի հրապարակվում`;
  if (r.skipped === 'not_configured') return `${platform}: — դեռ միացված չէ`;
  return `${platform}: ❌ ${r.error ?? 'անհայտ սխալ'}`;
}

/** Fetch the photo from Telegram and keep it where Meta can download it. */
async function savePhoto(fileId: string): Promise<string> {
  const token = process.env['TELEGRAM_BOT_TOKEN'] ?? '';
  const meta = (await (
    await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`, {
      signal: AbortSignal.timeout(20_000),
    })
  ).json()) as { ok?: boolean; result?: { file_path?: string } };
  const path = meta.result?.file_path;
  if (!meta.ok || !path) throw new Error('getFile failed');
  const file = await fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!file.ok) throw new Error(`photo download failed: HTTP ${file.status}`);
  // Telegram re-encodes every photo it sends as JPEG — the only format
  // Instagram's API accepts.
  const name = `${randomUUID()}.jpg`;
  await mkdir(MEDIA_DIR, { recursive: true });
  await writeFile(join(MEDIA_DIR, name), Buffer.from(await file.arrayBuffer()));
  return name;
}

/** Store, repost, report. Never throws: the webhook has already answered. */
export async function handleChannelPost(post: ChannelPost): Promise<void> {
  try {
    // A photo of an album we already handled: the first photo speaks for it.
    if (post.mediaGroupId) {
      const seen = await db()`
        SELECT 1 FROM social_posts WHERE tg_chat_id = ${post.chatId} AND tg_media_group = ${post.mediaGroupId}`;
      if (seen.length > 0) return;
    }
    const rows = await db()<{ id: string }[]>`
      INSERT INTO social_posts (tg_chat_id, tg_message_id, tg_media_group, text)
      VALUES (${post.chatId}, ${post.messageId}, ${post.mediaGroupId}, ${post.text})
      ON CONFLICT (tg_chat_id, tg_message_id) DO NOTHING
      RETURNING id`;
    const id = rows[0]?.id;
    if (!id) return; // a retried delivery of a post already handled

    let imageUrl: string | null = null;
    let photoNote: string | null = null;
    if (post.photoFileId) {
      try {
        const name = await savePhoto(post.photoFileId);
        await db()`UPDATE social_posts SET image_name = ${name} WHERE id = ${id}`;
        imageUrl = `${PUBLIC_URL}/media/${name}`;
      } catch (err) {
        photoNote = `Նկարը չհաջողվեց բեռնել (${(err as Error).message})՝ հրապարակվում է միայն տեքստը։`;
      }
    }

    if (!post.text && !imageUrl) return; // nothing to repost (e.g. a video alone)

    const [fb, ig] = await Promise.all([
      publishFacebook(post.text, imageUrl),
      publishInstagram(post.text, imageUrl),
    ]);
    await db()`
      UPDATE social_posts
         SET fb_post_id = ${fb.id ?? null}, fb_error = ${fb.error ?? null},
             ig_media_id = ${ig.id ?? null}, ig_error = ${ig.error ?? null}
       WHERE id = ${id}`;

    await sendToTeam(
      [
        'Ալիքի նոր գրառում',
        describe('Facebook', fb),
        describe('Instagram', ig),
        post.mediaGroupId ? 'Ալբոմից հրապարակվում է միայն առաջին նկարը։' : null,
        photoNote,
      ]
        .filter(Boolean)
        .join('\n'),
    );
  } catch (err) {
    console.error(`[social] repost failed: ${(err as Error).message}`);
    await sendToTeam(`Ալիքի գրառումը չհաջողվեց վերահրապարակել՝ ${(err as Error).message}`);
  }
}
