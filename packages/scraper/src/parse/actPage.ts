/**
 * THE ONLY MODULE THAT KNOWS ABOUT ARLIS HTML.
 *
 * ARLIS is scheduled for a redesign and has no API, so every selector and
 * every structural assumption is confined here. Everything else in the codebase
 * consumes the typed structures below. When the site changes, this file is the
 * blast radius.
 *
 * Observed structure (verified against the Tax Code, act 109017, Aug 2026):
 *
 *   <div id="act_body"> <div class="act-block act-block_main">
 *      <div class="act-block__section">   ... flat legacy Word-ish HTML ...
 *
 *   - Article headings are NOT semantic. They are single-row layout tables:
 *       <table><tr><td><strong>Հոդված 12.</strong></td>
 *                  <td><strong>Article title</strong></td></tr></table>
 *   - Structural headings are LETTERSPACED text:
 *       "Մ Ա Ս 1"  (part)  "Բ Ա Ժ Ի Ն 1" (section)  "Գ Լ ՈՒ Խ 1" (chapter)
 *     so any match must squash whitespace first. Note "ՈՒ" is a digraph.
 *   - Genuine data tables (tax rates, amortisation periods) are the multi-row
 *     tables; distinguishing them from heading tables is essential, because a
 *     mangled rate table is the worst failure mode this system has.
 *   - Amendment history lives in <div class="act-changes-history">, paired as
 *     (amending act -> incorporation/consolidated version).
 */
import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { Element } from 'domhandler';
import { parseActNumberAll } from '@armlex/shared';
import type { Lang, ParsedActNumber } from '@armlex/shared';

