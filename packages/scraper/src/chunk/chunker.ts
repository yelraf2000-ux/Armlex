/**
 * Chunking strategies.
 *
 *   articles → codes and laws          (Հոդված N.)
 *   points   → decisions and orders    (numbered կետ + Հավելված annexes)
 *   tabular  → whole-document tables   (a bare goods list with no divisions)
 *
 * Rules common to all three:
 *   - Tables are NEVER split. A rate table cut in half produces confidently
 *     wrong numbers, which is the worst failure this system can have.
 *   - Every chunk carries the same metadata header (see types.ts).
 *   - Text is copied verbatim; nothing is rewritten or summarised.
 */
import type { Block, ActPage } from '../parse/actPage.js';
import { makeChunk } from './types.js';
import type { Chunk, DocumentContext } from './types.js';

/** A numbered point: "3. Սահմանել …". Two-level refs like "3.1." also match. */
const POINT_RE = /^(\d{1,3}(?:\.\d{1,2})?)\s*\.\s+(?=\S)/;

/**
 * Sub-article (մաս / part) splitting threshold — **currently DISABLED.**
 *
 * The idea was sound on paper: 18% of chunks exceeded 7,000 tokens and one
 * article is 67k tokens, too large to sit in a generation context. Splitting
 * at 6,000 chars did improve the size profile exactly as predicted — p90 fell
 * 5,795 → 4,100 chars, chunks over 8k fell 60 → 34, at +53% chunk count.
 *
 * But it made RETRIEVAL MEASURABLY WORSE. Holding the model constant
 * (voyage-3-large) and varying only chunking, on the same 23-question golden
 * set scored at article granularity:
 *
 *     article-level:  hit@5 34.8%   hit@8 47.8%   MRR 0.262
 *     part-level:     hit@5 17.4%   hit@8 26.1%   MRR 0.111
 *
 * Roughly half the retrieval quality, gone. The likely mechanism: an
 * article's embedding carries its topic, while an individual part carries
 * procedural detail that references the topic without stating it
 * ("the persons specified in part 1 shall…"). Splitting dilutes the
 * topical signal across fragments, and no single fragment matches the
 * question as well as the whole article did.
 *
 * Set to a finite value (6000 was tested) to re-enable. Worth re-testing
 * against gemini-embedding-2 — it could not be measured on the day this was
 * run because its free-tier quota was exhausted — but the burden of proof is
 * now on re-enabling, not on leaving it off.
 *
 * The oversized-article problem it was meant to solve is real and remains
 * open: see docs/OPEN-ITEMS.md. The better shape is probably article-level
 * embeddings for RETRIEVAL plus part-level extraction when assembling
 * GENERATION context, rather than one chunk size serving both.
 */
const PART_SPLIT_THRESHOLD = Number.POSITIVE_INFINITY;

/** Annexes appended to a decision are their own mini-documents. */
function isAnnexStart(b: Block): boolean {
  return b.kind === 'annex';
}

/**
 * Split a run of blocks at each numbered point. Blocks before the first point
 * form an unnumbered leading group (a preamble), which is kept rather than
 * dropped — in annexes it is often the table's own caption.
 */
function groupByPoints(
  blocks: Block[],
): { number?: string; blocks: Block[] }[] {
  const groups: { number?: string; blocks: Block[] }[] = [];
  let current: { number?: string; blocks: Block[] } | undefined;

  for (const b of blocks) {
    const m = b.kind === 'text' ? POINT_RE.exec(b.text) : null;
    if (m?.[1]) {
      if (current) groups.push(current);
      current = { number: m[1], blocks: [b] };
      continue;
    }
    if (!current) current = { blocks: [] };
    current.blocks.push(b);
  }
  if (current) groups.push(current);

  return groups.filter((g) => g.blocks.length > 0);
}

