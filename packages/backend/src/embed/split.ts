/**
 * Token-aware splitting for oversized chunks.
 *
 * Most chunks embed whole. A handful do not: the excise rate table is 43K
 * characters, and Armenian tokenises far worse than English, so a chunk that
 * looks moderate by character count can exceed the model's input limit.
 *
 * Splitting rules:
 *   - Split only at internal boundaries: markdown table row groups, blank-line
 *     separated blocks. Never mid-row — half a rate table is worse than none.
 *   - Every slice carries the full metadata header, so a slice retrieved on its
 *     own still identifies its law, provision and status.
 *   - Slices resolve to the parent chunk id for scoring: retrieving slice 3 of
 *     article 88 counts as retrieving article 88, once.
 */
import { getEncoding } from 'js-tiktoken';
import type { CorpusChunk } from './corpus.js';

// text-embedding-3-* use cl100k_base. Cohere/Voyage tokenise differently, but
// cl100k is a reasonable common yardstick for budgeting and splitting.
const enc = getEncoding('cl100k_base');

export function countTokens(text: string): number {
  return enc.encode(text).length;
}

export interface Slice {
  /** Unique per slice. */
  id: string;
  /** The chunk this slice belongs to — what scoring resolves to. */
  parentId: string;
  arlisId: number;
  text: string;
  tokens: number;
  sliceIndex: number;
  sliceCount: number;
}

/** Header is everything up to and including the '---' terminator. */
function splitHeader(text: string): { header: string; body: string } {
  const marker = '\n---\n';
  const i = text.indexOf(marker);
  if (i === -1) return { header: '', body: text };
  return {
    header: text.slice(0, i + marker.length),
    body: text.slice(i + marker.length),
  };
}

/**
 * Break a body into atomic units that must never be split internally.
 * Markdown table rows are atomic; prose splits on blank lines.
 */
function atomicUnits(body: string): string[] {
  const lines = body.split('\n');
  const units: string[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    if (buffer.length) {
      units.push(buffer.join('\n'));
      buffer = [];
    }
  };

  for (const line of lines) {
    if (line.trim() === '') {
      flush();
      continue;
    }
    // Each table row is its own unit so groups can be cut between rows.
    if (line.startsWith('|')) {
      flush();
      units.push(line);
      continue;
    }
    buffer.push(line);
  }
  flush();

  return units.filter((u) => u.trim() !== '');
}

/** Header rows of a markdown table, repeated on every slice of that table. */
function tableHeaderOf(units: string[]): string | undefined {
  const first = units.find((u) => u.startsWith('|'));
  const sepIdx = units.findIndex((u) => /^\|\s*---/.test(u));
  if (!first || sepIdx === -1) return undefined;
  return `${units[sepIdx - 1] ?? first}\n${units[sepIdx]}`;
}

/**
 * Guarantee no unit exceeds the budget.
 *
 * A single atomic unit can still be too large — one table row listing a hundred
 * commodity codes, or an unbroken paragraph. Left alone it would produce a
 * slice above the model's hard input limit (8191 tokens for OpenAI v3), which
 * is a request error, not a quality problem. Degrade gracefully: sentence
 * boundaries first, then a hard token cut as the last resort.
 */
function expandOversizedUnits(units: string[], budget: number): string[] {
  const out: string[] = [];

  for (const unit of units) {
    if (countTokens(unit) < budget) {
      out.push(unit);
      continue;
    }

    // Armenian sentences end with U+0589 ARMENIAN FULL STOP (։); also allow
    // ASCII terminators, which appear in translated/technical passages.
    const sentences = unit.split(/(?<=[։.;])\s+/).filter(Boolean);
    let buf = '';

    const flushBuf = (): void => {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
    };

    for (const s of sentences) {
      if (countTokens(s) >= budget) {
        flushBuf();
        out.push(...hardCut(s, budget));
        continue;
      }
      if (countTokens(buf + ' ' + s) >= budget) flushBuf();
      buf = buf ? `${buf} ${s}` : s;
    }
    flushBuf();
  }

  return out;
}

