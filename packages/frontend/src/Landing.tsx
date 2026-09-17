/**
 * What a visitor with no account meets.
 *
 * They ask a real question and get a real answer to the first part of it; the
 * rest is behind registration. The blurred half is genuine withheld text, not a
 * decoration — so the promise the button makes is one the product keeps.
 *
 * The question survives the signup: it goes into `sessionStorage` before the
 * form appears and is asked again, properly, the moment the account exists. A
 * visitor who has to retype their question after registering has been made to
 * pay twice for the same thing.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Login, type Tab } from './Login.js';
import { MarkdownView } from './MarkdownView.js';
import { useSettings } from './Settings.js';
import { navigate, usePath } from './router.js';
import { BrandMark } from './BrandMark.js';

export const PENDING_QUESTION = 'matyan.pendingQuestion';
export const PENDING_PREVIEW = 'matyan.pendingPreview';

interface PreviewResult {
  id: string;
  shown: string;
  withheld: number;
  sources: number;
  /** Which act each source is in — the server never sends the number. */
  acts?: { act: string; kind: string }[];
  coverage: string | null;
}

/**
 * Text for the blurred half.
 *
 * Not the withheld answer, and not lorem either. A CSS blur over the real text
 * leaves it in the DOM for anyone who opens the inspector, which would make the
 * registration prompt a lie rather than a gate — so this is built from the
 * words ALREADY SHOWN above it, reordered into nonsense. Nothing is revealed
 * that the visitor is not already reading, the letter shapes and word lengths
 * are genuinely Armenian legal prose, and at the blur strength below a letter
 * here and there resolves while no line of it can be read.
 *
 * The stride is fixed rather than random so the same answer always blurs to the
 * same shape — a re-render must not reshuffle the page under the reader.
 */
