/**
 * One cited article, as a workbench card (milestone 8).
 *
 * Three things a reader of a legal answer needs and a bare snippet does not
 * give them:
 *
 *   1. The quoted fragment IN PLACE inside the full article, so the surrounding
 *      conditions and exceptions are visible. A quote read alone is the most
 *      common way to be confidently wrong about a provision.
 *   2. Status and amendment date — whether this text is current.
 *   3. The provisions this article defers to. Armenian tax law cites constantly
 *      ("in the manner established by Article 254"), so the article a reader
 *      lands on is often not the one carrying the rule they need.
 */
import { useState } from 'react';
import type { Chunk } from './types.js';

interface Related {
  articleId: string;
  arlisId: number;
  ref: string;
  documentTitle: string;
}

function arlisUrl(arlisId: number): string {
  return `https://www.arlis.am/hy/acts/${arlisId}/latest`;
}

/** Chunks carry a metadata header terminated by '---'; split it for display. */
function splitHeader(text: string): { header: string; body: string } {
  const i = text.indexOf('\n---\n');
  if (i === -1) return { header: '', body: text };
  return { header: text.slice(0, i), body: text.slice(i + 5) };
}

/** Pull one `[Field] value` out of the metadata header. */
function headerField(header: string, field: string): string | null {
  const m = new RegExp(`\\[${field}\\]\\s*([^\\n\\[]*)`).exec(header);
  return m?.[1]?.trim() || null;
}

/**
 * Split `body` around each occurrence of a quote, so it can be marked in place.
 *
 * Matching is plain `indexOf` on the exact quoted string. The quotes reaching
 * this point have already been verified as verbatim substrings of this text
 * server-side, so anything that fails to match here is a quote from a DIFFERENT
 * chunk — correctly left unhighlighted rather than approximately matched.
 */
function highlight(body: string, quotes: string[]): { text: string; mark: boolean }[] {
  const wanted = quotes.filter((q) => q.length > 20 && body.includes(q));
  if (wanted.length === 0) return [{ text: body, mark: false }];

  const parts: { text: string; mark: boolean }[] = [];
  let rest = body;

  for (;;) {
    // Take whichever quote appears earliest in what remains, so overlapping
    // ranges cannot reorder the text.
    let bestAt = -1;
    let best = '';
    for (const q of wanted) {
      const at = rest.indexOf(q);
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

export function ChunkCard({ chunk, quotes = [] }: { chunk: Chunk; quotes?: string[] }) {
  const [open, setOpen] = useState(false);
  const [related, setRelated] = useState<Related[] | null>(null);
  const { header, body } = splitHeader(chunk.text);

  const status = headerField(header, 'Status');
  const dates = headerField(header, 'Dates');

  async function toggle(): Promise<void> {
    const next = !open;
    setOpen(next);
    // Fetched on first expand, not on render: a turn can cite nine articles and
    // nobody opens all of them.
    if (next && related === null) {
      try {
        const res = await fetch(`/api/related?articleId=${encodeURIComponent(chunk.articleId)}`);
        const data = (await res.json()) as { related?: Related[] };
        setRelated(data.related ?? []);
      } catch {
        setRelated([]);
      }
    }
  }

  const segments = open ? highlight(body, quotes) : [];

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="ref">{chunk.ref}</div>
          <div className="doc" lang="hy">{chunk.documentTitle}</div>
        </div>
        <div className="meta">
          {status ? (
            <span className={status === 'in_force' ? 'status ok' : 'status warn'}>
              {status === 'in_force' ? 'действует' : status}
            </span>
          ) : null}
          {chunk.actNumber ? <span className="act">{chunk.actNumber}</span> : null}
        </div>
      </div>

      {dates ? <div className="asof">актуально на: {dates}</div> : null}

      <div className="card-actions">
        <button onClick={() => void toggle()}>
          {open ? 'Свернуть' : 'Показать статью'}
        </button>
        <a href={arlisUrl(chunk.arlisId)} target="_blank" rel="noreferrer">ARLIS ↗</a>
      </div>

      {open ? (
        <>
          <pre className="chunk-body" lang="hy">
            {segments.map((s, i) =>
              s.mark ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
            )}
          </pre>

          {related && related.length > 0 ? (
            <div className="related">
              <div className="related-title">Ссылается на:</div>
              {related.map((r) => (
                <a
                  key={r.articleId}
                  className="related-link"
                  href={arlisUrl(r.arlisId)}
                  target="_blank"
                  rel="noreferrer"
                  lang="hy"
                >
                  {r.ref} ↗
                </a>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
