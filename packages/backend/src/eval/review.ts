/**
 * Read back what real users asked and what they were told.
 *
 * Every turn is persisted to `sessions` / `messages`, but until now the only
 * way to read it was the session list in the UI, one conversation at a time.
 * Handing the app to a tester makes that the wrong shape: you want the whole
 * session in one scrollable place, and you want to export it.
 *
 * What this CAN show: the questions, the answers, timing, session grouping.
 * What it CANNOT show, because nothing persists it: which articles were
 * retrieved, the coverage verdict, how many quotes were stripped, the model, or
 * the cost. All of that is sent to the browser in the `done` SSE event and then
 * dropped. That gap matters more than it sounds — 2026-08-25 showed twice over
 * that the first question about any bad answer is "what text did generation
 * actually receive", and for a live session we cannot answer it after the fact.
 * See OPEN-ITEMS.
 *
 * Usage:
 *   npx tsx packages/backend/src/eval/review.ts                # last 20 sessions
 *   npx tsx packages/backend/src/eval/review.ts --since 2026-08-25
 *   npx tsx packages/backend/src/eval/review.ts --full         # print every turn
 *   npx tsx packages/backend/src/eval/review.ts --out review.md
 */
import { writeFile } from 'node:fs/promises';
import 'dotenv/config';
import { db, closeDb } from '../db/pool.js';

interface Row {
  session_id: string;
  created_at: string;
  role: string;
  content: string;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const sql = db();
  const since = arg('since');
  const full = process.argv.includes('--full');
  const out = arg('out');
  const limit = Number(arg('limit') ?? 20);

  // Newest sessions first, then turns in order within each.
  const rows = await sql<Row[]>`
    SELECT m.session_id, m.created_at::text, m.role, m.content
      FROM messages m
     WHERE m.session_id IN (
             SELECT session_id FROM messages
              ${since ? sql`WHERE created_at >= ${since}` : sql``}
              GROUP BY session_id
              ORDER BY max(created_at) DESC
              LIMIT ${limit}
           )
     ORDER BY m.session_id, m.id ASC`;

  const bySession = new Map<string, Row[]>();
  for (const r of rows) {
    const list = bySession.get(r.session_id) ?? [];
    list.push(r);
    bySession.set(r.session_id, list);
  }

  // Most recently active session last, so the newest is at the bottom of the
  // scroll — the order you want when reviewing a test session that just ended.
  const sessions = [...bySession.entries()].sort(
    (a, b) => (a[1].at(-1)?.created_at ?? '').localeCompare(b[1].at(-1)?.created_at ?? ''),
  );

  const lines: string[] = [
    `# ArmLex — conversation review`,
    '',
    `${sessions.length} session(s), ${rows.filter((r) => r.role === 'user').length} question(s)` +
      `${since ? ` since ${since}` : ''}.`,
    '',
    '> Retrieved articles, coverage verdict, stripped-quote count and cost are',
    '> NOT stored, so they cannot be shown here. See OPEN-ITEMS.',
    '',
  ];

  for (const [id, turns] of sessions) {
    const asked = turns.filter((t) => t.role === 'user').length;
    lines.push(`## ${turns[0]!.created_at.slice(0, 16)} · ${asked} question(s) · \`${id.slice(0, 8)}\``, '');
    for (const t of turns) {
      const body = full ? t.content : t.content.slice(0, 1200) + (t.content.length > 1200 ? ' …' : '');
      lines.push(t.role === 'user' ? `**Q:** ${body}` : `**A:** ${body}`, '');
    }
    lines.push('---', '');
  }

  const text = lines.join('\n');
  if (out) {
    await writeFile(out, text, 'utf8');
    console.log(`wrote ${out} — ${sessions.length} session(s)`);
  } else {
    console.log(text);
  }

  await closeDb();
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
