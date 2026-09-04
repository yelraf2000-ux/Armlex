/**
 * Dev workbench. One page, no router, no state library — deliberately rough.
 *
 * Three modes:
 *   Search — raw retrieval output, no model involved.
 *   Ask    — one-shot grounded answer, no memory.
 *   Chat   — multi-turn with contextualisation and carried-over chunks.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Chunk } from './types.js';
import { ChunkCard } from './ChunkCard.js';
import { BRAND } from './brand.js';
import { Chat } from './Chat.js';
import { Login, type Account } from './Login.js';
import { MarkdownView } from './MarkdownView.js';
import { NormPanel } from './NormPanel.js';
import { Shared } from './Shared.js';
import { extractQuotes } from './quotes.js';
import { RailToggle, SettingsControls, SettingsProvider, useSettings } from './Settings.js';

type Mode = 'search' | 'ask' | 'chat';

/**
 * Which modes the interface offers.
 *
 * TEST BUILD: Dialogue only. All three still exist and work — `AskMode`,
 * `SearchMode` and their endpoints are untouched — but a tester asked whether
 * the ANSWERS are any good should not first have to work out which of three
 * modes to be in. Ask is Dialogue without memory, and Search is a retrieval
 * diagnostic; neither teaches a tester anything about answer quality, and both
 * offer ways to end up somewhere confusing and blame the product for it.
 *
 * To restore: add 'ask' (and 'search') back to this list. The switcher renders
 * itself again as soon as there is more than one.
 */
const VISIBLE_MODES: Mode[] = ['chat'];

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
    <div className={entries.length === 0 ? 'workbench rail-hidden no-apparatus' : 'workbench rail-hidden'}>
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
                {BRAND} {model ? <span className="model">{model}</span> : null}
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
  /** Bumped to remount the active mode, which is how "go home" clears it. */
  const [homeKey, setHomeKey] = useState(0);
  const [corpus, setCorpus] = useState<CorpusInfo | null>(null);
  /** null = not yet known. */
  const [account, setAccount] = useState<Account | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);

  /** Who is signed in, and how much of this month's allowance is left. */
  const loadAccount = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/auth/me');
      // Fail CLOSED. Anything that isn't a clear "here is your account" shows
      // the sign-in screen rather than a workbench where every request 401s.
      if (!res.ok) {
        setAuthed(false);
        return;
      }
      const data = (await res.json()) as Account & { user: Account['user'] | null };
      setAccount(data);
      setAuthed(Boolean(data.user));
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

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

  /** Back to a clean Dialogue, from wherever you are. */
  function goHome(): void {
    setMode('chat');
    setHomeKey((k) => k + 1);
    window.scrollTo({ top: 0 });
  }

  /*
    A shared link is readable by anyone, so it is checked BEFORE the sign-in
    gate — the whole point of sharing is that the recipient need not have an
    account. There is no router in this app, so this is a path test.
  */
  const shared = /^\/shared\/([0-9a-f]{48})$/.exec(window.location.pathname);
  if (shared) return <Shared token={shared[1]!} />;

  if (authed === null) return <div className="wrap" />;
  if (!authed) {
    return (
      <div className="wrap">
        <Login
          googleEnabled={account?.google}
          onSuccess={() => {
            void loadAccount();
          }}
        />
      </div>
    );
  }

  return (
    // A column: masthead, the mode, colophon. The middle one takes the slack,
    // so the colophon rests at the foot of the window on a short page and is
    // pushed below the fold on a long one — never floating mid-screen.
    <div className="page">
      {/*
        Provenance sits above everything, permanently. A legal tool that does
        not say how current it is invites the reader to assume it is current,
        and "when was this checked against the source" is the first question a
        professional asks of an answer they intend to rely on.
      */}
      <header className="provenance">
        {/*
          One line, hard against the top-left. With the standing subtitle, the
          mode switcher and both settings switchers gone, there is nothing left
          to justify the two rows a printed masthead would take — and a compact
          mark in the corner sits better against a centred reading column than a
          full-width band does.

          What stays is only what qualifies an answer: the way home, the way to
          the register, and when the corpus was last checked against ARLIS. The
          corpus size and the not-legal-advice notice live in the colophon at
          the foot of the page — they are the imprint of the edition, not its
          running head.
        */}
        <div className="masthead-top">
          {/*
            The masthead is the way home, as it is on any site. Clicking it
            returns to Dialogue and starts a fresh consultation — remounting
            rather than clearing field by field, so nothing survives by
            accident. There is no router here, so this is the only "home".
          */}
          <button className="brand" onClick={goHome}>{BRAND}</button>
          <RailToggle />
          {corpus && synced ? (
            <span className="masthead-synced">
              {t('corpus.synced')} <span className="num">{synced}</span>
            </span>
          ) : null}

          <span className="spacer" />
          {/*
            The allowance, where the person can see it before they spend it.
            Shown only on a capped plan — an "unlimited" counter is furniture,
            and the same reasoning kept the coverage badge off confident answers.
          */}
          {account?.usage && account.usage.limit !== null ? (
            <span className="masthead-quota" title={t('auth.quotaLeft')}>
              <span className="num">{account.usage.remaining}</span> / {account.usage.limit}
            </span>
          ) : null}
          <button
            className="masthead-signout"
            onClick={() => {
              void (async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                setAccount(null);
                setAuthed(false);
              })();
            }}
          >
            {t('auth.signOut')}
          </button>
          <SettingsControls />
          {/*
            One mode, so no switcher: a lone tab is a control that cannot do
            anything, which is worse than no control at all.
          */}
          {VISIBLE_MODES.length > 1 ? (
            <div className="segmented" role="tablist">
              {VISIBLE_MODES.map((m) => (
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
          ) : null}
        </div>

        <div className="masthead-rule" />
      </header>

      {mode === 'chat' ? <Chat key={homeKey} corpusSynced={synced} /> : null}
      {mode === 'ask' ? <AskMode key={homeKey} corpusSynced={synced} /> : null}
      {mode === 'search' ? <SearchMode key={homeKey} /> : null}

      {/* The colophon: what this is, and how much of it there is. */}
      <footer className="colophon">
        <div className="colophon-disclaimer">{t('corpus.disclaimer')}</div>
        {corpus ? (
          <div className="colophon-counts">
            <span className="num">{corpus.documents}</span> {t('corpus.acts')} ·{' '}
            <span className="num">{corpus.chunks}</span> {t('corpus.chunks')}
          </div>
        ) : null}
      </footer>
    </div>
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