/** Last resort: cut on token boundaries so nothing exceeds the limit. */
function hardCut(text: string, budget: number): string[] {
  // A non-positive step would loop forever; the caller's budget can collapse
  // when a metadata header or table header is unusually long.
  const step = Math.max(1, Math.floor(budget));
  const tokens = enc.encode(text);
  const parts: string[] = [];
  for (let i = 0; i < tokens.length; i += step) {
    parts.push(enc.decode(tokens.slice(i, i + budget)));
  }
  return parts;
}

export function splitChunk(chunk: CorpusChunk, maxTokens = 7000): Slice[] {
  const total = countTokens(chunk.text);
  if (total <= maxTokens) {
    return [
      {
        id: chunk.id,
        parentId: chunk.id,
        arlisId: chunk.arlisId,
        text: chunk.text,
        tokens: total,
        sliceIndex: 0,
        sliceCount: 1,
      },
    ];
  }

  const { header, body } = splitHeader(chunk.text);
  const units = atomicUnits(body);
  const tableHeader = tableHeaderOf(units);

  const headerTokens = countTokens(header);
  const tableHeaderTokens = tableHeader ? countTokens(tableHeader) : 0;
  // Floor the budget: a very long document title plus a wide table header can
  // otherwise consume the whole allowance and leave nothing for content.
  const budget = Math.max(256, maxTokens - headerTokens - tableHeaderTokens - 16);

  const groups: string[][] = [];
  let current: string[] = [];
  let used = 0;

  for (const unit of expandOversizedUnits(units, budget)) {
    const t = countTokens(unit);
    if (t >= budget) {
      // Still oversized after hard splitting: emit alone rather than merge.
      if (current.length) { groups.push(current); current = []; used = 0; }
      groups.push([unit]);
      continue;
    }
    if (used + t > budget && current.length) {
      groups.push(current);
      current = [];
      used = 0;
    }
    current.push(unit);
    used += t;
  }
  if (current.length) groups.push(current);

  return groups.map((g, i) => {
    const isTablePart = tableHeader && g.some((u) => u.startsWith('|'));
    // Repeat the table header so a middle slice still has column names.
    const prefix = isTablePart && i > 0 ? `${tableHeader}\n` : '';
    const text = `${header}${prefix}${g.join('\n')}`;
    return {
      id: `${chunk.id}::${i}`,
      parentId: chunk.id,
      arlisId: chunk.arlisId,
      text,
      tokens: countTokens(text),
      sliceIndex: i,
      sliceCount: groups.length,
    };
  });
}

/**
 * Guarantee that NO slice exceeds `cap`, whatever the boundary logic did.
 *
 * The boundary-aware splitter tries to cut at table rows and sentences, but a
 * single atomic unit can defeat it — act 174166 contains one markdown table row
 * of ~8,057 tokens. Rather than trust that path, this backstop re-checks every
 * emitted slice and hard-cuts any that is still over, recursively, until the
 * invariant holds. Exceeding the cap is a request error (HTTP 400), not a
 * quality issue, so correctness here outranks tidy boundaries.
 */
function enforceTokenCap(slices: Slice[], cap: number, depth = 0): Slice[] {
  const over = slices.filter((s) => s.tokens > cap);
  if (over.length === 0) return slices;

  // Depth guard: if a header alone exceeds the cap nothing can shrink further,
  // and recursing would never terminate.
  if (depth >= 4) return slices;

  const out: Slice[] = [];
  for (const s of slices) {
    if (s.tokens <= cap) {
      out.push(s);
      continue;
    }

    const { header, body } = splitHeader(s.text);
    const headerTokens = countTokens(header);
    const room = cap - headerTokens - 8;

    // Header alone leaves no usable room: emit without the header rather than
    // loop forever. The parent id still carries provenance.
    if (room < 64) {
      for (const [i, part] of hardCut(s.text, cap - 8).entries()) {
        out.push({ ...s, id: `${s.id}~${i}`, text: part, tokens: countTokens(part) });
      }
      continue;
    }

    for (const [i, part] of hardCut(body, room).entries()) {
      const text = `${header}${part}`;
      out.push({ ...s, id: `${s.id}~${i}`, text, tokens: countTokens(text) });
    }
  }

  return enforceTokenCap(renumber(out), cap, depth + 1);
}

