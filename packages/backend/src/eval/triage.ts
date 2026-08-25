/**
 * Stage-1 triage: run harvested real-world questions through the pipeline and
 * let the system's own instrumentation flag failures — no ground truth needed.
 *
 * For each question: contextualise → retrieve → generate with the CHEAP model
 * (Flash-Lite via the seam) → record the self-diagnosis. Nothing touches the
 * sessions tables; this is measurement, not usage.
 *
 * What each signal means:
 *   coverage none/partial — corpus or retrieval could not carry the question
 *   invalidQuotes > 0     — the model asserted something it could not prove
 *   unsourcedLegal > 0    — stated a line/point/rate/deadline number that is in
 *                           no fragment (REPORT ONLY, see validateNumbers.ts)
 *   asksForArticle        — named a norm it needed instead of citing it
 *                           (Class-2 smell: it may be sitting in our corpus)
 *   lowTopScore           — reranker's best candidate is weak (Class-1 smell)
 *
 * Output: data/eval/triage-results.jsonl (one line per question, resumable)
 * and a summary table. Cost ≈ $0.012/question.
 *
 * The ANSWER TEXT goes to a sibling `-answers.jsonl`. Storing only metadata was
 * a false economy: every later question about answer quality — is a `full`
 * verdict a good answer, does the number guard fire on valid input — needed the
 * text and had to pay for a fresh run to get it. It is kept out of the results
 * file so that file stays small and diff-comparable.
 *
 * Usage:
 *   npx tsx packages/backend/src/eval/triage.ts              # all harvested
 *   npx tsx packages/backend/src/eval/triage.ts --limit 50
 *   npx tsx packages/backend/src/eval/triage.ts --limit 40 --out numbers-sample
 */
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'dotenv/config';
import { contextualize } from '../answer/contextualize.js';
import { generate } from '../answer/llm.js';
import { SYSTEM } from '../answer/chat.js';
import { CoverageParser } from '../answer/coverage.js';
import { validateQuotes } from '../answer/validateQuotes.js';
import { validateNumbers } from '../answer/validateNumbers.js';
import { answerLanguage } from '../answer/language.js';
import { retrieve, closeRetrieval } from '../retrieval/retrieve.js';

const EVAL_DIR = join(process.cwd(), 'data', 'eval');
const IN = join(EVAL_DIR, 'accountant-am.jsonl');

/**
 * `--out <name>` redirects both output files, so a fresh sample can be taken
 * without touching the 250-question baseline that every headline figure and
 * every `triage-diff` comparison rests on. Resume is keyed to whichever pair is
 * selected.
 */
const outIdx = process.argv.indexOf('--out');
const OUT_NAME = outIdx >= 0 ? process.argv[outIdx + 1]! : 'triage-results';
const OUT = join(EVAL_DIR, `${OUT_NAME}.jsonl`);
const OUT_ANSWERS = join(EVAL_DIR, `${OUT_NAME}-answers.jsonl`);

/** Cheap and fast; triage needs volume, not eloquence. */
const TRIAGE_MODEL = 'gemini-3.5-flash-lite';

interface Question {
  url: string;
  title: string;
  date: string | null;
  question: string;
}

interface Triage {
  url: string;
  title: string;
  date: string | null;
  coverage: string | null;
  invalidQuotes: number;
  topScore: number | null;
  articles: string[];
  /** The answer names a Հոդված absent from what was retrieved. */
  asksForArticle: string[];
  /** Numbers stated with a legal label that appear in no fragment. Report only. */
  unsourcedLegal: number;
  /** Unsourced numbers without a legal label — mostly the model's arithmetic. */
  unsourcedOther: number;
  /** The flagged numbers in context, so a firing can be judged without a re-run. */
  unsourced: { text: string; severity: string; context: string }[];
  answerChars: number;
  ms: number;
  error?: string;
}

async function done(): Promise<Set<string>> {
  try {
    const raw = await readFile(OUT, 'utf8');
    return new Set(raw.split('\n').filter(Boolean).map((l) => (JSON.parse(l) as Triage).url));
  } catch {
    return new Set();
  }
}

/** Հոդված numbers mentioned in the answer but not among retrieved articles. */
function namedNotRetrieved(answer: string, retrieved: string[]): string[] {
  const have = new Set(retrieved.map((r) => /Հոդված\s+([\d.]+)/u.exec(r)?.[1]).filter(Boolean));
  const named = new Set<string>();
  for (const m of answer.matchAll(/Հոդված\s+(\d+(?:\.\d+)?)/gu)) {
    if (!have.has(m[1]!)) named.add(m[1]!);
  }
  return [...named];
}

