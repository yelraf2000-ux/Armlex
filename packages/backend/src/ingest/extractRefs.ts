/**
 * Cross-reference extraction — spec pipeline step 4.
 *
 * Armenian tax law is written as a graph, not a list. Հոդված 267 states who
 * may use the micro-business regime and then defers to Հոդված 254 for the
 * threshold; retrieving one without the other gives an answer that is correct
 * about the wrong half of the rule. `article_refs` lets retrieval expand one
 * hop from a strong hit to the provisions it depends on.
 *
 * The patterns here were read off the corpus, not invented — see the shapes
 * that actually occur:
 *
 *   Օրենսգրքի 52-րդ և 53-րդ հոդվածներով      list, joined by "և"
 *   Օրենսգրքի 407-410-րդ հոդվածներով         range
 *   402.1-ին, 402.2-րդ և 422-րդ հոդվածներով  decimal numbers, mixed ordinals
 *   սույն հոդվածի 3-րդ մասով                 SELF-reference, must not be a ref
 *   › ԳԼՈՒԽ 3 › Հոդված 8                     our own metadata header, not text
 *
 * Ordinals vary with the final digit (`-ին` after 1, `-րդ` otherwise), and
 * article numbers are not integers — 402.1 and 402.2 are distinct articles.
 * Both are handled; neither is guessable from a naive `\d+` pattern.
 */

/** Where a citation points. */
export type RefScope =
  /** "Օրենսգրքի …" — the Tax Code, whichever document we are reading. */
  | 'tax-code'
  /** No act named: a reference within the document being read. */
  | 'same-document';

export interface Citation {
  /** Bare article number as written, e.g. "254" or "402.1". */
  articleNumber: string;
  scope: RefScope;
}

/**
 * Strip the chunk's metadata header.
 *
 * The header carries a breadcrumb (`› ԳԼՈՒԽ 3 › Հոդված 8`) naming the chunk's
 * OWN location. Scanning it would make every article cite itself, and the
 * chapter numbers would be read as article numbers. The header ends at the
 * first `---` line, which `makeChunk` always emits.
 */
export function stripHeader(text: string): string {
  const marker = text.indexOf('\n---\n');
  return marker === -1 ? text : text.slice(marker + 5);
}

/** An article number: integer, or dotted like 402.1. */
const NUM = String.raw`\d{1,4}(?:\.\d{1,3})?`;

/** Armenian ordinal suffix: `-ին` after a final 1, `-րդ` otherwise. */
const ORD = String.raw`-(?:րդ|ին)`;

/**
 * One number token: a single article, or a range like `407-410`.
 * The ordinal attaches to the last number only.
 */
const TOKEN = String.raw`${NUM}(?:\s*-\s*${NUM})?${ORD}`;

/** Separators inside a citation list: comma, `և`, or the older `եւ`. */
const SEP = String.raw`(?:\s*,\s*|\s+(?:և|եւ)\s+)`;

/**
 * A citation: one or more number tokens followed by an inflected `հոդված`.
 *
 * `հոդված` takes many endings (հոդվածով, հոդվածներով, հոդվածի, հոդվածում), so
 * the noun is matched by stem plus any letters. Requiring the numbers BEFORE
 * the noun is what excludes «սույն հոդվածի» — a self-reference has no number.
 */
const CITATION = new RegExp(
  String.raw`((?:${TOKEN}${SEP})*${TOKEN})\s+հոդված\p{L}*`,
  'gu',
);

/** How far back to look for the act that a citation belongs to. */
const SCOPE_WINDOW = 60;

/**
 * Widest range expanded into individual articles.
 *
 * A range is a compact way to write a handful of neighbouring provisions.
 * Beyond a certain width it is far more likely that the pattern latched onto
 * two unrelated numbers than that a provision genuinely cites 200 articles,
 * and a bad expansion would pull unrelated text into retrieval — the exact
 * failure `article_refs` exists to prevent.
 */
const MAX_RANGE = 30;

function expandRange(from: string, to: string): string[] {
  // Only integer ranges expand. "402.1-402.9" is not a numeric interval —
  // the dotted part is an insertion marker, not a decimal fraction.
  if (from.includes('.') || to.includes('.')) return [from, to];
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return [from, to];
  if (b - a > MAX_RANGE) return [from, to];
  return Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
}

/**
 * Find every article citation in a chunk body.
 *
 * Returns citations in document order, deduplicated by (number, scope).
 */
export function extractCitations(chunkText: string): Citation[] {
  const body = stripHeader(chunkText).replace(/\s+/g, ' ');
  const out = new Map<string, Citation>();

  for (const m of body.matchAll(CITATION)) {
    const group = m[1];
    if (!group) continue;

    // Which act? Look at the words immediately before the number group.
    // «Օրենսգրքի 52-րդ հոդվածով» points at the Tax Code even when read from a
    // government decision; a bare number points inside the current document.
    const before = body.slice(Math.max(0, m.index - SCOPE_WINDOW), m.index);
    const scope: RefScope = /օրենսգրք/iu.test(before) ? 'tax-code' : 'same-document';

    for (const token of group.split(new RegExp(SEP, 'u'))) {
      const t = token.trim();
      if (!t) continue;
      const parsed = new RegExp(String.raw`^(${NUM})(?:\s*-\s*(${NUM}))?${ORD}$`, 'u').exec(t);
      if (!parsed) continue;

      const first = parsed[1]!;
      const numbers = parsed[2] ? expandRange(first, parsed[2]) : [first];
      for (const n of numbers) out.set(`${n}|${scope}`, { articleNumber: n, scope });
    }
  }

  return [...out.values()];
}
