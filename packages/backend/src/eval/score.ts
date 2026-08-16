/**
 * Retrieval benchmark scorer.
 *
 * Scores every available retriever against the verified golden set:
 *   - fts            — the live Postgres retriever (the honest baseline)
 *   - <model>.jsonl  — any vector file in data/vectors, brute-force in memory
 *
 * Metrics, macro-averaged over questions:
 *   hit@k     — share of questions with ≥1 expected chunk in the top k
 *   recall@k  — share of each question's expected chunks found in the top k
 *   MRR       — 1/rank of the first expected chunk (0 if none in top 20)
 *
 * Slices resolve to their parent chunk before ranking (max-score
 * aggregation), so a chunk split into 11 slices competes as ONE candidate.
 *
 * Usage: npx tsx packages/backend/src/eval/score.ts
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ftsRetriever,
  vectorSearch,

  closeRetrieval,
} from '../retrieval/retrieve.js';
import { rerankChunks } from '../retrieval/rerank.js';

const EVAL_DIR = join(process.cwd(), 'data', 'eval');
const VECTOR_DIR = join(process.cwd(), 'data', 'vectors');
const TOP_K = 20;

interface GoldenQuestion {
  question: string;
  expected: Set<string>; // "arlisId#ref", article-level
}

/**
 * Collapse a chunk ref to article granularity.
 *
 * Sub-article chunking produces refs like `Հոդված 254, մաս 3`, while the
 * golden set records answers at article level (`Հոդված 254`). Scoring must
 * compare like with like, or part-level chunking would score 0 by
 * construction — and old vs new chunking would not be comparable at all.
 *
 * Retrieving any part of the right article counts as one hit for that
 * article, not several: both sides are deduped after normalisation.
 */
function toArticleKey(key: string): string {
  return key.replace(/,\s*(մաս|ներածական)\b.*$/u, '').trim();
}

interface VectorLine {
  id: string;
  parentId: string;
  vector: number[];
}

// --- golden set -------------------------------------------------------------

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

async function loadGolden(): Promise<GoldenQuestion[]> {
  const rows = parseCsvRows(
    await readFile(join(EVAL_DIR, 'golden_verified.csv'), 'utf8'),
  ).slice(1);

  const byQuestion = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.length < 4) continue;
    const q = r[0]!;
    const key = `${r[2]}#${r[3]}`;
    (byQuestion.get(q) ?? byQuestion.set(q, new Set()).get(q)!).add(key);
  }
  return [...byQuestion.entries()].map(([question, expected]) => ({ question, expected }));
}

// --- retrievers -------------------------------------------------------------

type RankFn = (question: string) => Promise<string[]>; // ordered "arlisId#ref"

function ftsRank(): RankFn {
  return async (question) => {
    const hits = await ftsRetriever(question, TOP_K);
    return hits.map((h) => `${h.arlisId}#${h.ref}`);
  };
}

async function vectorRank(model: string): Promise<RankFn | null> {
  let corpusRaw: string;
  let queriesRaw: string;
  try {
    corpusRaw = await readFile(join(VECTOR_DIR, `${model}.jsonl`), 'utf8');
    queriesRaw = await readFile(join(VECTOR_DIR, `${model}.queries.jsonl`), 'utf8');
  } catch {
    return null;
  }

  const slices = corpusRaw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as VectorLine);
  const queries = new Map(
    queriesRaw
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const v = JSON.parse(l) as VectorLine;
        return [v.id, Float64Array.from(v.vector)] as const;
      }),
  );

  const sliceVectors = slices.map((s) => Float64Array.from(s.vector));

  return async (question) => {
    const qv = queries.get(question);
    if (!qv) return [];

    // Vectors are unit-normalised (verified at probe time): cosine == dot.
    const byParent = new Map<string, number>();
    for (let i = 0; i < slices.length; i++) {
      const sv = sliceVectors[i]!;
      let dot = 0;
      for (let d = 0; d < qv.length; d++) dot += qv[d]! * sv[d]!;
      const parent = slices[i]!.parentId;
      const prev = byParent.get(parent);
      if (prev === undefined || dot > prev) byParent.set(parent, dot);
    }

    return [...byParent.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_K)
      .map(([parent]) => parent);
  };
}

