/**
 * Does a reranker-score threshold buy us anything? Sweep it and see.
 *
 * Two different jobs get called "the threshold", and they have different right
 * answers, so this measures both separately:
 *
 *   A. GATE — below score t, declare the corpus does not cover the question.
 *      Useful only if covered and missed questions occupy different score
 *      ranges. Reported against the two degenerate baselines (always-confident,
 *      always-cautious) so a "best threshold" that merely restates the base
 *      rate is visible as the non-result it is.
 *
 *   B. CUTOFF — drop chunks scoring below t before generation sees them.
 *      This can only LOSE correct articles, never add one, so the question is
 *      not "which t is best" but "how high can t go before recall moves".
 *      Below that point the cut is free noise reduction; above it, we are
 *      trading correctness for tidiness.
 *
 * Runs the production path — pgvector top-50 → one-hop citation expansion →
 * rerank-2.5 shown prefix + matched slice — using cached query vectors, so the
 * numbers describe what ships and the run costs one rerank call per question.
 *
 * Usage:
 *   npx tsx packages/backend/src/eval/sweep-threshold.ts
 *   npx tsx packages/backend/src/eval/sweep-threshold.ts --question "Какая ставка НДС в Армении?"
 *   npx tsx packages/backend/src/eval/sweep-threshold.ts --json out.json
 */
import { writeFile } from 'node:fs/promises';
import { vectorSearch, expandOneHop, closeRetrieval } from '../retrieval/retrieve.js';
import { rerankChunks } from '../retrieval/rerank.js';
import type { RetrievedChunk } from '../retrieval/retrieve.js';
import { loadGoldenSet, loadQueryVectors, toArticleKey, questionScript } from './goldenSet.js';

/** Matches `RERANK_POOL` in the shipped retriever. */
const POOL = Number(process.env['RERANK_POOL'] ?? 50);
/** Chunks generation actually receives (`FRESH_LIMIT` in answer/chat.ts). */
const GEN_CHUNKS = 4;
/** Depth kept for analysis — wider than generation, to see what a cut removes. */
const DEPTH = 8;
/** Grid: fine enough to locate a knee, coarse enough to read. */
const GRID = Array.from({ length: 41 }, (_, i) => i * 0.025);

interface Probe {
  question: string;
  script: 'ru' | 'hy';
  /** Rerank scores, best first. */
  scores: number[];
  /** Whether each returned chunk is one of the expected articles. */
  correct: boolean[];
  /** Expected articles for this question. */
  wanted: number;
}

async function probe(
  question: string,
  qv: number[],
  wanted: Set<string>,
): Promise<Probe | null> {
  const pool = await vectorSearch(qv, POOL);
  if (pool.length === 0) return null;
  const expanded = await expandOneHop(pool);
  const top: RetrievedChunk[] = await rerankChunks(question, expanded, DEPTH);
  if (top.length === 0) return null;
  return {
    question,
    script: questionScript(question),
    scores: top.map((c) => c.score),
    correct: top.map((c) => wanted.has(toArticleKey(`${c.arlisId}#${c.ref}`))),
    wanted: wanted.size,
  };
}

function fmtPct(n: number, d: number): string {
  return d === 0 ? '  n/a' : `${((100 * n) / d).toFixed(1).padStart(5)}%`;
}