function blurLines(shown: string): string[] {
  const words = shown
    .replace(/[#*_`>[\]()|]/g, ' ')
    .split(/\s+/)
    // Numbers and list markers out: "1." survives a blur as a recognisable
    // shape and gives the block away as chopped-up markdown.
    .filter((w) => w.length > 1 && !/\d/.test(w));
  if (words.length < 8) return [];

  const lines: string[] = [];
  let n = 0;
  // Uneven lengths, ending short: an even block of text reads as a placeholder.
  // Twelve lines, so the card laid over them has blurred text above and below
  // it rather than covering the whole block.
  for (const [row, count] of [9, 11, 8, 10, 9, 11, 7, 10, 9, 11, 8, 4].entries()) {
    const line: string[] = [];
    for (let i = 0; i < count; i++) {
      // The row offset matters when the answer is short: on a single stride the
      // sequence cycles and every line repeats the tail of the one above it.
      line.push(words[(n * 7 + row * 5 + 3) % words.length]!);
      n++;
    }
    lines.push(line.join(' '));
  }
  return lines;
}

/**
 * One card per act, counting its provisions by kind, in the order the server
 * listed them. Ten identical «Աշխատանքային օրենսգիրք · Հոդված [XX]» cards say
 * less than one card holding ten closed numbers.
 */
function groupByAct(acts: { act: string; kind: string }[]): [string, [string, number][]][] {
  const byAct = new Map<string, Map<string, number>>();
  for (const { act, kind } of acts) {
    const kinds = byAct.get(act) ?? new Map<string, number>();
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    byAct.set(act, kinds);
  }
  return [...byAct].map(([act, kinds]) => [act, [...kinds]]);
}

/**
 * The example chips. Short topics rather than full questions, as the design has
 * them; a click asks the topic as it reads — tax, labour and a government
 * decision, one each of what the corpus holds.
 */
const EXAMPLES = ['landing.example.1', 'landing.example.2', 'landing.example.3'];

export function Landing({
  googleEnabled,
  onAuthed,
}: {
  googleEnabled?: boolean | undefined;
  onAuthed: () => void;
}) {
  const { t } = useSettings();
  const [question, setQuestion] = useState('');
  const askRef = useRef<HTMLTextAreaElement>(null);

  /*
   * Fit the box to its text, up to the CSS max-height, where it starts
   * scrolling instead. Keyed on `question` rather than done in onChange so a
   * programmatic change — the box cleared after asking, or refilled — resizes
   * too, instead of leaving it stuck at the height of the last thing typed.
   * Layout effect, so the height is corrected before paint and the box never
   * visibly jumps.
   *
   * Collapsing to `auto` first is what lets it SHRINK: scrollHeight never
   * reports less than the current height, so without the reset a box that grew
   * could never get smaller again.
   */
  useLayoutEffect(() => {
    const el = askRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // scrollHeight covers content + padding but NOT the border, while the page
    // sizes boxes as border-box. Setting scrollHeight alone left the box 2px
    // short, and with overflow-y: auto that 2px showed a scrollbar on every
    // one-line question. offsetHeight − clientHeight is exactly the border.
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [question]);
  const [busy, setBusy] = useState(false);
  /** The question as submitted. The box goes away once it is asked; this is
   *  what keeps the visitor able to see what they asked. */
  const [askedText, setAskedText] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
/*
   * Which form to show is read off the address — /login and /registration —
   * rather than held in state.
   *
   * As state, the form had no address of its own: a reload dropped the visitor
   * back on the landing, a link to "register here" could not be sent, and the
   * back button walked out of the site instead of out of the form. The header
   * still carries both doors, so a returning user never has to ask a question
   * to find the way in.
   */
  const path = usePath();
  const showAuth: Tab | null =
    path === '/login' ? 'signin' : path === '/registration' ? 'register' : null;
  const openForm = (tab: Tab): void => navigate(tab === 'signin' ? '/login' : '/registration');

  /**
   * The outcome of a Google round trip, read once on first render.
   *
   * The redirect destroys component state, so the server has no way to speak to
   * this component except through the URL. Until now nothing read these — the
   * server had been redirecting to `/?auth=cancelled` and `/?auth=failed` since
   * Google sign-in existed, and every one of them landed on a page that showed
   * the visitor nothing at all.
   *
   * `no_account` opens REGISTER rather than sign-in: they proved they have a
   * Google account and no account here, so the only useful next step is the
   * other door. The rest reopen sign-in, which is where they were.
   */
  const [oauth] = useState(() => {
    const code = new URLSearchParams(window.location.search).get('auth');
    if (!code) return null;
    // Clear it immediately: a reload should not replay a stale complaint, and
    // the parameter would otherwise survive into any link they share. And put
    // them at the form's own address while doing it: `no_account` proved they
    // have a Google account and no account here, so registration is the only
    // useful next door; everything else reopens sign-in, where they were.
    window.history.replaceState(null, '', code === 'no_account' ? '/registration' : '/login');
    return code;
  });

  const OAUTH_MESSAGES: Record<string, string> = {
    no_account: t('auth.oauth.noAccount'),
    cancelled: t('auth.oauth.cancelled'),
    failed: t('auth.oauth.failed'),
    unverified: t('auth.oauth.unverified'),
  };
  const oauthError = oauth ? (OAUTH_MESSAGES[oauth] ?? t('auth.oauth.failed')) : undefined;

  const openAuth = showAuth;

  /** A question is in flight, or its answer — or its failure — is on screen. */
  const answering = busy || preview !== null || (error !== null && askedText !== null);

  /*
   * The main page, from anywhere a visitor can be.
   *
   * The mark goes home on every screen of this product. Here it did nothing on
   * the landing itself — a span, so a visitor looking at a preview had no way
   * back to a fresh question except the browser — and on the sign-in form it
   * only closed the form, returning them to whatever preview was still open.
   * Home is the landing as it first appears: no preview, no question, no form.
   * A preview request still in flight is left to land in state nobody renders.
   */
  function goHome(): void {
    setPreview(null);
    setAskedText(null);
    setError(null);
    setQuestion('');
    navigate('/');
    window.scrollTo({ top: 0 });
  }

  async function ask(q: string): Promise<void> {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    setAskedText(text);
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
      });
      const body = (await res.json()) as PreviewResult & { error?: string; detail?: string };
      if (!res.ok) {
        setError(body.detail ?? t('preview.failed'));
        // Out of free previews is the one error that should still lead
        // somewhere: registering is exactly the answer to it.
        if (res.status === 429) openForm('register');
        return;
      }
      setPreview(body);
      sessionStorage.setItem(PENDING_QUESTION, text);
      sessionStorage.setItem(PENDING_PREVIEW, body.id);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  /*
    Registration draws its own chrome: step one is a card with the mark inside
    it and no masthead, the later steps put the masthead back. Only the form
    knows which step it is on, so it is handed the way home and left to decide.
  */
  if (openAuth === 'register') {
    return (
      <div className="page">
        <Login
          googleEnabled={googleEnabled}
          onSuccess={onAuthed}
          initialTab="register"
          initialError={oauthError}
          onHome={goHome}
          fromPreview={preview !== null || sessionStorage.getItem(PENDING_QUESTION) !== null}
          onTabChange={(tab) =>
            navigate(tab === 'signin' ? '/login' : '/registration', { replace: true })
          }
        />
      </div>
    );
  }

  if (openAuth) {
    return (
      <div className="page">
        {/* The mark is the way back, exactly as it is the way home once you
            are signed in — and in the same corner, at the same size. */}
        <header className="provenance">
          <div className="masthead-top">
            <button className="brand" onClick={goHome}>
              <BrandMark />
            </button>
          </div>
        </header>
        <Login
          googleEnabled={googleEnabled}
          onSuccess={onAuthed}
          initialTab={openAuth}
          initialError={oauthError}
          // Switching between the two forms REPLACES the address: it is the
          // same door, turned the other way, and pushing would make the back
          // button walk the reader through every flip.
          onTabChange={(tab) =>
            navigate(tab === 'signin' ? '/login' : '/registration', { replace: true })
          }
        />
      </div>
    );
  }

  return (
    /*
      The signed-in page's own shape: a full-width masthead over a centred
      column. Both doors keep the other end of the masthead line — someone who
      already has an account arrived to USE the tool, and making them type a
      question first is a toll on the likeliest paying customer.
    */
    <div className="page">
      <header className="provenance lp-header">
        <div className="masthead-top">
          <button className="brand" onClick={goHome}>
            <BrandMark />
          </button>
          <span className="spacer" />
          <button className="landing-signin" onClick={() => openForm('signin')}>
            {t('auth.signIn')}
          </button>
          {/* Two labels, one shown: the full one wraps onto a second header
              row on a 375px phone, next to the mark and Sign in. */}
          <button className="landing-signup" onClick={() => openForm('register')}>
            <span className="lp-long">{t('landing.signup')}</span>
            <span className="lp-short">{t('landing.signupShort')}</span>
          </button>
        </div>
      </header>

      <div className="wrap lp">
        {/*
          Everything that introduces the page goes the moment a question is asked
          — the headline, the lede, the box and the examples. What the visitor
          wants from that point on is their answer, and a page still offering to
          explain itself above it is an advertisement in the way.
        */}
        {answering ? null : (
          <>
            <section className="lp-hero">
              <h1 className="lp-title">
                {t('landing.title')}
                <span className="lp-accent">{t('landing.titleAccent')}</span>
              </h1>
              <p className="lp-lede">{t('landing.lede')}</p>
            </section>

            <div className="lp-try">
              <div className="lp-try-label">{t('landing.try')}</div>
              <div className="lp-ask">
                <svg className="lp-ask-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <textarea
                  ref={askRef}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void ask(question);
                    }
                  }}
                  placeholder={t('landing.placeholder')}
                  aria-label={t('landing.try')}
                  rows={1}
                  disabled={busy}
                />
                {/* The arrow the signed-in composer uses, so the box a visitor
                    meets first is the box they will use after registering. */}
                <button
                  className={busy ? 'send-arrow busy' : 'send-arrow'}
                  onClick={() => void ask(question)}
                  disabled={busy || !question.trim()}
                  aria-label={busy ? t('preview.thinking') : t('preview.ask')}
                  title={busy ? t('preview.thinking') : t('preview.ask')}
                >
                  {busy ? null : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="lp-examples">
                <span className="lp-examples-label">{t('landing.examples')}</span>
                {EXAMPLES.map((key) => (
                  <button key={key} className="lp-example" onClick={() => void ask(t(key))} disabled={busy}>
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>

            <div className="lp-status">
              <span className="lp-status-line">
                <i className="lp-dot lp-dot-live" aria-hidden="true" />
                {t('landing.status')}
              </span>
              <span className="lp-scope">
                <i className="lp-dot" aria-hidden="true" />
                {t('landing.scope')}
              </span>
            </div>
          </>
        )}

        {answering ? (
          <article className="lp-result">
            <header className="lp-result-head">
              <div className="lp-result-q">
                <div className="lp-overline">{t('preview.yourQuestion')}</div>
                <h2 className="lp-result-title">{askedText}</h2>
              </div>
              <button className="lp-new" onClick={goHome}>
                {t('preview.newQuestion')}
              </button>
            </header>

            <div className="lp-result-body">
              <div className="lp-overline lp-overline-accent">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
                </svg>
                {t('preview.answer')}
              </div>

              {busy ? (
                <div className="stage">
                  <span className="stage-dots" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="stage-line">{t('preview.thinking')}</span>
                </div>
              ) : null}

              {error ? <div className="error">{error}</div> : null}

              {preview ? (
                <>
                  <div className="lp-answer">
                    <MarkdownView text={preview.shown} />
                  </div>

                  {/*
                    Which acts the answer rests on, with the provision number
                    closed. The number is the thing a professional checks, so
                    it stays behind registration — and it is never sent, so the
                    [XX] is not a mask over something the page is holding.
                  */}
                  {preview.acts && preview.acts.length > 0 ? (
                    <div className="lp-sources">
                      <div className="lp-overline">
                        {t('preview.sources')} · {preview.acts.length}
                      </div>
                      <div className="lp-source-grid">
                        {groupByAct(preview.acts).map(([act, kinds]) => (
                          <div key={act} className="lp-source">
                            <div className="lp-source-act">{act}</div>
                            <div className="lp-source-ref">
                              {kinds.map(([kind, count], k) => (
                                <span key={kind}>
                                  {k > 0 ? ', ' : ''}
                                  {kind || '№'}{' '}
                                  <span className="lp-closed">
                                    {Array.from({ length: Math.min(count, 3) }, () => '[XX]').join(' · ')}
                                  </span>
                                  {count > 3 ? ` +${count - 3}` : ''}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {preview.withheld > 0 ? (
                    <div className="preview-gate lp-gate">
                      <div className="lp-lock">
                        <span className="lp-lock-icon" aria-hidden="true">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="5" y="11" width="14" height="10" rx="2" />
                            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                          </svg>
                        </span>
                        <h3 className="lp-lock-title">{t('preview.lockTitle')}</h3>
                        <p className="lp-lock-body">{t('preview.lockBody')}</p>
                        <button className="lp-lock-button" onClick={() => openForm('register')}>
                          {t('preview.unlock')}
                        </button>
                        <p className="lp-lock-signin">
                          {t('auth.haveAccount')}{' '}
                          <button className="auth-switch-link" onClick={() => openForm('signin')}>
                            {t('preview.signIn')}
                          </button>
                        </p>
                      </div>

                      {/*
                        Behind the card, which sits on it: the blurred text
                        showing around its edges is the evidence that there is
                        more. Later in the markup, so a screen reader reaches
                        the offer and never the decoration. See `blurLines` for
                        why this is reordered words rather than the withheld
                        text itself.
                      */}
                      <div className="preview-blur" aria-hidden="true">
                        {blurLines(preview.shown).map((line, i) => (
                          <span key={i}>{line}</span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </article>
        ) : null}
      </div>
    </div>
  );
}
