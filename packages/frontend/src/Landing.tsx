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
import { useState } from 'react';
import { BRAND } from './brand.js';
import { Login } from './Login.js';
import { MarkdownView } from './MarkdownView.js';
import { useSettings } from './Settings.js';

export const PENDING_QUESTION = 'matyan.pendingQuestion';
export const PENDING_PREVIEW = 'matyan.pendingPreview';

interface PreviewResult {
  id: string;
  shown: string;
  withheld: number;
  sources: number;
  coverage: string | null;
}

/** Three real questions, from the harvested set — not invented marketing copy. */
const EXAMPLES = [
  'Շաուրմայի կետ եմ բացում մարզում։ Կարո՞ղ եմ միկրոձեռնարկատիրություն ընտրել։',
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
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAuth, setShowAuth] = useState(false);

  async function ask(q: string): Promise<void> {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    setPreview(null);
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
        if (res.status === 429) setShowAuth(true);
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

  if (showAuth) {
    return (
      <div className="wrap">
        <Login googleEnabled={googleEnabled} onSuccess={onAuthed} initialTab="register" />
        <div className="measure landing-back">
          <button className="linkish" onClick={() => setShowAuth(false)}>
            {t('preview.back')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wrap landing">
      <div className="login-head">
        <h1 className="login-title">{BRAND}</h1>
        <div className="login-sub">{t('masthead.sub')}</div>
        <div className="masthead-rule" />
      </div>

      {preview ? null : (
        <>
          <p className="landing-lede">{t('preview.lede')}</p>
          <div className="landing-examples">
            {EXAMPLES.map((e) => (
              <button key={e} className="landing-example" onClick={() => void ask(e)} disabled={busy}>
                {e}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="landing-ask">
        <textarea
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
        <button onClick={() => void ask(question)} disabled={busy || !question.trim()}>
          {busy ? t('preview.thinking') : t('preview.ask')}
        </button>
      </div>

      {error ? <div className="error measure">{error}</div> : null}

      {preview ? (
        <div className="measure preview">
          <div className="turn-role">{BRAND}</div>
          <div className="turn-text">
            <MarkdownView text={preview.shown} />
          </div>

          {preview.withheld > 0 ? (
            <div className="preview-gate">
              {/*
                Real withheld text would be readable in the DOM, so the blur is
                drawn rather than applied to the answer: repeated lines of the
                right shape, carrying no content at all.
              */}
              <div className="preview-blur" aria-hidden="true">
                {[92, 100, 78, 96, 64].map((w, i) => (
                  <span key={i} style={{ width: `${w}%` }} />
                ))}
              </div>

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
                <button className="preview-cta-button" onClick={() => setShowAuth(true)}>
                  {t('preview.unlock')}
                </button>
                <div className="preview-cta-note">{t('preview.free')}</div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="login-disclaimer">{t('corpus.disclaimer')}</div>
    </div>
  );
}
