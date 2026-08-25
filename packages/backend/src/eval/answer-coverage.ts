/**
 * Did the answer USE what retrieval delivered?
 *
 * The golden set scores retrieval: question -> ranked article IDs. It cannot
 * see this failure at all. On 2026-08-25 a user asked whether an EV charging
 * station built on solar panels is "production activity" taxed at 7% with a 5%
 * expense deduction. Retrieval returned `Հոդված 258` at rank 1 and the
 * calculation table at rank 2 — a perfect score. The answer then quoted the 7%
 * rate and the 5% mechanism correctly and silently dropped two provisions that
 * were in the delivered text:
 *
 *   - part 3's second sentence, capping the deduction so the tax stays at 3%
 *     of the base (also line 6.9 of the same table it quoted from);
 *   - part 6(2), which excludes fixed-asset purchases from deductible costs —
 *     decisive, because the asker plans to BUY the solar stations.
 *
 * An accountant acting on that answer computes the wrong tax and expects a
 * deduction they cannot take. The golden set would have scored the question
 * 100%.
 *
 * This is the project's most persistent defect (`Հոդված 288` at rank 4 never
 * read; `254` at 6; `112` at 7; `կետ 63` delivered and half-used) and it has
 * never had a number. This gives it one, by classifying each REQUIRED provision
 * into exactly three states:
 *
 *   NOT DELIVERED    retrieval's problem — the chunk never reached generation
 *   DELIVERED, USED  working as intended
 *   DELIVERED, UNUSED  the defect: we had it, we sent it, the answer ignored it
 *
 * Requirements are hand-authored in `data/eval/required-provisions.jsonl`,
 * because "did the answer engage with this provision" is a judgement about
 * meaning that only a human can pin. Each provision carries literal markers —
 * a rate, a term, a line number — whose presence is evidence of engagement.
 * Markers are deliberately generous: a false "USED" understates the defect,
 * which is the safer direction for a metric whose job is to expose it.
 *
 * Usage:
 *   npx tsx packages/backend/src/eval/answer-coverage.ts
 *   npx tsx packages/backend/src/eval/answer-coverage.ts --model gemini-3.5-flash-lite
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'dotenv/config';
import { contextualize } from '../answer/contextualize.js';
import { generate, DEFAULT_MODEL } from '../answer/llm.js';
import { SYSTEM } from '../answer/chat.js';
import { CoverageParser } from '../answer/coverage.js';
import { answerLanguage } from '../answer/language.js';
import { retrieve, closeRetrieval } from '../retrieval/retrieve.js';

interface Provision {
  id: string;
  chunk: string;
  markers: string[];
  note: string;
}
interface Case {
  question: string;
  title: string;
  provisions: Provision[];
}

type State = 'NOT DELIVERED' | 'DELIVERED, USED' | 'DELIVERED, UNUSED';

/** Whitespace-insensitive containment; markers are short literals, not quotes. */
function mentions(answer: string, markers: string[]): boolean {
  const hay = answer.replace(/\s+/g, ' ');
  return markers.some((m) => hay.includes(m.replace(/\s+/g, ' ')));
}

async function main(): Promise<void> {
  const modelIdx = process.argv.indexOf('--model');
  const model = modelIdx >= 0 ? process.argv[modelIdx + 1]! : DEFAULT_MODEL;

  const path = join(process.cwd(), 'data', 'eval', 'required-provisions.jsonl');
  const cases = (await readFile(path, 'utf8'))
    .split('\n').filter(Boolean).map((l) => JSON.parse(l) as Case);

  console.log(`answer coverage over ${cases.length} case(s), model ${model}\n`);

  const tally: Record<State, number> = {
    'NOT DELIVERED': 0,
    'DELIVERED, USED': 0,
    'DELIVERED, UNUSED': 0,
  };
  const report: string[] = [];

  for (const c of cases) {
    const ctx = await contextualize([], c.question);
    const query = [ctx.standaloneQuery, ctx.searchTerms].filter(Boolean).join(' ');
    const chunks = ctx.needsRetrieval ? await retrieve(query, 4) : [];
    const delivered = new Set(chunks.map((k) => `${k.arlisId}#${k.ref}`));

    const lang = answerLanguage(c.question) === 'ru' ? 'RUSSIAN' : 'ARMENIAN';
    const user = [
      `User message: ${c.question}`,
      `\n\nANSWER LANGUAGE: ${lang}.`,
      `\n\nLegal act fragments:\n\n${chunks.map((k) => k.text).join('\n\n---\n\n')}`,
    ].join('');

    const cov = new CoverageParser();
    let answer = '';
    await generate(
      { system: SYSTEM, history: [], user, onText: (d) => { answer += cov.feed(d); } },
      model,
    );
    answer += cov.flush();

    console.log(`## ${c.title}`);
    console.log(`   coverage verdict: ${cov.coverage} · ${chunks.length} chunk(s) delivered`);
    report.push(`## ${c.title}`, '', `- verdict: \`${cov.coverage}\``, '');

    for (const p of c.provisions) {
      const isDelivered = delivered.has(p.chunk);
      const state: State = !isDelivered
        ? 'NOT DELIVERED'
        : mentions(answer, p.markers)
          ? 'DELIVERED, USED'
          : 'DELIVERED, UNUSED';
      tally[state]++;
      const flag = state === 'DELIVERED, UNUSED' ? ' <<<' : '';
      console.log(`   ${state.padEnd(18)} ${p.id.padEnd(24)} ${p.chunk}${flag}`);
      report.push(`- \`${state}\` — **${p.id}** (${p.chunk})  \n  ${p.note}`);
    }
    console.log();
    report.push('');
  }

  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  console.log('=== ANSWER COVERAGE ===');
  for (const [k, v] of Object.entries(tally)) {
    console.log(`${k.padEnd(18)} ${String(v).padStart(3)} (${((100 * v) / total).toFixed(0)}%)`);
  }
  // The headline: of everything retrieval got right, how much did the answer use?
  const deliveredTotal = tally['DELIVERED, USED'] + tally['DELIVERED, UNUSED'];
  const used = deliveredTotal ? (100 * tally['DELIVERED, USED']) / deliveredTotal : 0;
  console.log(`\nof provisions DELIVERED, ${used.toFixed(0)}% were used by the answer`);

  await writeFile(
    join(process.cwd(), 'data', 'eval', 'answer-coverage.md'),
    `# Answer coverage — model \`${model}\`\n\n` +
      `Of provisions DELIVERED to generation, **${used.toFixed(0)}%** were used.\n\n` +
      report.join('\n') + '\n',
    'utf8',
  );

  await closeRetrieval();
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