/** Collapse NBSP + runs of whitespace. */
export function normalise(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/** Remove ALL whitespace — used to match letterspaced headings. */
function squash(s: string): string {
  return s.replace(/ /g, '').replace(/\s+/g, '');
}

/**
 * ARLIS article numbers mix ASCII "." with lookalikes: U+2024 ONE DOT LEADER,
 * U+00B7 MIDDLE DOT, U+2027 and the Armenian full stop U+0589. Three Tax Code
 * headings (36.1, 293.1, 377) use U+2024 and are silently lost without this.
 * Applied only to number matching, never to stored article text.
 */
function normaliseDots(s: string): string {
  return s.replace(/[․·‧։]/g, '.');
}

export interface ArticleHeading {
  /** e.g. "12" or "160.1" (inserted articles carry a decimal suffix). */
  number: string;
  title: string;
  /** Position among all article headings, in document order. */
  ord: number;
  part?: string;
  section?: string;
  chapter?: string;
}

export interface DataTable {
  rows: number;
  cols: number;
  /** First row, normalised — usually the header. */
  headerPreview: string;
  /** Nearest preceding article number, for attribution. */
  nearestArticle?: string;
}

export interface AmendmentEntry {
  /** Date the amending act was adopted, ISO yyyy-mm-dd when parseable. */
  amendedAt?: string;
  /** ARLIS display label, e.g. "18.06.2026, ՀՕ-257-Ն". */
  amendingLabel: string;
  amendingActId?: number;
  /** Consolidated revision produced by this amendment, when published. */
  incorporationActId?: number;
  incorporationLabel?: string;
}

/**
 * How the document is internally divided.
 *
 * Codes and laws use `Հոդված` (articles). Government decisions and ministerial
 * orders do not — they use numbered points (`կետ`) plus annexes (`հավելված`).
 * Chunking must follow whichever applies, so ingestion needs to know.
 */
export type ActStructure = 'articles' | 'points' | 'tabular' | 'unknown';

/**
 * Find the document's OWN act number, as opposed to the many act numbers it
 * cites.
 *
 * Position is the only reliable signal:
 *   - Decisions and orders print theirs in the header block
 *     ("… ԿԱՌԱՎԱՐՈՒԹՅՈՒՆ Ո Ր Ո Շ ՈՒ Մ 1 փետրվարի 2024 թվականի N 155-Ն").
 *   - Laws and codes print theirs at the very foot, after the signature
 *     ("… Նախագահ Ռ. Քոչարյան Երևան 4 հուլիսի 2001 թ. ՀՕ-195"), while their
 *     header often carries an *amendment* reference ("(օրենքը խմբ. … ՀՕ-5-Ն)")
 *     which must not be mistaken for the act's own number.
 */
function extractActNumber(bodyText: string): ParsedActNumber | undefined {
  const head = bodyText.slice(0, 600);
  const tail = bodyText.slice(-400);

  // Decisions/orders: first N-series number in the header.
  const headDecision = parseActNumberAll(head).find((n) => n.series === 'N');
  if (headDecision) return headDecision;

  // Laws/codes: the LAST ՀՕ number in the footer is the act's own.
  const tailLaw = parseActNumberAll(tail)
    .filter((n) => n.series === 'ՀՕ')
    .at(-1);
  if (tailLaw) return tailLaw;

  return parseActNumberAll(head).at(0);
}

export interface ActPage {
  title: string;
  /** Dominant script of the act body. */
  bodyLang: Lang | 'unknown';
  langCharCounts: { hy: number; ru: number; en: number };
  bodyTextLength: number;
  articles: ArticleHeading[];
  dataTables: DataTable[];
  amendments: AmendmentEntry[];
  /** "Ընդունված է ..." adoption date, ISO when parseable. */
  adoptedAt?: string;
  /** Free-text validity note ("ԱԿՏԻ ՎԱՎԵՐԱՊԱՅՄԱՆՆԵՐ"). */
  validityNote?: string;
  /** True when #act_body was found at all. */
  hasBody: boolean;
  /** Act number as printed in the document, e.g. "ՀՕ-165-Ն" / "N 155-Ն". */
  actNumber?: ParsedActNumber;
  structure: ActStructure;
  /** Count of top-level numbered points, when the document uses points. */
  pointCount: number;
  /** Annex (հավելված) headings found. */
  annexCount: number;
  /** ARLIS publication marker, e.g. "Պաշտոնական ինկորպորացիա". */
  publicationMark?: string;
}

const ARMENIAN_MONTHS: Record<string, number> = {
  հունվարի: 1, փետրվարի: 2, մարտի: 3, ապրիլի: 4, մայիսի: 5, հունիսի: 6,
  հուլիսի: 7, օգոստոսի: 8, սեպտեմբերի: 9, հոկտեմբերի: 10, նոյեմբերի: 11,
  դեկտեմբերի: 12,
};

/**
 * Parse an Armenian long-form date, in either order:
 *   laws      "2016 թվականի հոկտեմբերի 4-ին"   (year first)
 *   decisions "1 փետրվարի 2024 թվականի"        (day first)
 *
 * Whichever appears EARLIEST in the text wins. Order matters: a decision's
 * header carries its adoption date day-first, while its validity note further
 * down carries the *effective* date year-first. Preferring one pattern over the
 * other rather than the earliest position silently returns the wrong date.
 */
export function parseArmenianDate(text: string): string | undefined {
  const yearFirst = /(\d{4})\s*թ(?:վականի|\.)\s+([԰-֏]+)\s+(\d{1,2})/.exec(text);
  const dayFirst = /(\d{1,2})\s+([԰-֏]+)\s+(\d{4})\s*թ(?:վականի|\.)/.exec(text);

  const build = (
    year: string | undefined,
    monthWord: string | undefined,
    day: string | undefined,
  ): string | undefined => {
    const month = ARMENIAN_MONTHS[monthWord ?? ''];
    if (!year || !month || !day) return undefined;
    return `${year}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
  };

  const candidates: { at: number; iso: string | undefined }[] = [];
  if (yearFirst) {
    candidates.push({
      at: yearFirst.index,
      iso: build(yearFirst[1], yearFirst[2], yearFirst[3]),
    });
  }
  if (dayFirst) {
    candidates.push({
      at: dayFirst.index,
      iso: build(dayFirst[3], dayFirst[2], dayFirst[1]),
    });
  }

  return candidates
    .filter((c) => c.iso)
    .sort((a, b) => a.at - b.at)[0]?.iso;
}

/** "18.06.2026" -> "2026-06-18". */
export function parseDottedDate(text: string): string | undefined {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function countScripts(text: string): { hy: number; ru: number; en: number } {
  let hy = 0, ru = 0, en = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c >= 0x0530 && c <= 0x058f) hy++;
    else if ((c >= 0x0400 && c <= 0x04ff) || (c >= 0x0500 && c <= 0x052f)) ru++;
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) en++;
  }
  return { hy, ru, en };
}

/**
 * A heading table is a single-row table whose first cell is exactly an article
 * label. Everything else with >1 row is treated as content (a real table).
 */
function readArticleHeading(
  $: CheerioAPI,
  table: Cheerio<Element>,
): { number: string; title: string } | undefined {
  const rows = table.find('tr');
  if (rows.length !== 1) return undefined;

  const cells = table.find('td');
  if (cells.length === 0 || cells.length > 2) return undefined;

  // Strip leading decoration before matching.
  //
  // ARLIS marks articles that have linked court practice with a ⚖ (U+2696)
  // anchor INSIDE the heading cell, so the cell reads "⚖Հոդված 2." and a
  // `^Հոդված` anchor rejects it. Measured: this silently dropped 16 articles
  // of the Tax Code — including Հոդված 2, which regulates tax relations —
  // and the loss is invisible downstream, since a missing article looks
  // exactly like a question the corpus does not cover.
  //
  // Only leading non-letter, non-digit characters are removed, so a heading
  // that genuinely starts with a word is untouched.
  const first = normaliseDots(normalise($(cells[0]!).text())).replace(/^[^\p{L}\p{N}]+/u, '');
  const m = /^Հոդված\s+(\d+(?:\.\d+)*)\s*\.?$/.exec(first);
  if (!m || !m[1]) return undefined;

  const title = cells.length > 1 ? normalise($(cells[1]!).text()) : '';
  return { number: m[1], title };
}

/**
 * Convert a rate/content table to a markdown table.
 *
 * Tax law is full of rate tables and flattening one to prose produces
 * confidently wrong numbers — the worst failure this system can have. Cells
 * are emitted verbatim (only whitespace-normalised and pipe-escaped) so the
 * digits are never rewritten. Row/colspan are expanded so columns stay aligned.
 */
export function tableToMarkdown($: CheerioAPI, table: Cheerio<Element>): string {
  const grid: string[][] = [];
  // Tracks cells spilling down from earlier rows: key `${row}:${col}`.
  const pending = new Map<string, string>();

  const rows = table.find('tr').toArray();

  rows.forEach((tr, rowIdx) => {
    const out: string[] = [];
    let col = 0;

    const place = (value: string): void => {
      while (pending.has(`${rowIdx}:${col}`)) {
        out[col] = pending.get(`${rowIdx}:${col}`)!;
        pending.delete(`${rowIdx}:${col}`);
        col++;
      }
      out[col] = value;
      col++;
    };

    $(tr)
      .children('td, th')
      .each((_, cell) => {
        const $cell = $(cell);
        const text = normalise($cell.text()).replace(/\|/g, '\\|');
        const colspan = Math.max(1, Number($cell.attr('colspan') ?? 1) || 1);
        const rowspan = Math.max(1, Number($cell.attr('rowspan') ?? 1) || 1);

        for (let c = 0; c < colspan; c++) {
          const startCol = col;
          place(text);
          for (let r = 1; r < rowspan; r++) {
            pending.set(`${rowIdx + r}:${startCol}`, text);
          }
        }
      });

    // Flush any trailing spilled cells.
    while (pending.has(`${rowIdx}:${col}`)) {
      out[col] = pending.get(`${rowIdx}:${col}`)!;
      pending.delete(`${rowIdx}:${col}`);
      col++;
    }

    grid.push(out);
  });

  const width = Math.max(0, ...grid.map((r) => r.length));
  if (width === 0 || grid.length === 0) return '';

  const pad = (r: string[]): string[] =>
    Array.from({ length: width }, (_, i) => r[i] ?? '');

  const [header, ...rest] = grid;
  const lines = [
    `| ${pad(header!).join(' | ')} |`,
    `| ${Array.from({ length: width }, () => '---').join(' | ')} |`,
    ...rest.map((r) => `| ${pad(r).join(' | ')} |`),
  ];

  return lines.join('\n');
}

/** One ordered piece of act content, in document order. */
export type BlockKind = 'article' | 'annex' | 'struct' | 'table' | 'text';

export interface Block {
  kind: BlockKind;
  /** Plain text. For tables this is the flattened form (never chunked). */
  text: string;
  /** Markdown rendering, tables only — this is what gets stored. */
  markdown?: string;
  rows?: number;
  articleNumber?: string;
  articleTitle?: string;
  structKind?: 'part' | 'section' | 'chapter';
  structLabel?: string;
  annexLabel?: string;
}

/**
 * Flatten the act body into an ordered block sequence.
 *
 * This is the shared substrate for both chunkers: the article chunker segments
 * on `article` blocks, the points chunker on numbered `text` blocks, and both
 * treat `table` blocks as indivisible.
 *
 * Paragraphs inside tables are skipped — their text is already carried by the
 * table's markdown, and emitting both would duplicate every rate figure.
 */
/**
 * Classify a run of prose into a struct heading, an annex heading, or plain
 * text.
 *
 * Shared by both producers of prose, because ARLIS wraps headings in
 * single-row layout tables as often as it uses <p>. Classifying only inside the
 * paragraph branch silently demotes every table-wrapped annex heading to body
 * text, which collapses annexes into the preceding point.
 */
function classifyTextBlock(text: string): Block {
  const squashed = squash(text);

  let m: RegExpExecArray | null;
  if ((m = /^ՄԱՍ(\d+)$/.exec(squashed))) {
    return { kind: 'struct', text, structKind: 'part', structLabel: `ՄԱՍ ${m[1]}` };
  }
  if ((m = /^ԲԱԺԻՆ(\d+)$/.exec(squashed))) {
    return { kind: 'struct', text, structKind: 'section', structLabel: `ԲԱԺԻՆ ${m[1]}` };
  }
  if ((m = /^ԳԼՈՒԽ(\d+)$/.exec(squashed))) {
    return { kind: 'struct', text, structKind: 'chapter', structLabel: `ԳԼՈՒԽ ${m[1]}` };
  }

  // Annex heading: a paragraph whose FIRST WORD is exactly "Հավելված".
  //
  // Matching on the unsquashed text and requiring whitespace after the word is
  // what makes this safe: it accepts the real headings, which are long
  // reference blocks ("Հավելված N 1 ՀՀ … կոմիտեի նախագահի … հրամանի"), while
  // rejecting the inflected "Հավելվածում" ("in the annex") that opens ordinary
  // sentences. A squashed prefix test cannot tell those apart.
  if (/^Հավելված(\s|$)/.test(text) && text.length <= 300) {
    return { kind: 'annex', text, annexLabel: text.slice(0, 80) };
  }

  return { kind: 'text', text };
}

export function parseActBlocks(html: string): Block[] {
  const $ = cheerio.load(html);
  const body = $('#act_body');
  const blocks: Block[] = [];

  const nodes = body
    .find('p, table')
    .toArray()
    .filter((el) =>
      el.tagName === 'table'
        ? $(el).parents('table').length === 0
        : $(el).closest('table').length === 0,
    );

  for (const el of nodes) {
    const $el = $(el);

    if (el.tagName === 'table') {
      const heading = readArticleHeading($, $el);
      if (heading) {
        blocks.push({
          kind: 'article',
          text: `Հոդված ${heading.number}. ${heading.title}`.trim(),
          articleNumber: heading.number,
          articleTitle: heading.title,
        });
        continue;
      }

      const rows = $el.find('tr').length;
      const text = normalise($el.text());
      if (!text) continue;

      if (rows > 1) {
        blocks.push({
          kind: 'table',
          text,
          markdown: tableToMarkdown($, $el),
          rows,
        });
      } else {
        // Single-row tables are used as layout wrappers for headings and prose.
        blocks.push(classifyTextBlock(text));
      }
      continue;
    }

    const text = normalise($el.text());
    if (!text) continue;

    blocks.push(classifyTextBlock(text));
  }

  return blocks;
}

export function parseActPage(html: string): ActPage {
  const $ = cheerio.load(html);

  const title = normalise($('title').first().text());
  const body = $('#act_body');
  const hasBody = body.length > 0;

  const bodyText = hasBody ? normalise(body.text()) : '';
  const langCharCounts = countScripts(bodyText);

  let bodyLang: Lang | 'unknown' = 'unknown';
  const { hy, ru, en } = langCharCounts;
  const maxCount = Math.max(hy, ru, en);
  if (maxCount > 200) bodyLang = hy === maxCount ? 'hy' : ru === maxCount ? 'ru' : 'en';

  // --- articles + surrounding hierarchy, in a single document-order walk ---
  const articles: ArticleHeading[] = [];
  const dataTables: DataTable[] = [];
  let curPart: string | undefined;
  let curSection: string | undefined;
  let curChapter: string | undefined;
  let lastArticle: string | undefined;

  body.find('table, p, div, b, strong').each((_, el) => {
    const $el = $(el);

    if (el.tagName === 'table') {
      // Heading tables are matched regardless of nesting: a handful of article
      // headings sit inside an outer layout table, and dropping them silently
      // loses articles.
      const heading = readArticleHeading($, $el);
      if (heading) {
        lastArticle = heading.number;
        articles.push({
          number: heading.number,
          title: heading.title,
          ord: articles.length,
          ...(curPart ? { part: curPart } : {}),
          ...(curSection ? { section: curSection } : {}),
          ...(curChapter ? { chapter: curChapter } : {}),
        });
        return;
      }

      // For content tables, only the outermost counts, so a wrapper table is
      // not reported alongside the real rate table nested inside it.
      if ($el.parents('table').length > 0) return;

      const rows = $el.find('tr').length;
      if (rows > 1) {
        const firstRow = $el.find('tr').first();
        dataTables.push({
          rows,
          cols: firstRow.find('td, th').length,
          headerPreview: normalise(firstRow.text()).slice(0, 160),
          ...(lastArticle ? { nearestArticle: lastArticle } : {}),
        });
      }
      return;
    }

    // Structural headings: letterspaced, short, and leaf-ish.
    if ($el.children().length > 2) return;
    const squashed = squash($el.text());
    if (squashed.length === 0 || squashed.length > 40) return;

    let m: RegExpExecArray | null;
    if ((m = /^ՄԱՍ(\d+)$/.exec(squashed))) curPart = `ՄԱՍ ${m[1]}`;
    else if ((m = /^ԲԱԺԻՆ(\d+)$/.exec(squashed))) curSection = `ԲԱԺԻՆ ${m[1]}`;
    else if ((m = /^ԳԼՈՒԽ(\d+)$/.exec(squashed))) curChapter = `ԳԼՈՒԽ ${m[1]}`;
  });

  // --- amendment history ---
  const amendments: AmendmentEntry[] = [];
  $('.act-changes-history__couple').each((_, el) => {
    const items = $(el).find('.act-changes-history__item');
    const left = items.eq(0);
    const right = items.eq(1);

    const amendingLabel = normalise(left.text());
    if (!amendingLabel) return;

    const leftHref = left.find('a').attr('href') ?? '';
    const rightHref = right.find('a').attr('href') ?? '';
    const idOf = (href: string): number | undefined => {
      const m = /\/acts\/(\d+)/.exec(href);
      return m?.[1] ? Number(m[1]) : undefined;
    };

    const incorporationLabel = normalise(right.text());
    const amendedAt = parseDottedDate(amendingLabel);
    const incorporationActId = idOf(rightHref);
    const amendingActId = idOf(leftHref);

    amendments.push({
      amendingLabel,
      ...(amendedAt ? { amendedAt } : {}),
      ...(amendingActId ? { amendingActId } : {}),
      ...(incorporationActId ? { incorporationActId } : {}),
      ...(incorporationLabel && !/^-+$/.test(incorporationLabel)
        ? { incorporationLabel }
        : {}),
    });
  });

  const adoptedAt = parseArmenianDate(bodyText.slice(0, 4000));

  const validityRaw = normalise($('.act-content__info').text());
  const validityNote = validityRaw ? validityRaw.slice(0, 400) : undefined;

  const publicationRaw = normalise($('.act-actions__status').first().text());
  const publicationMark = publicationRaw || undefined;

  const actNumber = extractActNumber(bodyText);

  // Numbered points: "1." … "2." at paragraph start. Only meaningful when the
  // document has no articles.
  let pointCount = 0;
  body.find('p').each((_, el) => {
    const t = normalise($(el).text());
    if (/^\d{1,3}\s*\.\s+\S/.test(t)) pointCount++;
  });

  const annexCount = (bodyText.match(/Հավելված\s*\d*/gi) ?? []).length;

  // Some acts (e.g. a goods-list law) are one big table with no prose divisions
  // at all. That is a valid shape, not a parse failure — it just chunks by row
  // group rather than by article.
  const structure: ActStructure =
    articles.length > 0
      ? 'articles'
      : pointCount > 0
        ? 'points'
        : dataTables.length > 0
          ? 'tabular'
          : 'unknown';

  return {
    title,
    bodyLang,
    langCharCounts,
    bodyTextLength: bodyText.length,
    articles,
    dataTables,
    amendments,
    hasBody,
    structure,
    pointCount,
    annexCount,
    ...(actNumber ? { actNumber } : {}),
    ...(publicationMark ? { publicationMark } : {}),
    ...(adoptedAt ? { adoptedAt } : {}),
    ...(validityNote ? { validityNote } : {}),
  };
}
