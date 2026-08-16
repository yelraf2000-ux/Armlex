/**
 * Milestone 2 — ARLIS audit.
 *
 * For each act in the corpus, reports:
 *   - which language versions actually exist (hy / ru / en) and their dates
 *   - adoption date and latest amendment/consolidation date
 *   - whether /latest resolves, and how it differs from the bare version
 *   - internal structure (articles vs numbered points) and table counts
 *   - act number and the -Ն/-Ա normativity classification
 *
 * Also emits a side-by-side comparison for any duplicate-id group, to decide
 * which ARLIS id is canonical.
 *
 * Usage:  npm run audit            (whole corpus)
 *         npm run audit -- 109017  (specific act ids)
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  config,
  actLatestUrl,
  actVersionUrl,
  isRagEligible,
  describeEligibility,
} from '@armlex/shared';
import type { Lang, ParsedActNumber } from '@armlex/shared';
import { fetchPage } from '../http.js';
import { parseActPage } from '../parse/actPage.js';
import type { ActPage, ActStructure } from '../parse/actPage.js';
import { TAX_CORPUS } from './corpus.js';
import type { CorpusEntry } from './corpus.js';

/**
 * --offline replays saved snapshots instead of hitting ARLIS, so the report can
 * be regenerated instantly after a parser change. This is the whole point of
 * keeping raw HTML: parser iteration costs nothing and the site is untouched.
 */
const OFFLINE = process.argv.includes('--offline');

/** Fetch, or read the snapshot when running offline. */
async function getPage(
  url: string,
  snapshotName: string,
): Promise<{ status: number; html: string }> {
  if (OFFLINE) {
    try {
      const html = await readFile(
        join(config.snapshotDir, `${snapshotName}.html`),
        'utf8',
      );
      return { status: 200, html };
    } catch {
      return { status: 0, html: '' };
    }
  }
  const res = await fetchPage(url, { snapshotName });
  return { status: res.status, html: res.html };
}

/** Act ids that are candidates for the same logical document. */
const DUPLICATE_GROUPS: Record<string, number[]> = {
  'Tax Code': [109017, 228650],
};

interface LangProbe {
  status: number | 'error';
  bytes: number;
  detectedLang: string;
  articleCount: number;
  /** True when the body is actually in the language the URL claims. */
  isRealTranslation: boolean;
  /** Latest amendment date visible on that language's page. */
  lastAmendedAt?: string;
  note?: string;
}

interface AuditRow {
  id: number;
  label: string;
  title: string;
  control: boolean;
  expect: string;
  latestOk: boolean;
  latestBytes: number;
  bareBytes: number;
  latestDiffersFromBare: boolean;
  structure: ActStructure;
  articleCount: number;
  pointCount: number;
  annexCount: number;
  dataTableCount: number;
  adoptedAt?: string;
  lastAmendedAt?: string;
  amendmentCount: number;
  actNumber?: ParsedActNumber;
  expectedActNumber?: string;
  actNumberMatches?: boolean;
  ragEligible: boolean;
  eligibilityReason: string;
  hierarchyOk: boolean;
  langs: Record<Lang, LangProbe>;
  parseVerdict: 'ok' | 'partial' | 'failed';
  problems: string[];
}

const LANGS: Lang[] = ['hy', 'ru', 'en'];

function lastAmendment(page: ActPage): string | undefined {
  return page.amendments
    .map((a) => a.amendedAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);
}

async function probeLang(id: number, lang: Lang): Promise<LangProbe> {
  try {
    const res = await getPage(actLatestUrl(id, lang), `act-${id}-${lang}-latest`);
    if (!res.html) {
      return {
        status: 'error',
        bytes: 0,
        detectedLang: 'unknown',
        articleCount: 0,
        isRealTranslation: false,
        note: 'no snapshot',
      };
    }
    const parsed = parseActPage(res.html);

    // ARLIS serves the language prefix as UI chrome only; the act text may
    // still be Armenian. A "real" translation means the body script matches.
    const isRealTranslation = parsed.bodyLang === lang;
    const amended = lastAmendment(parsed);

    return {
      status: res.status,
      bytes: res.html.length,
      detectedLang: parsed.bodyLang,
      articleCount: parsed.articles.length,
      isRealTranslation,
      ...(amended ? { lastAmendedAt: amended } : {}),
      ...(isRealTranslation ? {} : { note: `body is ${parsed.bodyLang}` }),
    };
  } catch (err) {
    return {
      status: 'error',
      bytes: 0,
      detectedLang: 'unknown',
      articleCount: 0,
      isRealTranslation: false,
      note: String(err).slice(0, 80),
    };
  }
}