/**
 * Group an article's blocks into parts (մաս), for sub-article chunking.
 *
 * Differs from `groupByPoints` in one essential way: **part numbers must
 * increase monotonically.** Within a long article the digit-dot pattern also
 * introduces sub-enumerations that restart at 1, so a naive split produced
 * `Հոդված 341, մաս 1` three separate times. A candidate whose number is not
 * greater than the current part is treated as continuation text belonging to
 * that part, not as a new boundary.
 *
 * Operates on blocks, so a markdown table can never be a boundary.
 */
function groupIntoParts(blocks: Block[]): { number?: string; blocks: Block[] }[] {
  const groups: { number?: string; blocks: Block[] }[] = [];
  let current: { number?: string; blocks: Block[] } | undefined;
  let lastPart = 0;

  for (const b of blocks) {
    const m = b.kind === 'text' ? POINT_RE.exec(b.text) : null;
    // Only a whole number strictly greater than the previous part starts a new
    // one — "3.1." style sub-refs and restarted enumerations stay attached.
    const n = m?.[1] && /^\d+$/.test(m[1]) ? Number(m[1]) : NaN;

    if (Number.isFinite(n) && n > lastPart) {
      if (current) groups.push(current);
      current = { number: String(n), blocks: [b] };
      lastPart = n;
      continue;
    }
    if (!current) current = { blocks: [] };
    current.blocks.push(b);
  }
  if (current) groups.push(current);

  return groups.filter((g) => g.blocks.length > 0);
}

function joinBlocks(blocks: Block[]): { text: string; tableCount: number } {
  const parts: string[] = [];
  let tableCount = 0;
  for (const b of blocks) {
    if (b.kind === 'table' && b.markdown) {
      parts.push(b.markdown);
      tableCount++;
    } else {
      parts.push(b.text);
    }
  }
  return { text: parts.join('\n\n').trim(), tableCount };
}

/** Codes and laws: one chunk per article, carrying its hierarchy. */
function chunkByArticles(blocks: Block[], doc: DocumentContext): Chunk[] {
  const chunks: Chunk[] = [];
  let part: string | undefined;
  let section: string | undefined;
  let chapter: string | undefined;

  let current:
    | { number: string; title: string; path: string[]; body: Block[] }
    | undefined;

  const flush = (): void => {
    if (!current) return;
    const { text, tableCount } = joinBlocks(current.body);

    // Sub-article (մաս / part) splitting for oversized articles.
    //
    // Armenian articles nest: `1.` = մաս (part), `1)` = կետ (point),
    // `ա.` = ենթակետ. Part is the right granularity — point-level would
    // shred an article into fragments that lose their governing context.
    //
    // Done at BLOCK level, not line level, so a markdown table can never
    // become a split boundary. Table-dominated articles (rate schedules,
    // fee lists) therefore stay whole by construction — splitting a rate
    // table is the single worst failure this system can produce.
    //
    // Small articles are left intact: whole-article context retrieves better
    // than a fragment when the article is already a reasonable size.
    if (text.length > PART_SPLIT_THRESHOLD) {
      const parts = groupIntoParts(current.body);
      if (parts.length > 1) {
        for (const p of parts) {
          const joined = joinBlocks(p.blocks);
          if (!joined.text.trim()) continue;
          chunks.push(
            makeChunk(doc, {
              kind: 'article',
              ord: chunks.length,
              ref: p.number
                ? `Հոդված ${current.number}, մաս ${p.number}`
                : `Հոդված ${current.number}, ներածական`,
              title: current.title,
              path: current.path,
              text: joined.text,
              articleNumber: current.number,
              ...(p.number ? { partNumber: p.number } : {}),
              tableCount: joined.tableCount,
            }),
          );
        }
        current = undefined;
        return;
      }
    }

    chunks.push(
      makeChunk(doc, {
        kind: 'article',
        ord: chunks.length,
        ref: `Հոդված ${current.number}`,
        title: current.title,
        path: current.path,
        text,
        articleNumber: current.number,
        tableCount,
      }),
    );
    current = undefined;
  };

  for (const b of blocks) {
    if (b.kind === 'struct') {
      // A new part/section resets the levels beneath it.
      if (b.structKind === 'part') { part = b.structLabel; section = undefined; chapter = undefined; }
      else if (b.structKind === 'section') { section = b.structLabel; chapter = undefined; }
      else chapter = b.structLabel;
      continue;
    }

    if (b.kind === 'article') {
      flush();
      current = {
        number: b.articleNumber ?? '?',
        title: b.articleTitle ?? '',
        path: [part, section, chapter].filter((x): x is string => Boolean(x)),
        body: [],
      };
      continue;
    }

    // Preamble before the first article (title page, adoption line) is dropped:
    // it is document metadata, already captured in the header.
    if (current) current.body.push(b);
  }

  flush();
  return chunks;
}

