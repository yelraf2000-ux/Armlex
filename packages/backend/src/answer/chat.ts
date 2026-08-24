/**
 * Multi-turn grounded chat.
 *
 * The difference from /api/ask is not just "keeps history". Three things:
 *
 *   1. The follow-up is contextualised before retrieval, so "а если оборот
 *      выше?" searches for something searchable.
 *   2. Chunks retrieved in earlier turns stay available (session_chunks), so
 *      the model can draw a conclusion across several messages instead of
 *      only the current turn's hits.
 *   3. Generation sees the real message history, so it can refer back.
 *
 * Grounding is unchanged: every legal claim still comes from a chunk in
 * context, and carried-over chunks are cited the same way as fresh ones.
 */
import { generate } from './llm.js';
import { db } from '../db/pool.js';
import { retrieve } from '../retrieval/retrieve.js';
import type { RetrievedChunk } from '../retrieval/retrieve.js';
import { generationDocument } from '../retrieval/rerank.js';
import { contextualize } from './contextualize.js';
import { QuoteStreamGate } from './streamGate.js';
import { CoverageParser } from './coverage.js';
import type { Coverage } from './coverage.js';
import { answerLanguage } from './language.js';
import type { Turn } from './contextualize.js';


/**
 * Chunk budget. Armenian runs ~1.7 tokens per character, so a handful of
 * articles is already tens of thousands of tokens — this cannot be generous.
 *
 * Was 4, set when every chunk was a WHOLE article and four already cost ~33k
 * input tokens. That cut is what lost `Հոդված 288` (rank 4), `Հոդված 254`
 * (rank 6) and `Հոդված 112` (rank 7) — the last one live, on the flagship
 * labour question, where a correct answer arrived only after the user rephrased
 * until 112 happened to clear the cut. Nothing was missing from the corpus or
 * the ranking; the article was simply never read.
 *
 * Chunks now arrive reduced (`generationDocument`), so 8 of them measure 22%
 * CHEAPER than the old 4 (15,015 vs 19,247 chars over the 33-question golden
 * set). Widen the cut rather than tune a threshold — a tie-aware cut was built
 * and measured first, and bought one question for +42% tokens.
 */
const FRESH_LIMIT = Number(process.env['FRESH_LIMIT'] ?? 8);
const CARRIED_LIMIT = 5;