/** A. Can a top-1 cutoff tell covered questions from missed ones? */
function reportGate(probes: Probe[]): void {
  const rows = probes.map((p) => ({
    top1: p.scores[0] ?? 0,
    covered: p.correct.slice(0, 5).some(Boolean),
  }));
  const covered = rows.filter((r) => r.covered);
  const missed = rows.filter((r) => !r.covered);
  const n = rows.length;

  console.log('\n' + '='.repeat(72));
  console.log('A. GATE — top-1 rerank score as a coverage signal');
  console.log('='.repeat(72));
  if (covered.length === 0 || missed.length === 0) {
    console.log(`only one class present (covered ${covered.length}, missed ${missed.length}) — no separation measurable`);
    return;
  }
  const stat = (xs: number[]): string =>
    `mean ${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)}  ` +
    `range ${Math.min(...xs).toFixed(3)}–${Math.max(...xs).toFixed(3)}`;
  console.log(`covered (${String(covered.length).padStart(2)}): ${stat(covered.map((r) => r.top1))}`);
  console.log(`missed  (${String(missed.length).padStart(2)}): ${stat(missed.map((r) => r.top1))}`);

  // Overlap is the real verdict: how many covered questions score below the
  // best-scoring miss. If that number is large, no cutoff exists at any t.
  const worstMiss = Math.max(...missed.map((r) => r.top1));
  const buried = covered.filter((r) => r.top1 <= worstMiss).length;
  console.log(
    `\noverlap: ${buried}/${covered.length} covered questions score at or below the best miss (${worstMiss.toFixed(3)})`,
  );

  console.log('\n    t     correct   false-confident   false-cautious');
  let best = { t: -1, correct: -1, fc: 0, fk: 0 };
  for (const t of GRID) {
    const fc = missed.filter((r) => r.top1 >= t).length;
    const fk = covered.filter((r) => r.top1 < t).length;
    const correct = n - fc - fk;
    if (correct > best.correct) best = { t, correct, fc, fk };
    if (Math.round(t * 1000) % 100 === 0) {
      console.log(`  ${t.toFixed(3)}   ${String(correct).padStart(3)}/${n}        ${String(fc).padStart(3)}              ${String(fk).padStart(3)}`);
    }
  }

  // The baselines a threshold must beat to have earned its complexity.
  const alwaysConfident = covered.length; // t = 0: never gate
  const alwaysCautious = missed.length; // t = 1: always gate
  console.log(`\nbest t = ${best.t.toFixed(3)} → ${best.correct}/${n} correct (${best.fc} confident-but-wrong, ${best.fk} cautious-but-right)`);
  console.log(`baselines: always-confident ${alwaysConfident}/${n}, always-cautious ${alwaysCautious}/${n}`);
  const beat = best.correct - Math.max(alwaysConfident, alwaysCautious);
  console.log(
    beat > 0
      ? `VERDICT: a cutoff beats the trivial baseline by ${beat} question(s). Worth considering — re-check on a larger set before shipping.`
      : `VERDICT: no cutoff beats guessing the majority class. The score does not carry coverage information; keep the model's self-report.`,
  );
}

/** B. What does dropping low-scoring chunks cost before generation? */
function reportCutoff(probes: Probe[]): void {
  console.log('\n' + '='.repeat(72));
  console.log(`B. CUTOFF — drop chunks below t (generation receives ${GEN_CHUNKS})`);
  console.log('='.repeat(72));

  // Baseline: what generation gets today, with no cut at all.
  const baseHit = probes.filter((p) => p.correct.slice(0, GEN_CHUNKS).some(Boolean)).length;
  const baseFound = probes.reduce(
    (s, p) => s + p.correct.slice(0, GEN_CHUNKS).filter(Boolean).length,
    0,
  );
  const totalWanted = probes.reduce((s, p) => s + p.wanted, 0);
  console.log(`no cut: hit ${baseHit}/${probes.length}, ${baseFound}/${totalWanted} expected articles in context, ${GEN_CHUNKS}.00 chunks/question\n`);

  console.log('    t    hit@4        correct kept    chunks/q   empty context');
  let knee: number | null = null;
  for (const t of GRID) {
    let hit = 0, found = 0, kept = 0, empty = 0;
    for (const p of probes) {
      const idx = p.scores
        .map((s, i) => ({ s, i }))
        .filter((x) => x.s >= t)
        .slice(0, GEN_CHUNKS);
      kept += idx.length;
      if (idx.length === 0) empty++;
      const corr = idx.filter((x) => p.correct[x.i]).length;
      found += corr;
      if (corr > 0) hit++;
    }
    // The knee: the highest t at which nothing correct has been lost yet.
    if (found === baseFound && hit === baseHit) knee = t;
    if (Math.round(t * 1000) % 100 === 0) {
      console.log(
        `  ${t.toFixed(3)}  ${fmtPct(hit, probes.length)}      ${fmtPct(found, totalWanted)}         ${(kept / probes.length).toFixed(2)}        ${String(empty).padStart(3)}`,
      );
    }
  }
  console.log(
    knee === null
      ? '\nno safe cut: even t = 0.000 differs from the uncut baseline (unexpected — investigate)'
      : `\nhighest lossless cut: t = ${knee.toFixed(3)} — at or below this, dropping chunks costs no correct article.`,
  );
  if (knee !== null) {
    const at = probes.reduce(
      (s, p) => s + p.scores.filter((x) => x >= knee).slice(0, GEN_CHUNKS).length,
      0,
    ) / probes.length;
    console.log(
      at >= GEN_CHUNKS - 0.05
        ? `At that t nothing is actually dropped (${at.toFixed(2)} chunks/question) — a cut is available but pointless.`
        : `At that t generation sees ${at.toFixed(2)} chunks instead of ${GEN_CHUNKS}: less noise, same correct articles.`,
    );
  }
}

