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
        top_k: Math.min(topN, chunks.length),
      }),
    });

    if (!res.ok) {
      console.error(`[rerank] HTTP ${res.status} — falling back to vector order`);
      return chunks.slice(0, topN);
    }

    const json = (await res.json()) as {
      data: { index: number; relevance_score: number }[];
    };

    return json.data
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .map((d) => {
        const c = chunks[d.index];
        return c ? { ...c, score: d.relevance_score } : undefined;
      })
      .filter((c): c is RetrievedChunk => Boolean(c))
      .slice(0, topN);
  } catch (err) {
    // Reranking improves ordering; it is not required for correctness. A
    // provider outage must degrade to vector order, never fail the query.
    console.error(`[rerank] ${String(err).slice(0, 100)} — falling back to vector order`);
    return chunks.slice(0, topN);
  }
}