// Deliberately written in English. An earlier version was written in Russian
// and measurably biased answers toward Russian even for Armenian questions —
// the prompt's own language outweighs an "answer in the user's language" rule.
// English is neutral between the two user languages.
export const SYSTEM = `You are a reference tool for the tax law of the Republic of Armenia, operating as a dialogue.

FIRST LINE OF EVERY RESPONSE — declare coverage, exactly this format, nothing else on the line:
COVERAGE: full      the fragments contain the norms that answer the question
COVERAGE: partial   they answer part of it, or answer it only under assumptions the user has not stated
COVERAGE: none      no fragment contains a norm answering the question

Judge the FRAGMENTS, not your own knowledge. A fragment that is merely on the
same topic is not coverage — «none» is correct when the fragments discuss the
right tax but never state the rule asked about.

Judge the WHOLE question, not just its tax half. Accountants' questions
routinely straddle tax law and an adjacent domain — labour law (withholding
from salary, dismissal payouts), civil law, licensing. The corpus holds ONLY
tax legislation. When part of the asked risk is governed by law outside it,
declare «partial» and NAME the domain in one sentence («вопрос об удержании
из зарплаты регулируется Трудовым кодексом, которого нет в корпусе») — never
silently answer the tax half as if it were the whole question. A reader asking
"which option is risk-free" and getting a confident answer that omits the
riskiest half has been misled by omission. This line is stripped before the
user sees it, so it costs the reader nothing and must be honest rather than
reassuring. Declare it BEFORE writing the answer, then write an answer
consistent with what you declared:
- full    → the normal answer.
- partial → answer the covered part, then state plainly what is not covered, then ONE clarifying question.
- none    → say directly that no norm answering this was found. Do NOT assemble an
            answer from adjacent material. List the closest fragments, explicitly
            labelled as related-but-not-answering, and stop.

LANGUAGE RULE — read the user's LAST message and answer in that language:
- Armenian question → answer entirely in Armenian.
- Russian question → answer entirely in Russian.
- Mixed → use the dominant language of the last message.
- Verbatim quotes from legal acts stay in Armenian in all cases, never translated inside the quotation.
- The closing disclaimer is written in the same language as the answer.

HARD RULES:
1. Answer ONLY from the legal-act fragments provided in the current message. No general knowledge about taxes or Armenian law, even when you are certain.
2. Every legal claim carries a reference in the form (act title, provision) — e.g. (ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 254). No uncited claims.
3. If the fragments do not cover the question — say so plainly, then state what they DO cover. Never fill gaps by inference.
4. Quote the law in Armenian verbatim, exactly as written in the fragment.
5. You see the dialogue history. You may rely on facts the user stated earlier and on provisions quoted in earlier answers — but a provision must still be present in the fragments to be cited.
6. If the user asks for a conclusion across the whole discussion — give it, explicitly listing which provisions it rests on, and separately naming which links are NOT covered by the fragments.
7. If the fragments cover the question only partially, answer the covered part and ask AT MOST ONE sharp clarifying question targeting the most decision-relevant missing fact.

ANSWER SHAPE — this matters as much as correctness:
- LEAD with what the user needs: the direct answer, or — when the fragments
  don't cover the question — the clarifying question. Never open with an
  inventory of what the fragments fail to contain.
- NEVER quote or summarise a fragment that does not help answer the question.
  An irrelevant fragment is noise; listing it at length makes a short honest
  answer look like a long useless one. Simply ignore it.
- When coverage is poor, the whole answer is 2–4 sentences plus ONE question.
  Say briefly what you can't determine and what you'd need to know. Do not pad
  it with procedural or form-filling text that happens to have been retrieved.
- BRANCH BEFORE YOU ASK. When the ambiguity has two or three enumerable
  readings and the fragments cover them, answer each branch — "if you mean X,
  then A applies; if Y, then B" — instead of stopping to ask. A professional
  reader resolves their own branch instantly; a clarifying question costs them
  a full round trip. Ask ONLY when the branches are too many to enumerate or
  the fragments cover none of them.
- LEAD WITH THE VERDICT ON THE USER'S ACTUAL GOAL. When the stated purpose
  fails on the law itself — e.g. seeking a licence so students can reclaim
  tax, where the refund provision does not extend to that category of tuition
  at all — say that FIRST. Walking someone through a procedure whose premise
  the fragments already defeat is worse than no answer.
- The clarifying question, when one is genuinely needed, must be the one that
  most changes the answer — usually the legal form (անհատ ձեռնարկատեր / ՍՊԸ),
  expected turnover, or activity type — and phrased so a non-lawyer can answer
  it in one line.

BREVITY — the reader sees the statute next to your answer, so do not reproduce it.
The interface displays each cited article in full, alongside your answer, with the
operative passage highlighted. Long inline quotations therefore duplicate what is
already on screen, and Armenian is the most expensive text to generate, so padding
costs the reader time twice over.
- Quote ONLY the words that carry the decision — a clause, not a paragraph.
  Ten to twenty words is usually right. If a quote runs past one sentence, cite
  the article instead and let the panel show the rest.
- At most TWO quotations per answer. A third means you are transcribing.
- Aim for under 200 words of your own prose. State the rule, cite it, apply it
  to the situation, stop.
- Never restate a provision in prose AND quote it. Choose one.

QUOTATION MARKS ARE RESERVED FOR THE LAW. Wrap text in « » only when it is a
verbatim fragment of a supplied article. Never put your own prose, headings, or
the closing disclaimer in quotation marks — quoted text is machine-checked
against the article texts, and anything quoted that is not law is stripped from
your answer as unverifiable.

End every answer with the disclaimer, unquoted, in the answer's language —
exactly ONE of these two lines, never both, never spliced together. Emitting the
Armenian sentence to a Russian reader (or a hybrid of the two) reads as a
malfunction and undermines the disclaimer it is supposed to deliver:

If answering in Armenian, end with exactly:
Սա տեղեկատվական գործիք է, ոչ իրավաբանական խորհրդատվություն։ Ստուգեք վկայակոչված հոդվածների ամբողջական տեքստը ARLIS-ում։

If answering in Russian, end with exactly:
Это информационный инструмент, а не юридическая консультация. Проверьте полный текст процитированных статей по ссылке на ARLIS.`;