/** Recompute sliceIndex/sliceCount per parent after any re-splitting. */
function renumber(slices: Slice[]): Slice[] {
  const counts = new Map<string, number>();
  for (const s of slices) counts.set(s.parentId, (counts.get(s.parentId) ?? 0) + 1);
  const seen = new Map<string, number>();
  return slices.map((s) => {
    const i = seen.get(s.parentId) ?? 0;
    seen.set(s.parentId, i + 1);
    return { ...s, sliceIndex: i, sliceCount: counts.get(s.parentId) ?? 1 };
  });
}

// ---------------------------------------------------------------------------
// Enumeration-aware policy: one vector per enumerated item
// ---------------------------------------------------------------------------

/**
 * Why a second policy exists.
 *
 * The token policy above embeds Հոդված 64 — the VAT exemptions list, 26,000
 * characters — as 8 vectors of ~3,300 characters each. Every vector is the
 * average of a dozen unrelated exemptions (medical, education, funerals,
 * finance), so a question about ONE of them matches the blur weakly. Measured
 * on real traffic: 64 was never retrieved for an electric-car VAT question it
 * answers; the rate table in 258 reached retrieval for 17 of 250 questions
 * despite governing the most common regime. Same mechanism, four articles,
 * every Class-1 failure we traced.
 *
 * The fix is one vector per enumerated item, all resolving to the parent chunk
 * (scoring already max-pools slices per article, so nothing downstream
 * changes). This is NOT the sub-article chunking that was measured and
 * reverted: that made each part a separate retrievable chunk, fragmenting what
 * generation saw. Here generation still receives the whole article; only the
 * index gets sharper.
 */

/** Only enumerations long enough to blur get the treatment. */
const ENUM_MIN_CHARS = 2500;
/** Fewer markers than this and it is prose, not a list. */
const ENUM_MIN_ITEMS = 4;
/** Items shorter than this merge into a neighbour — a bare "2." is not a slice. */
const ENUM_MIN_ITEM_CHARS = 120;
/** Governing lead-in carried into each point, truncated. */
const LEAD_MAX_CHARS = 220;

/** Part-level marker: "1." / "2.1." at line start. */
const PART_RE = /^\s*\d+(?:\.\d+)*\.\s/;
/** Point-level marker: "1)" / "ա." / "ա)" at line start. */
const POINT_RE = /^\s*(?:\d+\)|[ա-ֆ][.)])\s/u;

export function isEnumeration(body: string): boolean {
  if (body.length < ENUM_MIN_CHARS) return false;
  const lines = body.split('\n');
  const markers = lines.filter((l) => PART_RE.test(l) || POINT_RE.test(l) || /^\|\s*\d+\)/.test(l)).length;
  return markers >= ENUM_MIN_ITEMS;
}

interface EnumItem {
  text: string;
  /** Lead-in of the governing part, for points. */
  lead: string | undefined;
  isTableRow: boolean;
}

/**
 * Cut a body into enumerated items.
 *
 * A new item starts at every part marker, point marker, or table row;
 * continuation lines attach to the current item. Points remember the lead-in
 * of the part they sit under, because «8) թաղման բյուրոների…» says nothing
 * about VAT until you know it sits under «2. ԱԱՀ-ից ազատվում են…».
 */
