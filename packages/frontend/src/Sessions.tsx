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

  return (
    <div className="sessions">
      {sessions.map((s) => (
        <button
          key={s.id}
          className={`session-item${s.id === currentId ? ' active' : ''}`}
          onClick={() => onOpen(s.id)}
          title={s.firstMessage}
        >
          <span className="session-q">{s.firstMessage || '(без вопроса)'}</span>
          <span className="session-meta">
            {shortDate(s.createdAt)} · {s.turns}
          </span>
        </button>
      ))}
    </div>
  );
}
