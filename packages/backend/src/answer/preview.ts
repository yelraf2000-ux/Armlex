/**
 * The answer a visitor sees before they have an account.
 *
 * A stranger types a real question, gets a real answer to the first part of it,
 * and the rest is withheld behind registration. Two rules keep that honest
 * rather than a bait:
 *
 *   1. The visible part is a TRUE answer, generated from retrieved law like any
 *      other. Nothing is fabricated to make the withheld half look valuable.
 *   2. What is withheld is the APPARATUS — the articles, the verbatim quotes,
 *      the application to their situation. Which is the right cut commercially
 *      as well as ethically: the citations are the product, and showing the
 *      conclusion without them is exactly the difference between this tool and
 *      a chatbot guess.
 *
 * Generated with the CHEAP model. A preview costs about $0.012 against Sonnet's
 * $0.10, and this endpoint is open to anyone on the internet — the economics
 * only work at the cheap end. The full answer is regenerated properly once the
 * visitor has an account.
 */
import { createHash } from 'node:crypto';
import { contextualize } from './contextualize.js';
import { generate } from './llm.js';
import { SYSTEM } from './chat.js';
import { CoverageParser } from './coverage.js';
import { answerLanguage } from './language.js';
import { validateQuotes } from './validateQuotes.js';
import { retrieve } from '../retrieval/retrieve.js';
import { generationDocument } from '../retrieval/rerank.js';
import { db } from '../db/pool.js';

/** Cheap and fast; a preview needs to be true, not eloquent. */
export const PREVIEW_MODEL = 'gemini-3.5-flash-lite';

/**
 * How much of the answer is shown.
 *
 * A share of the text rather than a fixed number of characters, because
 * Armenian answers vary from 800 to 4,000 characters and a fixed cut either
 * gives away a short answer entirely or shows one sentence of a long one.
 */
const SHOW_SHARE = 0.38;
/** Never withhold so little that registering buys nothing. */
const MAX_SHOWN = 900;
/** Never show so little that the visitor cannot tell whether it answered them. */
const MIN_SHOWN = 220;

/**
 * Cut the answer at a paragraph boundary inside the target range.
 *
 * Cutting mid-sentence reads as a bug rather than a deliberate withholding, and
 * a visitor who thinks the tool broke does not register. Falls back to a
 * sentence end, then to the raw offset.
 */
export function splitAnswer(answer: string): { shown: string; withheld: number } {
  const text = answer.trim();
  if (text.length <= MIN_SHOWN * 1.4) return { shown: text, withheld: 0 };

  const target = Math.min(MAX_SHOWN, Math.max(MIN_SHOWN, Math.floor(text.length * SHOW_SHARE)));

  /**
   * Every place the text could be cut without breaking a sentence.
   *
   * Both directions are considered, and the one CLOSEST to the target wins.
   * Searching only backwards — the first version — reliably landed a whole
   * paragraph short, because the nearest clean break is as often just past the
   * target as just before it.
   */
  const stops: number[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '\n' && text[i + 1] === '\n') stops.push(i);
  }
  const paragraphStops = stops.length > 0;
  if (!paragraphStops) {
    // No paragraphs: fall back to sentence ends. `։` is the Armenian full stop.
    for (let i = 0; i < text.length - 1; i++) {
      if (text[i] === '։' || (text[i] === '.' && (text[i + 1] === ' ' || text[i + 1] === '\n'))) {
        stops.push(i + 1);
      }
    }
  }

  // Only stops that leave a real teaser AND withhold something worth having.
  const usable = stops.filter((s) => s >= MIN_SHOWN * 0.8 && s < text.length * 0.8);
  if (usable.length === 0) return { shown: text.slice(0, target).trim(), withheld: text.length - target };

  const cut = usable.reduce((best, s) =>
    Math.abs(s - target) < Math.abs(best - target) ? s : best,
  );
  return { shown: text.slice(0, cut).trim(), withheld: text.length - cut };
}

export interface Preview {
  id: string;
  shown: string;
  /** Characters withheld — the UI uses it to size the blurred area honestly. */
  withheld: number;
  /** How many articles the answer rests on. Shown as a count, never listed. */
  sources: number;
  coverage: string | null;
}

/** Truncated, so the address itself is never stored. */
export function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export async function generatePreview(question: string, ip: string): Promise<Preview> {
  const ctx = await contextualize([], question);
  const query = [ctx.standaloneQuery, ctx.searchTerms].filter(Boolean).join(' ');
  const chunks = ctx.needsRetrieval ? await retrieve(query, 4) : [];

  const lang = answerLanguage(question) === 'ru' ? 'RUSSIAN' : 'ARMENIAN';
  const user = [
    `User message: ${question}`,
    `\n\nANSWER LANGUAGE: ${lang}.`,
    `\n\nLegal act fragments:\n\n${chunks.map((c) => generationDocument(c)).join('\n\n---\n\n')}`,
  ].join('');

  const cov = new CoverageParser();
  let answer = '';
  await generate(
    { system: SYSTEM, history: [], user, onText: (d) => { answer += cov.feed(d); } },
    PREVIEW_MODEL,
  );
  answer += cov.flush();

  // The same verbatim check as everywhere else. A preview is still law shown to
  // a member of the public, and the guard does not get to be weaker because the
  // reader has not registered yet.
  const checked = validateQuotes(answer, chunks.map((c) => generationDocument(c)));
  const { shown, withheld } = splitAnswer(checked.sanitized);

  const rows = await db()<{ id: string }[]>`
    INSERT INTO previews (question, shown, full_length, model, ip_hash)
    VALUES (${question}, ${shown}, ${checked.sanitized.length}, ${PREVIEW_MODEL}, ${hashIp(ip)})
    RETURNING id`;

  return {
    id: rows[0]!.id,
    shown,
    withheld,
    sources: chunks.length,
    coverage: cov.coverage,
  };
}

/**
 * Attribute a registration to the preview that led to it.
 *
 * Best-effort: a visitor who clears their storage between the preview and the
 * signup is simply not counted, and a wrong id is ignored rather than failing
 * the registration — nobody should be unable to create an account because an
 * analytics row would not link.
 */
export async function markConverted(previewId: string, userId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(previewId)) return;
  try {
    await db()`
      UPDATE previews SET converted_user_id = ${userId}, converted_at = now()
       WHERE id = ${previewId} AND converted_user_id IS NULL`;
  } catch {
    // Deliberately swallowed; see above.
  }
}
