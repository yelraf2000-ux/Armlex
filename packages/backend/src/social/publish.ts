/**
 * The team chat's buttons.
 *
 *   ✅ / ⏭   on a draft: publish it to the Telegram channel, the Facebook Page
 *           and Instagram, or discard it.
 *   🗑       under a post report: ask to delete it everywhere;
 *   Այո / Ոչ on that question: delete, or put the 🗑 back.
 *
 * Only the team chat's taps count — a callback from anyone else is refused.
 */
import { db } from '../db/pool.js';
import { tg, CAPTION_LIMIT } from './bot.js';
import { markOwnPost } from './channel.js';
import { publishFacebook, publishInstagram, type PublishResult } from './meta.js';
import { confirmButtons, deleteButton, removeEverywhere, reportPublished } from './remove.js';

const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'https://matyanai.am';

interface Callback {
  id: string;
  from?: { id?: number };
  data?: string;
  message?: { message_id: number; chat: { id: number }; text?: string };
}

export type Action = 'pub' | 'skip' | 'del' | 'delyes' | 'delno';

/** The action a button carries, if it is one of ours. */
export function readAction(data: string | undefined): { action: Action; draftId: string } | null {
  const m = /^(pub|skip|del|delyes|delno):([0-9a-f-]{36})$/.exec(data ?? '');
  return m ? { action: m[1] as Action, draftId: m[2]! } : null;
}

/** Post the photo and text to the channel. The channel is `TELEGRAM_CHANNEL`. */
async function publishTelegram(body: string, imageUrl: string): Promise<PublishResult> {
  const channel = process.env['TELEGRAM_CHANNEL'];
  if (!channel) return { skipped: 'not_configured' };
  try {
    markOwnPost(body);
    const chat_id = `@${channel.replace(/^@/, '')}`;
    const sent =
      body.length <= CAPTION_LIMIT
        ? await tg<{ message_id: number }>('sendPhoto', { chat_id, photo: imageUrl, caption: body })
        : (await tg('sendPhoto', { chat_id, photo: imageUrl }),
          await tg<{ message_id: number }>('sendMessage', { chat_id, text: body, disable_web_page_preview: true }));
    return { id: String(sent.message_id) };
  } catch (err) {
    return { error: (err as Error).message.slice(0, 300) };
  }
}

export interface Published {
  telegram: PublishResult;
  facebook: PublishResult;
  instagram: PublishResult;
}

/** One post to all three, at once. `imageName` is a file under the media directory. */
export async function publishEverywhere(body: string, imageName: string): Promise<Published> {
  const imageUrl = `${PUBLIC_URL}/media/${imageName}`;
  const [telegram, facebook, instagram] = await Promise.all([
    publishTelegram(body, imageUrl),
    publishFacebook(body, imageUrl),
    publishInstagram(body, imageUrl),
  ]);
  return { telegram, facebook, instagram };
}

const answer = (cb: Callback, text: string): Promise<unknown> =>
  tg('answerCallbackQuery', { callback_query_id: cb.id, text }).catch(() => {});

const setButtons = (cb: Callback, markup: unknown): Promise<unknown> =>
  cb.message
    ? tg('editMessageReplyMarkup', {
        chat_id: cb.message.chat.id,
        message_id: cb.message.message_id,
        reply_markup: markup,
      }).catch(() => {})
    : Promise.resolve();

export async function handleCallback(cb: Callback): Promise<void> {
  const owner = Number(process.env['TELEGRAM_CHAT_ID']);
  const act = readAction(cb.data);
  if (!act) return;
  if (!owner || cb.from?.id !== owner) {
    await answer(cb, 'Թույլատրված չէ');
    return;
  }

  if (act.action === 'del') {
    await answer(cb, 'Հաստատեք ջնջումը');
    await setButtons(cb, confirmButtons(act.draftId));
    return;
  }
  if (act.action === 'delno') {
    await answer(cb, 'Չեղարկված է');
    await setButtons(cb, deleteButton(act.draftId));
    return;
  }
  if (act.action === 'delyes') {
    await answer(cb, 'Ջնջվում է…');
    await setButtons(cb, { inline_keyboard: [] });
    const lines = await removeEverywhere(act.draftId);
    await tg('sendMessage', {
      chat_id: owner,
      text: ['Ջնջում', ...lines].join('\n'),
      disable_web_page_preview: true,
      ...(cb.message ? { reply_to_message_id: cb.message.message_id } : {}),
    }).catch(() => {});
    return;
  }

  // Claim the draft in one statement, so a double tap cannot publish twice.
  const next = act.action === 'pub' ? 'publishing' : 'skipped';
  const rows = await db()<{ body: string; image_name: string }[]>`
    UPDATE social_drafts SET status = ${next}, decided_at = now()
     WHERE id = ${act.draftId} AND status = 'pending'
    RETURNING body, image_name`;
  const draft = rows[0];
  await answer(cb, !draft ? 'Արդեն որոշված է' : act.action === 'pub' ? 'Հրապարակվում է…' : 'Բաց թողնված է');
  // The buttons go either way: a decided draft offers no second decision.
  await setButtons(cb, { inline_keyboard: [] });
  if (!draft || act.action === 'skip') return;

  const result = await publishEverywhere(draft.body, draft.image_name);
  const ok = [result.telegram, result.facebook, result.instagram].some((r) => r.id);
  await db()`
    UPDATE social_drafts
       SET status = ${ok ? 'published' : 'failed'}, results = ${db().json(result as never)}
     WHERE id = ${act.draftId}`;
  await reportPublished(act.draftId, 'Հրապարակվեց', result).catch(() => {});
}
