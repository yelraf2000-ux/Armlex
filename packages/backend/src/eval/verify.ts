/**
 * Golden-set self-verification.
 *
 * The proposals in golden_proposed.csv came from glossary-assisted FTS — a
 * ranking heuristic, not ground truth. Before any recall number is computed
 * against them, each high/med candidate is checked the only way that means
 * anything: by reading the article text and judging whether it actually
 * contains the norm the question asks about.
 *
 * The judge is claude-sonnet-5 with a strict rubric. This inherits the
 * judge's blind spots — acceptable for CHOOSING BETWEEN embedding models
 * (all models face the same targets), weaker as an absolute quality claim.
 * The output marks every verdict so a later human pass can override.
 *
 * Low-confidence rows are also judged (they cost the same) but a question
 * whose every candidate is rejected is EXCLUDED from the eval and listed for
 * manual resolution — a question with a wrong "correct answer" is worse than
 * no question, because it penalises the model that gets it right.
 *
 * Usage: npx tsx packages/backend/src/eval/verify.ts
 * Output: data/eval/golden_verified.csv + verification_report.md
 */
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import postgres from 'postgres';
import { config } from '@armlex/shared';

const JUDGE_MODEL = 'claude-sonnet-5';
const EVAL_DIR = join(process.cwd(), 'data', 'eval');

interface ProposedRow {
  question: string;
  lang: string;
  arlisId: number;
  ref: string;
  confidence: string;
}

interface Verdict {
  verdict: 'yes' | 'partial' | 'no';
  reason: string;
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['yes', 'partial', 'no'],
      description:
        'yes = the article contains the norm that directly answers the question. partial = it governs the topic and a professional would open it, but the decisive element is elsewhere. no = it does not answer the question.',
    },
    reason: { type: 'string', description: 'One sentence, in Russian.' },
  },
  required: ['verdict', 'reason'],
  additionalProperties: false,
} as const;

const JUDGE_SYSTEM = `You verify a retrieval gold set for Armenian tax law.

Given a QUESTION (Russian) and the full text of one ARTICLE (Armenian), decide whether this article is a correct "expected answer" for the question — i.e. whether a retrieval system returning this article for this question should be scored as CORRECT.

Rules:
- Judge only from the article text given. Do not use outside knowledge of Armenian law.
- "yes" requires the answering norm to be IN this article — not merely referenced by it.
- "partial" is for articles a tax professional would genuinely need to open for this question (they govern the asked topic), even if one decisive detail lives in a neighbouring article.
- "no" for topical adjacency without answering power — same tax, wrong aspect.
- Be strict: a gold set polluted with weak matches rewards bad retrieval.`;

function parseCsv(text: string): ProposedRow[] {
  // Simple state machine — the file is our own output, quoted with "".
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

  return rows
    .slice(1) // header
    .filter((r) => r.length >= 6 && r[2] !== '')
    .map((r) => ({
      question: r[0]!,
      lang: r[1]!,
      arlisId: Number(r[2]),
      ref: r[3]!,
      confidence: r[5]!,
    }));
}

