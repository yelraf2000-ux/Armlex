/**
 * Which retrieved provisions an answer actually leans on.
 *
 * The apparatus used to list everything retrieval returned — an answer resting
 * on four articles filed under fourteen, with nothing saying which was which.
 * This is the rule that separates them, and it reads only the delivered text:
 * the provisions the answer NAMES, and the provisions it QUOTES.
 *
 * Deliberately conservative in both directions. Presenting a provision as the
 * basis of an answer that never used it is a lie a professional would act on;
 * hiding one the answer does rest on breaks the checking this column exists
 * for. Where the two risks collide — below — the code keeps the provision.
 */
import { extractQuotes } from './quotes.js';

/** Just enough of a chunk to decide. */
export interface CitedCandidate {
  /** The provision's own reference — «Հոդված 254», «Հավելված 1, կետ 8». */
  ref: string;
  /** The article's full stored text, for matching quotes against. */
  text: string;
}

/**
 * Short references are not evidence.
 *
 * A reference like «կետ 1» is six characters that occur inside any answer
 * discussing a point of anything — including a citation of a DIFFERENT act's
 * point 1. Only references long enough to be distinctive count as a naming;
 * a short one still qualifies through its quote, which is exact.
 */
const DISTINCTIVE = 8;

/**
 * Does the answer name this provision?
 *
 * Bounded on the right, because «Հոդված 3» occurs inside «Հոդված 30» and the
 * wrong article presented as the basis of an answer is the failure that
 * matters most here. A digit may not follow the match.
 */
function names(text: string, ref: string): boolean {
  if (ref.length < DISTINCTIVE) return false;
  let from = 0;
  for (;;) {
    const at = text.indexOf(ref, from);
    if (at === -1) return false;
    const after = text[at + ref.length];
    if (after === undefined || !/[0-9]/.test(after)) return true;
    from = at + 1;
  }
}

/**
 * Filter candidates down to the ones the answer used.
 *
 * Returns everything when nothing matches: an answer citing in a form this
 * does not recognise must not leave the reader with no apparatus at all.
 *
 * `settled` says whether the answer is finished. It governs that fallback and
 * nothing else, because the fallback is the only part of this rule that is not
 * monotone — the matching itself only ever gains provisions as the text grows,
 * since a text containing «Հոդված 150» goes on containing it.
 *
 * An UNSETTLED answer therefore gets no fallback. Applying it mid-stream meant
 * the column opened with all sixteen retrieved provisions, held them for the
 * seconds before the first citation appeared, then collapsed to two — the
 * reader watching fourteen sources they had begun reading be taken away. With
 * the fallback held back the column starts empty and fills as the answer cites,
 * which is also the truer account: these are the provisions used SO FAR.
 */
export function citedIndexes(
  candidates: CitedCandidate[],
  answer: string,
  settled = true,
): number[] {
  const all = (): number[] => candidates.map((_, i) => i);
  if (!answer) return settled ? all() : [];
  const quoted = extractQuotes(answer);
  const used: number[] = [];
  candidates.forEach((c, i) => {
    if (names(answer, c.ref) || quoted.some((q) => c.text.includes(q))) used.push(i);
  });
  return used.length > 0 || !settled ? used : all();
}
