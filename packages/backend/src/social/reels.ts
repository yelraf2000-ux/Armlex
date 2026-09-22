/**
 * One automatic reel: take a ready 9:16 video, burn a short hook line onto it,
 * and publish it as a Reel on Instagram and Facebook and as a video in the
 * Telegram channel.
 *
 * The videos are made elsewhere (marketing/video, deliberately untracked) and
 * copied to `media/reels` on the server. This file only picks the next one,
 * adds the hook, publishes, and reports — the videos themselves are never
 * generated here.
 *
 * Off unless SOCIAL_AUTOPUBLISH=on. Manual run (`--dry`: to the team chat only):
 *   npx tsx packages/backend/src/social/reels.ts [file.mp4] [--dry]
 */
import 'dotenv/config';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Resvg } from '@resvg/resvg-js';
import { db } from '../db/pool.js';
import { sendToTeam } from '../contact/telegram.js';
import { tg } from './bot.js';
import { MEDIA_DIR } from './channel.js';
import { FAMILY, FONTS, escape, wrap } from './card.js';
import { publishFacebookReel, publishInstagramReel, type PublishResult } from './meta.js';
import { promoBody } from './autopost.js';
import { reportPublished } from './remove.js';

const run = promisify(execFile);
export const REELS_DIR = join(MEDIA_DIR, 'reels');
const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'https://matyanai.am';

/**
 * The hook burned onto the video's first frames — short, true, and never a
 * claim: the claims live in the caption, which is held to `facts.ts`.
 */
export const HOOKS = [
  'Ծանո՞թ իրավիճակ է',
  'Հաշվապահի ամենօրյա խնդիրը',
  'Ամեն գրասենյակում լինում է',
  'Ճանաչո՞ւմ եք ձեզ',
  'Ամեն շաբաթ նույնն է',
  'Սա ծանոթ է բոլորին',
];

/**
 * The hook as a transparent 1080×1920 overlay.
 *
 * ONE short line in a slim band near the top: the videos carry their own title
 * from about y=280 down, and a two-line band covered it — seen on the first
 * rehearsal. Instagram's own controls take roughly the top 120 and bottom 350
 * pixels, so the band sits between them.
 */
export function hookOverlay(text: string): Buffer {
  const line = wrap(text, 880, 52, true, 1)[0] ?? text;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <rect x="120" y="126" width="840" height="104" rx="52" fill="#0f172a" opacity="0.74"/>
  <text x="540" y="194" font-family="${FAMILY}" font-size="52" font-weight="700" fill="#ffffff" text-anchor="middle">${escape(line)}</text>
</svg>`;
  return Buffer.from(
    new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: FAMILY } })
      .render()
      .asPng(),
  );
}

/**
 * Burn the hook on. Re-encoded once with a fast preset: Meta re-encodes
 * everything anyway, so quality beyond this buys nothing.
 */
export async function burnHook(videoPath: string, hook: string): Promise<string> {
  const overlay = join(MEDIA_DIR, `${randomUUID()}.png`);
  await writeFile(overlay, hookOverlay(hook));
  const out = `${randomUUID()}.mp4`;
  try {
    await run(
      'ffmpeg',
      [
        '-y',
        '-i', videoPath,
        '-i', overlay,
        '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto[v]',
        '-map', '[v]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        join(MEDIA_DIR, out),
      ],
      { maxBuffer: 16 * 1024 * 1024 },
    );
  } finally {
    await unlink(overlay).catch(() => {});
  }
  return out;
}

/** The next video: one not used in the last 30 reels, else the oldest choice. */
export async function pickVideo(used: string[]): Promise<string | null> {
  const files = (await readdir(REELS_DIR).catch(() => []))
    .filter((f) => f.toLowerCase().endsWith('.mp4'))
    .sort();
  if (files.length === 0) return null;
  const fresh = files.filter((f) => !used.includes(`auto:reel:${f}`));
  const pool = fresh.length ? fresh : files;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

const REEL_BRIEF =
  'Write the caption for a short video ad about an everyday problem of an accountant. Two short paragraphs: the situation, then how MatyanAI helps. Only the facts. No hashtags.';

export async function autoreel(file?: string, dry = false): Promise<void> {
  const used = (
    await db()<{ topic: string }[]>`
      SELECT topic FROM social_drafts
       WHERE topic LIKE 'auto:reel:%' AND status IN ('published', 'deleted')
       ORDER BY created_at DESC LIMIT 30`
  ).map((r) => r.topic);
  const video = file ?? (await pickVideo(used));
  if (!video) {
    await sendToTeam('Ռիլս չհրապարակվեց՝ media/reels-ում տեսանյութ չկա։');
    return;
  }

  const hook = HOOKS[Math.floor(Math.random() * HOOKS.length)]!;
  const withHook = await burnHook(join(REELS_DIR, video), hook);
  const videoUrl = `${PUBLIC_URL}/media/${withHook}`;

  const caption = (await promoBody(REEL_BRIEF)) ?? null;
  if (!caption) {
    await unlink(join(MEDIA_DIR, withHook)).catch(() => {});
    await sendToTeam('Ռիլս չհրապարակվեց՝ տեքստը չանցավ ստուգումները։');
    return;
  }
  const body = `${caption}\n\nՓորձեք անվճար՝ matyanai.am`;

  if (dry) {
    await tg('sendVideo', {
      chat_id: process.env['TELEGRAM_CHAT_ID'],
      video: videoUrl,
      caption: `ՓՈՐՁ (չի հրապարակվել)՝ ${video}\n\n${body}`.slice(0, 1024),
    });
    console.log(`dry run: reel ${video} sent to the team chat`);
    return;
  }

  const rows = await db()<{ id: string }[]>`
    INSERT INTO social_drafts (topic, headline, subline, body, source_label, source_url, image_name, model, status, decided_at)
    VALUES (${`auto:reel:${video}`}, ${hook}, '', ${body}, 'reel', ${videoUrl}, ${withHook}, 'gemini+video', 'publishing', now())
    RETURNING id`;
  const id = rows[0]!.id;

  const channel = process.env['TELEGRAM_CHANNEL']?.replace(/^@/, '');
  const telegram: PublishResult = channel
    ? await tg<{ message_id: number }>('sendVideo', {
        chat_id: `@${channel}`,
        video: videoUrl,
        caption: body.slice(0, 1024),
        supports_streaming: true,
      })
        .then((sent) => ({ id: String(sent.message_id) }))
        .catch((err: Error) => ({ error: err.message.slice(0, 300) }))
    : { skipped: 'not_configured' };
  const [facebook, instagram] = await Promise.all([
    publishFacebookReel(videoUrl, body),
    publishInstagramReel(videoUrl, body),
  ]);

  const result = { telegram, facebook, instagram };
  const ok = [telegram, facebook, instagram].some((r) => r.id);
  await db()`
    UPDATE social_drafts SET status = ${ok ? 'published' : 'failed'}, results = ${db().json(result as never)}
     WHERE id = ${id}`;
  await reportPublished(id, `Ռիլս (${video})`, result);
}

if (process.argv[1]?.endsWith('reels.ts')) {
  const dry = process.argv.includes('--dry');
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!dry && process.env['SOCIAL_AUTOPUBLISH'] !== 'on') {
    console.log('SOCIAL_AUTOPUBLISH is not "on" — nothing posted');
    process.exit(0);
  }
  autoreel(file, dry)
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err);
      await sendToTeam(`Ռիլսը ձախողվեց՝ ${(err as Error).message}`).catch(() => {});
      process.exit(1);
    });
}
