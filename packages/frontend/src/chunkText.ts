/**
 * Reading the stored form of a chunk.
 *
 * Every chunk carries a metadata header terminated by `---`; the law itself is
 * everything after it. Shared so the norm panel and the source cards cannot
 * drift apart on what counts as the text of a provision.
 */

export function splitHeader(text: string): { header: string; body: string } {
  const i = text.indexOf('\n---\n');
  return i === -1 ? { header: '', body: text } : { header: text.slice(0, i), body: text.slice(i + 5) };
}

/** Pull one `[Field] value` out of the metadata header. */
export function headerField(header: string, field: string): string | null {
  const m = new RegExp(`\\[${field}\\]\\s*([^\\n\\[]*)`).exec(header);
  return m?.[1]?.trim() || null;
}

/** `adopted 2016-10-04 | amended 2026-07` → the two dates, separately. */
export function parseDates(header: string): { adopted: string | null; amended: string | null } {
  const raw = headerField(header, 'Dates') ?? '';
  const iso = (label: string): string | null => {
    const m = new RegExp(`${label}\\s+([0-9]{4}-[0-9]{2}(?:-[0-9]{2})?)`).exec(raw);
    if (!m?.[1]) return null;
    // Legal dates read day-first in both working languages here.
    const parts = m[1].split('-').reverse();
    return parts.join('.');
  };
  return { adopted: iso('adopted'), amended: iso('amended') };
}

export interface Segment {
  text: string;
  mark: boolean;
}

/**
 * Split `body` around each quoted fragment so it can be marked in place.
 *
 * Matching is exact. Quotes reaching the client have already been verified
 * server-side as verbatim substrings of some supplied chunk, so anything that
 * fails to match here belongs to a DIFFERENT chunk — correctly left
 * unhighlighted rather than approximately matched.
 */
export function highlight(body: string, quotes: string[]): Segment[] {
  const wanted = quotes.filter((q) => q.length > 20 && body.includes(q));
  if (wanted.length === 0) return [{ text: body, mark: false }];

  const parts: Segment[] = [];
  let rest = body;

  for (;;) {
    let bestAt = -1;
    let best = '';
    for (const q of wanted) {
      const at = rest.indexOf(q);
      // Earliest match wins, so overlapping ranges cannot reorder the text.
      if (at !== -1 && (bestAt === -1 || at < bestAt)) { bestAt = at; best = q; }
    }
    if (bestAt === -1) break;

    if (bestAt > 0) parts.push({ text: rest.slice(0, bestAt), mark: false });
    parts.push({ text: best, mark: true });
    rest = rest.slice(bestAt + best.length);
  }

  if (rest) parts.push({ text: rest, mark: false });
  return parts;
}
