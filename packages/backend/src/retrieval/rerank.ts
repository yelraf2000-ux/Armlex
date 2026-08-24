/**
 * Cross-encoder reranking (milestone 6).
 *
 * Embedding similarity and relevance are different judgments, and the gap
 * between them is exactly the failure this fixes. A tax-return FORM enumerates
 * every tax term — sole traders, employees, turnover, VAT — so it embeds close
 * to a term-rich question like "what taxes does a small shop pay", closer than
 * the article that actually states the rule. A bi-encoder cannot tell
 * "document that mentions turnover tax" from "article that governs turnover
 * tax"; a cross-encoder reads the query and document together and can.
 *
 * Measured on this corpus before shipping — see BENCHMARK.md. `rerank-2-lite`
 * was rejected: it ranked the form ABOVE the article on the probe case.
 */
import type { RetrievedChunk } from './retrieve.js';
import { splitEnumerated } from '../embed/split.js';
import type { CorpusChunk } from '../embed/corpus.js';

const MODEL = 'rerank-2.5';

/**
 * Characters of each chunk sent to the reranker.
 *
 * Armenian runs ~0.6 tokens/char, and the largest article is ~55k characters,
 * so the reranker cannot see whole articles across a 50-candidate pool. The
 * metadata header sits at the front and carries much of the signal, so a
 * prefix was the original compromise.
 */
const DOC_CHARS = 1800;

/**
 * Judge the slice that matched, not the article's opening.
 *
 * Enumeration articles are indexed one vector per item (see embed/split.ts),
 * and that sharpened vector search by ~10 points — which the reranker then gave
 * straight back: measured on the golden set, vector-only hit@5 rose 72.0% →
 * 81.5% while vector+rerank stayed at 85.2% with MRR FALLING 0.653 → 0.632.
 * Cause: the reranker was shown the first 1,800 characters of each article,
 * i.e. the header plus exemption №1 — row 8 of a rate table or exemption №23
 * sits 20,000 characters later and is invisible, so the reranker demotes
 * exactly the articles the sharper vectors had just found. Same disease, one
 * stage later.
 *
 * So the document sent for a vector hit is the matched slice — header, the
 * governing lead-in, the item itself — reconstructed deterministically from the
 * article text with the same split policy that built the index. Chunks that
 * arrived without a slice (citation expansion) keep the prefix.
 */
const sliceCache = new Map<string, string[]>();

function sliceTexts(chunk: RetrievedChunk): string[] {
  const key = `${chunk.articleId}:${chunk.text.length}`;
  const hit = sliceCache.get(key);
  if (hit) return hit;
  const corpusChunk: CorpusChunk = {
    id: `${chunk.arlisId}#${chunk.ref}`,
    arlisId: chunk.arlisId,
    ref: chunk.ref,
    kind: '',
    text: chunk.text,
    charCount: chunk.text.length,
  };
  const texts = splitEnumerated(corpusChunk).map((s) => s.text);
  // Bounded: the pool is 50 articles per query and the corpus is 902 chunks;
  // a thousand entries is the whole corpus with room to spare.
  if (sliceCache.size > 1000) sliceCache.clear();
  sliceCache.set(key, texts);
  return texts;
}

/**
 * What the reranker is shown for each candidate.
 *
 *   prefix — the article's first DOC_CHARS (the original behaviour)
 *   slice  — the matched slice alone
 *   both   — prefix, then the matched slice appended
 *
 * Measured on the golden set (27 questions, enum index, pool 50):
 *
 *            hit@5   hit@8   recall@5  recall@8   MRR
 *   prefix   85.2%   85.2%    71.0%     76.5%    0.632
 *   slice    85.2%   92.6%    69.8%     82.7%    0.564
 *   both     88.9%   92.6%    75.9%     87.0%    0.681   <- default
 *
 * `slice` found more correct articles and ranked them lower: per question, 6
 * improved (two MISS→1) and 10 slid from rank 1–2 to 2–7 — almost all
 * prose-answer questions. A terse table row was competing against rich opening
 * paragraphs and losing. `both` removes that asymmetry — every document carries
 * its framing AND its evidence — and beats every prior configuration on every
 * metric, including the pre-enumeration shipped path (85.2 / 88.9 / 72.2 /
 * 80.2 / 0.653).
 */