function csvCell(v: unknown): string {
  return `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
}

async function main(): Promise<void> {
  const sql = postgres(config.databaseUrl, { onnotice: () => {} });
  const client = new Anthropic();

  try {
    const inputFile = process.argv[2] || 'golden_proposed.csv';
    const proposed = parseCsv(
      await readFile(join(EVAL_DIR, inputFile), 'utf8'),
    );
    console.log(`input: ${inputFile}`);

    // Every verdict is journaled immediately; the CSV and report are derived
    // from the journal at the end. A killed run therefore loses at most one
    // in-flight judgment, and a rerun skips everything already judged.
    const journalPath = join(EVAL_DIR, 'judgments.jsonl');
    interface JournalEntry {
      question: string;
      lang: string;
      arlisId: number;
      ref: string;
      verdict: 'yes' | 'partial' | 'no';
      reason: string;
    }
    const journal: JournalEntry[] = [];
    try {
      for (const line of (await readFile(journalPath, 'utf8')).split('\n')) {
        if (line.trim()) journal.push(JSON.parse(line) as JournalEntry);
      }
    } catch {
      /* first run */
    }
    const judged = new Set(journal.map((j) => `${j.question}|${j.arlisId}|${j.ref}`));
    console.log(`candidates: ${proposed.length}, already judged: ${judged.size}`);

    const byQuestion = new Map<string, { accepted: number; judged: number }>();
    let apiCalls = 0;

    for (const [i, row] of proposed.entries()) {
      if (judged.has(`${row.question}|${row.arlisId}|${row.ref}`)) continue;

      const [art] = await sql<{ text_hy: string; title_hy: string }[]>`
        SELECT a.text_hy, d.title_hy
        FROM articles a JOIN documents d ON d.id = a.document_id
        WHERE d.arlis_id = ${row.arlisId} AND a.article_number = ${row.ref}
      `;
      if (!art) {
        console.log(`  [${i + 1}] MISSING ${row.arlisId}#${row.ref} — skipped`);
        continue;
      }

      // Cap very large articles; the operative norms come early, and a 90k-token
      // judgment per row is not worth the marginal accuracy on rate tables.
      const text =
        art.text_hy.length > 20000
          ? `${art.text_hy.slice(0, 20000)}\n…[обрезано: статья длиннее 20k символов]`
          : art.text_hy;

      let verdict: Verdict;
      try {
        apiCalls++;
        const res = await client.messages.create({
          model: JUDGE_MODEL,
          max_tokens: 512,
          system: JUDGE_SYSTEM,
          output_config: { format: { type: 'json_schema', schema: VERDICT_SCHEMA } },
          messages: [
            {
              role: 'user',
              content: `QUESTION (ru): ${row.question}\n\nARTICLE ${row.arlisId} · ${row.ref} · ${art.title_hy}:\n\n${text}`,
            },
          ],
        });
        const raw = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        verdict = JSON.parse(raw) as Verdict;
      } catch (err) {
        console.log(`  [${i + 1}] JUDGE ERROR ${String(err).slice(0, 80)} — kept as unjudged`);
        continue;
      }

      const entry: JournalEntry = {
        question: row.question,
        lang: row.lang,
        arlisId: row.arlisId,
        ref: row.ref,
        verdict: verdict.verdict,
        reason: verdict.reason,
      };
      journal.push(entry);
      await appendFile(journalPath, JSON.stringify(entry) + '\n', 'utf8');
      console.log(
        `  [${i + 1}/${proposed.length}] ${verdict.verdict.padEnd(7)} ${row.arlisId}#${row.ref.slice(0, 24).padEnd(24)} ${verdict.reason.slice(0, 60)}`,
      );
    }

    // Derive outputs from the full journal (this run + prior runs).
    const outRows: string[] = [
      ['question', 'lang', 'arlisId', 'ref', 'verdict', 'reason'].join(','),
    ];
    for (const j of journal) {
      const stat = byQuestion.get(j.question) ?? { accepted: 0, judged: 0 };
      byQuestion.set(j.question, stat);
      stat.judged++;
      if (j.verdict !== 'no') {
        stat.accepted++;
        outRows.push(
          [
            csvCell(j.question),
            csvCell(j.lang),
            j.arlisId,
            csvCell(j.ref),
            csvCell(j.verdict),
            csvCell(j.reason),
          ].join(','),
        );
      }
    }

    await writeFile(join(EVAL_DIR, 'golden_verified.csv'), outRows.join('\n') + '\n', 'utf8');

    // Report: which questions survived, which need manual resolution.
    const resolved = [...byQuestion.entries()].filter(([, s]) => s.accepted > 0);
    const unresolved = [...byQuestion.entries()].filter(([, s]) => s.accepted === 0);

    const report = [
      '# Golden set verification report',
      '',
      `Judge: ${JUDGE_MODEL} · candidates judged: ${apiCalls}`,
      `Questions with ≥1 verified answer: **${resolved.length} / ${byQuestion.size}**`,
      '',
      '## Unresolved questions (all candidates rejected — need manual refs)',
      '',
      ...(unresolved.length
        ? unresolved.map(([q]) => `- ${q}`)
        : ['(none)']),
      '',
      '## Verified questions',
      '',
      ...resolved.map(([q, s]) => `- (${s.accepted}/${s.judged}) ${q}`),
    ].join('\n');

    await writeFile(join(EVAL_DIR, 'verification_report.md'), report, 'utf8');
    console.log(
      `\nverified rows: ${outRows.length - 1} · questions resolved: ${resolved.length}/${byQuestion.size} · unresolved: ${unresolved.length}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
