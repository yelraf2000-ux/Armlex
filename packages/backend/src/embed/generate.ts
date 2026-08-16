/**
 * Generate corpus embeddings for one model and cache them to disk.
 *
 * DB-free by design: vectors land in data/vectors/<model>.jsonl, one line per
 * slice. Nothing touches pgvector until the model choice is made — that is the
 * whole point of benchmarking outside the database.
 *
 * Resumable: already-embedded slice ids are skipped, so a rate-limit abort
 * costs nothing but time.
 *
 * Usage:
 *   npx tsx packages/backend/src/embed/generate.ts gemini-embedding-2
 *   npx tsx packages/backend/src/embed/generate.ts voyage-3-large
 *   npx tsx packages/backend/src/embed/generate.ts gemini-embedding-2 --queries
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import 'dotenv/config';
import { loadCorpusFromSnapshots } from './corpus.js';
import { splitCorpus } from './split.js';
import type { Slice } from './split.js';
import { KNOWN_MODELS } from './embedder.js';

const VECTOR_DIR = join(process.cwd(), 'data', 'vectors');
const EVAL_DIR = join(process.cwd(), 'data', 'eval');

interface VectorLine {
  id: string;
  parentId: string;
  arlisId: number;
  vector: number[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Providers. Both return unit-normalised vectors (probed earlier), so cosine
// downstream is a plain dot product.
// ---------------------------------------------------------------------------

async function embedGemini(
  model: string,
  texts: string[],
  isQuery: boolean,
): Promise<number[][]> {
  const key = process.env['GEMINI_API_KEY'];
  if (!key) throw new Error('GEMINI_API_KEY not set');

  const body = {
    requests: texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType: isQuery ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
    })),
  };

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
      );
    } catch (err) {
      // Transport-level failure (reset, DNS, TLS) — retry like a 5xx. Without
      // this, one dropped connection aborts a run that is 95% cached anyway.
      if (attempt >= 6) throw err;
      const wait = Math.min(60000, 2000 * 2 ** attempt);
      console.log(`    fetch failed (${String(err).slice(0, 60)}), backing off ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 6) throw new Error(`gemini ${res.status} after ${attempt} retries`);
      const wait = Math.min(60000, 2000 * 2 ** attempt);
      console.log(`    HTTP ${res.status}, backing off ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { embeddings: { values: number[] }[] };
    return json.embeddings.map((e) => e.values);
  }
}

async function embedVoyage(
  model: string,
  texts: string[],
  isQuery: boolean,
): Promise<number[][]> {
  const key = process.env['VOYAGE_API_KEY'];
  if (!key) throw new Error('VOYAGE_API_KEY not set');

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: texts,
          model,
          input_type: isQuery ? 'query' : 'document',
        }),
      });
    } catch (err) {
      if (attempt >= 8) throw err;
      const wait = Math.min(120000, 5000 * 2 ** attempt);
      console.log(`    fetch failed (${String(err).slice(0, 60)}), backing off ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 8) throw new Error(`voyage ${res.status} after ${attempt} retries`);
      const wait = Math.min(120000, 5000 * 2 ** attempt);
      console.log(`    HTTP ${res.status}, backing off ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`voyage ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

// ---------------------------------------------------------------------------

/**
 * Fingerprint of the text a vector was computed from.
 *
 * The cache key is `<arlisId>#<ref>`, which identifies WHERE a chunk sits, not
 * WHAT it says. Those come apart whenever the parser changes: fixing the ⚖
 * heading bug moved 16 articles' worth of text out of the chunks that had
 * silently absorbed it, leaving those chunks with the same ref and different
 * content — so a ref-keyed cache happily served vectors describing text that
 * no longer exists. That failure is invisible: retrieval still returns
 * results, they are just quietly wrong.
 *
 * Including the content hash makes a changed chunk a cache miss by
 * construction, so no future parser or chunker change can serve stale vectors.
 */
function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Cache entries that are still valid, keyed by id AND content.
 *
 * Lines written before fingerprinting existed have no `hash` and are treated
 * as misses — a one-time full re-embed, which is the correct outcome: their
 * provenance cannot be established.
 */
async function loadDone(path: string): Promise<Set<string>> {
  try {
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
    const done = new Set<string>();
    for (const l of lines) {
      const v = JSON.parse(l) as VectorLine & { hash?: string };
      if (v.hash) done.add(`${v.id}|${v.hash}`);
    }
    return done;
  } catch {
    return new Set();
  }
}

/**
 * Resume set for query vectors, keyed by id alone.
 *
 * A query's id IS its text, so content is already in the key and there is
 * nothing for a fingerprint to catch.
 */
async function loadDoneIds(path: string): Promise<Set<string>> {
  try {
    const lines = (await readFile(path, 'utf8')).split('\n').filter(Boolean);
    return new Set(lines.map((l) => (JSON.parse(l) as VectorLine).id));
  } catch {
    return new Set();
  }
}