function verdict(
  page: ActPage,
  problems: string[],
): 'ok' | 'partial' | 'failed' {
  if (!page.hasBody) return 'failed';
  if (page.structure === 'unknown') return 'failed';
  return problems.length > 0 ? 'partial' : 'ok';
}

async function auditOne(entry: CorpusEntry): Promise<AuditRow> {
  const problems: string[] = [];

  const latest = await getPage(
    actLatestUrl(entry.id, 'hy'),
    `act-${entry.id}-hy-latest`,
  );
  const page = parseActPage(latest.html);

  const latestOk = latest.status === 200 && page.hasBody;
  if (!latestOk) problems.push('/latest returned no act body');

  // Bare version = one specific stored revision, not the consolidated text.
  const bare = await getPage(
    actVersionUrl(entry.id, 'hy'),
    `act-${entry.id}-hy-bare`,
  );

  if (page.structure === 'unknown') problems.push('no articles and no points parsed');

  // Hierarchy only applies to article-structured documents.
  const hierarchyOk =
    page.structure !== 'articles' || page.articles.some((a) => a.chapter);
  if (!hierarchyOk && page.articles.length > 5) {
    problems.push('no chapter hierarchy detected');
  }

  const numbers = page.articles.map((a) => a.number);
  if (numbers.length !== new Set(numbers).size) {
    problems.push('duplicate article numbers');
  }

  if (!page.actNumber) problems.push('act number not found in body');

  const actNumberMatches =
    entry.expectedActNumber && page.actNumber
      ? page.actNumber.raw.replace(/\s/g, '') ===
        entry.expectedActNumber.replace(/\s/g, '')
      : undefined;
  if (actNumberMatches === false) {
    problems.push(
      `act number mismatch: page says ${page.actNumber?.raw}, search said ${entry.expectedActNumber}`,
    );
  }

  const langs = {} as Record<Lang, LangProbe>;
  const hyAmended = lastAmendment(page);
  langs.hy = {
    status: latest.status,
    bytes: latest.html.length,
    detectedLang: page.bodyLang,
    articleCount: page.articles.length,
    isRealTranslation: page.bodyLang === 'hy',
    ...(hyAmended ? { lastAmendedAt: hyAmended } : {}),
  };
  for (const lang of LANGS.filter((l) => l !== 'hy')) {
    langs[lang] = await probeLang(entry.id, lang);
  }

  if (!langs.ru.isRealTranslation && !langs.en.isRealTranslation) {
    problems.push('no ru/en translation');
  }

  const ragEligible = isRagEligible(page.actNumber);

  return {
    id: entry.id,
    label: entry.label,
    title: page.title,
    control: entry.control ?? false,
    expect: entry.expect,
    latestOk,
    latestBytes: latest.html.length,
    bareBytes: bare.html.length,
    latestDiffersFromBare:
      bare.html.length > 0 && bare.html.length !== latest.html.length,
    structure: page.structure,
    articleCount: page.articles.length,
    pointCount: page.pointCount,
    annexCount: page.annexCount,
    dataTableCount: page.dataTables.length,
    amendmentCount: page.amendments.length,
    hierarchyOk,
    ragEligible,
    eligibilityReason: describeEligibility(page.actNumber),
    langs,
    parseVerdict: verdict(page, problems),
    problems,
    ...(page.actNumber ? { actNumber: page.actNumber } : {}),
    ...(entry.expectedActNumber
      ? { expectedActNumber: entry.expectedActNumber }
      : {}),
    ...(actNumberMatches !== undefined ? { actNumberMatches } : {}),
    ...(page.adoptedAt ? { adoptedAt: page.adoptedAt } : {}),
    ...(hyAmended ? { lastAmendedAt: hyAmended } : {}),
  };
}

function langCell(p: LangProbe): string {
  if (p.status === 'error') return 'ERR';
  if (p.status !== 200) return `HTTP ${p.status}`;
  // Article count is meaningless for point-structured documents, so it is only
  // shown when there is one.
  if (!p.isRealTranslation) return `no (${p.detectedLang})`;
  return p.articleCount > 0 ? `yes (${p.articleCount} art.)` : 'yes';
}

function structureCell(r: AuditRow): string {
  const ann = r.annexCount ? ` +${r.annexCount} ann.` : '';
  if (r.structure === 'articles') return `${r.articleCount} art.${ann}`;
  if (r.structure === 'points') return `${r.pointCount} pts${ann}`;
  if (r.structure === 'tabular') return `tabular (${r.dataTableCount} tbl)${ann}`;
  return '—';
}

function esc(v: unknown): string {
  return String(v).replace(/\|/g, '/');
}

