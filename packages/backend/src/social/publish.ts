/**
 * The approval tap: ✅ publishes a draft to the Telegram channel, the Facebook
 * Page and Instagram; ⏭ discards it. Only the team chat's buttons count — a
 * callback from anyone else is refused.
 */
import { db } from '../db/pool.js';
import { tg, CAPTION_LIMIT } from './bot.js';
import { describe, markOwnPost } from './channel.js';
import { publishFacebook, publishInstagram, type PublishResult } from './meta.js';

const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'https://matyanai.am';

interface Callback {
  id: string;
  from?: { id?: number };
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}

/** The action a button carries, if it is one of ours. */
export function readAction(data: string | undefined): { action: 'pub' | 'skip'; draftId: string } | null {
  const m = /^(pub|skip):([0-9a-f-]{36})$/.exec(data ?? '');
  return m ? { action: m[1] as 'pub' | 'skip', draftId: m[2]! } : null;
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

export async function handleCallback(cb: Callback): Promise<void> {
  const owner = Number(process.env['TELEGRAM_CHAT_ID']);
  const act = readAction(cb.data);
  if (!act) return;
  if (!owner || cb.from?.id !== owner) {
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Թույլատրված չէ' }).catch(() => {});
    return;
  }

  // Claim the draft in one statement, so a double tap cannot publish twice.
  const next = act.action === 'pub' ? 'publishing' : 'skipped';
  const rows = await db()<{ body: string; image_name: string }[]>`
    UPDATE social_drafts SET status = ${next}, decided_at = now()
     WHERE id = ${act.draftId} AND status = 'pending'
    RETURNING body, image_name`;
  const draft = rows[0];
  await tg('answerCallbackQuery', {
    callback_query_id: cb.id,
    text: !draft ? 'Արդեն որոշված է' : act.action === 'pub' ? 'Հրապարակվում է…' : 'Բաց թողնված է',
  }).catch(() => {});
  // The buttons go either way: a decided draft offers no second decision.
  if (cb.message) {
    await tg('editMessageReplyMarkup', {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
  }
  if (!draft || act.action === 'skip') return;

  const imageUrl = `${PUBLIC_URL}/media/${draft.image_name}`;
  const [telegram, facebook, instagram] = await Promise.all([
    publishTelegram(draft.body, imageUrl),
    publishFacebook(draft.body, imageUrl),
    publishInstagram(draft.body, imageUrl),
  ]);
  const ok = [telegram, facebook, instagram].some((r) => r.id);
  await db()`
    UPDATE social_drafts
       SET status = ${ok ? 'published' : 'failed'},
           results = ${db().json({ telegram, facebook, instagram } as never)}
     WHERE id = ${act.draftId}`;
  await tg('sendMessage', {
    chat_id: owner,
    text: ['Հրապարակում', describe('Telegram', telegram), describe('Facebook', facebook), describe('Instagram', instagram)].join('\n'),
    ...(cb.message ? { reply_to_message_id: cb.message.message_id } : {}),
  }).catch(() => {});
}
