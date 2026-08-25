/**
 * Does the number guard actually DETECT anything, or does it merely fail to
 * fire?
 *
 * A 40-question triage run produced zero legal-severity firings. That is the
 * result a perfect guard gives and also the result a vacuous one gives, and the
 * two are indistinguishable from the firing count alone. The distinction
 * matters here more than usual: generation is handed ~30,000 characters of
 * statute, which contains hundreds of numeric runs, so a bare integer like `5`
 * or `20` can be "verified" by coincidence — some unrelated provision somewhere
 * in context happens to contain it.
 *
 * So this measures POWER, not rate. Every number in every real answer is
 * perturbed into a number that is definitely false — the same shape, a
 * different value — and the guard is asked to catch it. A shape the guard
 * cannot catch under these conditions is a shape it does not protect, whatever
 * its firing count says.
 *
 * Reads the answers and article refs written by `triage.ts --out <name>`, and
 * re-fetches the fragment texts from the database by ref, so no API calls and
 * no generation are needed.
 *
 * Usage:
 *   npx tsx packages/backend/src/eval/number-guard-power.ts numbers-sample
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'dotenv/config';
import { db, closeDb } from '../db/pool.js';
import { validateNumbers } from '../answer/validateNumbers.js';

interface AnswerRow {
  url: string;
  title: string;
  answer: string;
  articles: string[];
  /** What generation actually read. Absent in runs made before it was stored. */
  chunkTexts?: string[];
}

const NUMBER = /\d+(?:[   .,]\d+)*/g;

/**
 * Perturb a number into one of the same shape that the fragments cannot
 * contain at that meaning — the counterfactual the guard should catch.
 *
 * Digits are shifted rather than randomised so the result stays plausible:
 * `9.2` becomes `9.7`, `288` becomes `299`. An implausible perturbation would
 * flatter the guard, since a number no model would ever emit is not the threat.
 */
function perturb(text: string): string {
  return text.replace(/\d/g, (d) => String((Number(d) + 5) % 10));
}

/** Which shape class a number belongs to — the unit this reports on. */
function shapeOf(text: string): string {
  const parts = text.split(/[^\d]+/).filter(Boolean);
  if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3)) return 'grouped amount';
  if (parts.length > 1) return 'hierarchical ref (9.2)';
  return `bare integer (${text.length} digit${text.length === 1 ? '' : 's'})`;
}

async function fragmentTexts(refs: string[]): Promise<string[]> {
  const sql = db();
  const out: string[] = [];
  for (const r of refs) {
    const at = r.indexOf('#');
    const arlisId = Number(r.slice(0, at));
    const ref = r.slice(at + 1);
    const rows = await sql<{ text_hy: string }[]>`
      SELECT a.text_hy
        FROM articles a JOIN documents d ON d.id = a.document_id
       WHERE d.arlis_id = ${arlisId} AND a.article_number = ${ref}
       LIMIT 1`;
    if (rows[0]) out.push(rows[0].text_hy);
  }
  return out;
}

async function main(): Promise<void> {
  const name = process.argv[2] ?? 'numbers-sample';
  const path = join(process.cwd(), 'data', 'eval', `${name}-answers.jsonl`);
  const rows = (await readFile(path, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AnswerRow);

  console.log(`power test over ${rows.length} real answers from ${name}\n`);

  const byShape = new Map<string, { total: number; caught: number; coincidental: number }>();
  let answersWithText = 0;
  let refetched = 0;

  for (const r of rows) {
    // Prefer the DELIVERED text; fall back to the database only for older runs
    // that did not store it, and say so — the two are not the same haystack,
    // and a silent fallback would make two runs look comparable when they are
    // measuring different things.
    const chunks = r.chunkTexts ?? (await fragmentTexts(r.articles));
    if (chunks.length === 0) continue;
    if (!r.chunkTexts) refetched++;
    answersWithText++;

    for (const m of r.answer.matchAll(NUMBER)) {
      const original = m[0];
      const at = m.index;
      const shape = shapeOf(original);
      const bucket = byShape.get(shape) ?? { total: 0, caught: 0, coincidental: 0 };

      /**
       * The number must be judged IN ITS SENTENCE. Validating it alone strips
       * the label beside it, which is half of what the guard checks — an
       * earlier version of this harness did exactly that and reported the
       * label-scoped guard as no better than the unscoped one, because it had
       * silently removed the labels first.
       */
      const sentence = (n: string): string =>
        r.answer.slice(Math.max(0, at - 120), at) + n + r.answer.slice(at + original.length, at + original.length + 120);

      const real = validateNumbers(sentence(original), chunks, []).checks.find(
        (c) => c.text === original,
      );
      if (real?.valid) bucket.coincidental++;

      // Would a false number of the same shape, in the same sentence, be caught?
      const fake = perturb(original);
      if (fake !== original) {
        bucket.total++;
        const check = validateNumbers(sentence(fake), chunks, []).checks.find((c) => c.text === fake);
        if (check && !check.valid) bucket.caught++;
      }
      byShape.set(shape, bucket);
    }
  }

  console.log(
    `answers scored: ${answersWithText}/${rows.length}` +
      (refetched
        ? ` (${refetched} fell back to database text — NOT what generation read)`
        : ' (delivered text)') +
      '\n',
  );
  console.log('shape                        n     caught (power)   real number passed');
  const order = [...byShape.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [shape, b] of order) {
    const power = b.total ? ((100 * b.caught) / b.total).toFixed(0) : '—';
    console.log(
      `${shape.padEnd(26)} ${String(b.total).padStart(4)}   ${String(b.caught).padStart(4)} (${String(power).padStart(3)}%)` +
        `      ${b.coincidental}`,
    );
  }

  const totals = [...byShape.values()].reduce(
    (a, b) => ({ total: a.total + b.total, caught: a.caught + b.caught, coincidental: 0 }),
    { total: 0, caught: 0, coincidental: 0 },
  );
  console.log(
    `\noverall power: ${totals.caught}/${totals.total} ` +
      `(${((100 * totals.caught) / (totals.total || 1)).toFixed(1)}%)`,
  );

  /**
   * Power is only half the question. The other half is what the guard says
   * about REAL answers in the configuration that would actually ship — user
   * figures exempted — because every one of those firings is a number a human
   * has to adjudicate, and a guard that is usually wrong cannot be allowed to
   * act. Printed in full rather than counted: a count cannot distinguish a
   * fabrication from a formatting difference, and those need opposite fixes.
   */
  const questions = new Map(
    (await readFile(join(process.cwd(), 'data', 'eval', 'accountant-am.jsonl'), 'utf8'))
      .split('\n').filter(Boolean)
      .map((l) => { const q = JSON.parse(l) as { url: string; question: string }; return [q.url, q.question]; }),
  );

  console.log('\n=== firings on REAL answers (shipped config: user figures exempt) ===');
  let legal = 0;
  let other = 0;
  for (const r of rows) {
    const chunks = r.chunkTexts ?? (await fragmentTexts(r.articles));
    if (chunks.length === 0) continue;
    const v = validateNumbers(r.answer, chunks, [questions.get(r.url) ?? ''], r.articles);
    legal += v.legalCount;
    other += v.otherCount;
    for (const c of v.checks.filter((x) => !x.valid && x.severity === 'legal')) {
      console.log(`  [${c.text}] ${r.title.slice(0, 34).padEnd(34)} ${c.context.slice(0, 96)}`);
    }
  }
  console.log(`\nlegal firings: ${legal} · other firings: ${other} · over ${rows.length} answers`);

  await closeDb();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