// --- scoring ----------------------------------------------------------------

interface Scores {
  name: string;
  hit5: number;
  hit8: number;
  recall5: number;
  recall8: number;
  mrr: number;
  perQuestion: { question: string; firstRank: number | null; found8: string[]; missed8: string[] }[];
}

async function score(name: string, rank: RankFn, golden: GoldenQuestion[]): Promise<Scores> {
  let hit5 = 0, hit8 = 0, recall5 = 0, recall8 = 0, mrr = 0;
  const perQuestion: Scores['perQuestion'] = [];

  for (const g of golden) {
    // Normalise to article level and dedupe, preserving rank order — so a
    // chunker that splits an article into 5 parts does not get 5 shots at
    // filling the top-5.
    const rawRanked = await rank(g.question);
    const seen = new Set<string>();
    const ranked: string[] = [];
    for (const r of rawRanked) {
      const k = toArticleKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      ranked.push(k);
    }

    const ranks = [...g.expected]
      .map((e) => ranked.indexOf(e))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);

    const first = ranks[0];
    if (first !== undefined) mrr += 1 / (first + 1);
    if (ranks.some((r) => r < 5)) hit5++;
    if (ranks.some((r) => r < 8)) hit8++;
    recall5 += ranks.filter((r) => r < 5).length / g.expected.size;
    recall8 += ranks.filter((r) => r < 8).length / g.expected.size;

    const top8 = new Set(ranked.slice(0, 8));
    perQuestion.push({
      question: g.question,
      firstRank: first !== undefined ? first + 1 : null,
      found8: [...g.expected].filter((e) => top8.has(e)),
      missed8: [...g.expected].filter((e) => !top8.has(e)),
    });
  }

  const n = golden.length;
  return {
    name,
    hit5: hit5 / n,
    hit8: hit8 / n,
    recall5: recall5 / n,
    recall8: recall8 / n,
    mrr: mrr / n,
    perQuestion,
  };
}

