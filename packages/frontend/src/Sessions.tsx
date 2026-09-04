/**
 * Past conversations.
 *
 * Tax questions are rarely one-shot — a professional works a case over several
 * sittings, and the established facts (`fact_summary`) live on the session.
 * Without a way back into a session, that accumulated context is unreachable
 * and the work has to be redone from the first question.
 */
import { useEffect, useState } from 'react';
import { useSettings } from './Settings.js';

export interface SessionSummary {
  id: string;
  createdAt: string;
  turns: number;
  firstMessage: string;
  /** A link has been issued for this conversation and has not been withdrawn. */
  shared?: boolean;
}

function shortDate(iso: string): string {
  // Postgres renders `2026-08-15 14:02:07.95+00`; the date and minute are all
  // that is useful in a list.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]} ${m[4]}` : iso.slice(0, 16);
}

export function Sessions({
  currentId,
  onOpen,
  reloadKey,
}: {
  currentId: string | null;
  onOpen: (id: string) => void;
  reloadKey: number;
}) {
  const { t } = useSettings();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/sessions');
        const data = (await res.json()) as { sessions?: SessionSummary[] };
        if (!cancelled) setSessions(data.sessions ?? []);
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    // `reloadKey` changes when a turn completes, so a new conversation appears
    // in the list without a page refresh.
    return () => { cancelled = true; };
  }, [reloadKey]);

  if (sessions === null) return <div className="sessions-empty">…</div>;
  if (sessions.length === 0) {
    return <div className="sessions-empty">{t('nav.noCases')}</div>;
  }

  /**
   * Issue a link, or withdraw one.
   *
   * The link is copied to the clipboard on issue, because a share control that
   * makes you go and find the link has not finished the job.
   */
  async function toggleShare(s: SessionSummary): Promise<void> {
    if (s.shared) {
      await fetch(`/api/sessions/${s.id}/share`, { method: 'DELETE' });
      setSessions((list) => (list ?? []).map((x) => (x.id === s.id ? { ...x, shared: false } : x)));
      return;
    }
    const res = await fetch(`/api/sessions/${s.id}/share`, { method: 'POST' });
    if (!res.ok) return;
    const { url } = (await res.json()) as { url: string };
    const full = `${window.location.origin}${url}`;
    try {
      await navigator.clipboard.writeText(full);
      setCopied(s.id);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused; the link still exists, so show it
      // rather than leaving the click looking like it failed.
      window.prompt(t('share.copied'), full);
    }
    setSessions((list) => (list ?? []).map((x) => (x.id === s.id ? { ...x, shared: true } : x)));
  }

  return (
    <div className="sessions">
      {sessions.map((s) => (
        <div key={s.id} className={`session-row${s.id === currentId ? ' active' : ''}`}>
          <button className="session-item" onClick={() => onOpen(s.id)} title={s.firstMessage}>
            <span className="session-q">{s.firstMessage || '—'}</span>
            <span className="session-meta">
              {shortDate(s.createdAt)} · {s.turns}
              {s.shared ? <span className="session-shared"> · {t('share.shared')}</span> : null}
            </span>
          </button>
          <button
            className={`session-share${s.shared ? ' on' : ''}`}
            title={s.shared ? t('share.stop') : t('share.share')}
            aria-label={s.shared ? t('share.stop') : t('share.share')}
            onClick={() => void toggleShare(s)}
          >
            {copied === s.id ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                <path d="M12 15V3M8 7l4-4 4 4" />
              </svg>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
