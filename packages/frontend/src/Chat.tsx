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
import { NormPanel } from './NormPanel.js';
import { MarkdownView } from './MarkdownView.js';
import { extractQuotes } from './quotes.js';
import { Sessions } from './Sessions.js';
import { useSettings } from './Settings.js';

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
const EXAMPLES = [
  'Какая ставка НДС в Армении?',
  'ես բուդկա եմ ուզում բացել',
  'Какой оборот считается пределом для микропредпринимательства?',
  'es uzum em pokr xanut bacel',
];

/** Grow the composer to fit its content, up to a ceiling. */
function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
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
    // Scroll the page, not the anchor: the composer is sticky, so scrolling an
    // anchor "into view" stops short by the composer's height every time.
    if (stickRef.current) window.scrollTo({ top: document.body.scrollHeight });
  }, [turns]);

  async function send(): Promise<void> {
    const message = input.trim();
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
  }

  // The provision shown in the norm panel: whatever the reader last selected,
  // otherwise the top-ranked chunk of the newest answer — so the statute is
  // already on screen without anyone clicking.
  const lastAnswer = [...turns].reverse().find((t) => t.role === 'assistant');
  const answerChunks = [...(lastAnswer?.fresh ?? []), ...(lastAnswer?.carried ?? [])];
  const shownChunk =
    answerChunks.find((c) => c.articleId === selectedId) ?? answerChunks[0] ?? null;
  const shownQuotes = extractQuotes(lastAnswer?.text ?? '');

  return (
    <div className={railOpen ? 'workbench' : 'workbench rail-hidden'}>
      {railOpen ? (
      <nav className="rail">
        <div className="panel-title">{t('nav.consultations')}</div>
        <button className="new-case" onClick={reset} disabled={turns.length === 0}>
          {t('nav.newCase')}
        </button>
        <Sessions currentId={sessionId} onOpen={(id) => void openSession(id)} reloadKey={reloadKey} />
      </nav>
      ) : null}

      <section className="thread">
      {turns.length === 0 ? (
        <div className="intro">
          <p>{t('intro.lead')}</p>
          {/*
            Examples are clickable and deliberately concrete. They do double
            duty: they save typing, and they show the corpus boundary — every
            one is a tax question, because that is all this corpus contains.
          */}
          <div className="examples">
            {EXAMPLES.map((q) => (
              <button
                key={q}
                className="example"
                onClick={() => {
                  setInput(q);
                  inputRef.current?.focus();
                }}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {turns.map((turn, i) => (
        <div key={i} className={`turn ${turn.role}`}>
          <div className="turn-role">{turn.role === 'user' ? t('turn.question') : 'ArmLex'}</div>
          {turn.coverage && COVERAGE_KEY[turn.coverage] ? (
            <div className={`coverage ${turn.coverage}`}>{t(COVERAGE_KEY[turn.coverage]!)}</div>
          ) : null}
          {turn.text ? (
            <div className="turn-text">
              <MarkdownView text={turn.text} />
              {turn.streaming ? <span className="caret" /> : null}
            </div>
          ) : null}
          {turn.stage && !turn.text ? (
            <div className="stage">
              <span className="stage-pulse" />
              {STAGE_KEY[turn.stage] ? t(STAGE_KEY[turn.stage]!) : turn.stage}
            </div>
          ) : null}

          {/*
            Citations, not a collapsed "Sources (4)" list. A citation is the
            unit an accountant reuses, so each one is a control that loads that
            provision into the norm panel beside the answer.
          */}
          {turn.role === 'assistant' && (turn.fresh?.length ?? 0) + (turn.carried?.length ?? 0) > 0 ? (
            <div className="turn-meta">
              <div className="cites">
                {(turn.fresh ?? []).map((c) => (
                  <button
                    key={`f${c.articleId}`}
                    className="cite"
                    aria-current={shownChunk?.articleId === c.articleId}
                    onClick={() => setSelectedId(c.articleId)}
                  >
                    <span lang="hy">{c.ref}</span>
                  </button>
                ))}
                {(turn.carried ?? []).map((c) => (
                  <button
                    key={`c${c.articleId}`}
                    className="cite carried"
                    aria-current={shownChunk?.articleId === c.articleId}
                    onClick={() => setSelectedId(c.articleId)}
                    title="Перенесено из прошлых сообщений"
                  >
                    <span lang="hy">{c.ref}</span>
                  </button>
                ))}
              </div>
              {turn.standaloneQuery && turn.standaloneQuery !== turns[i - 1]?.text ? (
                <div className="rewrite">{t('turn.searchedFor')} <em>{turn.standaloneQuery}</em></div>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}

      {error ? <div className="error">{error}</div> : null}

      {/* Anchor the auto-scroll to the end of the transcript. */}
      <div ref={endRef} />

      <div className="composer">
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

      <NormPanel chunk={shownChunk} quotes={shownQuotes} corpusSynced={corpusSynced} />
    </div>
  );
}
