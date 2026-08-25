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
import { MarkdownView } from './MarkdownView.js';
import { NormPanel } from './NormPanel.js';
import { extractQuotes } from './quotes.js';
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

/**
 * The query, shared by both one-shot modes.
 *
 * Only the request and its parsing are common. Search and Ask are different
 * JOBS — a ranked list of what the index holds, versus one grounded opinion
 * with its sources — and they render nothing in common, which is why they no
 * longer share a component.
 */
function useOneShot(mode: 'search' | 'ask') {
  const { t } = useSettings();
  const [query, setQuery] = useState('');
  /** The question as submitted, kept so the heading cannot drift as you retype. */
  const [asked, setAsked] = useState<string | null>(null);
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
    setAsked(query.trim());

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
            ? `HTTP ${res.status}: ${raw.slice(0, 200)}`
            : `${t('error.noApi')} (HTTP ${res.status})`,
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

  return { query, setQuery, asked, loading, error, chunks, answer, model, ran, run };
}

/** The query bar. Big, because in a one-shot mode it IS the page. */
function QueryBar({
  value,
  onChange,
  onSubmit,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
}) {
  const { t } = useSettings();
  return (
    <div className="controls">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
        }}
        placeholder={t('oneshot.placeholder')}
        autoFocus
      />
      <button onClick={onSubmit} disabled={loading || !value.trim()}>
        {loading ? '…' : t('oneshot.run')}
      </button>
    </div>
  );
}

/** Shown when retrieval came back empty — and it must name the CURRENT corpus. */
function NothingFound() {
  const { t } = useSettings();
  return <div className="empty">{t('oneshot.nothing')}</div>;
}

/**
 * Search — retrieval only, no model.
 *
 * One wide ranked list and nothing else: there is no opinion to set above it,
 * so an apparatus column would have nothing to hold. Rank and rerank score
 * hang in the gutter, and a weak score is printed rather than hidden.
 */
function SearchMode() {
  const { t } = useSettings();
  const { query, setQuery, loading, error, chunks, ran, run } = useOneShot('search');

  return (
    <div className="wrap">
      <QueryBar value={query} onChange={setQuery} onSubmit={() => void run()} loading={loading} />

      <div className="modes">
        <span>{t('search.note')}</span>
        {chunks.length > 0 ? (
          <>
            <span className="spacer" />
            <span>
              {t('search.found')} <span className="num">{chunks.length}</span>
            </span>
          </>
        ) : null}
      </div>

      {error ? <div className="error">{error}</div> : null}

      {chunks.map((c, i) => (
        <ChunkCard key={`${c.arlisId}#${c.ref}`} chunk={c} rank={i} />
      ))}

      {ran && !loading && !error && chunks.length === 0 ? <NothingFound /> : null}
    </div>
  );
}

/**
 * Ask — one grounded answer, no memory.
 *
 * This is the Dialogue screen minus the register and minus the conversation:
 * an opinion with its apparatus beside it. It shared a component with Search
 * until now, which cost it three things it should always have had — the answer
 * rendered as markdown rather than as literal asterisks, the quoted fragments
 * marked inside the article text, and sources presented as sources instead of
 * as a ranked result list.
 */
function AskMode({ corpusSynced }: { corpusSynced: string | null }) {
  const { t } = useSettings();
  const { query, setQuery, asked, loading, error, chunks, answer, model, ran, run } =
    useOneShot('ask');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = chunks.map((chunk) => ({ chunk, carried: false }));
  const quotes = extractQuotes(answer ?? '');

  return (
    <div className="workbench rail-hidden">
      <section className="thread">
        <div className="measure">
          <QueryBar value={query} onChange={setQuery} onSubmit={() => void run()} loading={loading} />

          {asked && answer !== null ? (
            <div className="turn user">
              <div className="turn-role">{t('turn.question')}</div>
              <div className="turn-text">{asked}</div>
            </div>
          ) : null}

          {error ? <div className="error">{error}</div> : null}

          {loading ? (
            <div className="stage">
              <span className="stage-pulse" />
              {t('stage.writing')}
            </div>
          ) : null}

          {answer !== null ? (
            <div className="turn assistant">
              <div className="turn-role">
                ArmLex {model ? <span className="model">{model}</span> : null}
              </div>
              <div className="turn-text">
                <MarkdownView text={answer} />
              </div>
            </div>
          ) : null}

          {ran && !loading && !error && chunks.length === 0 ? <NothingFound /> : null}
        </div>
      </section>

      <NormPanel
        entries={entries}
        quotes={quotes}
        corpusSynced={corpusSynced}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </div>
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
        {/*
          A masthead in the sense a printed commentary has one: title and
          standing on the first line, the facts that qualify every answer on the
          second, a double rule beneath. Mode is a running head, not a control
          panel — it sits with the title because it names what you are reading.
        */}
        <div className="masthead-top">
          <span className="brand">ArmLex</span>
          <span className="masthead-sub">{t('masthead.sub')}</span>
          <span className="spacer" />
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
        </div>

        <div className="masthead-facts">
          <RailToggle />
          {corpus ? (
            <>
              <span className="corpus-counts">
                <span className="num">{corpus.documents}</span> {t('corpus.acts')} ·{' '}
                <span className="num">{corpus.chunks}</span> {t('corpus.chunks')}
              </span>
              {synced ? <span>{t('corpus.synced')} <span className="num">{synced}</span></span> : null}
            </>
          ) : null}
          <span className="spacer" />
          <SettingsControls />
          <span className="disclaimer">{t('corpus.disclaimer')}</span>
        </div>

        <div className="masthead-rule" />
      </header>

      {mode === 'chat' ? <Chat corpusSynced={synced} /> : null}
      {mode === 'ask' ? <AskMode corpusSynced={synced} /> : null}
      {mode === 'search' ? <SearchMode /> : null}
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
