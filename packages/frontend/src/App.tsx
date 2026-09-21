/**
 * Dev workbench. One page, no router, no state library — deliberately rough.
 *
 * Three modes:
 *   Search — raw retrieval output, no model involved.
 *   Ask    — one-shot grounded answer, no memory.
 *   Chat   — multi-turn with contextualisation and carried-over chunks.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Chunk } from './types.js';
import { ChunkCard } from './ChunkCard.js';
import { BRAND } from './brand.js';
import { Chat } from './Chat.js';
import { Landing } from './Landing.js';
import { ContactWidget } from './ContactWidget.js';
import { type Account, PENDING_PROFILE } from './Login.js';
import { AccountMenu } from './AccountMenu.js';
import { Workspace } from './Workspace.js';
import { ProfilePopup } from './ProfilePopup.js';
import { navigate, sessionIdIn, usePath, workspaceSectionIn } from './router.js';
import { MarkdownView } from './MarkdownView.js';
import { NormPanel } from './NormPanel.js';
import { Shared } from './Shared.js';
import { Verify } from './Verify.js';
import { Invite } from './Invite.js';
import { Reset } from './Reset.js';
import { extractQuotes } from './quotes.js';
import { SettingsProvider, useSettings } from './Settings.js';
import { BrandMark } from './BrandMark.js';

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
        // The detail is the sentence written for a person; the code is for us.
        setError(e.detail || e.error || `HTTP ${res.status}`);
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
        answer={answer ?? ''}
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
  const { t, railOpen } = useSettings();
  const [mode, setMode] = useState<Mode>('chat');
  /** Bumped to remount the active mode, which is how "go home" clears it. */
  const [homeKey, setHomeKey] = useState(0);
  const [corpus, setCorpus] = useState<CorpusInfo | null>(null);
  /** null = not yet known. */
  const [account, setAccount] = useState<Account | null>(null);

  /*
   * Which screen, read off the address bar.
   *
   * State until now, which meant a reload — or a deploy, which reloads
   * everybody — dropped whoever was reading a conversation or managing their
   * firm back onto a blank question box. A screen you cannot link to, reload,
   * or reach with the back button is a screen the browser does not know exists.
   *
   * These are the app's own paths. The four token paths further down (shared,
   * verify, invite, reset) are matched separately because they have to work
   * before anyone is signed in.
   */
  const path = usePath();
  const wsSection = workspaceSectionIn(path);
  const showWorkspace = wsSection !== null;
  const showProfile = path === '/profile';
  const openId = sessionIdIn(path);

  /*
   * Where closing the name dialog returns you.
   *
   * It is a dialog over whatever you were reading, so it goes back THERE and
   * not to the front page — by replacing, so dismissing it leaves no history
   * entry for the back button to walk straight into.
   */
  const behindProfile = useRef('/');
  useEffect(() => {
    if (path !== '/profile') behindProfile.current = path;
  }, [path]);

  /* One screen, one address. `/workspace` is where the menu points and where a
     bookmark from before this existed lands; it says which half it opened. */
  useEffect(() => {
    if (path === '/workspace') navigate('/workspace/members', { replace: true });
  }, [path]);

  const signOut = useCallback((): void => {
    void (async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      setAccount(null);
      setAuthed(false);
    })();
  }, []);
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

      /*
        Someone who signed up through Google answered the profile questions
        BEFORE being redirected away, so those answers could not ride along in
        the registration call. The browser kept them; post them now that the
        account exists. Cleared first, so a failure cannot retry forever.
      */
      if (data.user && !data.user.companyName) {
        const stashed = sessionStorage.getItem(PENDING_PROFILE);
        if (stashed) {
          sessionStorage.removeItem(PENDING_PROFILE);
          try {
            const p = JSON.parse(stashed) as { companyName?: string; companySize?: string };
            await fetch('/api/auth/profile', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(p),
            });
          } catch {
            // A profile that fails to attach is a lost lead, not a broken
            // signup — never block the person from reaching the tool.
          }
        }
      }

      setAccount(data);
      setAuthed(Boolean(data.user));
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  /*
   * Signed in, and standing on a sign-in or registration address.
   *
   * That is where a successful sign-in leaves them — the form lived at /login
   * the moment before — and where a bookmark of the form lands someone who is
   * still signed in. Either way there is nothing to fill in, so they go home,
   * by replacing: the form should not be a step the back button returns to.
   */
  useEffect(() => {
    if (authed && (path === '/login' || path === '/registration')) {
      navigate('/', { replace: true });
    }
  }, [authed, path]);

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

  /**
   * Back to a clean Dialogue, from wherever you are.
   *
   * "Wherever" now includes the workspace page. It used to leave
   * `showWorkspace` standing, so the masthead — the way home on any site —
   * did nothing there, and the page's own Back button was the only exit. That
   * button is gone; this is what replaces it.
   */
  function goHome(): void {
    navigate('/');
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

  /*
    Same reasoning, same place in the order: the person following a verification
    link is by definition not signed in yet, so this has to be reachable before
    the gate. Base64url, so the character class is wider than the shared token's
    hex and the length is a range rather than a constant.
  */
  const verifying = /^\/verify\/([A-Za-z0-9_-]{20,200})$/.exec(window.location.pathname);
  if (verifying) return <Verify token={verifying[1]!} onVerified={() => void loadAccount()} />;

  /*
    An invitation link. Same reasoning once more: the person following it has
    no account, which is precisely what the link exists to give them.
  */
  const invited = /^\/invite\/([A-Za-z0-9_-]{20,200})$/.exec(window.location.pathname);
  if (invited) return <Invite token={invited[1]!} onAccepted={() => void loadAccount()} />;

  /*
    A reset link. Checked before the gate for the plainest reason of all: the
    person following it cannot sign in, which is why they are here.
  */
  const resetting = /^\/reset\/([A-Za-z0-9_-]{20,200})$/.exec(window.location.pathname);
  if (resetting) return <Reset token={resetting[1]!} onDone={() => void loadAccount()} />;

  if (authed === null) return <div className="wrap" />;
  if (!authed) {
    /*
      A visitor with no account meets a question box, not a sign-in form. They
      get a real partial answer first, and register to see the rest — which is
      also the only way this product can show a stranger what it is, since a
      description of "grounded answers with verbatim citations" persuades
      nobody who has not watched it happen to their own question.
    */
    return (
      <>
        <Landing googleEnabled={account?.google} onAuthed={() => void loadAccount()} />
        {/* Questions about the product, answered by a person — see ContactWidget. */}
        <ContactWidget />
      </>
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

          What stays is only the way home and the way to the register. The
          not-legal-advice notice and the date the corpus was last checked
          against ARLIS live in the colophon at the foot of the page — they are
          the imprint of the edition, not its running head.
        */}
        <div className="masthead-top">
          {/*
            The masthead is the way home, as it is on any site. Clicking it
            returns to Dialogue and starts a fresh consultation — remounting
            rather than clearing field by field, so nothing survives by
            accident. There is no router here, so this is the only "home".
          */}
          {/*
            With the sidebar open, the full lockup — book and wordmark as one
            image — heads the page. Collapsed, the book already stands at the top
            of the thin strip, so the header carries the compact mark beside the
            name instead of repeating the whole lockup next to it.

            Both are rendered while open, and CSS picks: below 1200px the sidebar
            cannot be shown whatever the setting says, so the compact mark stands
            in. The lockup's alt is the product's name, because on wide screens
            it is the only thing naming this button.

            Collapsed, on wide screens, the brand is not shown at all: the strip
            down the left edge already carries the book (which reopens the
            sidebar) and a new consultation, so a mark and name beside it only
            said the same thing again. It is hidden, not removed, so its height
            stays reserved and opening the sidebar does not move the page.
          */}
          <button className={railOpen ? 'brand' : 'brand rail-closed'} onClick={goHome}>
            {railOpen ? (
              <>
                <img className="brand-lockup" src="/logo-lockup.png" alt={BRAND} width={164} height={36} />
                <span className="brand-compact"><BrandMark /></span>
              </>
            ) : (
              <BrandMark />
            )}
          </button>

          <span className="spacer" />
          {/*
            The allowance and the way out used to stand here permanently. They
            now live at the foot of the register, where a signature belongs —
            this band is for what qualifies an answer, not for account
            furniture.

            This mount is the narrow-screen fallback ONLY: below 1200px the
            register is display:none, and an account control living solely in it
            would take sign-out off the page. CSS shows exactly one of the two.
          */}
          {account?.user ? (
            <AccountMenu
              account={account}
              placement="masthead"
              onSignOut={signOut}
              onOpenProfile={() => navigate('/profile')}
              onOpenWorkspace={() => navigate('/workspace')}
            />
          ) : null}
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

      {showWorkspace && account?.user ? (
        <Workspace
          meId={account.user.id}
          section={wsSection ?? 'members'}
          onSection={(s) => navigate(`/workspace/${s}`)}
        />
      ) : null}

      {/*
        One mount, over whatever is behind it. The account menu is rendered
        twice — foot of the register, and masthead at the widths where there is
        no register — so a dialog owned by the menu would have appeared twice
        at once, portalled past the CSS that hides one of the two.
      */}
      {showProfile && account?.user ? (
        <ProfilePopup
          account={account}
          onChanged={setAccount}
          onClose={() => navigate(behindProfile.current, { replace: true })}
        />
      ) : null}

      {!showWorkspace && mode === 'chat' ? (
        <Chat
          key={homeKey}
          corpusSynced={synced}
          account={account}
          openId={openId}
          onOpenSession={(id, replace) =>
            navigate(id ? `/c/${id}` : '/', { replace: replace ?? false })
          }
          onSignOut={signOut}
          onOpenProfile={() => navigate('/profile')}
          onOpenWorkspace={() => navigate('/workspace')}
        />
      ) : null}
      {!showWorkspace && mode === 'ask' ? <AskMode key={homeKey} corpusSynced={synced} /> : null}
      {!showWorkspace && mode === 'search' ? <SearchMode key={homeKey} /> : null}

    </div>
  );
}

