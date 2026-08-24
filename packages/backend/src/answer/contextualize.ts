/**
 * Query contextualisation — the step that makes multi-turn actually work.
 *
 * Retrieval is stateless: "а если оборот выше?" contains no searchable term,
 * so retrieving on the raw follow-up returns noise. This rewrites it into a
 * standalone query using the conversation so far, and maintains a running
 * summary of facts the user has established.
 *
 * Three jobs:
 *   1. Resolve references from history ("у них", "это", "в таком случае").
 *   2. Normalise Latin-script Armenian ("xanut bacel" → "խանութ բացել").
 *      Armenians routinely type Armenian in Latin letters when they lack an
 *      Armenian keyboard; measured, such a query returns ZERO results,
 *      because it shares no characters with the corpus and no meaningful
 *      embedding neighbourhood either.
 *   3. Maintain `fact_summary` — the facts the USER has stated about their
 *      situation. Without this, clarifying questions are theatre: the model
 *      asks "are you an ИП? what turnover?", the user answers, and those
 *      answers never reach the retriever, so the next turn searches for
 *      exactly what the previous one did.
 *
 * Rewrite CONSERVATIVELY. Resolve and normalise; never invent. A
 * contextualiser that adds "для ИП" because it seems likely sends retrieval —
 * and therefore the answer — somewhere the user never asked about.
 *
 * Uses a cheap model: this runs every turn and is a routing decision, not a
 * legal judgement.
 */
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5';

export interface Contextualized {
  standaloneQuery: string;
  /**
   * Armenian legal terms appended to the RETRIEVAL query only.
   *
   * Kept separate from standaloneQuery deliberately. "Rewrite faithfully,
   * never add facts the user didn't state" and "add legal vocabulary the user
   * never used" are conflicting instructions; a model asked to satisfy both in
   * one field resolves the conflict conservatively — staying faithful and
   * omitting the terms. That is exactly what left colloquial questions
   * unretrievable ("ինչ հարկեր պիտի տամ" shares no vocabulary with
   * «Շրջանառության հարկ վճարողները»). Two fields make each instruction
   * unambiguous, and keep the faithful rewrite available for display.
   */
  searchTerms: string;
  needsRetrieval: boolean;
  isTopicShift: boolean;
  /** Running summary of user-stated facts; empty string when none yet. */
  factSummary: string;
}

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const SCHEMA = {
  type: 'object',
  properties: {
    standalone_query: {
      type: 'string',
      description:
        "The user message rewritten so it can be understood without the conversation, IN THE USER'S OWN LANGUAGE — Armenian stays Armenian, Russian stays Russian. Never translate to English. Resolve references from history and incorporate established facts. Never add facts the user did not state.",
    },
    needs_retrieval: {
      type: 'boolean',
      description:
        'False only for meta-questions about the conversation itself ("повтори", "что ты сказал выше"). True whenever legal text is needed.',
    },
    search_terms: {
      type: 'string',
      description:
        'Armenian legal terms naming the tax regimes and concepts this situation plausibly implicates, space-separated. These are SEARCH HINTS, not assertions about the user — list every regime worth checking. E.g. for opening a shop: "շրջանառության հարկ միկրոձեռնարկատիրություն անհատ ձեռնարկատեր ավելացված արժեքի հարկ հսկիչ դրամարկղային մեքենա". Empty only for meta-questions.',
    },
    is_topic_shift: {
      type: 'boolean',
      description: 'True if this message moves to a different legal topic than the previous turns.',
    },
    fact_summary: {
      type: 'string',
      description:
        'Updated running summary of facts the USER has stated about their own situation (legal form, activity, turnover, employees, location, dates). Carry forward previous facts, add new ones, correct contradicted ones. ONLY facts the user actually stated — never inferred, never from the assistant. Empty string if the user has stated none.',
    },
  },
  required: ['standalone_query', 'search_terms', 'needs_retrieval', 'is_topic_shift', 'fact_summary'],
  additionalProperties: false,
} as const;