/**
 * Decisions and orders: one chunk per numbered point, then annexes.
 *
 * Inside an annex, each table becomes its own chunk (a rate schedule is a
 * self-contained unit), while prose between tables accumulates into a text
 * chunk for that annex.
 */
function chunkByPoints(blocks: Block[], doc: DocumentContext): Chunk[] {
  const chunks: Chunk[] = [];

  // Split the document at the first annex heading.
  const firstAnnex = blocks.findIndex(isAnnexStart);
  const mainBlocks = firstAnnex === -1 ? blocks : blocks.slice(0, firstAnnex);
  const annexBlocks = firstAnnex === -1 ? [] : blocks.slice(firstAnnex);

  // --- operative part: numbered points ------------------------------------
  let current: { number: string; body: Block[] } | undefined;

  const flushPoint = (): void => {
    if (!current) return;
    const { text, tableCount } = joinBlocks(current.body);
    if (text) {
      chunks.push(
        makeChunk(doc, {
          kind: 'point',
          ord: chunks.length,
          ref: `կետ ${current.number}`,
          path: [],
          text,
          pointNumber: current.number,
          tableCount,
        }),
      );
    }
    current = undefined;
  };

  for (const b of mainBlocks) {
    if (b.kind === 'text') {
      const m = POINT_RE.exec(b.text);
      if (m?.[1]) {
        flushPoint();
        current = { number: m[1], body: [b] };
        continue;
      }
    }
    // A table belongs to the point that introduced it.
    if (current) current.body.push(b);
  }
  flushPoint();

  // --- annexes -------------------------------------------------------------
  // Refs double as articles.article_number, which is UNIQUE per document, so
  // they must be short, stable and collision-free. The annex's full reference
  // block is long and often shares an 80-char prefix with its siblings, so it
  // is kept in the [Location] header while the ref uses the annex ordinal.
  let annexLabel: string | undefined;
  let annexIndex = 0;
  let annexProse: Block[] = [];
  let tableSeq = 0;
  let partSeq = 0;

  // An annex is a mini-document: its prose carries its own numbered points, so
  // it is split the same way rather than stored as one slab.
  const flushAnnexProse = (): void => {
    const groups = groupByPoints(annexProse);
    annexProse = [];
    for (const g of groups) {
      const { text, tableCount } = joinBlocks(g.blocks);
      if (!text) continue;
      chunks.push(
        makeChunk(doc, {
          kind: 'annex_text',
          ord: chunks.length,
          ref: g.number
            ? `Հավելված ${annexIndex}, կետ ${g.number}`
            : `Հավելված ${annexIndex}, մաս ${++partSeq}`,
          path: annexLabel ? [annexLabel] : [],
          text,
          ...(annexLabel ? { annexLabel } : {}),
          ...(g.number ? { pointNumber: g.number } : {}),
          tableCount,
        }),
      );
    }
  };

  for (const b of annexBlocks) {
    if (isAnnexStart(b)) {
      flushAnnexProse();
      annexLabel = b.annexLabel ?? 'Հավելված';
      annexIndex++;
      tableSeq = 0;
      partSeq = 0;
      continue;
    }

    if (b.kind === 'table' && b.markdown) {
      // Whole-table unit, per the chunking rule: a rate schedule is
      // self-contained, and attaching it to the preceding point buries it.
      flushAnnexProse();
      tableSeq++;
      chunks.push(
        makeChunk(doc, {
          kind: 'annex_table',
          ord: chunks.length,
          ref: `Հավելված ${annexIndex}, աղյուսակ ${tableSeq}`,
          path: annexLabel ? [annexLabel] : [],
          text: b.markdown,
          ...(annexLabel ? { annexLabel } : {}),
          tableCount: 1,
        }),
      );
      continue;
    }

    annexProse.push(b);
  }
  flushAnnexProse();

  return chunks;
}

