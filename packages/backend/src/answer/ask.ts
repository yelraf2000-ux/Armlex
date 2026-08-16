/**
 * Grounded answer generation, one-shot (no history). See chat.ts for the
 * multi-turn path.
 *
 * Deliberately minimal: no contextualiser and no confidence gate — those are
 * milestone 7. What IS enforced is the grounding contract, because a legal
 * answer that invents a norm is worse than no answer at all, plus programmatic
 * verbatim-quote validation (spec principle #2) so quoting the law correctly
 * is checked rather than merely requested.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { RetrievedChunk } from '../retrieval/retrieve.js';
import { validateQuotes } from './validateQuotes.js';

/** Sonnet-class, per the dev-tool spec. */
const MODEL = 'claude-sonnet-5';

// Written in English on purpose: a Russian-language prompt was found to bias
// answers toward Russian even for Armenian questions. See chat.ts.
export const SYSTEM_PROMPT = `You are a reference tool for the tax law of the Republic of Armenia.

LANGUAGE RULE — answer in the language of the user's question: Armenian question → Armenian answer, Russian → Russian. Verbatim legal quotes stay Armenian in all cases. The closing disclaimer matches the answer's language.

HARD RULES:
1. Answer ONLY from the legal-act fragments provided below. No general knowledge about taxes, Armenian law, or practice — even when you are certain.
2. Every legal claim must carry a reference in the form (act title, provision) — e.g. (ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 63). An uncited claim is not allowed.
3. If the fragments do not contain the answer — say so plainly, then list which adjacent questions the fragments DO cover. Never fill the gap by inference or guessing.
4. If the fragments answer only part of the question — answer the covered part and explicitly name what remains uncovered.
5. Quote the law in Armenian verbatim, exactly as given in the fragment. Never translate or paraphrase inside a quotation.
6. Each fragment starts with a metadata header ([Document], [Location], [Status], [Dates], [Source]). Use it for references; the metadata itself is not the text of the law.

QUOTATION MARKS ARE RESERVED FOR THE LAW. Wrap text in « » only when it is a
verbatim fragment of a supplied article. Never put your own prose, headings, or
the closing disclaimer in quotation marks — quoted text is machine-checked
against the article texts, and anything quoted that is not law is stripped from
your answer as unverifiable.

End every answer with the disclaimer, in the answer's language, unquoted:
Armenian: Սա տեղեկատվական գործիք է, ոչ իրավաբանական խորհրդատվություն։ Ստուգեք վկայակոչված հոդվածների ամբողջական տեքստը ARLIS-ում։
Russian: Это информационный инструмент, а не юридическая консультация. Проверьте полный текст процитированных статей по ссылке на ARLIS.`;

export interface AskResult {
  answer: string;
  chunks: RetrievedChunk[];
  model: string;
  /** Quotes removed because they were not verbatim in the supplied text. */
  invalidQuotes: number;
}

function renderChunks(chunks: RetrievedChunk[]): string {
  return chunks
    .map(
      (c, i) =>
        `<fragment n="${i + 1}" act="${c.arlisId}" provision="${c.ref}">\n${c.text}\n</fragment>`,
    )
    .join('\n\n');
}

export function isConfigured(): boolean {
  return Boolean(process.env['ANTHROPIC_API_KEY']);
}

export async function ask(
  question: string,
  chunks: RetrievedChunk[],
): Promise<AskResult> {
  const client = new Anthropic();

  const userContent =
    chunks.length === 0
      ? `User question: ${question}\n\n(No fragments found — retrieval returned nothing.)`
      : `User question: ${question}\n\nLegal act fragments:\n\n${renderChunks(chunks)}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    // No temperature: non-default sampling parameters are rejected on
    // Sonnet 5. Steering happens in the system prompt instead.
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: userContent }],
  });

  // content is a discriminated union — narrow before reading .text.
  const rawAnswer = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  // Spec principle #2 — see validateQuotes.ts. Enforced, not merely requested.
  const check = validateQuotes(rawAnswer, chunks.map((c) => c.text));
  if (check.invalidCount > 0) {
    console.error(`[quotes] ${check.invalidCount} unverifiable quote(s) removed`);
  }

  return {
    answer: check.sanitized,
    chunks,
    model: response.model,
    invalidQuotes: check.invalidCount,
  };
}
