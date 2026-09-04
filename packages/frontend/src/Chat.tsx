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
import { Sessions } from './Sessions.js';
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

/**
 * Starter questions.
 *
 * Chosen to span the corpus rather than to flatter it: one that retrieval
 * handles well (VAT rate), one colloquial (opening a kiosk), one that needs the
 * micro-business rules, and one transliterated — the input style Armenian users
 * actually type when they lack an Armenian keyboard.
 */
/**
 * Starter questions. Three, not five: the list is a nudge for an empty screen,
 * not a catalogue, and it disappears for good after the first question.
 *
 * They live in the dictionary rather than as literals, so an example is always
 * in the language the reader is being addressed in. They used to be Russian
 * regardless — which read as an oversight in an Armenian interface, and would
 * again the moment the language switcher comes back.
 *
 * Two, one per code: a tax question and a labour question, since the corpus
 * stopped being tax-only.
 */
const EXAMPLE_KEYS = ['example.1', 'example.2'];

/** Figures for the example list — this is an edition, so it numbers in roman. */
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** Grow the composer to fit its content, up to a ceiling. */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}

/**
 * Issue a link for a conversation and put it on the clipboard.
 *
 * Returns the link so the caller can show it when the clipboard is refused —
 * which browsers do, and a share control that silently fails has not shared
 * anything.
 */
async function issueShareLink(sessionId: string): Promise<string | null> {
  const res = await fetch(`/api/sessions/${sessionId}/share`, { method: 'POST' });
  if (!res.ok) return null;
  const { url } = (await res.json()) as { url: string };
  return `${window.location.origin}${url}`;
}

export function Chat({ corpusSynced }: { corpusSynced: string | null }) {
  const { t, railOpen } = useSettings();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Provision pinned into the norm panel; null follows the newest answer. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Bumped when a turn completes, so the session list refetches. */
  const [reloadKey, setReloadKey] = useState(0);
  /** The share link for this conversation, once one has been issued. */
  const [shareUrl, setShareUrl] = useState<string | null>(null);

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

  async function share(): Promise<void> {
    if (!sessionId) return;
    const url = shareUrl ?? (await issueShareLink(sessionId));
    if (!url) return;
    setShareUrl(url);
    // Copying is a convenience, not the mechanism: the link is rendered beside
    // the button either way. The first version fell back to `window.prompt`,
    // which is blocked outright in embedded contexts and threw — leaving the
    // click looking like nothing had happened, in the one flow where the user
    // is trying to hand something to somebody else.
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* shown inline instead */
    }
  }
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  /** Whether to keep following the streaming answer; false once the reader scrolls up. */
  const stickRef = useRef(true);

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
      const data = (await res.json()) as { messages?: { role: string; content: string }[] };
      setSessionId(id);
      setTurns(
        (data.messages ?? []).map((m) => ({
          role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
          text: m.content,
        })),
      );
      setSelectedId(null);
      setError(null);
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
    // Scroll the page, not the anchor: the composer is sticky, so scrolling an
    // anchor "into view" stops short by the composer's height every time.
    if (stickRef.current) window.scrollTo({ top: document.body.scrollHeight });
  }, [turns]);

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

          if (m[1] === 'stage') {
            patchLast({ stage: payload.stage });
          } else if (m[1] === 'chunks') {
            // Articles are known ~1-2s before the first word of the answer.
            patchLast({ fresh: payload.chunks });
          } else if (m[1] === 'delta') {
            pending += payload.text ?? '';
          } else if (m[1] === 'done') {
            if (payload.sessionId) setSessionId(payload.sessionId);
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

  function reset(): void {
    setSessionId(null);
    setTurns([]);
    setError(null);
    setSelectedId(null);
    // Starting a new consultation from halfway down a long register would
    // otherwise leave the fresh, empty screen scrolled past.
    window.scrollTo({ top: 0 });
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
  const owningTurn =
    (selectedId
      ? [...assistantTurns].reverse().find((t) => sourcesOf(t).some((e) => e.chunk.articleId === selectedId))
      : undefined) ?? assistantTurns[assistantTurns.length - 1];

  const entries = sourcesOf(owningTurn);
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
      <nav className="rail">
        <div className="panel-title">{t('nav.consultations')}</div>
        {/*
          Starting a new consultation is the one ACTION in this column; the rest
          is a list to read. Below forty register entries it sat off the bottom
          of a scrolling column, which is nowhere.
        */}
        <button className="new-case" onClick={reset} disabled={turns.length === 0}>
          {t('nav.newCase')}
        </button>
        <div className="register-rule" />
        <Sessions currentId={sessionId} onOpen={(id) => void openSession(id)} reloadKey={reloadKey} />
      </nav>
      ) : null}

      <section className={turns.length === 0 ? 'thread thread-blank' : 'thread'}>
      {/*
        The empty state carries a heading and examples — and nothing else.
        It used to carry a lede and a caution paragraph as well: onboarding read
        once, then read past every day by someone who already knows what the
        tool is. The masthead already states the corpus and the disclaimer.
      */}
      {turns.length === 0 ? (
        <div className="intro measure">
          {/*
            The product names itself here, so the name is set apart from the
            sentence around it. `{brand}` is a placeholder rather than the name
            written into each dictionary: only the sentence knows how to decline
            it (Armenian takes MatyanAI-ն), and the name itself never changes.
          */}
          <h1 className="intro-title">
            {t('intro.title')
              .split('{brand}')
              .flatMap((part, i) =>
                i === 0 ? [part] : [<span key={i} className="brand-name">{BRAND}</span>, part],
              )}
          </h1>

          <div className="panel-title">{t('intro.start')}</div>
          <div className="examples-rule" />
          <div className="examples">
            {EXAMPLE_KEYS.map((key, i) => {
              const q = t(key);
              return (
                <button
                  key={key}
                  className="example"
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                >
                  <span className="example-n">{ROMAN[i]}</span>
                  <span className="example-q">{q}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {turns.map((turn, i) => {
        const sources = sourcesOf(turn);
        return (
        <div key={i} className={`turn ${turn.role} measure`}>
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
              <button
                className={`turn-share${shareUrl ? ' on' : ''}`}
                onClick={() => void share()}
                title={shareUrl ? t('share.copied') : t('share.share')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" />
                  <path d="M12 15V3M8 7l4-4 4 4" />
                </svg>
                {shareUrl ? t('share.copied') : t('share.share')}
              </button>
            ) : null}
            {turn.role === 'user' && i === 0 && shareUrl ? (
              // Always visible once issued, and selectable — a link the user
              // can see is a link they can send even when the clipboard refused.
              <input className="share-link" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
            ) : null}
          </div>
          {turn.coverage && COVERAGE_KEY[turn.coverage] ? (
            <div className={`coverage ${turn.coverage}`}>
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

                aria-hidden, because the stage line beside it already says what
                is happening and a screen reader announcing a decorative
                animation twice is worse than not announcing it at all.
              */}
              <span className="stage-figure" aria-hidden="true" />
              <span className="stage-line">
                <span className="stage-pulse" />
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
                    <span className="cite-n">{n + 1}</span>
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
        <button onClick={() => void send()} disabled={loading || !input.trim()}>
          {loading ? '…' : t('composer.send')}
        </button>
      </div>
      </section>

      <NormPanel
        entries={entries}
        quotes={shownQuotes}
        corpusSynced={corpusSynced}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />
    </div>
  );
}