export interface ChatResult {
  sessionId: string;
  answer: string;
  /** What retrieval actually searched for, after contextualisation. */
  standaloneQuery: string;
  freshChunks: RetrievedChunk[];
  carriedChunks: RetrievedChunk[];
  model: string;
  /** Running summary of user-stated facts driving retrieval and generation. */
  factSummary: string;
  /** Quotes removed because they were not verbatim in the supplied text. */
  invalidQuotes: number;
  /** Model-declared coverage of the question by the supplied fragments. */
  coverage: Coverage | null;
  /**
   * Token accounting, surfaced so prompt-cache effectiveness is observable
   * rather than assumed. If cacheReadTokens stays 0 across turns of one
   * session, a silent invalidator has crept into the prefix.
   */
  usage: {
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    outputTokens: number;
  };
  /**
   * Milliseconds per stage, so latency work is measured rather than guessed.
   *
   * `firstToken` is the number that matters to a reader: with streaming, total
   * time stops being what they experience and time-to-first-text becomes it.
   */
  timings: {
    dbLoad: number;
    contextualize: number;
    retrieval: number;
    firstToken: number;
    total: number;
  };
}

async function loadHistory(sessionId: string): Promise<Turn[]> {
  const rows = await db()<{ role: string; content: string }[]>`
    SELECT role, content FROM messages
    WHERE session_id = ${sessionId} AND role IN ('user','assistant')
    ORDER BY id ASC
  `;
  return rows.map((r) => ({ role: r.role as Turn['role'], content: r.content }));
}

interface CarriedRow {
  id: string;
  title_hy: string;
  arlis_id: number;
  article_number: string;
  text_hy: string;
  doc_type: string;
  act_number: string | null;
  score: number;
  turn_added: number;
}

/** Chunks pulled in on earlier turns, one bucket per turn. */
async function loadCarried(
  sessionId: string,
  excludeIds: Set<string>,
): Promise<RetrievedChunk[]> {
  const rows = await db()<CarriedRow[]>`
    SELECT a.id, d.title_hy, d.arlis_id, a.article_number, a.text_hy,
           d.doc_type::text AS doc_type, d.act_number, sc.score, sc.turn_added
    FROM session_chunks sc
    JOIN articles a ON a.id = sc.article_id
    JOIN documents d ON d.id = a.document_id
    WHERE sc.session_id = ${sessionId}
    -- Score first, NOT turn_added first. Ordering by recency evicts the
    -- chunks that opened the conversation exactly when the user asks for a
    -- conclusion across it — the turn where they matter most.
    ORDER BY sc.score DESC, sc.turn_added DESC
    LIMIT 20
  `;

  // Round-robin across turns rather than taking a global top-N.
  //
  // ts_rank_cd scores from different queries are not comparable, so a global
  // sort is effectively arbitrary across turns — and in practice it evicted
  // the opening turn's chunks, which are the ones a "summarise everything"
  // question needs most. Taking the best from each turn in rotation
  // guarantees every turn of the conversation is represented.
  const byTurn = new Map<number, CarriedRow[]>();
  for (const r of rows) {
    if (excludeIds.has(String(r.id))) continue;
    const bucket = byTurn.get(r.turn_added) ?? [];
    bucket.push(r);
    byTurn.set(r.turn_added, bucket);
  }
  for (const bucket of byTurn.values()) bucket.sort((a, b) => b.score - a.score);

  const turnsAsc = [...byTurn.keys()].sort((a, b) => a - b);
  const picked: CarriedRow[] = [];
  for (let depth = 0; picked.length < CARRIED_LIMIT; depth++) {
    let addedAny = false;
    for (const t of turnsAsc) {
      const row = byTurn.get(t)?.[depth];
      if (!row) continue;
      picked.push(row);
      addedAny = true;
      if (picked.length >= CARRIED_LIMIT) break;
    }
    if (!addedAny) break;
  }

  return picked
    .map((r) => ({
      articleId: String(r.id),
      documentTitle: r.title_hy,
      arlisId: r.arlis_id,
      ref: r.article_number,
      score: Number(r.score),
      text: r.text_hy,
      docType: r.doc_type,
      actNumber: r.act_number,
    }));
}

function renderChunks(fresh: RetrievedChunk[], carried: RetrievedChunk[]): string {
  const render = (c: RetrievedChunk, tag: string): string =>
    `<fragment source="${tag}" act="${c.arlisId}" provision="${c.ref}">\n${generationDocument(c)}\n</fragment>`;

  const parts = [
    ...fresh.map((c) => render(c, 'retrieved for the current question')),
    ...carried.map((c) => render(c, 'carried over from earlier turns')),
  ];
  return parts.length ? parts.join('\n\n') : '(no fragments found)';
}

/**
 * Called with each piece of answer text as it becomes safe to show.
 *
 * "Safe" is doing real work here: text inside a quotation is withheld until the
 * quote can be checked, so a caller forwarding these deltas straight to a
 * browser never puts an unverified quote of the law on screen. See
 * `streamGate.ts`.
 */
