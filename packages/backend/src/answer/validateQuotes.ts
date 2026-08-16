/**
 * Verbatim quote validation — spec principle #2.
 *
 * The system prompt tells the model to quote the law exactly. That is an
 * instruction, not a guarantee: a model can paraphrase, merge two provisions,
 * silently modernise wording, or fabricate outright. In a legal tool a
 * fabricated Armenian quote is the worst possible output — it is specific,
 * authoritative-looking, and citable, so it survives scrutiny far longer than
 * a vague wrong answer.
 *
 * This checks every quoted Armenian span in an answer against the actual chunk
 * texts that were supplied, programmatically. Per the spec: an unverifiable
 * quote is dropped, while its reference is kept — the citation still points
 * the reader at the real provision, but we never present unverified text as
 * the words of the law.
 *
 * Deliberately NOT a fuzzy match. "Close enough" is exactly the failure mode
 * being guarded against; a quote that differs by a negation or a number is
 * both nearly identical and completely wrong.
 */

/** Quote delimiters used in Armenian and Russian legal writing. */
export const QUOTE_PATTERNS: { open: string; close: string }[] = [
  { open: '«', close: '»' },
  { open: '"', close: '"' },
  { open: '“', close: '”' },
];

const ARMENIAN = /[԰-֏]/;

/** Shortest span treated as a quotation rather than a term. */
const MIN_QUOTE = 25;

/**
 * Is this span subject to verbatim rules at all?
 *
 * Only Armenian legal text is: a Russian phrase in quotes is the model's own
 * prose, not a claim about the law, and a very short span is a term rather
 * than a quotation.
 */
export function isCheckableQuote(inner: string): boolean {
  return ARMENIAN.test(inner) && normalise(inner).length >= MIN_QUOTE;
}

/**
 * Verify one quote against the supplied chunk texts.
 *
 * Exported so the streaming path can check a quote the moment its closing
 * delimiter arrives, applying exactly the same rule as the batch path. Two
 * implementations of "is this verbatim" would inevitably drift, and the one
 * users see would be the untested one.
 */
export function isVerbatimQuote(quote: string, chunkTexts: string[]): boolean {
  const needle = normalise(quote);
  return chunkTexts.some((t) => matches(needle, normalise(t)));
}

/** The notice shown in place of a quote that could not be verified. */
export function removalNotice(language: 'hy' | 'ru'): string {
  return language === 'hy'
    ? '[մեջբերումը չհաստատվեց և հանվեց — բացեք հոդվածը հղումով]'
    : '[цитата не прошла проверку и была удалена — откройте статью по ссылке]';
}

export interface QuoteCheck {
  quote: string;
  valid: boolean;
  /** Index of the chunk it was found in, when valid. */
  matchedChunk?: number;
}

export interface ValidationResult {
  checks: QuoteCheck[];
  /** The answer with unverifiable quotes removed. */
  sanitized: string;
  invalidCount: number;
}

/**
 * Normalise for comparison WITHOUT weakening the check.
 *
 * Only differences that carry no legal meaning are collapsed: whitespace runs,
 * non-breaking spaces, and the several dash and apostrophe characters that
 * vary between ARLIS's HTML and a model's output. Letters, digits, negations
 * and punctuation that changes meaning are all preserved exactly.
 */
function normalise(s: string): string {
  return s
    .replace(/ /g, ' ')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’ʼ]/g, "'")
    // U+0589 ARMENIAN FULL STOP and ASCII ':' are the same sentence terminator.
    // ARLIS emits the ASCII form; a model writing Armenian properly emits the
    // Unicode one. Same mark, different encoding of it.
    .replace(/։/g, ':')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sentence-final punctuation, which a quotation may legitimately differ on.
 *
 * A quote ends where the writer chose to stop, and the mark they put there is
 * a decision about their own sentence, not a claim about the law's wording.
 * Measured: the model reproduced Հոդված 8 of the Tax Code verbatim and closed
 * it with `.` where the corpus has `:`. Rejecting that trains the reader to
 * ignore the warning notice, which is the one thing it must never do.
 *
 * Only the TRAILING mark is optional. Interior punctuation stays exact: a comma
 * moved inside a provision changes which clause a condition binds to.
 */
const TRAILING_PUNCT = /[.:;,]+$/;

/**
 * A part number the model prefixes to a quoted provision ("1. ", "3) ").
 *
 * The number identifies the provision rather than asserting anything about its
 * content, and the chunker does not always keep it adjacent to the text, so it
 * is dropped before matching. What remains — the actual legal proposition —
 * still has to be verbatim.
 */
