/**
 * Past conversations.
 *
 * Tax questions are rarely one-shot — a professional works a case over several
 * sittings, and the established facts (`fact_summary`) live on the session.
 * Without a way back into a session, that accumulated context is unreachable
 * and the work has to be redone from the first question.
 */
import { useEffect, useRef, useState } from 'react';
import { SharePopup } from './SharePopup.js';
import { useSettings } from './Settings.js';

export interface SessionSummary {
  id: string;
  createdAt: string;
  turns: number;
  firstMessage: string;
  /** A link has been issued for this conversation and has not been withdrawn. */
  shared?: boolean;
  /** A name the owner gave it; falls back to the first question when unset. */
  title?: string | null;
  pinned?: boolean;
  /** Text around the keyword hit. Present only in a search result. */
  snippet?: string;
}

function shortDate(iso: string): string {
  // Postgres renders `2026-08-15 14:02:07.95+00`; the date and minute are all
  // that is useful in a list.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]} ${m[4]}` : iso.slice(0, 16);
}

/** Small stroked glyphs, sized to the menu text rather than to each other. */
function Icon({ d }: { d: string[] }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {d.map((path, i) => (
        <path key={i} d={path} />
      ))}
    </svg>
  );
}

const PIN = ['M12 17v5', 'M9 2h6l-1 6 3 3v2H7v-2l3-3-1-6z'];
const PENCIL = ['M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z', 'M14.5 6.5l3 3'];
const SHARE = ['M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7', 'M12 15V3M8 7l4-4 4 4'];
const TRASH = ['M4 7h16', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M6 7l1 13h10l1-13'];
const CHECK = ['M20 6L9 17l-5-5'];

export function Sessions({
  currentId,
  onOpen,
  onDeleted,
  reloadKey,
}: {
  currentId: string | null;
  onOpen: (id: string) => void;
  /** The open conversation was deleted from under the reader; the view must go. */
  onDeleted?: ((id: string) => void) | undefined;
  reloadKey: number;
}) {
  const { t } = useSettings();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  /** Which conversation's share popup is open, if any. */
  const [sharingFor, setSharingFor] = useState<string | null>(null);
  /** Which row's menu is open — at most one, so a stray menu cannot be left behind. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  /** Delete asks once, in place. A modal for a list row is heavier than the act. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  /**
   * What is typed, and what has actually been sent.
   *
   * Separate because the request is debounced. Binding the fetch straight to
   * the input would issue one search per keystroke — six requests to type
   * «ԱԱՀ-ի» — and the answers can arrive out of order, so the list would
   * settle on whichever query the server happened to finish last.
   */
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setQuery(typed), 250);
    return () => clearTimeout(id);
  }, [typed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          query.trim() ? `/api/sessions?q=${encodeURIComponent(query.trim())}` : '/api/sessions',
        );
        const data = (await res.json()) as { sessions?: SessionSummary[] };
        if (!cancelled) setSessions(data.sessions ?? []);
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    // `reloadKey` changes when a turn completes, so a new conversation appears
    // in the list without a page refresh. `query` re-runs it for a search —
    // and `cancelled` is what stops a slow earlier request from overwriting a
    // faster later one with results for a query nobody is looking at.
    return () => {
      cancelled = true;
    };
  }, [reloadKey, query]);

  /**
   * Close the menu on an outside click or Escape.
   *
   * Without this the menu survives clicking the page behind it, and it stays
   * open over a conversation the reader has already moved on from.
   */
  useEffect(() => {
    if (!menuFor) return;
    function away(e: MouseEvent): void {
      if (!(e.target instanceof Node)) return;
      if (listRef.current?.contains(e.target)) return;
      setMenuFor(null);
      setConfirming(null);
    }
    function esc(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setMenuFor(null);
        setConfirming(null);
      }
    }
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [menuFor]);

  /** Apply a change locally as well as remotely — the list must not wait on a refetch. */
  function patchLocal(id: string, change: Partial<SessionSummary>): void {
    setSessions((list) => (list ?? []).map((x) => (x.id === id ? { ...x, ...change } : x)));
  }

  async function togglePin(s: SessionSummary): Promise<void> {
    const pinned = !s.pinned;
    setMenuFor(null);
    patchLocal(s.id, { pinned });
    // Reorder to match what the server will return on the next load: pinned
    // first, newest within each group. Leaving the row where it was would make
    // the pin look like it did nothing until a refresh.
    setSessions((list) =>
      [...(list ?? [])]
        .map((x) => (x.id === s.id ? { ...x, pinned } : x))
        .sort((a, b) =>
          Boolean(a.pinned) === Boolean(b.pinned)
            ? b.createdAt.localeCompare(a.createdAt)
            : a.pinned
              ? -1
              : 1,
        ),
    );
    await fetch(`/api/sessions/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned }),
    });
  }

  async function saveRename(s: SessionSummary): Promise<void> {
    const title = draft.trim();
    setRenaming(null);
    // An empty name clears back to the first question rather than leaving a
    // blank row; the server treats "" the same way.
    patchLocal(s.id, { title: title || null });
    await fetch(`/api/sessions/${s.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  }

  async function remove(s: SessionSummary): Promise<void> {
    setConfirming(null);
    setMenuFor(null);
    const res = await fetch(`/api/sessions/${s.id}`, { method: 'DELETE' });
    if (!res.ok) return;
    setSessions((list) => (list ?? []).filter((x) => x.id !== s.id));
    if (s.id === currentId) onDeleted?.(s.id);
  }

  /*
   * The search box renders even when the result is empty — otherwise the only
   * way out of a search that found nothing would be to reload the page, since
   * the control you would use to clear it went away with the results.
   *
   * It hides only when there is nothing to search AND nothing typed: a list
   * that has never held a conversation does not need a filter above it.
   */
  const searchBox =
    sessions !== null && (sessions.length > 0 || typed) ? (
      <div className="sessions-search">
        <input
          type="search"
          value={typed}
          placeholder={t('nav.search')}
          aria-label={t('nav.search')}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
    ) : null;

  if (sessions === null) return <div className="sessions-empty">…</div>;
  if (sessions.length === 0) {
    return (
      <>
        {searchBox}
        <div className="sessions-empty">{typed ? t('nav.noMatches') : t('nav.noCases')}</div>
      </>
    );
  }

  return (
    <div className="sessions" ref={listRef}>
      {searchBox}
      {sessions.map((s) => (
        <div
          key={s.id}
          className={
            `session-row${s.id === currentId ? ' active' : ''}` +
            `${menuFor === s.id ? ' menu-open' : ''}`
          }
        >
          {renaming === s.id ? (
            <input
              className="session-rename"
              value={draft}
              autoFocus
              aria-label={t('nav.rename')}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void saveRename(s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveRename(s);
                // Escape abandons the edit; without it, blur would save it.
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <button
              className="session-item"
              onClick={() => onOpen(s.id)}
              title={s.title || s.firstMessage}
            >
              <span className="session-q">
                {s.pinned ? (
                  <span className="session-pin" aria-hidden="true">
                    <Icon d={PIN} />
                  </span>
                ) : null}
                {s.title || s.firstMessage || '—'}
              </span>
              {/*
                Why this row matched. Without it a hit on a word buried in a
                long answer shows a title that does not contain the word, and
                the result reads as wrong rather than as deep.
              */}
              {s.snippet ? <span className="session-snippet">{s.snippet}</span> : null}
              <span className="session-meta">
                {shortDate(s.createdAt)} · {s.turns}
              </span>
            </button>
          )}

          {sharingFor === s.id ? (
            <SharePopup sessionId={s.id} onClose={() => setSharingFor(null)} />
          ) : null}

          <button
            className="session-more"
            aria-label={t('nav.more')}
            aria-haspopup="menu"
            aria-expanded={menuFor === s.id}
            onClick={() => {
              setConfirming(null);
              setMenuFor((open) => (open === s.id ? null : s.id));
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="12" cy="5" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="12" cy="19" r="1.7" />
            </svg>
          </button>

          {menuFor === s.id ? (
            <div className="session-menu" role="menu">
              <button role="menuitem" onClick={() => void togglePin(s)}>
                <Icon d={PIN} />
                {s.pinned ? t('nav.unpin') : t('nav.pin')}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setDraft(s.title || s.firstMessage.slice(0, 60));
                  setRenaming(s.id);
                  setMenuFor(null);
                }}
              >
                <Icon d={PENCIL} />
                {t('nav.rename')}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenuFor(null);
                  setSharingFor(s.id);
                }}
              >
                <Icon d={SHARE} />
                {t('share.share')}
              </button>

              <div className="session-menu-rule" />

              {/*
                The confirmation replaces the item in place rather than opening a
                dialog. A modal for one list row is heavier than the act — and
                the question has to be asked, because there is no undo: the
                messages go by cascade and the text is genuinely gone.
              */}
              {confirming === s.id ? (
                <div className="session-confirm">
                  <span>{t('nav.deleteAsk')}</span>
                  <button className="danger" onClick={() => void remove(s)}>
                    {t('nav.deleteYes')}
                  </button>
                  <button onClick={() => setConfirming(null)}>{t('nav.cancel')}</button>
                </div>
              ) : (
                <button role="menuitem" className="danger" onClick={() => setConfirming(s.id)}>
                  <Icon d={TRASH} />
                  {t('nav.delete')}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
