/**
 * Quoted spans in an answer, for highlighting them inside the cited article.
 *
 * The server has already verified every quote that survives into the answer as
 * a verbatim substring of some supplied chunk, so this only needs to find them
 * — not judge them. Matching in the card is exact, and a quote belonging to a
 * different chunk simply will not be found there.
 */
const DELIMITERS: { open: string; close: string }[] = [
  { open: '«', close: '»' },
  { open: '“', close: '”' },
];

export function extractQuotes(answer: string): string[] {
  const found: string[] = [];
  for (const { open, close } of DELIMITERS) {
    let i = 0;
    for (;;) {
      const start = answer.indexOf(open, i);
      if (start === -1) break;
      const end = answer.indexOf(close, start + open.length);
      if (end === -1) break;
      const inner = answer.slice(start + open.length, end);
      if (inner.length > 20) found.push(inner);
      i = end + close.length;
    }
  }
  return found;
}
