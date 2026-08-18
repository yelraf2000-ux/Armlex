/**
 * The cited provision, kept on screen beside the answer.
 *
 * The change this makes is the whole point of the workbench: an accountant does
 * not read an answer, they verify one, then paste conclusion and statute into a
 * client memo. Behind a toggle, verification is the expensive step — expand a
 * card, hunt for the quoted line, lose the answer off-screen. Here the norm and
 * the conclusion are visible together, with the quoted fragment already marked.
 */
import { useEffect, useState } from 'react';
import type { Chunk } from './types.js';
import { highlight, parseDates, splitHeader } from './chunkText.js';
import { useSettings } from './Settings.js';

interface Related {
  articleId: string;
  arlisId: number;
  ref: string;
  documentTitle: string;
}

const arlisUrl = (arlisId: number): string => `https://www.arlis.am/hy/acts/${arlisId}/latest`;

/** Amendments within this window are worth a second look before relying on them. */
const RECENT_DAYS = 180;

/** `dd.mm.yyyy` or `mm.yyyy` (as parsed from the chunk header) → is it recent? */
function isRecent(ddmmyyyy: string): boolean {
  const parts = ddmmyyyy.split('.').map(Number);
  const year = parts[parts.length - 1];
  const month = parts.length >= 2 ? parts[parts.length - 2] : 1;
  const day = parts.length >= 3 ? parts[0] : 1;
  if (!year || !month) return false;
  const when = new Date(year, month - 1, day ?? 1).getTime();
  return (Date.now() - when) / 86_400_000 < RECENT_DAYS;
}

export function NormPanel({
  chunk,
  quotes,
  corpusSynced,
}: {
  chunk: Chunk | null;
  quotes: string[];
  corpusSynced: string | null;
}) {
  const { t } = useSettings();
  const [related, setRelated] = useState<Related[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRelated([]);
    setCopied(false);
    if (!chunk) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/related?articleId=${encodeURIComponent(chunk.articleId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { related?: Related[] };
        if (!cancelled) setRelated(data.related ?? []);
      } catch {
        /* related provisions are an aid, not a requirement */
      }
    })();
    return () => { cancelled = true; };
  }, [chunk]);

  if (!chunk) {
    return (
      <aside className="norm">
        <div className="panel-title">{t('norm.title')}</div>
        <p className="norm-empty">
          {t('norm.empty')}
        </p>
      </aside>
    );
  }

  const { header, body } = splitHeader(chunk.text);
  const { adopted, amended } = parseDates(header);
  const segments = highlight(body, quotes);
  const marked = segments.filter((s) => s.mark).map((s) => s.text);

  async function copyQuote(): Promise<void> {
    // What an accountant actually pastes into a memo: the words of the law
    // plus the citation that makes them checkable. Either alone is useless in
    // correspondence.
    const text = marked.length > 0 ? marked.join('\n\n') : body.slice(0, 1200);
    const citation = `${chunk!.documentTitle}, ${chunk!.ref}`;
    try {
      await navigator.clipboard.writeText(`«${text}»\n\n— ${citation}\n${arlisUrl(chunk!.arlisId)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="norm">
      <div className="panel-title">{t('norm.title')}</div>

      <div className="norm-head">
        <span className="norm-ref" lang="hy">{chunk.ref}</span>
        <span className="chip">{t('norm.inForce')}</span>
        {amended ? (
          // Red is reserved for things needing attention. A provision amended
          // recently is one — the reader may know the old wording, and an
          // answer resting on fresh text deserves a second look. A 2017
          // amendment is just a date, and flagging every article in red would
          // train the reader to ignore the colour that matters.
          <span className={isRecent(amended) ? 'chip warn' : 'chip quiet'}>
            {t('norm.revised')} {amended}
          </span>
        ) : null}
      </div>
      <div className="norm-act" lang="hy">{chunk.documentTitle}</div>

      <dl className="norm-dates">
        {adopted ? <div><dt>{t('norm.adopted')}</dt><dd>{adopted}</dd></div> : null}
        {amended ? <div><dt>{t('norm.revisedFrom')}</dt><dd>{amended}</dd></div> : null}
        {corpusSynced ? <div><dt>{t('norm.checked')}</dt><dd>{corpusSynced}</dd></div> : null}
      </dl>

      <div className="norm-body" lang="hy">
        {segments.map((s, i) => (s.mark ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
      </div>

      <div className="norm-actions">
        <button className="btn" onClick={() => void copyQuote()}>
          {copied ? t('norm.copied') : marked.length > 0 ? t('norm.copyQuote') : t('norm.copyArticle')}
        </button>
        <a className="btn" href={arlisUrl(chunk.arlisId)} target="_blank" rel="noreferrer">ARLIS ↗</a>
      </div>

      {related.length > 0 ? (
        <>
          <div className="panel-title">{t('norm.refersTo')}</div>
          <div className="refs">
            {related.map((r) => (
              <a
                key={r.articleId}
                className="ref"
                lang="hy"
                href={arlisUrl(r.arlisId)}
                target="_blank"
                rel="noreferrer"
              >
                {r.ref}
              </a>
            ))}
          </div>
        </>
      ) : null}
    </aside>
  );
}