type RerankDoc = 'prefix' | 'slice' | 'both';
const RERANK_DOC: RerankDoc = (process.env['RERANK_DOC'] as RerankDoc | undefined) ?? 'both';

export function rerankDocument(chunk: RetrievedChunk): string {
  const prefix = chunk.text.slice(0, DOC_CHARS);
  if (chunk.sliceIndex === undefined || RERANK_DOC === 'prefix') return prefix;

  const slices = sliceTexts(chunk);
  // Index drift between the stored slice_index and a recomputed split is
  // possible only for the handful of hard-cut oversized rows; the prefix is the
  // safe fallback there, never a wrong slice.
  const slice = slices.length > 1 ? slices[chunk.sliceIndex] : undefined;
  if (!slice) return prefix;

  if (RERANK_DOC === 'slice') return slice.slice(0, DOC_CHARS * 2);

  // both: the slice already repeats the metadata header; strip it so the
  // reranker is not shown the same title twice.
  const marker = slice.indexOf('\n---\n');
  const evidence = marker === -1 ? slice : slice.slice(marker + 5);
  return `${prefix}\n…\n${evidence}`.slice(0, DOC_CHARS * 2);
}


/**
 * How close a candidate must be to the last included one to survive the cut.
 *
 * Cross-encoder scores on this corpus are compressed — the threshold sweep
 * (2026-08-19) found covered questions mean top-1 0.668 against missed 0.616,
 * and 11 of 24 covered questions scoring at or below the best miss. That
 * killed an ABSOLUTE cutoff: no value of t separates good from bad.
 *
 * This uses the same compression as a signal rather than fighting it. When the
 * next candidate is within DELTA of the last included one, the reranker is not
 * actually distinguishing them, and cutting between them is a coin flip.
 * Measured coin flips, all governing articles lost at the boundary:
 *
 *   Հոդված 288  rank 4  0.465  vs 0.469  (registration dates)
 *   Հոդված 198  rank 5  0.758  vs 0.762  (wage delay)
 *   Հոդված 254  rank 6  0.547  vs 0.582  (IT services, cost a full->none)
 *
 * MAX_EXTRA bounds the cost: Armenian runs ~1.7 tokens/char and a turn is
 * already ~40k input tokens, so an unbounded tail is a real bill, not a
 * rounding error.
 */
// Read per call, not at import: the scorer A/Bs both settings in one process.
/**
 * OFF by default (delta 0). Measured on the 33-question golden set at a cut of
 * 4: it recovered ONE question for +42% tokens, and the tighter settings sized
 * to the observed 0.004 ties recovered nothing at all. The real fix was to make
 * chunks small enough to send more of them (`generationDocument` + FRESH_LIMIT
 * 8), which bought +24 points of complete-context delivery for +10% cost.
 *
 * Kept, not deleted: it has not been re-measured at a cut of 8, where the
 * marginal chunk is cheaper. Set RERANK_TIE_DELTA to re-test.
 */
const tieDelta = (): number => Number(process.env['RERANK_TIE_DELTA'] ?? 0);
const tieMaxExtra = (): number => Number(process.env['RERANK_TIE_MAX_EXTRA'] ?? 3);

/** Top N, plus any immediately-following candidate the reranker cannot separate from Nth. */
export function takeWithTies<T extends { score: number }>(ordered: T[], topN: number): T[] {
  const delta = tieDelta();
  const maxExtra = tieMaxExtra();
  if (ordered.length <= topN || delta <= 0) return ordered.slice(0, topN);
  const floor = (ordered[topN - 1]?.score ?? 0) - delta;
  const out = ordered.slice(0, topN);
  for (let i = topN; i < ordered.length && out.length < topN + maxExtra; i++) {
    const c = ordered[i];
    if (!c || c.score < floor) break;
    out.push(c);
  }
  return out;
}