async function main(): Promise<void> {
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : Infinity;

  const raw = await readFile(IN, 'utf8');
  const all = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Question);
  const skip = await done();
  const todo = all.filter((q) => !skip.has(q.url)).slice(0, limit);
  console.log(`triage: ${all.length} harvested, ${skip.size} done, running ${todo.length}\n`);

  let i = 0;
  for (const q of todo) {
    const t0 = Date.now();
    try {
      const ctx = await contextualize([], q.question);
      const query = [ctx.standaloneQuery, ctx.searchTerms].filter(Boolean).join(' ');
      const chunks = ctx.needsRetrieval ? await retrieve(query, 4) : [];

      const lang = answerLanguage(q.question) === 'ru' ? 'RUSSIAN' : 'ARMENIAN';
      const user = [
        `User message: ${q.question}`,
        `\n\nANSWER LANGUAGE: ${lang}.`,
        `\n\nLegal act fragments:\n\n${chunks.map((c) => c.text).join('\n\n---\n\n')}`,
      ].join('');

      const cov = new CoverageParser();
      let answer = '';
      await generate(
        { system: SYSTEM, history: [], user, onText: (d) => { answer += cov.feed(d); } },
        TRIAGE_MODEL,
      );
      answer += cov.flush();

      const chunkTexts = chunks.map((c) => c.text);
      const quotes = validateQuotes(answer, chunkTexts);
      const articles = chunks.map((c) => `${c.arlisId}#${c.ref}`);

      // Numbers are checked against the SANITIZED answer: a number inside a
      // quote that was already stripped is not a claim the reader will see, and
      // counting it would double-report one failure as two.
      // Act numbers («N 300-Ն») identify the DOCUMENT and appear neither in a
      // chunk's text nor in its ref, so citing one read as a fabrication. They
      // are labelled here the way the answer writes them, so the ordinary
      // family rule applies rather than a special case.
      const sources = [
        ...articles,
        ...new Set(chunks.map((c) => c.actNumber).filter(Boolean).map((n) => `հրաման N ${n}`)),
      ];
      const numbers = validateNumbers(quotes.sanitized, chunkTexts, [q.question], sources);
      const flagged = numbers.checks.filter((c) => !c.valid);

      // The CHUNK TEXTS are stored, not just their refs. Re-fetching an
      // article by ref afterwards gets `text_hy`, which is not what generation
      // read — the delivered text is part-reduced — so a guard measured against
      // the database is measured against the wrong haystack. Cost is disk; the
      // alternative is paying for a fresh run every time a question about
      // answer quality comes up, which is what storing metadata alone forced.
      await appendFile(
        OUT_ANSWERS,
        JSON.stringify({ url: q.url, title: q.title, answer, articles, chunkTexts }) + '\n',
        'utf8',
      );

      const row: Triage = {
        url: q.url,
        title: q.title,
        date: q.date,
        coverage: cov.coverage,
        invalidQuotes: quotes.invalidCount,
        topScore: chunks[0]?.score ?? null,
        articles,
        asksForArticle: namedNotRetrieved(answer, articles),
        unsourcedLegal: numbers.legalCount,
        unsourcedOther: numbers.otherCount,
        unsourced: flagged.map((c) => ({
          text: c.text,
          severity: c.severity,
          context: c.context,
        })),
        answerChars: answer.length,
        ms: Date.now() - t0,
      };
      await appendFile(OUT, JSON.stringify(row) + '\n', 'utf8');

      i++;
      const flag =
        row.coverage !== 'full' ? row.coverage : row.invalidQuotes > 0 ? 'quotes!' : 'ok';
      console.log(`${String(i).padStart(3)}/${todo.length} [${flag}] ${q.title.slice(0, 55)}`);
    } catch (err) {
      await appendFile(
        OUT,
        JSON.stringify({ url: q.url, title: q.title, date: q.date, error: String(err).slice(0, 150), ms: Date.now() - t0 }) + '\n',
        'utf8',
      );
      console.log(`${String(++i).padStart(3)}/${todo.length} [ERROR] ${q.title.slice(0, 50)}`);
    }
  }

  // --- summary ---------------------------------------------------------------
  const rows = (await readFile(OUT, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Triage);
  const n = rows.length;
  const count = (f: (r: Triage) => boolean): string => {
    const c = rows.filter(f).length;
    return `${c} (${((100 * c) / n).toFixed(0)}%)`;
  };
  console.log(`\n=== TRIAGE SUMMARY over ${n} real questions ===`);
  console.log(`coverage full     : ${count((r) => r.coverage === 'full')}`);
  console.log(`coverage partial  : ${count((r) => r.coverage === 'partial')}`);
  console.log(`coverage none     : ${count((r) => r.coverage === 'none')}`);
  console.log(`no header/error   : ${count((r) => !r.coverage)}`);
  console.log(`invalid quotes    : ${count((r) => (r.invalidQuotes ?? 0) > 0)}`);
  console.log(`names unretrieved article (Class-2 smell): ${count((r) => (r.asksForArticle?.length ?? 0) > 0)}`);

  // Report only — nothing is rewritten or withheld on these. The point of the
  // run is to learn how often the guard fires and on what, BEFORE deciding
  // whether it may act. A guard that fires on valid input is worse than none.
  console.log(`\n--- number guard (REPORT ONLY) ---`);
  console.log(`unsourced legal number : ${count((r) => (r.unsourcedLegal ?? 0) > 0)}`);
  console.log(`unsourced other number : ${count((r) => (r.unsourcedOther ?? 0) > 0)}`);
  const legalHits = rows.flatMap((r) => (r.unsourced ?? []).filter((u) => u.severity === 'legal'));
  console.log(`total legal firings    : ${legalHits.length}`);
  for (const h of legalHits.slice(0, 25)) console.log(`  ${h.text.padEnd(14)} ${h.context.slice(0, 90)}`);

  await closeRetrieval();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
