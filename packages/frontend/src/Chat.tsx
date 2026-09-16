/**
 * Chat mode. Multi-turn, session-backed.
 *
 * Each assistant turn shows which chunks it was given and — importantly —
 * which of those were carried over from earlier turns rather than retrieved
 * for this question. That distinction is the whole point of the mode, and
 * hiding it would make wrong answers hard to diagnose.
 */
import { useEffect, useRef, useState } from 'react';
import type { Chunk } from './types.js';
import { BRAND } from './brand.js';
import { NormPanel } from './NormPanel.js';
import type { Entry } from './NormPanel.js';
import { MarkdownView } from './MarkdownView.js';
import { extractQuotes } from './quotes.js';
import { citedIndexes } from './cited.js';
import { BrandLine } from './BrandLine.js';
import { Sessions } from './Sessions.js';
import { SharePopup } from './SharePopup.js';
import { AccountMenu } from './AccountMenu.js';
import type { Account } from './Login.js';
import { useSettings } from './Settings.js';
import { PENDING_PREVIEW, PENDING_QUESTION } from './Landing.js';

interface ChatResponse {
  sessionId: string;
  answer: string;
  standaloneQuery: string;
  freshChunks: Chunk[];
  carriedChunks: Chunk[];
  model: string;
}

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  // Explicitly `| undefined`: a turn is patched incrementally as events arrive,
  // and clearing a field means assigning undefined to it.
  standaloneQuery?: string | undefined;
  fresh?: Chunk[] | undefined;
  carried?: Chunk[] | undefined;
  /** Which stage is running, while nothing has been written yet. */
  stage?: string | undefined;
  /** True while text is still arriving — drives the caret. */
  streaming?: boolean | undefined;
  /** Model-declared coverage of the question by the retrieved articles. */
  coverage?: string | undefined;
}

/** Fields any SSE frame may carry; each event uses a subset. */
interface StreamPayload {
  stage?: string;
  title?: string;
  chunks?: Chunk[];
  text?: string;
  sessionId?: string;
  standaloneQuery?: string;
  freshChunks?: Chunk[];
  carriedChunks?: Chunk[];
  error?: string;
  detail?: string;
  coverage?: string;
}

/**
 * What each stage is doing, in the user's language.
 *
 * Real progress, not a spinner — each label appears when that stage actually
 * begins. Nine seconds before the first word is unavoidable (two sequential
 * model calls plus retrieval); nine seconds of silence is not.
 */
const STAGE_KEY: Record<string, string> = {
  understanding: 'stage.understanding',
  searching: 'stage.searching',
  reading: 'stage.reading',
  writing: 'stage.writing',
};

/**
 * How completely the retrieved articles cover the question, as the model
 * declared before writing.
 *
 * Retrieval finds a correct article in the top 5 for about 87% of questions, so
 * roughly one in eight answers is built on fragments that do not contain the
 * rule. Without this the reader cannot tell those apart — every answer carries
 * the same confident formatting and the same citations.
 *
 * `full` shows nothing: a badge on every answer would be noise, and the absence
 * of a warning is the signal.
 */
const COVERAGE_KEY: Record<string, string> = {
  partial: 'coverage.partial',
  none: 'coverage.none',
};

/*
 * No starter questions on the empty screen.
 *
 * They were a nudge for a stranger, and inside an account there are no
 * strangers: everyone here has already asked at least one question to get an
 * account at all. What they met instead was a prompt to pick from a list of
 * two, every time they started a consultation. The landing page keeps its
 * examples, where the reader genuinely has not seen this work yet.
 *
 * `example.1` and `example.2` stay in the dictionaries — the landing uses the
 * same idea, and deleting strings is how a translation quietly goes missing.
 */

/** Grow the composer to fit its content, up to a ceiling. */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}