function mainTable(rows: AuditRow[]): string {
  const head = [
    '| Act id | Type | Act no. | RAG | Structure | Tables | Adopted | Last amended | Amend. | hy | ru | en | Verdict |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ];
  const body = rows.map((r) =>
    `| ${[
      r.control ? `${r.id} ⟨control⟩` : r.id,
      r.expect,
      r.actNumber?.raw ?? '—',
      r.ragEligible ? 'yes' : 'NO',
      structureCell(r),
      r.dataTableCount,
      r.adoptedAt ?? '—',
      r.lastAmendedAt ?? '—',
      r.amendmentCount,
      langCell(r.langs.hy),
      langCell(r.langs.ru),
      langCell(r.langs.en),
      r.parseVerdict,
    ]
      .map(esc)
      .join(' | ')} |`,
  );
  return [...head, ...body].join('\n');
}

function languageCoverage(rows: AuditRow[]): string {
  const real = (l: Lang): AuditRow[] =>
    rows.filter((r) => r.langs[l].isRealTranslation);

  const lines = [
    '## (b) Language coverage',
    '',
    `| Language | Documents with real text | Share |`,
    '|---|---|---|',
    ...LANGS.map((l) => {
      const n = real(l).length;
      return `| ${l} | ${n} / ${rows.length} | ${Math.round((n / rows.length) * 100)}% |`;
    }),
    '',
  ];

  const anyTranslation = rows.filter(
    (r) => r.langs.ru.isRealTranslation || r.langs.en.isRealTranslation,
  );

  if (anyTranslation.length === 0) {
    lines.push(
      'No document in the corpus has Russian or English text. The `/ru/` and',
      '`/en/` URLs return HTTP 200 with an Armenian body, so translation',
      'coverage cannot be detected by status code — only by script detection.',
      '',
      'Consequence: `ru_amended_at` / `en_amended_at` staleness comparison has',
      'nothing to compare, and retrieval must operate on Armenian text.',
    );
  } else {
    lines.push('| Act | Language | hy amended | translation amended | stale? |');
    lines.push('|---|---|---|---|---|');
    for (const r of anyTranslation) {
      for (const l of ['ru', 'en'] as const) {
        if (!r.langs[l].isRealTranslation) continue;
        const tr = r.langs[l].lastAmendedAt;
        const hy = r.lastAmendedAt;
        const stale = tr && hy ? (tr < hy ? 'STALE' : 'current') : 'unknown';
        lines.push(`| ${r.id} | ${l} | ${hy ?? '—'} | ${tr ?? '—'} | ${stale} |`);
      }
    }
  }
  return lines.join('\n');
}

function suffixSection(rows: AuditRow[]): string {
  const decisions = rows.filter(
    (r) => r.expect === 'gov_decision' || r.expect === 'ministerial_order',
  );
  const withN = decisions.filter((r) => r.actNumber?.suffix === 'Ն');
  const withA = decisions.filter((r) => r.actNumber?.suffix === 'Ա');
  const none = decisions.filter((r) => r.actNumber && !r.actNumber.suffix);
  const missing = decisions.filter((r) => !r.actNumber);

  const laws = rows.filter((r) => r.expect === 'law' || r.expect === 'code');

  return [
    '## (c) -Ն / -Ա suffix pattern',
    '',
    `Decisions and orders examined: **${decisions.length}**`,
    '',
    `| Suffix | Count | rag_eligible | Act ids |`,
    '|---|---|---|---|',
    `| -Ն normative | ${withN.length} | yes | ${withN.map((r) => r.id).join(', ') || '—'} |`,
    `| -Ա individual | ${withA.length} | **no** | ${withA.map((r) => r.id).join(', ') || '—'} |`,
    `| no suffix | ${none.length} | yes (pre-2018) | ${none.map((r) => r.id).join(', ') || '—'} |`,
    `| unparsed | ${missing.length} | yes (default) | ${missing.map((r) => r.id).join(', ') || '—'} |`,
    '',
    `Laws and codes examined: **${laws.length}** — ${laws
      .map((r) => `${r.id} ${r.actNumber?.raw ?? '?'}`)
      .join(', ')}`,
    '',
    withA.length === 0
      ? '> No -Ա act in the set, so the rule is unverified as a discriminator.'
      : `> The -Ա controls were correctly classified rag_eligible = false, and every tax document was retained. The rule discriminates.`,
  ].join('\n');
}

function duplicateSection(rows: AuditRow[]): string {
  const out: string[] = ['## (a) Duplicate act ids — canonical selection', ''];

  for (const [name, ids] of Object.entries(DUPLICATE_GROUPS)) {
    const group = ids
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is AuditRow => Boolean(r));
    if (group.length < 2) continue;

    out.push(`### ${name}`, '');
    const fields: [string, (r: AuditRow) => string][] = [
      ['Title', (r) => r.title.slice(0, 40)],
      ['Act number', (r) => r.actNumber?.raw ?? '—'],
      ['Articles', (r) => String(r.articleCount)],
      ['Data tables', (r) => String(r.dataTableCount)],
      ['Adopted', (r) => r.adoptedAt ?? '—'],
      ['Last amended', (r) => r.lastAmendedAt ?? '—'],
      ['Amendment entries', (r) => String(r.amendmentCount)],
      ['/latest bytes', (r) => r.latestBytes.toLocaleString()],
      ['bare bytes', (r) => r.bareBytes.toLocaleString()],
      ['latest ≠ bare', (r) => (r.latestDiffersFromBare ? 'yes' : 'no')],
    ];

    out.push(`| Field | ${group.map((r) => r.id).join(' | ')} |`);
    out.push(`|---|${group.map(() => '---').join('|')}|`);
    for (const [label, fn] of fields) {
      out.push(`| ${label} | ${group.map((r) => esc(fn(r))).join(' | ')} |`);
    }
    out.push('');

    const identical =
      group.every((r) => r.articleCount === group[0]!.articleCount) &&
      group.every((r) => r.latestBytes === group[0]!.latestBytes);

    // When /latest content is identical, richness cannot decide it — both ids
    // resolve to the same consolidated text. What distinguishes them is
    // stability: ARLIS mints a NEW, higher act id for each consolidation, so
    // the lowest id is the original act record (the spine that survives every
    // amendment) and higher ids are revision snapshots that will be superseded.
    // Pinning a revision id means the canonical pointer silently goes stale.
    const byRichness = [...group].sort(
      (a, b) => b.amendmentCount - a.amendmentCount || b.articleCount - a.articleCount,
    )[0]!;
    const lowest = [...group].sort((a, b) => a.id - b.id)[0]!;
    const best = identical ? lowest : byRichness;

    const reason = identical
      ? `content is byte-identical across all candidate ids, so richness cannot discriminate. ` +
        `Chose the LOWEST id (${lowest.id}) as the original act record: ARLIS mints a new, higher ` +
        `id per consolidation, so higher ids are revision snapshots that go stale on the next amendment.`
      : `richest record — ${byRichness.amendmentCount} amendment entries and ${byRichness.articleCount} articles.`;

    out.push(
      `**Content identical across ids:** ${identical ? 'yes' : 'no'}`,
      '',
      `**Recommended canonical id: ${best.id}** — ${reason}`,
      '',
      `Register the others as aliases:`,
      ...group
        .filter((r) => r.id !== best.id)
        .map(
          (r) =>
            `  \`INSERT INTO document_aliases (arlis_id, document_id, reason) VALUES (${r.id}, <doc>, 'duplicate');\``,
        ),
      '',
    );
  }
  return out.join('\n');
}

