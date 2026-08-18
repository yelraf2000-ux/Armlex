/**
 * Dev workbench. One page, no router, no state library — deliberately rough.
 *
 * Three modes:
 *   Search — raw retrieval output, no model involved.
 *   Ask    — one-shot grounded answer, no memory.
 *   Chat   — multi-turn with contextualisation and carried-over chunks.
 */
import { useEffect, useState } from 'react';
import type { Chunk } from './types.js';
import { ChunkCard } from './ChunkCard.js';
import { Chat } from './Chat.js';
import { Login } from './Login.js';
import { RailToggle, SettingsControls, SettingsProvider, useSettings } from './Settings.js';

type Mode = 'search' | 'ask' | 'chat';

interface SearchResponse {
  query: string;
  count: number;
  chunks: Chunk[];
}

interface AskResponse {
  answer: string;
  chunks: Chunk[];
  model: string;
}

function OneShot({ mode }: { mode: 'search' | 'ask' }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [ran, setRan] = useState(false);

  async function run(): Promise<void> {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    setModel(null);
    setChunks([]);

    try {
      const res = await fetch(`/api/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });

      // Read as text first: when the API is down the proxy answers with an
      // empty body, and res.json() would throw an error naming the wrong layer.
      const raw = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        setError(
          raw.trim()
            ? `HTTP ${res.status}: ответ не JSON — ${raw.slice(0, 200)}`
            : `API не отвечает (HTTP ${res.status}). Запущен ли backend на :3001? Запустите «npm run dev».`,
        );
        return;
      }

      if (!res.ok) {
        const e = data as { error?: string; detail?: string };
        setError([e.error, e.detail].filter(Boolean).join(' — ') || `HTTP ${res.status}`);
        return;
      }

      if (mode === 'search') {
        setChunks((data as SearchResponse).chunks);
      } else {
        const d = data as AskResponse;
        setAnswer(d.answer);
        setChunks(d.chunks);
        setModel(d.model);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
      setRan(true);
    }
  }

  return (
    <>
      <div className="controls">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run();
          }}
          placeholder="Вопрос на русском, армянском или латиницей (xanut bacel)"
          autoFocus
        />
        <button onClick={() => void run()} disabled={loading || !query.trim()}>
          {loading ? '…' : 'Выполнить'}
        </button>
      </div>

      {error ? <div className="error">{error}</div> : null}

      {answer !== null ? (
        <div className="answer">
          <div className="answer-head">
            Ответ {model ? <span className="model">{model}</span> : null}
          </div>
          <div className="answer-body">{answer}</div>
        </div>
      ) : null}

      {chunks.length > 0 ? (
        <>
          <h2>
            {answer !== null ? 'Фрагменты, переданные модели' : 'Найденные фрагменты'} (
            {chunks.length})
          </h2>
          {chunks.map((c) => (
            <ChunkCard key={`${c.arlisId}#${c.ref}`} chunk={c} />
          ))}
        </>
      ) : null}

      {ran && !loading && !error && chunks.length === 0 ? (
        <div className="empty">
          Ничего не найдено. Корпус — только налоговое законодательство
          (Налоговый кодекс, решения правительства, приказы КГД). Вопросы по
          трудовому, гражданскому праву и судебной практике в него не входят.
        </div>
      ) : null}
    </>
  );
}

interface CorpusInfo {
  documents: number;
  chunks: number;
  lastChecked: string | null;
}

function Workbench() {
  const { t } = useSettings();
  const [mode, setMode] = useState<Mode>('chat');
  const [corpus, setCorpus] = useState<CorpusInfo | null>(null);
  /** null = not yet known; the gate is off entirely in local development. */
  const [authed, setAuthed] = useState<boolean | null>(null);

  // Ask whether a password is required at all, then whether we already hold a
  // valid cookie. /api/corpus is a cheap authenticated call, so its status
  // answers the second question without a dedicated endpoint.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/auth');
        // Fail CLOSED. Any answer that isn't a clear "no password needed" is
        // treated as "password needed", so a malformed or errored response
        // shows the login screen instead of a workbench where every request
        // 401s — which is exactly what happened when /api/auth was itself
        // gated and `authRequired` came back undefined.
        if (!res.ok) return setAuthed(false);
        const data = (await res.json()) as { authRequired?: boolean };
        if (data.authRequired === false) return setAuthed(true);
        const probe = await fetch('/api/corpus');
        setAuthed(probe.status !== 401);
      } catch {
        setAuthed(false);
      }
    })();
  }, []);

  // Corpus provenance for the banner. A legal tool that doesn't say how current
  // it is invites the reader to assume it is current. Waits for auth, since the
  // endpoint is behind the gate.
  useEffect(() => {
    if (!authed) return;
    void (async () => {
      try {
        const res = await fetch('/api/corpus');
        if (res.ok) setCorpus((await res.json()) as CorpusInfo);
      } catch {
        setCorpus(null);
      }
    })();
  }, [authed]);

  const synced = corpus?.lastChecked
    ? corpus.lastChecked.slice(0, 10).split('-').reverse().join('.')
    : null;

  if (authed === null) return <div className="wrap" />;
  if (!authed) {
    return (
      <div className="wrap">
        <Login onSuccess={() => setAuthed(true)} />
      </div>
    );
  }

  return (
    <>
      {/*
        Provenance sits above everything, permanently. A legal tool that does
        not say how current it is invites the reader to assume it is current,
        and "when was this checked against the source" is the first question a
        professional asks of an answer they intend to rely on.
      */}
      <header className="provenance">
        <RailToggle />
        <span className="brand">ArmLex</span>
        {corpus ? (
          <>
            <span>
              <span className="num">{corpus.documents}</span> {t('corpus.acts')} ·{' '}
              <span className="num">{corpus.chunks}</span> {t('corpus.chunks')}
            </span>
            {synced ? <span>{t('corpus.synced')} <span className="num">{synced}</span></span> : null}
          </>
        ) : null}

        <div className="segmented" role="tablist">
          {(['chat', 'ask', 'search'] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              className={mode === m ? 'seg active' : 'seg'}
              onClick={() => setMode(m)}
            >
              {t(`mode.${m}`)}
            </button>
          ))}
        </div>

        <SettingsControls />
        <span className="spacer" />
        <span className="disclaimer">{t('corpus.disclaimer')}</span>
      </header>

      {mode === 'chat' ? (
        <Chat corpusSynced={synced} />
      ) : (
        <div className="wrap"><OneShot mode={mode} /></div>
      )}
    </>
  );
}

/**
 * Settings wrap everything, including the login screen — someone who cannot get
 * past the password gate should still be able to read it in their own language.
 */
export function App() {
  return (
    <SettingsProvider>
      <Workbench />
    </SettingsProvider>
  );
}
