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

/**
 * The opening of a provision, for an entry the answer named but did not quote.
 *
 * NOT a quote, and deliberately not set as one: the panel reserves « » for
 * passages the server verified as verbatim, and dressing a truncated preview
 * in the same marks would make an editorial cut look like an exact citation.
 * The caller shows it plain, and the full text is a click away.
 *
 * One paragraph only — the first that is actually a rule. Articles in this
 * corpus open onto rate TABLES often enough, and onto amendment annotations
 * («վերնագիրը փոփ. 24.10.25 ՀՕ-324-Ն») often enough, that taking the first
 * paragraph blind previewed table plumbing and editorial notes as though they
 * were the provision. Returns '' when the article is nothing but those, and
 * the caller shows no preview at all.
 */
export function opening(body: string, max = 180): string {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find(
      (p) =>
        p !== '' &&
        // A rate table. Pipes read as damage, and the table is only legible
        // expanded — «| Եկամտի տեսակ | Դրույքաչափ |» as a preview tells the
        // reader nothing and looks like the text arrived broken.
        !p.startsWith('|') &&
        // An amendment annotation — «(վերնագիրը փոփ. 24.10.25 ՀՕ-324-Ն)».
        // Articles open with one often enough that it was being shown as
        // though it were the provision. Anything wholly bracketed is editorial.
        !/^\([^)]*\)$/.test(p.replace(/\s+/g, ' ')),
    );
  // Nothing but tables and annotations: better no preview than pipes.
  if (!paragraph) return '';
  const clean = paragraph.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  // Only break on a word if one is far enough in to leave a readable line.
  return `${(lastSpace > 60 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
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