const SYSTEM = `You preprocess queries for a legal search system covering Armenian tax law. The corpus is written entirely in Armenian.

Your output feeds a semantic search engine, then a grounded answer generator.

TASKS

1. REWRITE the user's last message into a self-contained search query.
   - Resolve references to earlier messages ("а если", "это", "там", "у них", "в таком случае").
   - Fold in relevant established facts, so the search reflects the user's actual situation.
   - Keep hypotheticals hypothetical.
   - NEVER add facts the user did not state. If they never said "ИП", do not write "ИП".
   - WRITE IT IN THE USER'S OWN LANGUAGE. An Armenian question stays Armenian,
     a Russian one stays Russian. NEVER translate the query into English —
     English is not the corpus language and not the user's language, so it
     helps neither retrieval nor generation, and it leaks into the answer's
     language. This applies to fact_summary too: record the user's facts in
     their language, not translated.

2. NORMALISE TRANSLITERATION. Armenian users frequently type Armenian words in
   Latin letters ("xanut" = խանութ = shop, "harkeri" = հարկերի = of taxes,
   "bacel" = բացել = to open, "gorcuneutyun" = գործունեություն = activity).
   Convert any such words to Armenian script in the query. Russian text stays
   Russian — only Latin-script ARMENIAN is converted.

3. ADD ARMENIAN LEGAL TERMS — ALWAYS, and this is the highest-impact step.
   Apply it to EVERY query regardless of the input language, including
   messages already written in Armenian. A colloquially-phrased Armenian
   question is just as unretrievable as a Russian one: the corpus is written
   in formal legal register, and "ինչ հարկեր պիտի տամ" shares no vocabulary
   with «Շրջանառության հարկ վճարողները».

   Name the tax regimes and legal concepts the situation actually implicates,
   even when the user never used those words:
     turnover tax = շրջանառության հարկ
     micro-business = միկրոձեռնարկատիրություն
     VAT = ավելացված արժեքի հարկ
     income tax = եկամտային հարկ
     profit tax = շահութահարկ
     sole trader = անհատ ձեռնարկատեր
     employees = վարձու աշխատողներ
     cash register = հսկիչ դրամարկղային մեքենա
     property tax = գույքահարկ

   Example — "I want to open a small shop, what taxes do I pay" must become a
   query naming շրջանառության հարկ, միկրոձեռնարկատիրություն, անհատ
   ձեռնարկատեր and ավելացված արժեքի հարկ, because those are the regimes that
   govern the answer.

   Naming a candidate regime is NOT the same as asserting a fact about the
   user. Listing շրջանառության հարկ as potentially relevant is legitimate;
   stating that the user IS registered under it is not.

4. MAINTAIN fact_summary — a compact list of what the USER has told you about
   their own circumstances. Carry previous facts forward; add new ones; if the
   user contradicts an earlier fact, replace it. Include ONLY what the user
   stated themselves. Never include facts the assistant introduced, and never
   infer.`;

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function contextualize(
  history: Turn[],
  message: string,
  previousFactSummary = '',
): Promise<Contextualized> {
  const client = new Anthropic();

  const transcript = history
    .slice(-8)
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n\n');

  const parts = [
    previousFactSummary
      ? `Established facts about the user (from earlier turns):\n${previousFactSummary}`
      : 'Established facts about the user: (none yet)',
    history.length ? `\nConversation so far:\n\n${transcript}` : '',
    `\nNew user message:\n${message}`,
  ].join('\n');

  try {
    // No `effort` — it is rejected on Haiku 4.5.
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      // Deterministic by default (Haiku 4.5 still accepts sampling params).
      //
      // Measured 2026-08-24: this call was the ONLY non-deterministic stage in
      // retrieval — vector search and rerank-2.5 both return identical results
      // for identical input, this did not. And it varied in WHETHER it rewrote
      // at all, not how: one run returned all 46 golden questions untouched,
      // another rewrote 24 of them, a direct probe gave 2 distinct outputs in 3
      // calls. Everything downstream inherits that, which is why the same
      // question could deliver its answer on one draw and not the next (6.5% of
      // golden questions flipped between draws) and why 1-2 question retrieval
      // experiments became unfalsifiable.
      //
      // There is no upside to sampling here. This is an extraction step with a
      // JSON schema, not a generative one — variety in a query rewrite is pure
      // noise injected upstream of every measurement and every answer.
      temperature: 0,
      // This prompt is identical on every turn of every session, and it sits on
      // the critical path to first token — the user waits for it before
      // retrieval can even start. Caching it removes its prefill from that wait.
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: parts }],
    });

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const parsed = parseJson(text);
    if (!parsed) throw new Error('unparseable contextualiser output');

    const q = typeof parsed['standalone_query'] === 'string' ? parsed['standalone_query'].trim() : '';
    const fs = typeof parsed['fact_summary'] === 'string' ? parsed['fact_summary'].trim() : '';

    return {
      standaloneQuery: q || message,
      searchTerms:
        typeof parsed['search_terms'] === 'string' ? parsed['search_terms'].trim() : '',
      needsRetrieval: parsed['needs_retrieval'] !== false,
      isTopicShift: parsed['is_topic_shift'] === true,
      // Never let a failed update silently erase accumulated facts.
      factSummary: fs || previousFactSummary,
    };
  } catch {
    // Contextualisation is an optimisation, not a correctness requirement.
    // Falling back to the raw message degrades retrieval; failing the turn
    // would be worse.
    return {
      standaloneQuery: message,
      searchTerms: '',
      needsRetrieval: true,
      isTopicShift: false,
      factSummary: previousFactSummary,
    };
  }
}