// --- main -------------------------------------------------------------------

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`;

/** Parent chunk ids present in a model's vector file. */
async function coveredParents(model: string): Promise<Set<string>> {
  try {
    const raw = await readFile(join(VECTOR_DIR, `${model}.jsonl`), 'utf8');
    return new Set(
      raw.split('\n').filter(Boolean).map((l) => (JSON.parse(l) as VectorLine).parentId),
    );
  } catch {
    return new Set();
  }
}

async function main(): Promise<void> {
  let golden = await loadGolden();

  const files = await readdir(VECTOR_DIR).catch(() => [] as string[]);
  const models = files
    .filter((f) => f.endsWith('.jsonl') && !f.includes('.queries.'))
    .map((f) => f.replace(/\.jsonl$/, ''));

  // --fair restricts every retriever to the chunks ALL models embedded, so a
  // model with partial corpus coverage is neither penalised for missing chunks
  // nor credited for a smaller haystack. Without it, comparing a partially
  // embedded model against a fully embedded one is meaningless in both
  // directions.
  const fair = process.argv.includes('--fair');
  let common: Set<string> | null = null;
  if (fair && models.length > 1) {
    const sets = await Promise.all(models.map(coveredParents));
    common = sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
    console.log(`fair mode: common chunk universe = ${common.size}`);

    // Keep only gold answers inside the shared universe; drop questions left empty.
    // The golden set records article-level keys while `common` holds chunk
    // ids, which under sub-article chunking are part-level. Compare both at
    // article granularity or every question is filtered away.
    const commonArticles = new Set([...common].map(toArticleKey));
    golden = golden
      .map((g) => ({
        question: g.question,
        expected: new Set([...g.expected].filter((e) => commonArticles.has(e))),
      }))
      .filter((g) => g.expected.size > 0);
  }

  const restrict = (fn: RankFn): RankFn =>
    common === null ? fn : async (q) => (await fn(q)).filter((id) => common!.has(id));

  console.log(`golden questions: ${golden.length}\n`);

  const runs: Scores[] = [];
  runs.push(await score('fts (baseline)', restrict(ftsRank()), golden));

  // DB-backed retrievers — what the app actually runs, as opposed to the
  // in-memory brute-force vector scoring below.
  //
  // Query vectors come from the cache rather than a live embedding call, so
  // the pgvector path stays testable when the embedding provider is rate
  // limited. The DB, index, SQL and fusion are all exercised for real; only
  // the query-embedding HTTP call is substituted.
  if (process.argv.includes('--live')) {
    const cached = new Map<string, number[]>();
    try {
      const raw = await readFile(
        join(VECTOR_DIR, 'gemini-embedding-2.queries.jsonl'),
        'utf8',
      );
      for (const line of raw.split('\n').filter(Boolean)) {
        const v = JSON.parse(line) as VectorLine;
        cached.set(v.id, v.vector);
      }
    } catch {
      /* no cache — the live paths below simply return nothing */
    }

    const vectorRank: RankFn = async (q) => {
      const qv = cached.get(q);
      if (!qv) return [];
      return (await vectorSearch(qv, TOP_K)).map((h) => `${h.arlisId}#${h.ref}`);
    };

    // Same RRF as hybridRetriever, over the cached query vector.
    const hybridRank: RankFn = async (q) => {
      const qv = cached.get(q);
      const [fts, vec] = await Promise.all([
        ftsRetriever(q, Math.max(TOP_K * 4, 30)),
        qv ? vectorSearch(qv, Math.max(TOP_K * 4, 30)) : Promise.resolve([]),
      ]);
      const scores = new Map<string, number>();
      const keyOf = new Map<string, string>();
      for (const list of [fts, vec]) {
        list.forEach((c, i) => {
          scores.set(c.articleId, (scores.get(c.articleId) ?? 0) + 1 / (60 + i + 1));
          if (!keyOf.has(c.articleId)) keyOf.set(c.articleId, `${c.arlisId}#${c.ref}`);
        });
      }
      return [...scores.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_K)
        .map(([id]) => keyOf.get(id)!);
    };

    // Reranked: vector recall, cross-encoder ordering. The pool is deliberately
    // larger than TOP_K — a reranker can only fix the ORDER of what the
    // retriever already found, so a wider pool is where its upside comes from.
    const rerankRank: RankFn = async (q) => {
      const qv = cached.get(q);
      if (!qv) return [];
      const pool = await vectorSearch(qv, Number(process.env['RERANK_POOL'] ?? 30));
      return (await rerankChunks(q, pool, TOP_K)).map((h) => `${h.arlisId}#${h.ref}`);
    };

    runs.push(await score('vector (pgvector)', restrict(vectorRank), golden));
    runs.push(await score('hybrid RRF (pgvector+FTS)', restrict(hybridRank), golden));
    runs.push(await score('vector + rerank-2.5', restrict(rerankRank), golden));
  }

  for (const m of models) {
    const rank = await vectorRank(m);
    if (!rank) continue;
    runs.push(await score(m, restrict(rank), golden));
  }

  const header = '| Retriever | hit@5 | hit@8 | recall@5 | recall@8 | MRR |';
  const sep = '|---|---|---|---|---|---|';
  const lines = runs.map(
    (r) => `| ${r.name} | ${pct(r.hit5)} | ${pct(r.hit8)} | ${pct(r.recall5)} | ${pct(r.recall8)} | ${r.mrr.toFixed(3)} |`,
  );
  const table = [header, sep, ...lines].join('\n');
  console.log(table);

  // Per-question detail for the best non-baseline run (or baseline if alone).
  const best = runs.length > 1 ? runs.slice(1).sort((a, b) => b.recall8 - a.recall8)[0]! : runs[0]!;
  const detail = [
    '',
    `## Per-question detail — ${best.name}`,
    '',
    ...best.perQuestion.map((p) => {
      const status = p.firstRank === null ? 'MISS' : `rank ${p.firstRank}`;
      return `- [${status}] ${p.question.slice(0, 80)}${p.missed8.length ? ` · missed: ${p.missed8.join(', ')}` : ''}`;
    }),
  ].join('\n');

  await writeFile(
    join(EVAL_DIR, 'benchmark_results.md'),
    `# Retrieval benchmark\n\nGolden questions: ${golden.length}\n\n${table}\n${detail}\n`,
    'utf8',
  );
  console.log(`\nwrote ${join(EVAL_DIR, 'benchmark_results.md')}`);

  await closeRetrieval();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
