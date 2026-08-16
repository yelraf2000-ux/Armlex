/**
 * Golden-set candidate proposal, v2.
 *
 * v1 (propose.ts) mapped each question to a hand-written RU→HY glossary and
 * ranked by FTS score. Verification exposed it as broken: 77/89 candidates
 * were rejected, and for "какой порог оборота" it proposed a VAT-registration
 * article and a transitional-provisions article while never surfacing
 * Հոդված 254 «Շրջանառության հարկ վճարողները» — the article whose TITLE is
 * almost a direct translation of the question. The corpus has the answer;
 * the glossary-FTS heuristic couldn't find it.
 *
 * v2 replaces heuristic ranking with the thing that actually works here: an
 * LLM given the corpus's full title index (885 titles is small enough to fit
 * in one context) reading Armenian titles and picking candidates directly.
 * This is a title-matching task, which is exactly what a Russian-fluent,
 * Armenian-literate model does well — no lexical-overlap heuristic required.
 *
 * Output is compatible with verify.ts's input format, so the existing
 * verification pass (read full article text, judge yes/partial/no) is
 * unchanged and still catches any title-only false positive.
 *
 * Usage: npx tsx packages/backend/src/eval/proposeV2.ts
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import postgres from 'postgres';
import { config } from '@armlex/shared';
import { QUESTIONS } from './questions.js';

const MODEL = 'claude-sonnet-5';
const EVAL_DIR = join(process.cwd(), 'data', 'eval');
const CANDIDATES_PER_QUESTION = 6;

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer', description: 'Question number, matching the input list.' },
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                arlisId: { type: 'integer' },
                ref: { type: 'string', description: 'Exact ref string from the index, e.g. "Հոդված 254".' },
                confidence: { type: 'string', enum: ['high', 'med', 'low'] },
              },
              required: ['arlisId', 'ref', 'confidence'],
              additionalProperties: false,
            },
          },
        },
        required: ['n', 'candidates'],
        additionalProperties: false,
      },
    },
  },
  required: ['answers'],
  additionalProperties: false,
} as const;

const SYSTEM = `You are selecting candidate legal-act provisions for a retrieval evaluation set on Armenian tax law.

You are given the FULL TITLE INDEX of the corpus — every provision's ARLIS act id, its ref (article/point/annex label), and its Armenian title — plus a list of Russian questions.

For each question, return up to ${CANDIDATES_PER_QUESTION} candidate provisions from the index whose TITLE suggests it answers the question, ordered best-first.

Rules:
- Only propose refs that literally appear in the index — copy arlisId and ref exactly.
- Prefer specific, on-topic titles over generic ones (e.g. a "Rates of X" article over a general "Object of taxation" article, when the question asks about a rate).
- Include lower-confidence guesses too (mark them "low") when unsure — a downstream step verifies against full article text, so recall matters more than precision here.
- If truly nothing in the index looks relevant, return an empty candidates array for that question rather than forcing a match.`;

async function main(): Promise<void> {
  const sql = postgres(config.databaseUrl, { onnotice: () => {} });
  const client = new Anthropic();

  try {
    const rows = await sql<{ arlis_id: number; article_number: string; title: string | null }[]>`
      SELECT d.arlis_id, a.article_number, a.title
      FROM articles a
      JOIN documents d ON d.id = a.document_id
      WHERE d.rag_eligible AND d.status = 'in_force'
      ORDER BY d.arlis_id, a.ord
    `;
    console.log(`title index: ${rows.length} entries`);

    const index = rows
      .map((r) => `${r.arlis_id}\t${r.article_number}\t${r.title ?? '(без заголовка)'}`)
      .join('\n');

    const questionList = QUESTIONS.map((q) => `${q.n}. ${q.question}`).join('\n');

    console.log('calling judge model over full title index...');
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `TITLE INDEX (arlisId\\tref\\ttitle):\n\n${index}\n\nQUESTIONS:\n\n${questionList}`,
        },
      ],
    });

    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = JSON.parse(raw) as {
      answers: { n: number; candidates: { arlisId: number; ref: string; confidence: string }[] }[];
    };

    const byN = new Map(parsed.answers.map((a) => [a.n, a.candidates]));

    const csvCell = (v: unknown): string =>
      `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

    const csvRows: string[] = [
      ['question', 'lang', 'arlisId', 'ref', 'snippet', 'confidence'].join(','),
    ];
    let none = 0;
    for (const q of QUESTIONS) {
      const candidates = byN.get(q.n) ?? [];
      if (candidates.length === 0) {
        csvRows.push([csvCell(q.question), csvCell(q.lang), '', '', '', csvCell('none')].join(','));
        none++;
        console.log(`  Q${q.n} NONE`);
        continue;
      }
      for (const c of candidates) {
        csvRows.push(
          [csvCell(q.question), csvCell(q.lang), c.arlisId, csvCell(c.ref), '', csvCell(c.confidence)].join(','),
        );
      }
      console.log(`  Q${q.n} ${candidates.length} candidates: ${candidates.map((c) => `${c.arlisId}#${c.ref}`).join(', ')}`);
    }

    await writeFile(join(EVAL_DIR, 'golden_proposed_v2.csv'), csvRows.join('\n') + '\n', 'utf8');
    console.log(`\nwrote golden_proposed_v2.csv: ${csvRows.length - 1} rows, ${QUESTIONS.length - none}/${QUESTIONS.length} questions got ≥1 candidate`);
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
