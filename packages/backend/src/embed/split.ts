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

export function splitCorpus(
  chunks: CorpusChunk[],
  maxTokens = 7000,
  cap = 8000,
): Slice[] {
  const slices = chunks.flatMap((c) => splitChunk(c, maxTokens));
  return enforceTokenCap(renumber(slices), cap);
}