async function inspectOne(question: string): Promise<void> {
  const expected = await loadGoldenSet();
  const vectors = await loadQueryVectors();
  const qv = vectors.get(question);
  if (!qv) {
    console.error(`no cached query vector for that exact question.\nIt must match a golden-set question verbatim; run score.ts to refresh the cache.`);
    return;
  }
  const p = await probe(question, qv, expected.get(question) ?? new Set());
  if (!p) { console.error('retrieval returned nothing'); return; }
  console.log(`\n${question}\nexpected articles: ${p.wanted}\n`);
  console.log('rank  score   correct');
  p.scores.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2)}  ${s.toFixed(3)}   ${p.correct[i] ? 'YES' : ' — '}`);
  });
  console.log('\nwhat each cutoff would keep (generation takes the first 4):');
  for (const t of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
    const kept = p.scores.filter((s) => s >= t).length;
    const corr = p.scores.filter((s, i) => s >= t && p.correct[i]).length;
    console.log(`  t=${t.toFixed(2)}  keeps ${kept}/${p.scores.length}, of which correct ${corr}/${p.correct.filter(Boolean).length}`);
  }
}

async function main(): Promise<void> {
  const qIdx = process.argv.indexOf('--question');
  if (qIdx >= 0) {
    await inspectOne(process.argv[qIdx + 1] ?? '');
    await closeRetrieval();
    return;
  }

  const expected = await loadGoldenSet();
  const vectors = await loadQueryVectors();
  const probes: Probe[] = [];
  let skipped = 0;

  for (const [q, wanted] of expected) {
    const qv = vectors.get(q);
    if (!qv) { skipped++; continue; }
    const p = await probe(q, qv, wanted);
    if (p) probes.push(p);
    process.stderr.write(`\r  ${probes.length}/${expected.size}   `);
  }
  process.stderr.write('\r');

  const ru = probes.filter((p) => p.script === 'ru').length;
  console.log(`questions: ${probes.length} (${skipped} without a cached query vector)`);
  console.log(`language mix: ${ru} Russian, ${probes.length - ru} Armenian`);
  console.log(
    'CAVEAT: real traffic measured on accountant.am is 3 Russian / 247 Armenian.\n' +
      'Any threshold chosen here is calibrated on a language mix users do not send.',
  );

  reportGate(probes);
  reportCutoff(probes);

  const jIdx = process.argv.indexOf('--json');
  if (jIdx >= 0 && process.argv[jIdx + 1]) {
    await writeFile(process.argv[jIdx + 1]!, JSON.stringify(probes, null, 2));
    console.log(`\nraw scores → ${process.argv[jIdx + 1]}`);
  }

  await closeRetrieval();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
