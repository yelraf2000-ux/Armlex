/**
 * Verify the pgvector HNSW index reproduces brute-force ranking.
 *
 * The benchmark (91.3% hit@5) was measured with exact brute-force cosine over
 * in-memory vectors. Production uses an approximate HNSW index. If the two
 * disagree, the benchmark number does not describe the shipped system — so
 * this compares them directly on the real golden questions.
 *
 * HNSW is approximate by design; some divergence in the tail is expected and
 * fine. What matters is agreement at the top of the ranking, because that is
 * what generation actually consumes.
 *
 * Usage: npx tsx packages/backend/src/embed/verify-hnsw.ts [model]
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'dotenv/config';
import postgres from 'postgres';
import { config } from '@armlex/shared';

const VECTOR_DIR = join(process.cwd(), 'data', 'vectors');
const K = 8;

interface VectorLine {
  id: string;
  parentId: string;
  vector: number[];
}

/** Max-pool over a chunk's slices — identical to the benchmark's scoring. */
function bruteForceRank(
  queryVec: Float64Array,
  slices: { parentId: string; vec: Float64Array }[],
  k: number,
): string[] {
  const byParent = new Map<string, number>();
  for (const s of slices) {
    let dot = 0;
    for (let i = 0; i < queryVec.length; i++) dot += queryVec[i]! * s.vec[i]!;
    const prev = byParent.get(s.parentId);
    if (prev === undefined || dot > prev) byParent.set(s.parentId, dot);
  }
  return [...byParent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([p]) => p);
}

async function main(): Promise<void> {
  const model = process.argv[2] ?? 'gemini-embedding-2';

  const corpus = (await readFile(join(VECTOR_DIR, `${model}.jsonl`), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as VectorLine)
    .map((v) => ({ parentId: v.parentId, vec: Float64Array.from(v.vector) }));

  const queries = (await readFile(join(VECTOR_DIR, `${model}.queries.jsonl`), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as VectorLine);

  const sql = postgres(config.databaseUrl, { onnotice: () => {} });

  try {
    // Only chunks that actually have vectors loaded can be compared.
    const loaded = new Set(
      (
        await sql<{ key: string }[]>`
          SELECT DISTINCT d.arlis_id || '#' || a.article_number AS key
          FROM embeddings e
          JOIN articles a ON a.id = e.article_id
          JOIN documents d ON d.id = a.document_id
          WHERE e.model = ${model}
        `
      ).map((r) => r.key),
    );
    const corpusLoaded = corpus.filter((c) => loaded.has(c.parentId));
    console.log(`model=${model} | chunks with vectors: ${loaded.size} | queries: ${queries.length}\n`);

    let exactTop1 = 0;
    let overlapSum = 0;
    const divergent: string[] = [];

    for (const q of queries) {
      const qv = Float64Array.from(q.vector);
      const brute = bruteForceRank(qv, corpusLoaded, K);

      // HNSW path — mirrors what production retrieval will run: max-pool per
      // chunk via DISTINCT ON after ordering by distance.
      const hnsw = (
        await sql<{ key: string }[]>`
          SELECT key FROM (
            SELECT DISTINCT ON (a.id)
                   d.arlis_id || '#' || a.article_number AS key,
                   e.vector::halfvec(3072) <=> ${JSON.stringify(q.vector)}::halfvec(3072) AS dist
            FROM embeddings e
            JOIN articles a ON a.id = e.article_id
            JOIN documents d ON d.id = a.document_id
            WHERE e.model = ${model}
              AND d.rag_eligible AND d.status = 'in_force' AND a.status = 'in_force'
            ORDER BY a.id, dist ASC
          ) s
          ORDER BY dist ASC
          LIMIT ${K}
        `
      ).map((r) => r.key);

      if (brute[0] === hnsw[0]) exactTop1++;
      const overlap = hnsw.filter((h) => brute.includes(h)).length;
      overlapSum += overlap;

      if (brute[0] !== hnsw[0] || overlap < K - 1) {
        divergent.push(
          `  "${q.id.slice(0, 52)}" top1 brute=${brute[0]} hnsw=${hnsw[0]} overlap=${overlap}/${K}`,
        );
      }
    }

    const n = queries.length;
    console.log(`top-1 agreement : ${exactTop1}/${n} (${Math.round((100 * exactTop1) / n)}%)`);
    console.log(
      `top-${K} overlap   : ${(overlapSum / n).toFixed(2)}/${K} (${Math.round((100 * overlapSum) / (n * K))}%)`,
    );

    if (divergent.length) {
      console.log(`\ndivergent queries (${divergent.length}):`);
      divergent.slice(0, 10).forEach((d) => console.log(d));
    }

    const ok = exactTop1 / n >= 0.95 && overlapSum / (n * K) >= 0.95;
    console.log(`\n${ok ? 'PASS' : 'FAIL'} — HNSW ${ok ? 'reproduces' : 'DIVERGES FROM'} brute force`);
    if (!ok) process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
