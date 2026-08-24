/**
 * THE RETRIEVAL SEAM.
 *
 * Everything that needs chunks goes through `retrieve()`, bound at the bottom
 * of this file — swapping the implementation touches that one line, not any
 * caller, route, or UI.
 *
 * Four implementations live here:
 *   ftsRetriever      — Postgres full-text over tsv_hy. Lexical only, and since
 *                       tsv_hy holds Armenian it scores 0.0% on Russian queries.
 *   vectorRetriever   — pgvector + gemini-embedding-2, one vector per
 *                       enumerated item (embed/split.ts). 81.5% hit@5, verified
 *                       to reproduce brute force exactly (embed/verify-hnsw.ts).
 *   hybridRetriever   — RRF fusion of both. Implemented, measured, NOT active:
 *                       worse MRR than vector alone. See the note on `retrieve`.
 *   rerankedRetriever — vector top-50 → one-hop citation expansion → cross-
 *                       encoder shown prefix + matched slice (rerank.ts).
 *                       **Currently active.** 88.9% hit@5, MRR 0.681.
 *
 * Numbers come from `npx tsx packages/backend/src/eval/score.ts --live`.
 */
import { rerankChunks } from './rerank.js';
import { db, closeDb } from '../db/pool.js';

export interface RetrievedChunk {
  /** articles.id — needed to cache the chunk against a session. */
  articleId: string;
  documentTitle: string;
  arlisId: number;
  ref: string;
  /** Retriever score. Comparable within one retriever, not across retrievers. */
  score: number;
  text: string;
  docType: string;
  actNumber: string | null;
  /**
   * Which slice of the chunk matched best, when the chunk was found by vector
   * search. Enumeration articles are indexed one vector per item, so this says
   * WHICH item matched — and the reranker must judge that item, not the
   * article's opening paragraph (see rerank.ts).
   */
  sliceIndex?: number;
}

export type Retriever = (query: string, limit: number) => Promise<RetrievedChunk[]>;


/**
 * Postgres full-text search over `tsv_hy`.
 *
 * `websearch_to_tsquery` is used rather than `plainto_tsquery` so quoted
 * phrases and OR/- operators work; `simple` matches the config the column was
 * generated with. Filters on `rag_eligible` and `status` exactly as the
 * production retriever must.
 */
/**
 * Run one tsquery expression and return ranked chunks.
 *
 * Normalisation flag 2 divides rank by document length — without it the longest
 * chunk wins nearly everything, since it simply contains more of every term.
 */