export async function rerankChunks(
  query: string,
  chunks: RetrievedChunk[],
  topN: number,
): Promise<RetrievedChunk[]> {
  const key = process.env['VOYAGE_API_KEY'];
  if (!key || chunks.length === 0) return chunks.slice(0, topN);

  try {
    const res = await fetch('https://api.voyageai.com/v1/rerank', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        documents: chunks.map(rerankDocument),
        model: MODEL,
        // Ask for the extras too, or takeWithTies has nothing to extend from:
        // the API returns exactly top_k documents, so requesting topN means
        // ranks topN+1.. never come back and the tie rule silently no-ops.
        top_k: Math.min(topN + tieMaxExtra(), chunks.length),
      }),
    });

    if (!res.ok) {
      console.error(`[rerank] HTTP ${res.status} — falling back to vector order`);
      return chunks.slice(0, topN);
    }

    const json = (await res.json()) as {
      data: { index: number; relevance_score: number }[];
    };

    const ordered = json.data
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map((d) => {
        const c = chunks[d.index];
        return c ? { ...c, score: d.relevance_score } : undefined;
      })
      .filter((c): c is RetrievedChunk => Boolean(c));

    return takeWithTies(ordered, topN);
  } catch (err) {
    // Reranking improves ordering; it is not required for correctness. A
    // provider outage must degrade to vector order, never fail the query.
    console.error(`[rerank] ${String(err).slice(0, 100)} — falling back to vector order`);
    return chunks.slice(0, topN);
  }
}

/**
 * What GENERATION reads for a chunk — as opposed to what the reranker judges.
 *
 * The reranker already reads the matched part rather than the article's opening
 * (see `rerankDocument`); generation still received the whole article, up to
 * 33,627 characters of which one paragraph mattered. Armenian runs ~1.7 tokens
 * per character, so that text is where nearly all the per-question cost lives —
 * and the cost is what forced `FRESH_LIMIT` down to 4, which is what dropped
 * `Հոդված 288`, `Հոդված 254` and `Հոդված 112` before the model could read them.
 *
 * `DECISIONS.md` named this shape in August and nobody built it: article-level
 * embeddings for retrieval, part-level extraction for generation — one chunk
 * size does not have to serve both. Search is untouched here; only the reading
 * narrows. That is the distinction the reverted sub-article experiment missed.
 *
 * Three rules keep it safe:
 *   - Articles at or under GEN_CHARS pass through WHOLE. Most do — the Labour
 *     Code's median chunk is 1,111 characters. Only giants are ever cut.
 *   - The article's opening lead always travels with the matched part, because
 *     legal text refers backwards ("the persons specified in part 1 shall…")
 *     and a part alone can be unreadable. That reference-loss is exactly what
 *     halved retrieval when sub-article chunking was tried on the search side.
 *   - Neighbouring parts come too, so a rule split across adjacent items is not
 *     severed mid-sentence.
 *
 * Measured on the 33-question golden set: 8 reduced chunks are 22% CHEAPER than
 * 4 whole articles (15,015 vs 19,247 chars), so the wider cut pays for itself.
 * Watch the invalid-quote rate (10% baseline in triage): if it rises, the model
 * is being shown too little and inventing the rest.
 */
const GEN_CHARS = Number(process.env['GEN_DOC_CHARS'] ?? 6000);

/** Strip the repeated metadata header a slice carries, keeping its body. */
function evidenceOf(slice: string): string {
  const m = slice.indexOf('\n---\n');
  return m === -1 ? slice : slice.slice(m + 5);
}

export function generationDocument(chunk: RetrievedChunk): string {
  if (chunk.text.length <= GEN_CHARS) return chunk.text;
  if (chunk.sliceIndex === undefined) return chunk.text.slice(0, GEN_CHARS);

  const slices = sliceTexts(chunk);
  const i = chunk.sliceIndex;
  if (slices.length <= 1 || !slices[i]) return chunk.text.slice(0, GEN_CHARS);

  const marker = chunk.text.indexOf('\n---\n');
  const header = marker === -1 ? '' : chunk.text.slice(0, marker + 5);
  const lead = evidenceOf(chunk.text).slice(0, 900);

  const window = [i - 1, i, i + 1]
    .filter((j) => j >= 0 && j < slices.length)
    .map((j) => evidenceOf(slices[j]!))
    .join('\n');

  return `${header}${lead}\n…\n${window}`.slice(0, GEN_CHARS);
}