/**
 * The colophon, fixed to the foot of the window: the not-legal-advice note.
 *
 * It used to be the last thing in each screen's own flow, which put it below
 * the fold on every screen long enough to scroll — which is every screen with
 * an answer on it. Mounted here rather than per screen, so there is one of it
 * and it cannot be forgotten on a new page.
 *
 * The "checked against ARLIS" date stood under it and was taken off on request.
 * Nothing is lost by that: every article in the sources panel carries its own
 * checked date, which is where a reader deciding whether to trust a provision
 * actually needs it.
 */
function Colophon() {
  const { t } = useSettings();
  const ref = useRef<HTMLElement>(null);

  /*
   * Tell the page how tall this is, instead of the page guessing.
   *
   * Everything that stands at the bottom of the window — the composer, the
   * account block — reserves --footer-h. A fixed value cannot be right: on a
   * phone the note wraps to two lines, and Russian and English wrap at
   * different widths from Armenian, so a number measured at one width left the
   * question box 17px underneath the footer at another. The bar measures itself
   * whenever its size changes and writes the real height. Rounded UP, so a
   * 32.5px bar reserves 33 and nothing sits half a pixel inside it.
   *
   * Layout effect, so the first paint already has the right value.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (): void =>
      document.documentElement.style.setProperty(
        '--footer-h',
        `${Math.ceil(el.getBoundingClientRect().height)}px`,
      );
    apply();
    const watch = new ResizeObserver(apply);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  return (
    <footer ref={ref} className="colophon">
      {/* §6.6: an info circle, decorative — the sentence beside it says it all. */}
      <svg
        className="colophon-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      <div className="colophon-disclaimer">{t('corpus.disclaimer')}</div>
    </footer>
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
      <Colophon />
    </SettingsProvider>
  );
}