async function runFts(
  tsqueryExpr: string,
  limit: number,
): Promise<RetrievedChunk[]> {
  const rows = await db()<
    {
      id: string;
      title_hy: string;
      arlis_id: number;
      article_number: string;
      score: number;
      text_hy: string;
      doc_type: string;
      act_number: string | null;
    }[]
  >`
    SELECT a.id, d.title_hy, d.arlis_id, a.article_number, a.text_hy,
           d.doc_type::text AS doc_type, d.act_number,
           ts_rank_cd(a.tsv_hy, to_tsquery('simple', ${tsqueryExpr}), 2) AS score
    FROM articles a
    JOIN documents d ON d.id = a.document_id
    WHERE d.rag_eligible
      AND d.status = 'in_force'
      AND a.status = 'in_force'
      AND a.tsv_hy @@ to_tsquery('simple', ${tsqueryExpr})
    ORDER BY score DESC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
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

/** Words safe to feed to to_tsquery: strip punctuation and tsquery operators. */
function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}._-]+/u)
    .map((t) => t.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((t) => t.length >= 2);
}

/**
 * Two-stage FTS.
 *
 * Stage 1 ANDs every term. That is the precise interpretation, but it is
 * brittle here for two compounding reasons: the `simple` config does no
 * Armenian stemming (հարկ and հարկի are different lexemes), and a natural
 * question carries conversational words (ինչ, կասես) that never appear in
 * legislative text. One such word drives the whole conjunction to zero.
 *
 * Stage 2 therefore ORs the terms and lets ts_rank_cd order by how many
 * matched. Only runs when stage 1 finds nothing, so exact phrases keep their
 * precise behaviour.
 *
 * This is a usability floor for hand-testing, NOT a fix for cross-lingual
 * retrieval — a Russian query still matches nothing, because tsv_hy holds no
 * Cyrillic. That remains milestone 5's job.
 */
export const ftsRetriever: Retriever = async (query, limit) => {
  const words = terms(query);
  if (words.length === 0) return [];

  const strict = await runFts(words.join(' & '), limit);
  if (strict.length > 0) return strict;

  return runFts(words.join(' | '), limit);
};

// ---------------------------------------------------------------------------
// Vector retrieval
// ---------------------------------------------------------------------------

/** The embedding model whose vectors are loaded into pgvector. */
const VECTOR_MODEL = 'gemini-embedding-2';

/**
 * Embed a query with the same model and task type used for the corpus.
 *
 * `RETRIEVAL_QUERY` (not `RETRIEVAL_DOCUMENT`) matters: Gemini embeds queries
 * and documents into deliberately different regions, and mixing the task types
 * silently degrades similarity.
 */
export async function embedQuery(text: string): Promise<number[] | null> {
  const key = process.env['GEMINI_API_KEY'];
  if (!key) {
    warnVectorUnavailable('GEMINI_API_KEY is not set');
    return null;
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${VECTOR_MODEL}:embedContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${VECTOR_MODEL}`,
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_QUERY',
        }),
      },
    );
    if (!res.ok) {
      warnVectorUnavailable(`embedding API returned HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { embedding?: { values: number[] } };
    return json.embedding?.values ?? null;
  } catch (err) {
    warnVectorUnavailable(String(err).slice(0, 120));
    return null;
  }
}

/**
 * Degrading to FTS-only must never be silent.
 *
 * Without the vector leg, retrieval measures 0% on Russian questions — the
 * system looks like it is working (it returns answers, it says "no relevant
 * fragments") while being comprehensively broken. That failure is
 * indistinguishable from a genuine miss unless it announces itself.
 */
let lastVectorWarning = '';
function warnVectorUnavailable(reason: string): void {
  if (reason === lastVectorWarning) return; // don't spam identical failures
  lastVectorWarning = reason;
  console.error(
    `[retrieval] VECTOR LEG UNAVAILABLE (${reason}) — falling back to FTS-only, ` +
      `which scores ~0% on non-Armenian queries.`,
  );
}

/**
 * Vector search over pgvector, max-pooling a chunk's slices.
 *
 * `DISTINCT ON (a.id)` after ordering by distance takes each chunk's best
 * slice — identical to the benchmark's scoring, and verified to reproduce
 * brute-force ranking exactly (see embed/verify-hnsw.ts).
 */
export const vectorRetriever: Retriever = async (query, limit) => {
  const qv = await embedQuery(query);
  if (!qv) return [];
  return vectorSearch(qv, limit);
};

/**
 * Vector search from an already-computed query embedding.
 *
 * Split out from `vectorRetriever` so the evaluation harness can exercise the
 * real pgvector path using cached query vectors — otherwise every eval run
 * needs live API calls, and a provider outage or quota limit makes the
 * database path untestable exactly when you most need to check it.
 */
export async function vectorSearch(
  queryVector: number[],
  limit: number,
): Promise<RetrievedChunk[]> {
  const qv = queryVector;
  const rows = await db()<
    {
      id: string;
      title_hy: string;
      arlis_id: number;
      article_number: string;
      text_hy: string;
      doc_type: string;
      act_number: string | null;
      slice_index: number | null;
      score: number;
    }[]
  >`
    SELECT id, title_hy, arlis_id, article_number, text_hy, doc_type, act_number,
           slice_index, 1 - dist AS score
    FROM (
      SELECT DISTINCT ON (a.id)
             a.id, d.title_hy, d.arlis_id, a.article_number, a.text_hy,
             d.doc_type::text AS doc_type, d.act_number, e.slice_index,
             e.vector::halfvec(3072) <=> ${JSON.stringify(qv)}::halfvec(3072) AS dist
      FROM embeddings e
      JOIN articles a ON a.id = e.article_id
      JOIN documents d ON d.id = a.document_id
      WHERE e.model = ${VECTOR_MODEL}
        AND d.rag_eligible AND d.status = 'in_force' AND a.status = 'in_force'
      ORDER BY a.id, dist ASC
    ) s
    ORDER BY dist ASC
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    articleId: String(r.id),
    documentTitle: r.title_hy,
    arlisId: r.arlis_id,
    ref: r.article_number,
    score: Number(r.score),
    text: r.text_hy,
    docType: r.doc_type,
    actNumber: r.act_number,
    ...(r.slice_index === null ? {} : { sliceIndex: r.slice_index }),
  }));
}

