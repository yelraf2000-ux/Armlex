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
import { BRAND } from './brand.js';
import { Login, type Tab } from './Login.js';
import { MarkdownView } from './MarkdownView.js';
import { BrandLine } from './BrandLine.js';
import { useSettings } from './Settings.js';
import { navigate, usePath } from './router.js';

export const PENDING_QUESTION = 'matyan.pendingQuestion';
export const PENDING_PREVIEW = 'matyan.pendingPreview';

interface PreviewResult {
  id: string;
  shown: string;
  withheld: number;
  sources: number;
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

/** Real questions, from the harvested set — not invented marketing copy. */
const EXAMPLES = [
  'Գործատուն ուշացնում է աշխատավարձը։ Ի՞նչ իրավունքներ ունեմ։',
  'Որքա՞ն է ԱԱՀ-ի դրույքաչափը։',
];

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

  /** A question is in flight, or its answer is on screen. */
  const answering = busy || preview !== null;

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

  if (openAuth) {
    return (
      <div className="page">
        {/* The mark is the way back, exactly as it is the way home once you
            are signed in — and in the same corner, at the same size. */}
        <header className="provenance">
          <div className="masthead-top">
            <button className="brand" onClick={goHome}>
              {BRAND}
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
      reading column.

      The mark used to be a 42px centred title here and a 24px word in the
      top-left once signed in, so registering appeared to change which product
      you were looking at. Both doors keep the other end of the masthead line —
      someone who already has an account arrived to USE the tool, and making
      them type a question first is a toll on the likeliest paying customer.
    */
    <div className="page">
      <header className="provenance">
        <div className="masthead-top">
          <button className="brand" onClick={goHome}>
            {BRAND}
          </button>
          <span className="spacer" />
          <button className="landing-signin" onClick={() => openForm('signin')}>
            {t('auth.signIn')}
          </button>
          <button className="landing-signup" onClick={() => openForm('register')}>
            {t('auth.register')}
          </button>
        </div>
      </header>

      <div className="wrap landing">
        {/*
          Everything that introduces the page goes the moment a question is asked
          — the standing subtitle, the lede, the examples and the box itself. What
          the visitor wants from that point on is their answer, and a page still
          offering to explain itself underneath it is asking them to read an
          advertisement while their own question is being worked on.
        */}
        {answering ? (
          <div className="measure landing-thread">
            <div className="turn user">
              <div className="turn-role">{t('turn.question')}</div>
              <div className="turn-text">{askedText}</div>
            </div>
            {busy ? (
              <div className="stage">
                <span className="stage-who">{BRAND}</span>
                <span className="stage-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="stage-line">{t('preview.thinking')}</span>
              </div>
            ) : null}
          </div>
        ) : (
        <>
        <div className="login-head">
          <div className="login-sub">
            <BrandLine text={t('masthead.sub')} />
          </div>
        </div>

        <p className="landing-lede">{t('preview.lede')}</p>
        <div className="landing-examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="landing-example" onClick={() => void ask(e)} disabled={busy}>
              {e}
            </button>
          ))}
        </div>

        <div className="landing-ask">
          {/* Same arrow-inside-the-field as the signed-in composer, so the box a
              visitor meets first is the box they will use after registering. */}
          <div className="composer-field">
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
              placeholder={t('composer.first')}
              rows={3}
              disabled={busy}
            />
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
        </div>
        </>
        )}

        {error ? <div className="error measure">{error}</div> : null}

        {preview ? (
          <div className="measure preview">
            <div className="turn-role">{BRAND}</div>
            <div className="turn-text">
              <MarkdownView text={preview.shown} />
            </div>

            {preview.withheld > 0 ? (
              <div className="preview-gate">
                <div className="preview-cta">
                  <div className="preview-cta-text">
                    {t('preview.rest')}
                    {preview.sources > 0 ? (
                      <span className="preview-sources">
                        {' '}
                        · {preview.sources} {t('preview.sources')}
                      </span>
                    ) : null}
                  </div>
                  <button className="preview-cta-button" onClick={() => openForm('register')}>
                    {t('preview.unlock')}
                  </button>
                  <div className="preview-cta-note">{t('preview.free')}</div>
                </div>

                {/*
                  Behind the prompt, which sits on it as a card: the offer is
                  what the visitor needs to read, and the blurred text showing
                  around its edges is the evidence that there is more behind
                  it. First in the markup regardless, so a screen reader reaches
                  the offer and never the decoration. See `blurLines` for why
                  this is reordered words rather than the withheld text itself.
                */}
                <div className="preview-blur" aria-hidden="true">
                  {blurLines(preview.shown).map((line, i) => (
                    <span key={i}>{line}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

      </div>
    </div>
  );
}
