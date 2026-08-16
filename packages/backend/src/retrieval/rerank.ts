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

const MODEL = 'rerank-2.5';

/**
 * Characters of each chunk sent to the reranker.
 *
 * Armenian runs ~1.7 tokens/char, so a whole chunk can be tens of thousands of
 * tokens and the largest is ~55k characters. The metadata header (document
 * title, provision, status) sits at the front and carries most of the
 * discriminating signal — the title-index experiment showed titles alone are
 * enough to match questions to provisions — so a prefix is not a meaningful
 * loss.
 */
const DOC_CHARS = 1800;

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
        documents: chunks.map((c) => c.text.slice(0, DOC_CHARS)),
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