export function Chat({
  corpusSynced,
  account,
  openId,
  onOpenSession,
  onSignOut,
  onOpenProfile,
  onOpenWorkspace,
}: {
  corpusSynced: string | null;
  account?: Account | null;
  /** Which conversation the ADDRESS says is open; null is a fresh one. */
  openId?: string | null | undefined;
  /**
   * Ask for a different conversation. The caller moves the address, which comes
   * back down as `openId` — one direction, so the two can never disagree.
   * `replace` for a move the reader did not ask for.
   */
  onOpenSession?: ((id: string | null, replace?: boolean) => void) | undefined;
  onSignOut?: (() => void) | undefined;
  onOpenProfile?: (() => void) | undefined;
  onOpenWorkspace?: (() => void) | undefined;
}) {
  const { t, railOpen, setRail } = useSettings();
  /** The avatar letter in the collapsed strip — same rule as AccountMenu's. */
  const railInitial = account?.user
    ? (account.user.name || account.user.email.split('@')[0] || account.user.email)
        .slice(0, 1)
        .toUpperCase()
    : '';
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Provision pinned into the norm panel; null follows the newest answer. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Bumped when a turn completes, so the session list refetches. */
  const [reloadKey, setReloadKey] = useState(0);
  /** Whether the share popup is open. The link itself lives in the popup. */
  const [shareOpen, setShareOpen] = useState(false);

  /**
   * Ask the question the visitor typed before they had an account.
   *
   * They asked it once, saw half an answer, and registered on the strength of
   * it. Making them retype it now would charge them twice for the same thing —
   * and the moment right after signup is exactly when a product gets to prove
   * it kept its promise. Cleared first, so a failed turn cannot loop.
   */
  useEffect(() => {
    const pending = sessionStorage.getItem(PENDING_QUESTION);
    if (!pending) return;
    sessionStorage.removeItem(PENDING_QUESTION);
    sessionStorage.removeItem(PENDING_PREVIEW);
    void send(pending);
    // Runs once on mount, after the account exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
   * The address decides which conversation is open — this is where it lands.
   *
   * `syncedRef` holds the id this component has already acted on, so the three
   * ways a conversation changes (a click in the register, a new one earning its
   * id mid-answer, the browser's own back button) all end up here and none of
   * them re-fetches a transcript that is already on screen. It starts null so a
   * cold load of /c/<id> is a change and does fetch.
   */
  const syncedRef = useRef<string | null>(null);
  useEffect(() => {
    const want = openId ?? null;
    if (want === syncedRef.current) return;
    syncedRef.current = want;
    if (want) void openSession(want);
    else clearThread();
    // openSession and clearThread are redefined every render and stable in
    // behaviour; depending on them would re-run this on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Whether to keep following the streaming answer; false once the reader scrolls up. */
  const stickRef = useRef(true);
  /**
   * A transcript has just been loaded, so the next render is a conversation
   * arriving whole rather than an answer growing. It opens at its first
   * question — which is where reading one starts — instead of at the foot of
   * the last answer.
   */
  const openedRef = useRef(false);

  /**
   * Reopen a past conversation.
   *
   * Only the transcript is restored, not the retrieved chunks — those are
   * per-turn and stay in `session_chunks` server-side, where the next turn
   * still carries them. Re-rendering source cards for old turns would mean
   * refetching every chunk of the conversation to show something the reader
   * did not ask for.
   */
  async function openSession(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
      /*
        An id that is not yours, or not anything.

        Only reachable since conversations got addresses — the register could
        only ever offer your own. Left alone it would seat the reader in an
        empty transcript that still carried the foreign id, and their next
        question would be posted into somebody else's conversation. Start a
        fresh one instead, and put the address right.
      */
      if (!res.ok) {
        syncedRef.current = null;
        clearThread();
        onOpenSession?.(null, true);
        return;
      }
      const data = (await res.json()) as {
        messages?: { role: string; content: string }[];
        chunksByTurn?: Record<string, Chunk[]>;
      };
      setSessionId(id);
      /*
        The articles come back with the transcript.

        They used to be dropped — only the words were restored — so a
        conversation you returned to had no sources column and no citations
        under its answers. The apparatus vanishing also collapsed the grid from
        three columns to two, which moved the whole reading column a quarter of
        the window to the right: the same text, in a place it had not been,
        which reads as the page having changed size.
      */
      let answered = 0;
      setTurns(
        (data.messages ?? []).map((m) => {
          if (m.role === 'user') return { role: 'user' as const, text: m.content };
          answered += 1;
          return {
            role: 'assistant' as const,
            text: m.content,
            // turn_added is the 1-based question number, so the Nth answer
            // takes the Nth bucket.
            fresh: data.chunksByTurn?.[String(answered)] ?? [],
          };
        }),
      );
      setSelectedId(null);
      setError(null);
      openedRef.current = true;
      // The reader may have scrolled away in the conversation they just left;
      // a new answer in this one should still be followed.
      stickRef.current = true;
    } catch (err) {
      setError(String(err));
    }
  }

  // Wake the database while the user is still reading the page. Neon suspends
  // an idle compute and the cold start is ~3.4s — it would otherwise land on
  // the very first question, the worst place for it.
  useEffect(() => {
    void fetch('/api/warm').catch(() => {});
  }, []);

  /**
   * Follow the answer as it streams, unless the reader has scrolled away.
   *
   * An answer runs past a screen and takes 40–60s to write, so without this the
   * reader chases it manually. But yanking the viewport while they are re-reading
   * an earlier turn is worse than not following at all.
   *
   * The signal is the reader's own scrolling, NOT the distance from the bottom.
   * A distance test was tried and failed: text arrives faster than the effect
   * re-runs, so the gap exceeded the threshold within a second or two and
   * following switched off permanently — measured stuck at 207px with the
   * answer still growing. Deliberate intent is the thing to detect; a gap that
   * opens on its own is not intent.
   */
  useEffect(() => {
    const onUserScroll = (): void => {
      const gap = document.body.scrollHeight - (window.innerHeight + window.scrollY);
      stickRef.current = gap < 120; // scrolled back to the bottom → resume following
    };
    window.addEventListener('wheel', onUserScroll, { passive: true });
    window.addEventListener('touchmove', onUserScroll, { passive: true });
    return () => {
      window.removeEventListener('wheel', onUserScroll);
      window.removeEventListener('touchmove', onUserScroll);
    };
  }, []);

  useEffect(() => {
    // Nothing to follow before the first question — and following anyway lands
    // the reader at the bottom of the register, below the empty state that
    // explains what the edition covers.
    if (turns.length === 0) return;

    /*
      A conversation that was just opened starts at the top.

      This effect used to fire for that too, because opening one replaces
      `turns` exactly as an arriving answer does — so clicking a conversation
      in the register dropped the reader at the end of its last answer, and
      they had to scroll back up to the question they had come to re-read.
    */
    if (openedRef.current) {
      openedRef.current = false;
      window.scrollTo({ top: 0 });
      return;
    }

    /*
      Otherwise follow only while something is actually being written. Without
      this the same jump returns by another door: any later change to `turns`
      on a conversation the reader is sitting in would move them to the bottom.
    */
    if (!loading) return;
    // Scroll the page, not the anchor: the composer is sticky, so scrolling an
    // anchor "into view" stops short by the composer's height every time.
    if (stickRef.current) window.scrollTo({ top: document.body.scrollHeight });
  }, [turns, loading]);

  async function send(override?: string): Promise<void> {
    const message = (override ?? input).trim();
    if (!message || loading) return;

    setInput('');
    // The textarea grew to fit the question; collapse it back, or the composer
    // stays tall and empty after sending.
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setError(null);
    setTurns((t) => [...t, { role: 'user', text: message }]);
    setLoading(true);

    // The assistant turn is appended empty and filled in as events arrive, so
    // there is exactly one place text accumulates. Time to first token is ~9s
    // warm and the full answer takes ~45-60s; without streaming that is a
    // minute of blank screen.
    setTurns((t) => [...t, { role: 'assistant', text: '' }]);

    const patchLast = (patch: Partial<Turn>): void => {
      setTurns((t) => {
        const next = [...t];
        const last = next[next.length - 1];
        if (last) next[next.length - 1] = { ...last, ...patch };
        return next;
      });
    };

    // Declared out here so `finally` can always stop the pacer, including when
    // the stream throws part-way through.
    let timer: ReturnType<typeof setInterval> | undefined;
    let pending = '';
    let shown = '';

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: message, sessionId }),
      });

      if (!res.ok || !res.body) {
        const raw = await res.text();
        setError(
          raw.trim()
            ? `HTTP ${res.status}: ${raw.slice(0, 200)}`
            : `${t('error.noApi')} (HTTP ${res.status})`,
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Pace the output instead of painting each delta as it lands.
      //
      // The API delivers tokens in uneven bursts — a long pause, then a
      // paragraph at once — which reads as freezing and jerking rather than
      // writing. `pending` holds text that has arrived, `shown` is what the
      // reader sees, and a timer moves characters between them at a steady
      // rate. The drain is proportional to how much is waiting, so a big burst
      // empties quickly and the display never falls behind the stream.
      //
      // A timer, NOT requestAnimationFrame. rAF does not fire while the tab is
      // hidden or otherwise not compositing, which stalls the pacer with text
      // already received and leaves the answer blank — observed exactly that.
      // Content delivery must not depend on whether anyone is looking at it.
      // Timers are throttled in background tabs rather than stopped, and the
      // flush below guarantees the final text lands regardless.
      timer = setInterval(() => {
        if (pending.length === 0) return;
        const take = Math.max(2, Math.ceil(pending.length / 10));
        shown += pending.slice(0, take);
        pending = pending.slice(take);
        patchLast({ text: shown, stage: undefined, streaming: true });
      }, 16);

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE frames are separated by a blank line; a partial frame stays in
        // the buffer until the rest of it arrives.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          const m = /^event: (\w+)\ndata: (.*)$/s.exec(frame.trim());
          if (!m) continue;
          const payload = JSON.parse(m[2]!) as StreamPayload;

          if (m[1] === 'session') {
            /*
              The conversation now exists, and its question is already stored —
              so it is in the register and has an address, both long before the
              answer is finished. It used to get neither until the last token
              had landed, which is the better part of a minute spent looking at
              a screen with no evidence that anything had been kept.
            */
            if (payload.sessionId && payload.sessionId !== syncedRef.current) {
              setSessionId(payload.sessionId);
              syncedRef.current = payload.sessionId;
              // REPLACE: the same screen the reader is already on, now with a
              // name. Pushing would make Back walk into the blank consultation
              // they had just left.
              onOpenSession?.(payload.sessionId, true);
              setReloadKey((k) => k + 1);
            }
          } else if (m[1] === 'title') {
            // A name arrived for it. Only the register shows one, so this is
            // the whole of the update.
            setReloadKey((k) => k + 1);
          } else if (m[1] === 'stage') {
            patchLast({ stage: payload.stage });
          } else if (m[1] === 'chunks') {
            // Articles are known ~1-2s before the first word of the answer.
            patchLast({ fresh: payload.chunks });
          } else if (m[1] === 'delta') {
            pending += payload.text ?? '';
          } else if (m[1] === 'done') {
            if (payload.sessionId) {
              setSessionId(payload.sessionId);
              /*
                Give it its address, by REPLACING. It is the same screen the
                reader is already looking at, merely one that now has a name —
                pushing would make the back button walk into the blank
                consultation they had just left behind.
              */
              if (payload.sessionId !== syncedRef.current) {
                syncedRef.current = payload.sessionId;
                onOpenSession?.(payload.sessionId, true);
              }
            }
            // Deliberately does NOT set `text`: the pacer is still draining
            // `pending`, and overwriting it here would jump the answer to its
            // final state mid-animation.
            patchLast({
              standaloneQuery: payload.standaloneQuery,
              fresh: payload.freshChunks,
              carried: payload.carriedChunks,
              coverage: payload.coverage,
              stage: undefined,
            });
          } else if (m[1] === 'error') {
            // An exhausted API balance arrives as a 400 from Anthropic and is
            // re-raised as a 502 "chat failed", which reads like an application
            // bug. Name it, so nobody debugs the request shape for an hour.
            setError(
              /credit balance is too low/i.test(payload.detail ?? '')
                ? t('error.credit')
                : [payload.error, payload.detail].filter(Boolean).join(' — '),
            );
          }
        }
      }
    } catch (err) {
      setError(String(err));
    } finally {
      // Stop pacing and show whatever is still buffered. Text that has been
      // received must never stay undelivered because an animation is mid-flight
      // — including when the stream failed part-way.
      if (timer) clearInterval(timer);
      setReloadKey((k) => k + 1);
      patchLast({ text: shown + pending, streaming: false });
      setLoading(false);
    }
  }

  /** Wipe the screen. Says nothing about the address — see `reset`. */
  function clearThread(): void {
    setSessionId(null);
    setTurns([]);
    setError(null);
    setSelectedId(null);
    // Starting a new consultation from halfway down a long register would
    // otherwise leave the fresh, empty screen scrolled past.
    window.scrollTo({ top: 0 });
  }

  /**
   * A fresh consultation.
   *
   * Asks for the move and lets it come back as `openId`, so a new conversation
   * is reached the same way as every other — and the back button returns to the
   * one you left. Without a caller listening, it just clears.
   */
  function reset(): void {
    if (onOpenSession) {
      syncedRef.current = null;
      clearThread();
      onOpenSession(null);
      return;
    }
    clearThread();
  }

  // Which turn's apparatus is on screen.
  //
  // Normally the newest answer, so the statute is already there without anyone
  // clicking. But a citation in an OLDER turn addresses that turn's sources, so
  // selecting one has to bring its own apparatus with it — otherwise the figure
  // points at nothing.
  const assistantTurns = turns.filter((t) => t.role === 'assistant');
  const sourcesOf = (t: Turn | undefined): Entry[] => [
    ...(t?.fresh ?? []).map((chunk) => ({ chunk, carried: false })),
    ...(t?.carried ?? []).map((chunk) => ({ chunk, carried: true })),
  ];

  /**
   * The provisions the answer actually leans on, out of everything retrieved.
   *
   * Retrieval hands over eight or more candidates and the panel used to list
   * all of them, so an answer resting on four articles was filed under thirteen
   * — most of them fetched, considered and not used, with nothing to say so.
   * A reader checking an answer had to work out which of the thirteen it was
   * built from, which is the work the apparatus exists to save them.
   *
   * Two signals, both taken from the delivered text: the answer names the
   * provision (it cites by name — «(ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ, Հոդված 254)»), or it
   * quotes a passage that occurs in that article. `citedIndexes` holds the
   * rule and the edge cases it has to survive.
   *
   * While the answer is still being written, everything found is shown: the
   * text has not finished naming what it uses, and entries would appear and
   * vanish under the reader as it did.
   *
   * If nothing matches, everything is shown. An answer that cites in a form
   * this does not recognise must not leave the reader with no apparatus at all
   * — failing towards more evidence is the safe direction here.
   */
  const citedOf = (t: Turn | undefined): Entry[] => {
    const all = sourcesOf(t);
    const text = t?.text ?? '';
    if (!text || t?.streaming) return all;
    const keep = new Set(citedIndexes(all.map((e) => e.chunk), text));
    return all.filter((_, i) => keep.has(i));
  };
  const owningTurn =
    (selectedId
      ? [...assistantTurns].reverse().find((t) => citedOf(t).some((e) => e.chunk.articleId === selectedId))
      : undefined) ?? assistantTurns[assistantTurns.length - 1];

  const entries = citedOf(owningTurn);
  const shownQuotes = extractQuotes(owningTurn?.text ?? '');

  return (
    // The sources column exists only when there are sources; without it the
    // grid drops to a single reading column and the measure centres across the
    // whole width rather than sitting beside a blank panel.
    <div
      className={[
        'workbench',
        railOpen ? null : 'rail-hidden',
        entries.length === 0 ? 'no-apparatus' : null,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {railOpen ? (
      <nav
        className="rail"
        onClick={(e) => {
          /*
            A click on the sidebar's BLANK ground collapses it to the thin
            strip. Anything you can act on keeps its own meaning — a
            conversation, a button, a menu, the account block, and the share
            and delete popups, which are portaled to <body> but whose clicks
            still bubble here through the React tree (the backdrop included,
            or dismissing a popup would also fold the sidebar away).
          */
          const target = e.target as HTMLElement;
          if (
            target.closest(
              'button, a, input, textarea, select, [role="menu"], [role="dialog"], ' +
                '.popup-backdrop, .session-row, .account',
            )
          ) {
            return;
          }
          // A drag that selects text ends in a click; folding the sidebar at
          // the end of a selection would be a surprise.
          if (window.getSelection()?.toString()) return;
          setRail(false);
        }}
      >
        <div className="panel-title">{t('nav.consultations')}</div>
        {/*
          Starting a new consultation is the one ACTION in this column; the rest
          is a list to read. Below forty register entries it sat off the bottom
          of a scrolling column, which is nowhere.
        */}
        {/*
          In an empty conversation this row IS the current conversation — no
          entry below is highlighted, because the new one has no row yet — so
          it takes the active style rather than a greyed-out disabled one.
          Still inert: starting a new conversation from a new conversation
          would do nothing.
        */}
        <button
          className={turns.length === 0 ? 'new-case active' : 'new-case'}
          onClick={reset}
          disabled={turns.length === 0}
          aria-current={turns.length === 0 ? 'page' : undefined}
        >
          {t('nav.newCase')}
        </button>
        <div className="register-rule" />
        <Sessions
          currentId={sessionId}
          onOpen={(id) => (onOpenSession ? onOpenSession(id) : void openSession(id))}
          reloadKey={reloadKey}
          // Deleting the conversation being read has to clear the reader too,
          // or the transcript stays on screen with nothing behind it.
          onDeleted={reset}
        />
        {/*
          The foot of the register. Below 1200px this whole column is
          display:none and the masthead carries the same control instead — CSS
          shows exactly one, so sign-out is never off the page.
        */}
        {account?.user && onSignOut && onOpenWorkspace ? (
          <AccountMenu
            account={account}
            placement="rail"
            onSignOut={onSignOut}
            onOpenProfile={onOpenProfile ?? (() => {})}
            onOpenWorkspace={onOpenWorkspace}
          />
        ) : null}
      </nav>
      ) : (
        /*
          The collapsed sidebar: a thin strip holding the mark, a way to start a
          conversation, and the account — the three things worth keeping in
          reach while the list is out of the way. Every one of them reopens the
          sidebar; the pen also starts a new conversation first.
        */
        <nav
          className="rail-mini"
          aria-label={t('nav.consultations')}
          // Anywhere on the strip opens the sidebar — its blank length as well
          // as its three icons, which is where people actually click. The pen
          // still starts a new conversation first; its click then bubbles
          // here, and opening an already-opening sidebar is harmless.
          onClick={() => setRail(true)}
        >
          <button
            className="rail-mini-logo"
            onClick={() => setRail(true)}
            aria-label={t('nav.openRail')}
            title={t('nav.openRail')}
          >
            <img src="/favicon.svg" alt="" width={26} height={26} />
          </button>
          <button
            onClick={() => {
              reset();
              setRail(true);
            }}
            aria-label={t('nav.newCase')}
            title={t('nav.newCase')}
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6" />
              <path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
            </svg>
          </button>
          <span className="rail-mini-spacer" />
          {railInitial ? (
            <button
              className="rail-mini-avatar"
              onClick={() => setRail(true)}
              aria-label={t('nav.openRail')}
              title={t('nav.openRail')}
            >
              <span className="account-initial" aria-hidden="true">
                {railInitial}
              </span>
            </button>
          ) : null}
        </nav>
      )}

      <section className={turns.length === 0 ? 'thread thread-blank' : 'thread'}>
      {/*
        The empty state carries a heading and nothing else. It used to carry a
        lede, a caution paragraph and two example questions as well: onboarding
        read once, then read past every day by someone who already knows what
        the tool is. The colophon already states the disclaimer.
      */}
      {turns.length === 0 ? (
        <div className="intro measure">
          <h1 className="intro-title">
            <BrandLine text={t('intro.title')} />
          </h1>
        </div>
      ) : null}

      {turns.map((turn, i) => {
        const sources = citedOf(turn);
        /* Waiting on the first word. The typing line names the speaker itself,
           so the standing role label would only say MatyanAI a second time. */
        const typing = turn.role === 'assistant' && !!turn.stage && !turn.text;
        return (
        <div key={i} className={`turn ${turn.role} measure`}>
          {typing ? null : (
            <div className="turn-role">
              {turn.role === 'user' ? t('turn.question') : BRAND}
              {/*
                Share sits on the FIRST question of a saved conversation, which is
                where someone looks for it — the earlier placement was an unlabelled
                icon revealed by hovering the sidebar list, and the first person to
                use it could not find it at all. One control, named, in the thread
                it acts on.
              */}
              {turn.role === 'user' && i === 0 && sessionId ? (
                <button className="turn-share" onClick={() => setShareOpen(true)} title={t('share.share')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                    <path d="M12 15V3M8 7l4-4 4 4" />
                  </svg>
                  {t('share.share')}
                </button>
              ) : null}
              {turn.role === 'user' && i === 0 && shareOpen && sessionId ? (
                <SharePopup sessionId={sessionId} onClose={() => setShareOpen(false)} />
              ) : null}
            </div>
          )}
          {turn.coverage && COVERAGE_KEY[turn.coverage] ? (
            <div className={`coverage ${turn.coverage}`}>
              <span className="coverage-label">
                {t(turn.coverage === 'none' ? 'coverage.noneLabel' : 'coverage.partialLabel')}
              </span>
              <div className="coverage-body">{t(COVERAGE_KEY[turn.coverage]!)}</div>
            </div>
          ) : null}
          {turn.text ? (
            <div className="turn-text">
              {turn.role === 'user' ? turn.text : <MarkdownView text={turn.text} />}
              {turn.streaming ? <span className="caret" /> : null}
            </div>
          ) : null}
          {turn.stage && !turn.text ? (
            <div className="stage">
              {/*
                Shown only until the first word arrives — roughly nine seconds
                of two model calls and a retrieval, which is the stretch that
                reads as a hung request. Once text is streaming the words are
                the feedback and this goes away.

                Shaped like the typing indicator every messaging app uses: who
                is answering, then dots that say they are still at it. The dots
                are aria-hidden — the stage line beside them already says what
                is happening, and a screen reader announcing a decorative
                animation on top of that is worse than not announcing it.
              */}
              <span className="stage-who">{BRAND}</span>
              <span className="stage-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="stage-line">
                {STAGE_KEY[turn.stage] ? t(STAGE_KEY[turn.stage]!) : turn.stage}
              </span>
            </div>
          ) : null}

          {/*
            Citations as superior figures addressing the apparatus beside the
            answer. The figure a reader clicks is the number the entry carries,
            so "3" in the text and "3" in the sources are the same provision.
          */}
          {turn.role === 'assistant' && sources.length > 0 ? (
            <div className="turn-meta">
              <div className="cites">
                <span className="cites-label">{t('cites.label')}</span>
                {sources.map((e, n) => (
                  <button
                    key={e.chunk.articleId}
                    className={e.carried ? 'cite carried' : 'cite'}
                    aria-current={selectedId === e.chunk.articleId}
                    onClick={() => setSelectedId(e.chunk.articleId)}
                    title={e.carried ? t('norm.carried') : e.chunk.documentTitle}
                  >
                    <span lang="hy">{e.chunk.ref}</span>
                  </button>
                ))}
              </div>
              {turn.standaloneQuery && turn.standaloneQuery !== turns[i - 1]?.text ? (
                <div className="rewrite">{t('turn.searchedFor')} <em>{turn.standaloneQuery}</em></div>
              ) : null}
            </div>
          ) : null}
        </div>
        );
      })}

      {error ? <div className="error measure">{error}</div> : null}

      {/* Anchor the auto-scroll to the end of the transcript. */}
      <div ref={endRef} />

      <div className="composer measure">
        {/*
          The send control sits INSIDE the field, as a small arrow, rather than
          as a labelled button beside it: the field is the thing you use, and a
          word-sized button next to it competed with it for attention. The
          label survives as aria-label and title, so it is still named.
        */}
        <div className="composer-field">
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline. A tax question often runs
              // several lines (turnover, headcount, activity), and a single-line
              // input hides most of what was typed.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={turns.length === 0 ? t('composer.first') : t('composer.next')}
          />
          <button
            className={loading ? 'send-arrow busy' : 'send-arrow'}
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            aria-label={t('composer.send')}
            title={t('composer.send')}
          >
            {loading ? null : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            )}
          </button>
        </div>
      </div>
      </section>

      <NormPanel
        entries={entries}
        quotes={shownQuotes}
        answer={owningTurn?.text ?? ''}
        corpusSynced={corpusSynced}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </div>
  );
}
