/**
 * Load cached embedding vectors from disk into pgvector.
 *
 * Vectors are generated DB-free (see generate.ts) and cached as JSONL so the
 * model choice could be benchmarked before committing to a schema. This is the
 * step that commits: it maps each slice back to its parent chunk's
 * `articles.id` and inserts one embeddings row per slice.
 *
 * Slice-level rows are deliberate — retrieval max-pools over a chunk's slices,
 * which is exactly what the benchmark measured (see migration 003).
 *
 * Usage:
 *   npx tsx packages/backend/src/embed/load.ts gemini-embedding-2
 *   npx tsx packages/backend/src/embed/load.ts gemini-embedding-2 --replace
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'dotenv/config';
import postgres from 'postgres';
import { config } from '@armlex/shared';
import { KNOWN_MODELS } from './embedder.js';

const VECTOR_DIR = join(process.cwd(), 'data', 'vectors');

interface VectorLine {
  id: string;
  parentId: string; // "<arlisId>#<ref>"
  arlisId: number;
  vector: number[];
}

async function main(): Promise<void> {
  const modelName = process.argv[2];
  const replace = process.argv.includes('--replace');
  const spec = modelName ? KNOWN_MODELS[modelName] : undefined;
  if (!spec) {
    console.error(`usage: load.ts <model> [--replace]\nknown: ${Object.keys(KNOWN_MODELS).join(', ')}`);
    process.exit(1);
  }

  const raw = await readFile(join(VECTOR_DIR, `${spec.name}.jsonl`), 'utf8');
  const parsed = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as VectorLine);

  // The cache file is APPEND-ONLY: when a chunk's text changes, generate.ts
  // appends a fresh vector without removing the superseded line, so both share
  // one id. Loading both attached the OLD-text vector to the article as an
  // extra slice — and since retrieval max-pools slices, queries kept matching
  // wording that no longer exists in the corpus. Observed after applying the
  // 2026 Tax Code amendments: 7 articles each carried their old and new
  // vectors side by side. Last line wins, because appends are chronological.
  const byId = new Map<string, VectorLine>();
  for (const s of parsed) byId.set(s.id, s);
  const slices = [...byId.values()];
  if (slices.length !== parsed.length) {
    console.log(`deduped ${parsed.length - slices.length} superseded cache line(s)`);
  }
  console.log(`${spec.name}: ${slices.length} slices on disk`);

  // Guard: a dimension mismatch here means the column and the model disagree,
  // and every similarity score would be meaningless.
  const dims = new Set(slices.map((s) => s.vector.length));
  if (dims.size !== 1 || !dims.has(spec.dimensions)) {
    throw new Error(
      `dimension mismatch: file has ${[...dims].join(',')}, model declares ${spec.dimensions}`,
    );
  }

  const sql = postgres(config.databaseUrl, { onnotice: () => {} });
  try {
    const [col] = await sql<{ dims: number }[]>`
      SELECT atttypmod AS dims FROM pg_attribute
      WHERE attrelid = 'embeddings'::regclass AND attname = 'vector'
    `;
    if (col?.dims && col.dims > 0 && col.dims !== spec.dimensions) {
      throw new Error(
        `embeddings.vector is ${col.dims}-d but ${spec.name} produces ${spec.dimensions}-d — migrate first`,
      );
    }

    // Map "<arlisId>#<ref>" -> articles.id
    const rows = await sql<{ id: string; arlis_id: number; article_number: string }[]>`
      SELECT a.id, d.arlis_id, a.article_number
      FROM articles a JOIN documents d ON d.id = a.document_id
    `;
    const idByKey = new Map(rows.map((r) => [`${r.arlis_id}#${r.article_number}`, r.id]));
    console.log(`chunks in DB: ${idByKey.size}`);

    if (replace) {
      const del = await sql`DELETE FROM embeddings WHERE model = ${spec.name}`;
      console.log(`deleted ${del.count} existing rows for ${spec.name}`);
    }

    // Group slices by parent so slice_index is stable and contiguous.
    const byParent = new Map<string, VectorLine[]>();
    for (const s of slices) {
      const bucket = byParent.get(s.parentId) ?? [];
      bucket.push(s);
      byParent.set(s.parentId, bucket);
    }

    let inserted = 0;
    let orphaned = 0;
    const orphanExamples: string[] = [];

    for (const [parentId, group] of byParent) {
      const articleId = idByKey.get(parentId);
      if (!articleId) {
        orphaned += group.length;
        if (orphanExamples.length < 5) orphanExamples.push(parentId);
        continue;
      }
      // Deterministic order: slice id carries a "::N" suffix when split.
      group.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));

      for (const [i, s] of group.entries()) {
        await sql`
          INSERT INTO embeddings (article_id, lang_used, model, vector, slice_index)
          VALUES (${articleId}, 'hy', ${spec.name}, ${JSON.stringify(s.vector)}::vector, ${i})
          ON CONFLICT (article_id, model, slice_index)
          DO UPDATE SET vector = EXCLUDED.vector, created_at = now()
        `;
        inserted++;
      }
    }

    console.log(`inserted/updated: ${inserted} rows`);
    if (orphaned > 0) {
      console.log(
        `ORPHANED: ${orphaned} slices had no matching chunk (chunking changed since embedding?)`,
      );
      orphanExamples.forEach((e) => console.log(`  e.g. ${e}`));
    }

    const [count] = await sql<{ n: number; chunks: number }[]>`
      SELECT count(*)::int AS n, count(DISTINCT article_id)::int AS chunks
      FROM embeddings WHERE model = ${spec.name}
    `;
    const [total] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles`;
    console.log(
      `\nin DB: ${count?.n} vectors covering ${count?.chunks}/${total?.n} chunks ` +
        `(${Math.round((100 * (count?.chunks ?? 0)) / (total?.n ?? 1))}%)`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
