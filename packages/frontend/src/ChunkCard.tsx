/**
 * One retrieved fragment, as an entry in a ranked list.
 *
 * Search mode is a different job from Dialogue, so it gets a different shape:
 * no opinion, one wide ranked list. Rank and rerank score hang in the gutter
 * the way running heads do, and the score is PRINTED rather than hidden —
 * including when it is weak, in which case it prints in the accent. Hiding a
 * weak result is the dishonest option: a weak result should look weak.
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
import { headerField, highlight, parseDates, splitHeader } from './chunkText.js';
import { useSettings } from './Settings.js';

interface Related {
  articleId: string;
  arlisId: number;
  ref: string;
  documentTitle: string;
}

function arlisUrl(arlisId: number): string {
  return `https://www.arlis.am/hy/acts/${arlisId}/latest`;
}

/** Figures for the ranked list — this is an edition, so it numbers in roman. */
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

/**
 * Below this the reranker is not confident. Printed in the accent rather than
 * suppressed, so the reader can see where the list stops being useful.
 */
const WEAK_SCORE = 0.5;

export function ChunkCard({
  chunk,
  quotes = [],
  rank,
}: {
  chunk: Chunk;
  quotes?: string[];
  rank?: number;
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const [related, setRelated] = useState<Related[] | null>(null);
  const { header, body } = splitHeader(chunk.text);

  const status = headerField(header, 'Status');
  const { adopted, amended } = parseDates(header);

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
  const weak = typeof chunk.score === 'number' && chunk.score < WEAK_SCORE;

  return (
    <div className="card">
      <div className="card-head">
        {rank !== undefined ? <span className="rank">{ROMAN[rank] ?? rank + 1}</span> : null}
        <span className="ref" lang="hy">{chunk.ref}</span>
        <span className="doc" lang="hy">{chunk.documentTitle}</span>
        <span className="meta">
          {typeof chunk.score === 'number' ? (
            <span className={weak ? 'score low' : 'score'}>{chunk.score.toFixed(3)}</span>
          ) : null}
          {chunk.actNumber ? <span className="act" lang="hy">{chunk.actNumber}</span> : null}
          {status ? (
            <span className={status === 'in_force' ? 'status' : 'status warn'}>
              {status === 'in_force' ? t('norm.inForce') : status}
            </span>
          ) : null}
        </span>
      </div>

      {adopted || amended ? (
        <div className="asof">
          {adopted ? `${t('norm.adopted')} ${adopted}` : null}
          {adopted && amended ? ' · ' : null}
          {amended ? `${t('norm.revisedFrom')} ${amended}` : null}
        </div>
      ) : null}

      <div className="card-actions">
        <button className="btn" onClick={() => void toggle()}>
          {open ? t('card.collapse') : t('card.expand')}
        </button>
        <a className="btn" href={arlisUrl(chunk.arlisId)} target="_blank" rel="noreferrer">
          {t('norm.openArlis')}
        </a>
      </div>

      {open ? (
        <>
          <div className="chunk-body" lang="hy">
            {segments.map((s, i) =>
              s.mark ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>,
            )}
          </div>

          {related && related.length > 0 ? (
            <div className="related">
              <span className="related-title">{t('norm.refersTo')}</span>
              {related.map((r) => (
                <a
                  key={r.articleId}
                  className="related-link"
                  href={arlisUrl(r.arlisId)}
                  target="_blank"
                  rel="noreferrer"
                  lang="hy"
                >
                  {r.ref}
                </a>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