/**
 * Documents that are one big table with no prose divisions (e.g. a goods list
 * law). Each table is a chunk; surrounding prose becomes a preamble chunk.
 */
function chunkTabular(blocks: Block[], doc: DocumentContext): Chunk[] {
  const chunks: Chunk[] = [];
  let prose: Block[] = [];
  let proseSeq = 0;
  let tableSeq = 0;

  const flushProse = (): void => {
    const { text, tableCount } = joinBlocks(prose);
    prose = [];
    if (!text) return;
    chunks.push(
      makeChunk(doc, {
        kind: 'annex_text',
        ord: chunks.length,
        ref: `նախաբան ${++proseSeq}`,
        path: [],
        text,
        tableCount,
      }),
    );
  };

  for (const b of blocks) {
    if (b.kind === 'table' && b.markdown) {
      flushProse();
      chunks.push(
        makeChunk(doc, {
          kind: 'annex_table',
          ord: chunks.length,
          ref: `աղյուսակ ${++tableSeq}`,
          path: [],
          text: b.markdown,
          tableCount: 1,
        }),
      );
      continue;
    }
    prose.push(b);
  }
  flushProse();

  return chunks;
}

export interface ChunkResult {
  chunks: Chunk[];
  strategy: 'articles' | 'points' | 'tabular' | 'none';
  anomalies: string[];
}

export function chunkDocument(
  page: ActPage,
  blocks: Block[],
  doc: DocumentContext,
): ChunkResult {
  const anomalies: string[] = [];

  let chunks: Chunk[];
  let strategy: ChunkResult['strategy'];

  switch (page.structure) {
    case 'articles':
      chunks = chunkByArticles(blocks, doc);
      strategy = 'articles';
      if (chunks.length !== page.articles.length) {
        anomalies.push(
          `chunk count ${chunks.length} != article headings ${page.articles.length}`,
        );
      }
      break;
    case 'points':
      chunks = chunkByPoints(blocks, doc);
      strategy = 'points';
      break;
    case 'tabular':
      chunks = chunkTabular(blocks, doc);
      strategy = 'tabular';
      break;
    default:
      chunks = [];
      strategy = 'none';
      anomalies.push('no chunking strategy for structure "unknown"');
  }

  // Refs become articles.article_number, which is UNIQUE (document_id,
  // article_number, part_number). A collision would abort the whole ingest
  // transaction, so disambiguate here and report it rather than failing at the
  // database boundary.
  const seen = new Map<string, number>();
  for (const c of chunks) {
    const n = seen.get(c.ref) ?? 0;
    seen.set(c.ref, n + 1);
    if (n > 0) {
      const original = c.ref;
      c.ref = `${c.ref} (${n + 1})`;
      anomalies.push(`duplicate ref "${original}" disambiguated as "${c.ref}"`);
    }
  }

  const empty = chunks.filter((c) => c.text.trim().length === 0).length;
  if (empty > 0) anomalies.push(`${empty} chunk(s) with empty body`);

  // A chunk far beyond typical size usually means a missed boundary.
  const huge = chunks.filter((c) => c.charCount > 60_000);
  if (huge.length > 0) {
    anomalies.push(
      `${huge.length} chunk(s) over 60k chars (${huge.map((c) => c.ref).join(', ').slice(0, 80)})`,
    );
  }

  const tablesInChunks = chunks.reduce((n, c) => n + c.tableCount, 0);
  if (page.dataTables.length > 0 && tablesInChunks < page.dataTables.length) {
    anomalies.push(
      `${page.dataTables.length - tablesInChunks} data table(s) not captured in any chunk`,
    );
  }

  return { chunks, strategy, anomalies };
}