function enumerationItems(body: string): EnumItem[] {
  const items: EnumItem[] = [];
  let current: EnumItem | null = null;
  let lead: string | undefined;

  const push = (): void => {
    if (current && current.text.trim()) items.push(current);
    current = null;
  };

  for (const line of body.split('\n')) {
    if (line.trim() === '') continue;

    if (line.startsWith('|')) {
      push();
      current = { text: line, lead, isTableRow: true };
      push();
      continue;
    }
    if (PART_RE.test(line)) {
      push();
      lead = line.trim().slice(0, LEAD_MAX_CHARS);
      current = { text: line, lead: undefined, isTableRow: false };
      continue;
    }
    if (POINT_RE.test(line)) {
      push();
      current = { text: line, lead, isTableRow: false };
      continue;
    }
    // Continuation.
    if (current) current.text += `\n${line}`;
    else current = { text: line, lead, isTableRow: false };
  }
  push();
  return items;
}

/** Merge items too short to stand alone into the item that follows them. */
function mergeTiny(items: EnumItem[]): EnumItem[] {
  const out: EnumItem[] = [];
  let carry: EnumItem | null = null;
  for (const it of items) {
    if (carry) {
      it.text = `${carry.text}\n${it.text}`;
      it.lead ??= carry.lead;
      carry = null;
    }
    if (it.text.length < ENUM_MIN_ITEM_CHARS && !it.isTableRow) {
      carry = it;
      continue;
    }
    out.push(it);
  }
  if (carry) {
    const last = out[out.length - 1];
    if (last) last.text += `\n${carry.text}`;
    else out.push(carry);
  }
  return out;
}

export function splitEnumerated(chunk: CorpusChunk): Slice[] {
  const { header, body } = splitHeader(chunk.text);
  if (!isEnumeration(body)) return splitChunk(chunk);

  const units = atomicUnits(body);
  const tableHeader = tableHeaderOf(units);
  const items = mergeTiny(enumerationItems(body));

  return items.map((it, i) => {
    // Header rows of the table are structure, not items; they travel as a
    // prefix on every data row instead.
    const isTableHeaderRow = it.isTableRow && tableHeader?.includes(it.text);
    const parts = [header];
    if (it.isTableRow && tableHeader && !isTableHeaderRow) parts.push(`${tableHeader}\n`);
    // Do not re-attach a lead-in the item already opens with. `mergeTiny` folds
    // a bare part line into the point that follows it, so that merged item's
    // text ALREADY starts with the lead — prepending it again produced
    //   «5. …չեն կարող համարվել` 5. …չեն կարող համարվել` 1) բանկերը…»
    // on Հոդված 267. Corrupt-looking text with real consequences: the model was
    // shown part 5 and answered that part 5 was absent from its fragments.
    // Affects the first slice of every enumeration, so it is also in the
    // embedded text — a re-embed is needed for the index to benefit.
    const opensWithLead =
      it.lead !== undefined &&
      it.text.trimStart().startsWith(it.lead.trim().slice(0, Math.min(60, it.lead.trim().length)));
    if (it.lead && !opensWithLead) parts.push(`${it.lead}\n`);
    parts.push(it.text);
    const text = parts.join('');
    return {
      id: `${chunk.id}::e${i}`,
      parentId: chunk.id,
      arlisId: chunk.arlisId,
      text,
      tokens: countTokens(text),
      sliceIndex: i,
      sliceCount: items.length,
    };
  }).filter((s) => {
    // Drop slices that are ONLY the table header (structure without content).
    const { body: b } = splitHeader(s.text);
    return tableHeader ? b.trim() !== tableHeader.trim() : true;
  });
}

export type SplitPolicy = 'token' | 'enum';

export function splitCorpus(
  chunks: CorpusChunk[],
  maxTokens = 7000,
  cap = 8000,
  policy: SplitPolicy = 'token',
): Slice[] {
  const slices = chunks.flatMap((c) =>
    policy === 'enum' ? splitEnumerated(c) : splitChunk(c, maxTokens),
  );
  return enforceTokenCap(renumber(slices), cap);
}