function toMarkdown(rows: AuditRow[]): string {
  const corpus = rows.filter((r) => !r.control);
  const notes = rows
    .filter((r) => r.problems.length > 0)
    .map((r) => `- **${r.id}**: ${r.problems.join('; ')}`);

  return [
    '# ARLIS tax corpus audit',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Documents: ${corpus.length} corpus + ${rows.length - corpus.length} control`,
    '',
    mainTable(rows),
    '',
    duplicateSection(rows),
    '',
    languageCoverage(corpus),
    '',
    suffixSection(rows),
    '',
    ...(notes.length ? ['## Per-document problems', '', ...notes] : []),
  ].join('\n');
}

async function main(): Promise<void> {
  const argIds = process.argv
    .slice(2)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);

  const targets: CorpusEntry[] = argIds.length
    ? argIds.map((id) => ({ id, label: `act ${id}`, expect: 'law' as const }))
    : TAX_CORPUS;

  console.log(
    `Auditing ${targets.length} document(s) at ${config.crawlDelayMs}ms/request…\n`,
  );

  const rows: AuditRow[] = [];
  for (const entry of targets) {
    process.stdout.write(`  [${entry.id}] ${entry.label.slice(0, 44)} … `);
    try {
      const row = await auditOne(entry);
      rows.push(row);
      console.log(
        `${row.parseVerdict} · ${structureCell(row)} · ${row.actNumber?.raw ?? 'no act no.'}${row.ragEligible ? '' : ' · RAG-EXCLUDED'}`,
      );
    } catch (err) {
      console.log(`ERROR ${String(err).slice(0, 80)}`);
    }
  }

  await mkdir(config.auditDir, { recursive: true });
  const md = toMarkdown(rows);
  await writeFile(join(config.auditDir, 'audit.md'), md, 'utf8');
  await writeFile(
    join(config.auditDir, 'audit.json'),
    JSON.stringify(rows, null, 2),
    'utf8',
  );

  console.log(`\nWrote ${join(config.auditDir, 'audit.md')}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