const LEADING_ENUM = /^\d+[.)]\s*/;

/** Extract quoted spans that contain Armenian text. */
export function extractQuotes(answer: string): string[] {
  const found: string[] = [];

  for (const { open, close } of QUOTE_PATTERNS) {
    let i = 0;
    while (i < answer.length) {
      const start = answer.indexOf(open, i);
      if (start === -1) break;
      const end = answer.indexOf(close, start + open.length);
      if (end === -1) break;

      const inner = answer.slice(start + open.length, end);
      if (isCheckableQuote(inner)) found.push(inner);
      i = end + close.length;
    }
  }

  return found;
}

/** Elision markers a model uses when it skips a span inside a quotation. */
const ELLIPSIS = /\s*(?:\[?(?:…|\.\.\.|․․․)\]?)\s*/;

/**
 * Shortest segment accepted either side of an ellipsis.
 *
 * Elision is a legitimate quoting convention — «X ... Y» where X and Y are both
 * verbatim is an honest quotation, and rejecting it trains the reader to ignore
 * the warning notice. But short segments match by coincidence in a 34,000-word
 * corpus, and stitching two coincidental matches together is exactly how a
 * fabricated claim could slip through. Long segments cannot collide by accident.
 */
const MIN_SEGMENT = 15;

/**
 * Does `needle` appear in `haystack`, allowing elided spans?
 *
 * Segments must match **in order and without overlap** (the search resumes past
 * the previous match). Order matters legally: the same words rearranged can
 * invert a condition, so an out-of-order "match" is not a quotation of anything.
 */
function matches(needle: string, haystack: string): boolean {
  if (haystack.includes(needle)) return true;

  const segments = needle
    .split(ELLIPSIS)
    // Both relaxations apply to EVERY segment, including the sole segment of a
    // quote with no elision at all. Applying them only on the ellipsis path was
    // a bug: it rejected «1. Հայաստանի Հանրապետությունում գործում են հարկման
    // ընդհանուր և հատուկ համակարգեր.» — verbatim Հոդված 8, differing from the
    // corpus only by a part number the model restored and a final `.` for `:`.
    .map((s) => s.trim().replace(TRAILING_PUNCT, '').replace(LEADING_ENUM, '').trim())
    // A bare enumerator ("1.", "3)") is not a legal proposition — it cannot be
    // the thing being fabricated, and it is what a model emits when it quotes a
    // numbered part from partway in: «1. ...հսկիչ դրամարկղային...».
    .filter((s) => s && !/^[\d.)\s-]+$/.test(s));

  if (segments.length < 2) {
    const only = segments[0];
    return only !== undefined && only.length >= MIN_SEGMENT && haystack.includes(only);
  }

  let from = 0;
  for (const segment of segments) {
    if (segment.length < MIN_SEGMENT) return false;
    const at = haystack.indexOf(segment, from);
    if (at < 0) return false;
    from = at + segment.length;
  }
  return true;
}

export function validateQuotes(answer: string, chunkTexts: string[]): ValidationResult {
  const haystacks = chunkTexts.map(normalise);
  const quotes = extractQuotes(answer);

  const checks: QuoteCheck[] = quotes.map((quote) => {
    const needle = normalise(quote);
    const idx = haystacks.findIndex((h) => matches(needle, h));
    return idx >= 0
      ? { quote, valid: true, matchedChunk: idx }
      : { quote, valid: false };
  });

  // The replacement text must match the ANSWER's language. A Russian notice
  // dropped into an Armenian answer reads as a system malfunction rather than
  // a deliberate safeguard.
  const cyrillic = (answer.match(/[Ѐ-ӿ]/g) ?? []).length;
  const armenian = (answer.match(/[԰-֏]/g) ?? []).length;
  const notice = removalNotice(armenian > cyrillic ? 'hy' : 'ru');

  // Remove only the quoted text, leaving surrounding prose and any citation
  // intact — the reference still directs the reader to the real provision.
  let sanitized = answer;
  for (const c of checks) {
    if (c.valid) continue;
    for (const { open, close } of QUOTE_PATTERNS) {
      const full = `${open}${c.quote}${close}`;
      if (sanitized.includes(full)) {
        sanitized = sanitized.replace(full, notice);
        break;
      }
    }
  }

  return {
    checks,
    sanitized,
    invalidCount: checks.filter((c) => !c.valid).length,
  };
}