// ---------------------------------------------------------------------------
// Hybrid
// ---------------------------------------------------------------------------

/**
 * RRF constant. 60 is the value from the original Cormack et al. paper and the
 * usual default; it damps the influence of rank-1 enough that a single
 * retriever cannot dominate the fused list on its own.
 */
const RRF_K = 60;

/**
 * Reciprocal Rank Fusion of FTS and vector results.
 *
 * RRF fuses by RANK, never by score — which is the point. `ts_rank_cd` values
 * and cosine similarities are not comparable quantities, and any attempt to
 * normalise them into a shared scale would be arbitrary. Rank position is the
 * only thing both retrievers agree on the meaning of.
 *
 * Both legs run concurrently; each is over-fetched so the fusion has enough
 * candidates to actually reorder.
 */
export const hybridRetriever: Retriever = async (query, limit) => {
  const pool = Math.max(limit * 4, 30);
  const [fts, vec] = await Promise.all([
    ftsRetriever(query, pool),
    vectorRetriever(query, pool),
  ]);

  const scores = new Map<string, number>();
  const chunks = new Map<string, RetrievedChunk>();

  for (const list of [fts, vec]) {
    list.forEach((c, i) => {
      const key = c.articleId;
      scores.set(key, (scores.get(key) ?? 0) + 1 / (RRF_K + i + 1));
      if (!chunks.has(key)) chunks.set(key, c);
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, score]) => ({ ...chunks.get(key)!, score }));
};

// ---------------------------------------------------------------------------
// Reranked
// ---------------------------------------------------------------------------

/**
 * How many candidates the reranker sees.
 *
 * Chosen by sweep, not intuition (hit@5 / recall@8 / MRR on the golden set):
 *
 *     pool 15 : 82.6%  77.5%  0.675
 *     pool 30 : 82.6%  76.8%  0.666
 *     pool 50 : 87.0%  79.0%  0.677   <- selected
 *     pool 80 : 87.0%  76.8%  0.658
 *
 * The upside of reranking is entirely in the tail: a wider pool is how a
 * correct article sitting at rank 30 by embedding similarity gets rescued at
 * all. It stops paying at 80, where added noise costs more than the extra
 * recall is worth.
 */
const RERANK_POOL = 50;

/**
 * How many top candidates get their citations pulled in.
 *
 * Only the strongest hits are expanded. A provision cited by a rank-40
 * candidate is two steps of guesswork from the question, and every extra
 * candidate is noise the reranker has to sift.
 */
const EXPAND_FROM = 8;

/**
 * On by default: measured on the 25-question golden set it improves every
 * metric — hit@5 80.0% -> 84.0%, hit@8 84.0% -> 88.0%, recall@8 76.7% -> 78.7%,
 * MRR 0.609 -> 0.625. Set EXPAND_ONE_HOP=0 to measure without it.
 */
const EXPAND_ENABLED = process.env['EXPAND_ONE_HOP'] !== '0';

/**
 * Add the provisions that the strongest candidates cite (spec pipeline step 3).
 *
 * Armenian tax law defers constantly, and the deferral often points at the
 * article that actually carries the rule. Measured case: "what expenses are
 * deductible under turnover tax" retrieves Հոդված 260, which cites Հոդված 258
 * — and 258 is the article containing the answer. Embedding similarity cannot
 * find 258 there, because the question's vocabulary matches the profit-tax
 * expense chapter instead; the citation graph can.
 *
 * Expansion follows OUTBOUND edges only — what a hit cites, not what cites it.
 * Inbound would drag in every provision referring to a popular article, which
 * is most of the Code for something like Հոդված 53.
 */
