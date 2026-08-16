/**
 * Does the reranker's score tell us whether the corpus actually covers a question?
 *
 * The confidence gate is only worth building if that signal is real. A gate
 * calibrated on a guessed threshold would fire on the wrong questions and be
 * worse than none — it would attach a confident framing to answers that miss,
 * which is the exact failure it exists to prevent.
 *
 * So: for every golden question, take the reranked top-8 and record the score
 * alongside whether a KNOWN-correct article actually landed in the top 5. If
 * covered questions score visibly higher than missed ones, a threshold exists.
 * If the distributions overlap, they do not, and the gate needs a different
 * signal.
 *
 * Usage: npx tsx packages/backend/src/eval/calibrate-confidence.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vectorSearch, closeRetrieval } from '../retrieval/retrieve.js';
import { rerankChunks } from '../retrieval/rerank.js';

const EVAL_DIR = join(process.cwd(), 'data', 'eval');
const VECTOR_DIR = join(process.cwd(), 'data', 'vectors');
const POOL = 50;

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

/** Article-level key, matching the scorer's normalisation. */
const toArticleKey = (k: string): string => k.replace(/,\s*(մաս|ներածական)\b.*$/u, '').trim();

async function main(): Promise<void> {
  const rows = parseCsvRows(await readFile(join(EVAL_DIR, 'golden_verified.csv'), 'utf8')).slice(1);
  const expected = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.length < 4) continue;
    const q = r[0]!;
    (expected.get(q) ?? expected.set(q, new Set()).get(q)!).add(`${r[2]}#${r[3]}`);
  }

  const cached = new Map<string, number[]>();
  const raw = await readFile(join(VECTOR_DIR, 'gemini-embedding-2.queries.jsonl'), 'utf8');
  for (const line of raw.split('\n').filter(Boolean)) {
    const v = JSON.parse(line) as { id: string; vector: number[] };
    cached.set(v.id, v.vector);
  }

  interface Row { q: string; top1: number; mean3: number; hit5: boolean }
  const out: Row[] = [];

  for (const [q, want] of expected) {
    const qv = cached.get(q);
    if (!qv) continue;
    const pool = await vectorSearch(qv, POOL);
    const top = await rerankChunks(q, pool, 8);
    if (top.length === 0) continue;

    const keys = top.map((c) => toArticleKey(`${c.arlisId}#${c.ref}`));
    const wanted = new Set([...want].map(toArticleKey));
    const hit5 = keys.slice(0, 5).some((k) => wanted.has(k));

    out.push({
      q,
      top1: top[0]!.score,
      mean3: top.slice(0, 3).reduce((s, c) => s + c.score, 0) / Math.min(3, top.length),
      hit5,
    });
  }

  out.sort((a, b) => b.top1 - a.top1);
  console.log('top1   mean3  hit@5  question');
  for (const r of out) {
    console.log(
      `${r.top1.toFixed(3)}  ${r.mean3.toFixed(3)}  ${r.hit5 ? ' YES ' : ' no  '}  ${r.q.slice(0, 62)}`,
    );
  }

  const hits = out.filter((r) => r.hit5);
  const misses = out.filter((r) => !r.hit5);
  const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

  console.log(`\nn=${out.length}  covered=${hits.length}  missed=${misses.length}`);
  console.log(`covered: mean top1 ${avg(hits.map((r) => r.top1)).toFixed(3)}, min ${Math.min(...hits.map((r) => r.top1)).toFixed(3)}`);
  console.log(`missed : mean top1 ${avg(misses.map((r) => r.top1)).toFixed(3)}, max ${Math.max(...misses.map((r) => r.top1)).toFixed(3)}`);

  // Best achievable split on this signal: the threshold that maximises correct
  // classifications. Printed with its error counts so a weak separation is
  // obvious rather than hidden behind a single number.
  let best = { t: 0, correct: 0, falseConfident: 0, falseCautious: 0 };
  for (let t = 0.1; t <= 0.9; t += 0.005) {
    const falseConfident = misses.filter((r) => r.top1 >= t).length;
    const falseCautious = hits.filter((r) => r.top1 < t).length;
    const correct = out.length - falseConfident - falseCautious;
    if (correct > best.correct) best = { t, correct, falseConfident, falseCautious };
  }
  console.log(
    `\nbest top1 threshold ${best.t.toFixed(3)}: ${best.correct}/${out.length} correct ` +
      `(${best.falseConfident} confident-but-wrong, ${best.falseCautious} cautious-but-right)`,
  );

  await closeRetrieval();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
