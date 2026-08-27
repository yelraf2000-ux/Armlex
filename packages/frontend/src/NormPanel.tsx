/**
 * The apparatus: every provision the answer rests on, at once.
 *
 * This replaces the single-provision panel, and the change is the point. An
 * accountant does not read an answer, they verify one — then paste conclusion
 * and statute into a client memo. With one slot, verifying an answer that cites
 * four articles meant four round trips through the same panel, losing your
 * place each time. Here every cited provision is present, collapsed to the
 * fragment that was actually quoted, and expands in place.
 *
 * Set as a printed apparatus rather than a stack of cards: the figure hangs in
 * the gutter, entries are separated by rules, and the citation figures in the
 * transcript address these numbers.
 */
import { useEffect, useState } from 'react';
import type { Chunk } from './types.js';
import { highlight, parseDates, splitHeader } from './chunkText.js';
import { useSettings } from './Settings.js';

export interface Entry {
  chunk: Chunk;
  /** Carried from an earlier turn: read, but not retrieved for this question. */
  carried: boolean;
}

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

/** Cross-references, fetched only when an entry is actually opened. */
function useRelated(articleId: string, open: boolean): Related[] {
  const [related, setRelated] = useState<Related[]>([]);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!open || fetched) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/related?articleId=${encodeURIComponent(articleId)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { related?: Related[] };
        if (!cancelled) {
          setRelated(data.related ?? []);
          setFetched(true);
        }
      } catch {
        /* cross-references are an aid, not a requirement */
      }
    })();
    return () => { cancelled = true; };
  }, [articleId, open, fetched]);

  return related;
}

function ApparatusEntry({
  entry,
  n,
  quotes,
  corpusSynced,
  focused,
  open,
  onToggle,
}: {
  entry: Entry;
  n: number;
  quotes: string[];
  corpusSynced: string | null;
  focused: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useSettings();
  const [copied, setCopied] = useState(false);
  const { chunk, carried } = entry;

  const { header, body } = splitHeader(chunk.text);
  const { adopted, amended } = parseDates(header);
  const segments = highlight(body, quotes);
  const marked = segments.filter((s) => s.mark).map((s) => s.text);
  const related = useRelated(chunk.articleId, open);

  async function copyQuote(): Promise<void> {
    // What an accountant actually pastes into a memo: the words of the law plus
    // the citation that makes them checkable. Either alone is useless.
    const text = marked.length > 0 ? marked.join('\n\n') : body.slice(0, 1200);
    const citation = `${chunk.documentTitle}, ${chunk.ref}`;
    try {
      await navigator.clipboard.writeText(`«${text}»\n\n— ${citation}\n${arlisUrl(chunk.arlisId)}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={focused ? 'entry focused' : 'entry'}>
      <button className="entry-head" onClick={onToggle} aria-expanded={open}>
        <span className="entry-n">{n}</span>
        <span className="entry-main">
          <span className="entry-line">
            <span className="norm-ref" lang="hy">{chunk.ref}</span>
            {amended ? (
              // Red is reserved for things needing attention. A provision amended
              // recently is one — the reader may know the old wording. A 2017
              // amendment is just a date, and flagging every article would train
              // the reader to ignore the colour that matters.
              <span className={isRecent(amended) ? 'rev recent' : 'rev'}>
                {t('norm.revised')} {amended}
              </span>
            ) : null}
          </span>
          <span className="norm-act" lang="hy">{chunk.documentTitle}</span>
        </span>
      </button>

      {/* Collapsed, an entry still shows the fragment the answer actually leans
          on — the quote is the reason it is in the apparatus at all. */}
      {carried ? (
        <div className="entry-quote carried">{t('norm.carried')}</div>
      ) : marked.length > 0 ? (
        <div className="entry-quote" lang="hy">«{marked[0]}»</div>
      ) : null}

      {open ? (
        <div className="entry-body">
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
            <a className="btn" href={arlisUrl(chunk.arlisId)} target="_blank" rel="noreferrer">
              {t('norm.openArlis')}
            </a>
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
        </div>
      ) : null}
    </div>
  );
}

export function NormPanel({
  entries,
  quotes,
  corpusSynced,
  selectedId,
  onSelect,
}: {
  entries: Entry[];
  quotes: string[];
  corpusSynced: string | null;
  /** Which entry the reader last addressed from the transcript. */
  selectedId: string | null;
  onSelect: (articleId: string) => void;
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Selecting a citation in the transcript opens its entry. Everything already
  // open stays open — the whole point is not losing your place.
  useEffect(() => {
    if (selectedId) setOpen((o) => ({ ...o, [selectedId]: true }));
  }, [selectedId]);

  // Nothing to show, so no column: an empty panel headed "Sources" explaining
  // that it is empty is a section that exists only to describe its own absence.
  // The caller drops the grid column when this returns null.
  if (entries.length === 0) return null;

  // The first entry opens by default: the statute should be on screen without
  // anyone having to click.
  const first = entries[0]!.chunk.articleId;
  const isOpen = (id: string): boolean => open[id] ?? (id === first && selectedId === null);

  return (
    /*
      Two elements, because the column has two jobs that want different heights.
      The <aside> is the COLUMN: it stretches the whole grid row, so its ground
      runs as far down as the thread beside it. The inner div is the SCROLLER:
      it sticks to the top and is capped to the window. Doing both jobs with one
      element meant the ground stopped wherever the cap fell — about 100px short
      of the composer's rule, leaving the column visibly cut off.
    */
    <aside className="norm">
      <div className="norm-inner">
        <div className="app-head">
          <span className="app-title">{t('norm.title')}</span>
          <span className="app-count">{entries.length}</span>
        </div>
        <div className="app-rule" />

        {entries.map((entry, i) => (
          <ApparatusEntry
          key={entry.chunk.articleId}
          entry={entry}
          n={i + 1}
          quotes={quotes}
          corpusSynced={corpusSynced}
          focused={selectedId === entry.chunk.articleId}
          open={isOpen(entry.chunk.articleId)}
          onToggle={() => {
            const id = entry.chunk.articleId;
            const next = !isOpen(id);
            setOpen((o) => ({ ...o, [id]: next }));
            // Only report a selection when OPENING. Reporting it on collapse
            // changed `selectedId`, which re-ran the effect above and forced the
            // entry straight back open — so the first entry could never be
            // closed at all.
            if (next) onSelect(id);
          }}
        />
        ))}
      </div>
    </aside>
  );
}