export async function expandOneHop(candidates: RetrievedChunk[]): Promise<RetrievedChunk[]> {
  if (candidates.length === 0) return candidates;

  const seed = candidates.slice(0, EXPAND_FROM).map((c) => c.articleId);
  const have = new Set(candidates.map((c) => c.articleId));

  const rows = await db()<
    {
      id: string;
      title_hy: string;
      arlis_id: number;
      article_number: string;
      text_hy: string;
      doc_type: string;
      act_number: string | null;
    }[]
  >`
    SELECT DISTINCT a.id, d.title_hy, d.arlis_id, a.article_number, a.text_hy,
           d.doc_type::text AS doc_type, d.act_number
    FROM article_refs r
    JOIN articles a ON a.id = r.to_article_id
    JOIN documents d ON d.id = a.document_id
    WHERE r.from_article_id = ANY(${seed}::bigint[])
      AND d.rag_eligible AND d.status = 'in_force' AND a.status = 'in_force'
    LIMIT 40
  `;

  const added = rows
    .filter((r) => !have.has(String(r.id)))
    .map((r) => ({
      articleId: String(r.id),
      documentTitle: r.title_hy,
      arlisId: r.arlis_id,
      ref: r.article_number,
      // Cited provisions carry no similarity score of their own; they earn
      // their place from the reranker or not at all.
      score: 0,
      text: r.text_hy,
      docType: r.doc_type,
      actNumber: r.act_number,
    }));

  return [...candidates, ...added];
}

/**
 * Vector retrieval followed by cross-encoder reranking.
 *
 * The two stages do different jobs: the bi-encoder finds plausible candidates
 * fast over 885 chunks, the cross-encoder then reads query and document
 * together to judge actual relevance. That second judgment is what separates
 * an article that GOVERNS a topic from a form that merely MENTIONS it.
 */
/**
 * Lexical candidates folded into the rerank pool.
 *
 * RRF was measured and rejected in August: FTS scored 0.0% on a Russian-only
 * golden set, and fusing by rank still credited its top-ranked misses. Two
 * things changed. The golden set now contains Armenian questions, and FTS is no
 * longer zero on them (0.0% -> 5.4%). And the corpus now holds FORM documents,
 * where the answer is a terse table row — «տող», «այլ ակտիվների» — which is
 * exactly what lexical search matches and embeddings blur.
 *
 * The difference from RRF: nothing is fused by rank. FTS only ADDS candidates
 * to the pool, and the cross-encoder decides. That is the arrangement
 * `OPEN-ITEMS` 7 named as the obvious next experiment — RRF failed because it
 * had no way to discard lexical noise, and the reranker does.
 *
 * Off by default until measured on the golden set.
 */
const FTS_POOL = Number(process.env['FTS_POOL'] ?? 0);

/**
 * Vector hits that survive the reranker's judgement regardless.
 *
 * The cross-encoder sharpens the TOP hit and costs recall — measured on the
 * 46-question set, vector-only beats reranked on hit@5 (89.1% vs 87.0%) and
 * recall@5 (83.0% vs 80.4%) and loses only on MRR (0.638 vs 0.740). Inspecting
 * the questions where generation never receives every required article, four of
 * six had their gold article in the VECTOR TOP 8 and the reranker demoted it
 * below the cut:
 *
 *   Հոդված 150 @vector 2   dividends to a resident
 *   Հոդված 117 @vector 3   dismissal after childcare leave
 *   Հոդված 5   @vector 7   employer social payments
 *   Հոդված 130 @vector 8   profit-tax rate
 *
 * So the strongest few vector hits are appended if reranking dropped them. This
 * is not distrust of the reranker — its ordering still leads — it is refusing to
 * let a second-stage judgement DISCARD what the first stage was most confident
 * about. Same contract as one-hop expansion and the tie-aware cut: extra
 * candidates ride along, they never displace.
 *
 * Measured on delivered-set recall (46 questions, FRESH_LIMIT 8):
 *
 *   slots   recall   ALL required   mean chunks
 *   0       89.1%    87.0%          10.20
 *   2       91.3%    89.1%          10.63
 *   3       93.5%    91.3%          11.00   <- default
 *   4       93.5%    91.3%          11.41
 *
 * Monotonic to 3 then flat, for +0.8 chunks. 4 buys nothing and sends more.
 */
