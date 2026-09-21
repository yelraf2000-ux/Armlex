/**
 * The model drafts a post; a person approves it.
 *
 * Grounded like an answer: the topic is retrieved against the corpus and the
 * model writes ONLY from those fragments. The source line and the ARLIS link
 * are added by code from the fragment itself, never written by the model, and
 * every number is checked against the law (`validateNumbers`) — a draft whose
 * legal-looking numbers are not in the source is refused, not sent.
 *
 * Nothing here publishes. The draft goes to the team chat with Publish / Skip
 * buttons (publish.ts).
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { generate } from '../answer/llm.js';
import { validateNumbers } from '../answer/validateNumbers.js';
import { retrieve, type RetrievedChunk } from '../retrieval/retrieve.js';
import { loadGoldenSet } from '../eval/goldenSet.js';
import { db } from '../db/pool.js';
import { actTitle } from './titles.js';
import { renderCard } from './card.js';
import { MEDIA_DIR } from './channel.js';
import { tg, CAPTION_LIMIT } from './bot.js';

export const DRAFT_MODEL = process.env['SOCIAL_MODEL'] ?? 'gemini-3.5-flash';
const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'https://matyanai.am';

const SYSTEM = `You write one social-media post, in Armenian, for accountants and tax specialists in Armenia, for the page of MatyanAI — a tool that answers tax and labour-law questions from the text of Armenian law.

Rules, all mandatory:
1. Use ONLY the legal fragments given. Every rate, amount, threshold, deadline and condition must appear in them. If the fragments do not support a useful post on the topic, reply with {"skip": "reason"}.
2. Never invent numbers, dates or article numbers. Do not cite articles in the text — the source line is added separately.
3. One practical point per post, stated plainly, as a professional would say it to a colleague. No advice ("you should"), no promises, no emojis except at most one at the start.
4. Armenian, correct spelling and punctuation (։ at sentence end).
5. Reply with JSON only, no code fences:
{"headline": "...", "subline": "...", "body": "...", "sourceIndex": N}
- headline: the key fact, at most 60 characters.
- subline: one sentence explaining it, at most 170 characters.
- body: the post, 350-800 characters, 2-4 short paragraphs, ending with a question that invites comments. No hashtags, no links, no source line.
- sourceIndex: the number of the fragment the post mainly rests on.`;

export interface DraftFields {
  headline: string;
  subline: string;
  body: string;
  sourceIndex: number;
}

/** The model's reply as fields, or why not. Tolerates code fences and prose around the JSON. */
export function parseDraft(reply: string): DraftFields | { skip: string } {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start === -1 || end <= start) return { skip: 'no JSON in the reply' };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return { skip: 'unreadable JSON' };
  }
  if (typeof json['skip'] === 'string') return { skip: json['skip'] };
  const s = (k: string): string => (typeof json[k] === 'string' ? (json[k] as string).trim() : '');
  const fields = { headline: s('headline'), subline: s('subline'), body: s('body'), sourceIndex: Number(json['sourceIndex']) };
  if (!fields.headline || !fields.subline || !fields.body || !Number.isInteger(fields.sourceIndex)) {
    return { skip: 'missing fields' };
  }
  return fields;
}

/** «Հոդված 258» from a chunk ref like «Հոդված 258» or «Հավելված 1, կետ 5». */
export function sourceLabel(chunk: Pick<RetrievedChunk, 'documentTitle' | 'ref'>): string {
  return `${actTitle(chunk.documentTitle)} · ${chunk.ref}`;
}

/** The ARLIS address printed in the chunk's own header. */
export function sourceUrl(chunk: Pick<RetrievedChunk, 'text' | 'arlisId'>): string {
  return chunk.text.match(/\[Source\]\s*(\S+)/)?.[1] ?? `https://www.arlis.am/hy/acts/${chunk.arlisId}/latest`;
}

/** The post as published: the model's text, then the source and link added here. */
export function composeBody(body: string, label: string, url: string): string {
  return `${body}\n\nԱղբյուր՝ ${label}\n${url}\n\nՀարցրեք MatyanAI-ին՝ matyanai.am`;
}

