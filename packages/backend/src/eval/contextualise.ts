/**
 * Pre-compute the contextualiser's rewrite for every golden question.
 *
 * `score.ts` embeds the golden question verbatim; `chat.ts` retrieves on the
 * REWRITE. So every benchmark number has been measured on an input production
 * never sends (`OPEN-ITEMS` 8). On 2026-08-24 that gap hid a real failure: the
 * turnover-tax line table is delivered for the raw phrasing and absent for the
 * rewrite, which differs only by a parenthetical moved four words left.
 *
 * Cached to disk for the same reason query vectors are: so the benchmark stays
 * runnable and deterministic without an LLM call per question per run. The
 * contextualiser is an LLM, but it was measured deterministic on repeat calls
 * (3/3 identical), so caching loses nothing but cost.
 *
 * Resumable — already-rewritten questions are skipped.
 *
 * Usage: npx tsx packages/backend/src/eval/contextualise.ts
 */
import { readFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'dotenv/config';
import { contextualize } from '../answer/contextualize.js';
import { loadGoldenSet } from './goldenSet.js';

const OUT = join(process.cwd(), 'data', 'eval', 'contextualised.jsonl');

async function main(): Promise<void> {
  const questions = [...(await loadGoldenSet()).keys()];

  const done = new Set<string>();
  try {
    for (const l of (await readFile(OUT, 'utf8')).split('\n').filter(Boolean)) {
      done.add((JSON.parse(l) as { raw: string }).raw);
    }
  } catch {
    /* first run */
  }

  const todo = questions.filter((q) => !done.has(q));
  console.log(`golden questions: ${questions.length}, todo: ${todo.length}`);

  let changed = 0;
  for (const [i, raw] of todo.entries()) {
    const ctx = await contextualize([], raw, '');
    const rewritten = ctx.standaloneQuery?.trim() || raw;
    if (rewritten !== raw) changed++;
    await appendFile(OUT, JSON.stringify({ raw, rewritten }) + '\n', 'utf8');
    if ((i + 1) % 10 === 0 || i === todo.length - 1) console.log(`  ${i + 1}/${todo.length}`);
  }

  console.log(`\nwrote ${OUT}`);
  if (todo.length) {
    console.log(`rewrites that differ from the raw question: ${changed}/${todo.length}`);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