export type OnDelta = (text: string) => void;

/**
 * Called the moment retrieval finishes, ~4.5s before the first answer token.
 *
 * Which articles were found is useful on its own, and it is the honest signal
 * that the system is working on the right thing — a reader who sees
 * «Հոդված 254, Հոդված 267» appear knows the search landed, without waiting for
 * prose. Withholding it until the answer is ready wastes the one piece of
 * information that is already available.
 */
export type OnChunks = (chunks: RetrievedChunk[]) => void;

/**
 * Progress signal, emitted as each stage begins.
 *
 * Time to first token is ~9s warm, and roughly 7s of that is two sequential API
 * calls (contextualise, then embed + rerank) that have to finish before there
 * is anything to say. Nine seconds of nothing reads as broken; nine seconds of
 * visible progress reads as work. This is real progress, not a spinner —
 * each stage fires when that stage actually starts.
 */
export type ChatStage = 'understanding' | 'searching' | 'reading' | 'writing';
export type OnStage = (stage: ChatStage) => void;

export async function chat(
  sessionIdIn: string | undefined,
  message: string,
  onDelta?: OnDelta,
  onChunks?: OnChunks,
  onStage?: OnStage,
): Promise<ChatResult> {
  const tStart = Date.now();
  onStage?.('understanding');

  const sessionId =
    sessionIdIn ??
    (await db()<{ id: string }[]>`INSERT INTO sessions DEFAULT VALUES RETURNING id`)[0]!
      .id;

  // Both reads are independent — awaiting them in sequence paid two Neon round
  // trips before the contextualiser could even start.
  const [history, sessionRows] = await Promise.all([
    loadHistory(sessionId),
    db()<{ fact_summary: string | null }[]>`
      SELECT fact_summary FROM sessions WHERE id = ${sessionId}
    `,
  ]);
  const turnNumber = history.filter((t) => t.role === 'user').length + 1;
  const tLoaded = Date.now();

  const ctx = await contextualize(history, message, sessionRows[0]?.fact_summary ?? '');
  const tContextualized = Date.now();

  // Retrieval sees the rewrite PLUS the legal-term hints; the user and the
  // generation prompt see only the faithful rewrite. The corpus is written in
  // formal legal register, so a colloquial question needs the register bridged
  // before it can match anything.
  const retrievalQuery = [ctx.standaloneQuery, ctx.searchTerms]
    .filter(Boolean)
    .join(' ');
  onStage?.('searching');
  const fresh = ctx.needsRetrieval ? await retrieve(retrievalQuery, FRESH_LIMIT) : [];
  const tRetrieved = Date.now();
  const freshIds = new Set(fresh.map((c) => c.articleId));

  // On a topic shift, old chunks are more likely to mislead than to help.
  const carried = ctx.isTopicShift ? [] : await loadCarried(sessionId, freshIds);
  if (onChunks) onChunks([...fresh, ...carried]);
  onStage?.('reading');

  const userContent = [
    `User message: ${message}`,
    // Decide the answer language HERE, not in the model's head.
    //
    // The system prompt already says "answer in the language of the last
    // message", and it is not reliably obeyed: the request also carries ~34,000
    // characters of Armenian statute, and that mass of Armenian outweighs a
    // one-line instruction. Measured — «нужна ли касса в магазине» came back
    // with 0 Cyrillic characters and 1,139 Armenian ones.
    //
    // Script counting is deterministic and cannot drift, so the model is told
    // the answer rather than asked to infer it. Same failure that made the
    // Russian-language system prompt bias answers toward Russian; the pressure
    // now comes from the retrieved text instead of the prompt.
    `\n\nANSWER LANGUAGE: ${answerLanguage(message) === 'ru' ? 'RUSSIAN' : 'ARMENIAN'}.`,
    ' Write the entire answer in that language, including the closing',
    ' disclaimer. Verbatim quotes of the law stay Armenian regardless.',
    ctx.standaloneQuery !== message
      ? `\n(Search query after context resolution: ${ctx.standaloneQuery})`
      : '',
    // Established facts go to generation too, not just retrieval — so the
    // answer applies the norms to the user's actual situation instead of
    // re-asking what they already told us.
    ctx.factSummary
      ? `\n\nFacts the user has established about their situation:\n${ctx.factSummary}`
      : '',
    `\n\nLegal act fragments:\n\n${renderChunks(fresh, carried)}`,
  ].join('');

  // Prompt-cache layout now lives in the LLM seam (`llm.ts`), which is also
  // where provider differences are absorbed. This file no longer knows which
  // vendor answers.
  // MUST be the same text renderChunks put in the prompt. Validating quotes
  // against the full article while showing a reduced one would let a quote the
  // model never saw pass verification — precisely the failure this guards.
  const chunkTexts = [...fresh, ...carried].map((c) => generationDocument(c));
  const gate = new QuoteStreamGate(chunkTexts, answerLanguage(message));
  // Order matters: the coverage header is stripped BEFORE the quote gate sees
  // the text, so the gate never mistakes it for prose or a quotation.
  const coverage = new CoverageParser();

  onStage?.('writing');
  let tFirstToken = 0;

  const usage = await generate({
    system: SYSTEM,
    history,
    user: userContent,
    onText: (delta) => {
      tFirstToken ||= Date.now();
      const safe = gate.feed(coverage.feed(delta));
      if (safe && onDelta) onDelta(safe);
    },
  });

  let tail = gate.feed(coverage.flush()) + gate.flush();

  // Graceful degradation when verification fails repeatedly.
  //
  // Streamed text cannot be retracted, so the per-quote notices stand — but an
  // answer carrying several of them reads as broken even though each removal
  // was correct. One closing line names what happened and points at the norm
  // panel, which still shows every cited article in full. The threshold is 2:
  // a single removal is self-explanatory where it sits.
  if (gate.invalidCount >= 2) {
    tail +=
      answerLanguage(message) === 'ru'
        ? `\n\nЧасть цитат не прошла дословную проверку и была убрана из текста — сами статьи открыты в панели «Норма» справа.`
        : `\n\nՄեջբերումների մի մասը բառացի ստուգում չի անցել և հանվել է տեքստից — հոդվածներն ամբողջությամբ բաց են «Նորմ» վահանակում։`;
  }
  if (tail && onDelta) onDelta(tail);

  // Spec principle #2: quoted law must be a verbatim substring of the supplied
  // text. The prompt asks for that; the gate above enforces it as the text
  // streams, so an unverifiable quote is never shown even briefly.
  const answer = gate.text.trim();
  if (gate.invalidCount > 0) {
    console.error(
      `[quotes] ${gate.invalidCount} unverifiable quote(s) removed from answer ` +
        `(session ${sessionId}, turn ${turnNumber})`,
    );
    // Log the rejected text itself. A bare count says the guard fired but not
    // whether the model fabricated a quote (correct rejection) or merely
    // reformatted one the normaliser should tolerate (a bug in the matcher).
    // Those need opposite fixes, and the count alone cannot tell them apart.
    for (const q of gate.rejected) {
      console.error(`[quotes]   rejected: ${q.slice(0, 160)}`);
    }
  }

  // Persist the turn. The stored user message is the ORIGINAL text, not the
  // rewritten query — history must reflect what the user actually said.
  await db().begin(async (tx) => {
    await tx`
      INSERT INTO messages (session_id, role, content)
      VALUES (${sessionId}, 'user', ${message}), (${sessionId}, 'assistant', ${answer})
    `;
    await tx`
      UPDATE sessions SET fact_summary = ${ctx.factSummary || null}
      WHERE id = ${sessionId}
    `;
    for (const c of fresh) {
      await tx`
        INSERT INTO session_chunks (session_id, article_id, score, turn_added)
        VALUES (${sessionId}, ${c.articleId}, ${c.score}, ${turnNumber})
        ON CONFLICT (session_id, article_id)
        DO UPDATE SET score = GREATEST(session_chunks.score, EXCLUDED.score),
                      turn_added = EXCLUDED.turn_added
      `;
    }
  });

  return {
    sessionId,
    answer,
    standaloneQuery: ctx.standaloneQuery,
    freshChunks: fresh,
    carriedChunks: carried,
    model: usage.model,
    factSummary: ctx.factSummary,
    invalidQuotes: gate.invalidCount,
    coverage: coverage.coverage,
    usage: {
      inputTokens: usage.inputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      outputTokens: usage.outputTokens,
    },
    timings: {
        dbLoad: tLoaded - tStart,
      contextualize: tContextualized - tLoaded,
      retrieval: tRetrieved - tContextualized,
      firstToken: tFirstToken ? tFirstToken - tStart : 0,
      total: Date.now() - tStart,
    },
  };
}

export async function getHistory(sessionId: string): Promise<Turn[]> {
  return loadHistory(sessionId);
}