/** A topic not used in the last 60 drafts: a hand-verified golden-set question. */
async function pickTopic(): Promise<string> {
  const golden = [...(await loadGoldenSet()).keys()];
  const used = new Set(
    (await db()<{ topic: string }[]>`SELECT topic FROM social_drafts ORDER BY created_at DESC LIMIT 60`).map(
      (r) => r.topic,
    ),
  );
  const fresh = golden.filter((q) => !used.has(q));
  const pool = fresh.length > 0 ? fresh : golden;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export interface Draft {
  id: string;
  body: string;
  imageName: string;
  warnings: string | null;
}

/**
 * Draft one post, render its card, store it, and send it for approval.
 * Tries twice: a draft refused by the number check is regenerated once.
 */
export async function createDraft(topic?: string): Promise<Draft | { skipped: string }> {
  const subject = topic ?? (await pickTopic());
  const chunks = (await retrieve(subject, 4)).slice(0, 4);
  if (chunks.length === 0) return { skipped: 'nothing retrieved for the topic' };

  const fragments = chunks
    .map((c, i) => `[${i + 1}] ${actTitle(c.documentTitle)} — ${c.ref}\n${c.text.slice(0, 6000)}`)
    .join('\n\n---\n\n');

  let lastReason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let reply = '';
    await generate(
      {
        system: SYSTEM,
        history: [],
        user: `Topic: ${subject}\n\nLegal fragments:\n\n${fragments}`,
        onText: (d) => {
          reply += d;
        },
      },
      DRAFT_MODEL,
    );
    const parsed = parseDraft(reply);
    if ('skip' in parsed) {
      lastReason = parsed.skip;
      continue;
    }
    const source = chunks[parsed.sourceIndex - 1] ?? chunks[0]!;
    const texts = chunks.map((c) => c.text);
    const numbers = validateNumbers(
      `${parsed.headline}\n${parsed.subline}\n${parsed.body}`,
      texts,
      [],
      chunks.map((c) => c.ref),
    );
    if (numbers.legalCount > 0) {
      lastReason = `numbers not in the law: ${numbers.checks.filter((c) => !c.valid && c.severity === 'legal').map((c) => c.text).join(', ')}`;
      continue;
    }
    const warnings =
      numbers.otherCount > 0
        ? `Ստուգեք թվերը՝ ${numbers.checks.filter((c) => !c.valid).map((c) => c.text).join(', ')}`
        : null;

    const label = sourceLabel(source);
    const url = sourceUrl(source);
    const body = composeBody(parsed.body, label, url);

    const imageName = `${randomUUID()}.jpg`;
    await mkdir(MEDIA_DIR, { recursive: true });
    await writeFile(join(MEDIA_DIR, imageName), renderCard({ headline: parsed.headline, subline: parsed.subline, source: label }));

    const rows = await db()<{ id: string }[]>`
      INSERT INTO social_drafts (topic, headline, subline, body, source_label, source_url, image_name, warnings, model)
      VALUES (${subject}, ${parsed.headline}, ${parsed.subline}, ${body}, ${label}, ${url}, ${imageName}, ${warnings}, ${DRAFT_MODEL})
      RETURNING id`;
    const draft = { id: rows[0]!.id, body, imageName, warnings };
    await sendForApproval(draft);
    return draft;
  }
  return { skipped: lastReason || 'the model declined the topic' };
}

/** The draft, its card and the two buttons, in the team chat. */
export async function sendForApproval(d: Draft): Promise<void> {
  const chat = process.env['TELEGRAM_CHAT_ID'];
  if (!chat) throw new Error('TELEGRAM_CHAT_ID is not set');
  const buttons = {
    inline_keyboard: [
      [
        { text: '✅ Հրապարակել', callback_data: `pub:${d.id}` },
        { text: '⏭ Բաց թողնել', callback_data: `skip:${d.id}` },
      ],
    ],
  };
  const note = d.warnings ? `⚠️ ${d.warnings}\n\n` : '';
  const caption = `${note}${d.body}`;
  const photo = `${PUBLIC_URL}/media/${d.imageName}`;
  if (caption.length <= CAPTION_LIMIT) {
    await tg('sendPhoto', { chat_id: chat, photo, caption, reply_markup: buttons });
  } else {
    await tg('sendPhoto', { chat_id: chat, photo });
    await tg('sendMessage', { chat_id: chat, text: caption, reply_markup: buttons, disable_web_page_preview: true });
  }
}
