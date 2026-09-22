/**
 * The post report in the team chat, and its 🗑 button: delete a published post
 * from the Telegram channel, the Facebook Page and Instagram in one go.
 *
 * Two taps, on purpose — 🗑 asks, «Այո» deletes — because deletion cannot be
 * undone and the button sits under every report.
 *
 * Limits of the platforms, not of this code: Telegram lets a bot delete its
 * channel posts only within 48 hours; Instagram deletion needs the
 * `instagram_manage_contents` permission on the token, and without it the
 * report says so and gives the link to delete by hand.
 */
import { db } from '../db/pool.js';
import { tg } from './bot.js';
import type { Published } from './publish.js';

const GRAPH = 'https://graph.facebook.com/v25.0';

export const deleteButton = (draftId: string) => ({
  inline_keyboard: [[{ text: '🗑 Ջնջել ամենուր', callback_data: `del:${draftId}` }]],
});

export const confirmButtons = (draftId: string) => ({
  inline_keyboard: [
    [
      { text: '✅ Այո, ջնջել ամենուր', callback_data: `delyes:${draftId}` },
      { text: 'Ոչ', callback_data: `delno:${draftId}` },
    ],
  ],
});

async function instagramLink(mediaId: string): Promise<string> {
  try {
    const r = await fetch(`${GRAPH}/${mediaId}?fields=permalink&access_token=${process.env['META_PAGE_TOKEN']}`);
    const j = (await r.json()) as { permalink?: string };
    return j.permalink ?? mediaId;
  } catch {
    return mediaId;
  }
}

/** One line per platform: the link, or why it did not go out. */
export async function linkLines(p: Published): Promise<string[]> {
  const channel = process.env['TELEGRAM_CHANNEL']?.replace(/^@/, '');
  const lines: string[] = [];
  lines.push(
    p.telegram.id && channel ? `Telegram: https://t.me/${channel}/${p.telegram.id}` : `Telegram: ❌ ${p.telegram.error ?? p.telegram.skipped}`,
  );
  lines.push(p.facebook.id ? `Facebook: https://www.facebook.com/${p.facebook.id}` : `Facebook: ❌ ${p.facebook.error ?? p.facebook.skipped}`);
  lines.push(
    p.instagram.id ? `Instagram: ${await instagramLink(p.instagram.id)}` : `Instagram: ❌ ${p.instagram.error ?? p.instagram.skipped}`,
  );
  // Stories carry no link of their own and disappear after 24 hours, so they
  // are reported as done or not done, not as an address.
  const story = (name: string, r: Published['facebookStory']): string =>
    !r ? `${name} story: —` : r.id ? `${name} story: ✅` : `${name} story: ❌ ${r.error ?? r.skipped}`;
  lines.push(story('Facebook', p.facebookStory), story('Instagram', p.instagramStory));
  return lines;
}

/** Tell the team chat what went out, with the 🗑 button under it. */
export async function reportPublished(draftId: string, title: string, p: Published): Promise<void> {
  const chat = process.env['TELEGRAM_CHAT_ID'];
  if (!chat) return;
  await tg('sendMessage', {
    chat_id: chat,
    text: [title, ...(await linkLines(p))].join('\n'),
    disable_web_page_preview: true,
    reply_markup: deleteButton(draftId),
  });
}

async function graphDelete(id: string): Promise<string | null> {
  const res = await fetch(`${GRAPH}/${id}?access_token=${encodeURIComponent(process.env['META_PAGE_TOKEN'] ?? '')}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string } };
  return j.success ? null : (j.error?.message ?? `HTTP ${res.status}`);
}

/** Delete a published post everywhere; one line per platform on what happened. */
export async function removeEverywhere(draftId: string): Promise<string[]> {
  const rows = await db()<{ status: string; results: Published | null }[]>`
    SELECT status, results FROM social_drafts WHERE id = ${draftId}`;
  const draft = rows[0];
  if (!draft) return ['Գրառումը չի գտնվել։'];
  if (draft.status === 'deleted') return ['Արդեն ջնջված է։'];
  const r = draft.results;
  const lines: string[] = [];

  const channel = process.env['TELEGRAM_CHANNEL']?.replace(/^@/, '');
  if (r?.telegram?.id && channel) {
    try {
      await tg('deleteMessage', { chat_id: `@${channel}`, message_id: Number(r.telegram.id) });
      lines.push('Telegram: ✅ ջնջված');
    } catch (err) {
      lines.push(`Telegram: ❌ ${(err as Error).message} (48 ժամից հին գրառումները ջնջեք ձեռքով)`);
    }
  }
  if (r?.facebook?.id) {
    const e = await graphDelete(r.facebook.id);
    lines.push(e ? `Facebook: ❌ ${e}` : 'Facebook: ✅ ջնջված');
  }
  if (r?.instagram?.id) {
    const link = await instagramLink(r.instagram.id);
    const e = await graphDelete(r.instagram.id);
    lines.push(e ? `Instagram: ❌ ջնջեք ձեռքով՝ ${link} (${e})` : 'Instagram: ✅ ջնջված');
  }

  await db()`UPDATE social_drafts SET status = 'deleted' WHERE id = ${draftId}`;
  return lines.length ? lines : ['Հրապարակված պատճեններ չկան։'];
}
