/**
 * Where does a required provision actually get lost?
 *
 * The golden set scores retrieval — question -> ranked article IDs — and stops
 * there. It cannot distinguish an article that was found and used from one that
 * was found, ranked first, and then trimmed out of the prompt. This classifies
 * every REQUIRED provision into three states, at PROVISION granularity:
 *
 *   NOT DELIVERED      its text was not in what generation read
 *   DELIVERED, USED    working as intended
 *   DELIVERED, UNUSED  we had it, we sent it, the answer ignored it
 *
 * **What it found first time out, and the finding is the opposite of the
 * assumption behind building it.** A user asked whether an EV charging station
 * on solar panels is "production activity" at 7% with a 5% expense deduction.
 * The answer got the rate right and omitted both the 3% deduction floor
 * (`Հոդված 258` part 3) and the exclusion of fixed-asset purchases from
 * deductible costs (part 6(2)) — the provision that decides the question for
 * someone who plans to BUY the solar stations.
 *
 * That looked like the project's oldest defect: delivered and not read. It was
 * not. `Հոդված 258` is 8,134 characters and `generationDocument` delivered
 * 1,672 of them; both provisions were outside the window. Measured across two
 * cases: **of provisions DELIVERED, 100% were used — and 50% of required
 * provisions were never delivered at all**, with 27–33% of retrieved characters
 * reaching the model.
 *
 * So the model reads what it is given. The bottleneck is what it is given, and
 * it sits in context assembly, downstream of a retrieval leg that had already
 * put the right article at rank 1.
 *
 * Requirements are hand-authored in `data/eval/required-provisions.jsonl`,
 * because "did the answer engage with this provision" is a judgement about
 * meaning that only a human can pin. `source` locates the provision in the
 * statute; `markers` are evidence the answer engaged with it. Markers are
 * deliberately generous: a false "USED" understates the defect, which is the
 * safer direction for a metric whose job is to expose it.
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
import { generationDocument } from '../retrieval/rerank.js';

interface Provision {
  id: string;
  chunk: string;
  /**
   * A literal string from the STATUTE identifying this provision.
   *
   * Delivery must be judged on the text generation actually received, not on
   * whether the chunk's name appeared in the retrieved list. The first version
   * of this file checked chunk membership and got the EV case exactly backwards:
   * `Հոդված 258` was retrieved at rank 1, so all four provisions counted as
   * delivered — but `generationDocument` reduced the article from 8,134
   * characters to 1,672, and both the 3% floor and the fixed-asset exclusion
   * were outside that window. The instrument blamed the model for a
   * context-assembly failure, which is the `Հոդված 267` part-5 mistake in
   * GOTCHAS repeated by the very tool built to catch it.
   */
  source: string;
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

    // The REDUCED text, which is what generation reads. Using `chunk.text` here
    // would measure a haystack the model never saw — the same mistake the
    // number guard's harness made, for the same reason.
    const docs = chunks.map((k) => generationDocument(k));
    const deliveredText = docs.join('\n\n---\n\n');

    const lang = answerLanguage(c.question) === 'ru' ? 'RUSSIAN' : 'ARMENIAN';
    const user = [
      `User message: ${c.question}`,
      `\n\nANSWER LANGUAGE: ${lang}.`,
      `\n\nLegal act fragments:\n\n${deliveredText}`,
    ].join('');

    const cov = new CoverageParser();
    let answer = '';
    await generate(
      { system: SYSTEM, history: [], user, onText: (d) => { answer += cov.feed(d); } },
      model,
    );
    answer += cov.flush();

    const storedChars = chunks.reduce((n, k) => n + k.text.length, 0);
    console.log(`## ${c.title}`);
    console.log(
      `   verdict: ${cov.coverage} · ${chunks.length} chunk(s) · ` +
        `${storedChars} chars stored -> ${deliveredText.length} delivered ` +
        `(${((100 * deliveredText.length) / (storedChars || 1)).toFixed(0)}%)`,
    );
    report.push(
      `## ${c.title}`,
      '',
      `- verdict: \`${cov.coverage}\``,
      `- delivered ${deliveredText.length} of ${storedChars} stored characters`,
      '',
    );

    for (const p of c.provisions) {
      const isDelivered = deliveredText.includes(p.source);
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