async function loadQuestions(): Promise<string[]> {
  const text = await readFile(join(EVAL_DIR, 'golden_proposed.csv'), 'utf8');
  const questions = new Set<string>();
  // question is the first quoted field of each line
  for (const line of text.split('\n').slice(1)) {
    const m = /^"((?:[^"]|"")*)"/.exec(line);
    if (m?.[1]) questions.add(m[1].replace(/""/g, '"'));
  }
  return [...questions];
}

async function main(): Promise<void> {
  const modelName = process.argv[2];
  const queriesMode = process.argv.includes('--queries');
  const spec = modelName ? KNOWN_MODELS[modelName] : undefined;
  if (!spec) {
    console.error(`usage: generate.ts <model> [--queries]\nknown: ${Object.keys(KNOWN_MODELS).join(', ')}`);
    process.exit(1);
  }

  const embed =
    spec.provider === 'gemini' ? embedGemini
    : spec.provider === 'voyage' ? embedVoyage
    : null;
  if (!embed) throw new Error(`no generator for provider ${spec.provider}`);

  await mkdir(VECTOR_DIR, { recursive: true });

  if (queriesMode) {
    const questions = await loadQuestions();
    const out = join(VECTOR_DIR, `${spec.name}.queries.jsonl`);
    const done = await loadDoneIds(out);
    const todo = questions.filter((q) => !done.has(q));
    console.log(`queries: ${questions.length}, todo: ${todo.length}`);

    for (let i = 0; i < todo.length; i += 10) {
      const batch = todo.slice(i, i + 10);
      const vectors = await embed(spec.name, batch, true);
      const lines = batch
        .map((q, j) => JSON.stringify({ id: q, parentId: q, arlisId: 0, vector: vectors[j] }))
        .join('\n');
      await appendFile(out, lines + '\n', 'utf8');
      console.log(`  ${Math.min(i + 10, todo.length)}/${todo.length}`);
    }
    console.log(`wrote ${out}`);
    return;
  }

  // Corpus mode. Slice cap 8000 covers Gemini's 8192 limit; Voyage's 32k
  // limit is looser, but identical slicing keeps the comparison apples-to-apples.
  const chunks = await loadCorpusFromSnapshots();
  const slices: Slice[] = splitCorpus(chunks, 7000, 8000);
  const out = join(VECTOR_DIR, `${spec.name}.jsonl`);
  const done = await loadDone(out);
  const todo = slices.filter((s) => !done.has(`${s.id}|${fingerprint(s.text)}`));
  console.log(`model=${spec.name} slices=${slices.length} done=${done.size} todo=${todo.length}`);

  // Empirically calibrated:
  //   Gemini: 4 workers × batch 10 hit sustained 429s (RPM cap) at 148 slices;
  //   a single probe succeeded a minute later — per-minute limit, not quota.
  //   Serial + ~13 RPM with fat batches stays under it.
  //   Voyage: unpaid tier was 10K TPM / 3 RPM; a payment method was added
  //   (still billed against the 200M free-token allowance), which lifts the
  //   throttle — verified via a live probe. Standard tier limits are far
  //   higher, so parallel workers are safe here too.
  //   Gemini free tier proved tighter than 15/batch @ 4.5s: that pacing died
  //   twice on sustained 429s while a lone probe still returned 200 (so it is
  //   a rate limit, not a daily quota). Backed off to 5/batch @ 12s ≈ 5 RPM.
  const batchSize = spec.provider === 'voyage' ? 8 : 15;
  // Paid tier: the free-tier RPM cap no longer applies.
  const workers = 4;
  const interBatchDelayMs = spec.provider === 'voyage' ? 500 : 4000;
  const t0 = Date.now();

  const batches: Slice[][] = [];
  for (let i = 0; i < todo.length; i += batchSize) batches.push(todo.slice(i, i + batchSize));

  let nextBatch = 0;
  let completed = 0;
  // appendFile is atomic per call; each worker writes whole lines only.
  const worker = async (): Promise<void> => {
    for (;;) {
      const idx = nextBatch++;
      const batch = batches[idx];
      if (!batch) return;
      const vectors = await embed(spec.name, batch.map((s) => s.text), false);
      const lines = batch
        .map((s, j) =>
          JSON.stringify({ id: s.id, parentId: s.parentId, arlisId: s.arlisId, hash: fingerprint(s.text), vector: vectors[j] }),
        )
        .join('\n');
      await appendFile(out, lines + '\n', 'utf8');
      completed += batch.length;
      await sleep(interBatchDelayMs);
      if (idx % 8 === 0) {
        const rate = completed / ((Date.now() - t0) / 1000);
        const eta = rate > 0 ? Math.round((todo.length - completed) / rate) : '?';
        console.log(`  ${done.size + completed}/${slices.length}  (${rate.toFixed(1)}/s, eta ${eta}s)`);
      }
    }
  };
  await Promise.all(Array.from({ length: workers }, () => worker()));

  console.log(`wrote ${out} — ${done.size + completed}/${slices.length} slices`);
}

main().catch((err: unknown) => {
  console.error(String(err));
  process.exit(1);
});