const GUARANTEED_VECTOR_SLOTS = Number(process.env['GUARANTEED_VECTOR_SLOTS'] ?? 0);

export const rerankedRetriever: Retriever = async (query, limit) => {
  const candidates = await vectorRetriever(query, RERANK_POOL);
  if (candidates.length === 0) return [];

  let pool = candidates;
  if (FTS_POOL > 0) {
    const lexical = await ftsRetriever(query, FTS_POOL);
    const have = new Set(pool.map((c) => c.articleId));
    // Lexical hits carry no comparable score, so they enter with 0 and earn
    // their place from the reranker or not at all — same contract as one-hop
    // expansion.
    pool = [...pool, ...lexical.filter((c) => !have.has(c.articleId)).map((c) => ({ ...c, score: 0 }))];
  }

  const expanded = EXPAND_ENABLED ? await expandOneHop(pool) : pool;
  const reranked = await rerankChunks(query, expanded, limit);

  if (GUARANTEED_VECTOR_SLOTS > 0) {
    const have = new Set(reranked.map((c) => c.articleId));
    for (const c of candidates.slice(0, GUARANTEED_VECTOR_SLOTS)) {
      if (!have.has(c.articleId)) {
        reranked.push(c);
        have.add(c.articleId);
      }
    }
  }
  return reranked;
};

/**
 * The active retriever: **vector + cross-encoder rerank.**
 *
 * Measured on the 27-question golden set, 902 chunks indexed as 5,139
 * enumeration-aware vectors (2026-08-19):
 *
 *     retriever                         hit@5   recall@5  recall@8   MRR
 *     fts (baseline)                     0.0%     0.0%      0.0%    0.000
 *     vector only                       81.5%    74.7%     79.6%    0.601
 *     hybrid RRF                        81.5%    69.8%     81.5%    0.468
 *     vector + expansion + rerank-2.5   88.9%    75.9%     87.0%    0.681   <- shipped
 *
 * Better on every metric, which is why it ships — the same evidence rule that
 * kept hybrid RRF switched off.
 *
 * MRR matters disproportionately here because generation sees only 3–4 chunks;
 * a correct article at rank 5 might as well not have been retrieved. Reranking
 * moves the first correct hit up, which is exactly the axis that reaches the
 * user.
 *
 * `hybridRetriever` stays in the file, unused: FTS may still earn its place
 * once an Armenian-language golden set exists (exact-term and article-number
 * lookups are where lexical search should win). Fusing FTS *under* the
 * reranker is now the obvious next experiment — the reranker can discard the
 * lexical noise that RRF alone could not. Re-measure before enabling; do not
 * assume.
 */
export const retrieve: Retriever = rerankedRetriever;

/**
 * Wake the database without waiting for it.
 *
 * Neon suspends an idle compute, so the FIRST query of a session pays ~3.4s of
 * cold start — measured 3.6s cold against ~250ms warm. That penalty lands on
 * the first question anyone asks, which is the worst possible place for it.
 *
 * A periodic keep-alive ping would fix it by keeping the compute awake around
 * the clock, and would burn compute hours continuously to do so. Instead this
 * is fired (not awaited) when the UI loads, which is seconds before anyone
 * finishes typing a question — enough to absorb the wake-up, while an idle
 * system still costs nothing.
 *
 * It cannot usefully be fired at the start of a turn: the turn's first act is
 * already a database read, so there would be nothing left to overlap with.
 *
 * Failures are swallowed on purpose: this is an optimisation, and the real
 * query that follows will surface any genuine database problem.
 */
export function warmRetrieval(): void {
  void db()`SELECT 1`.catch(() => {});
}

export async function closeRetrieval(): Promise<void> {
  await closeDb();
}
