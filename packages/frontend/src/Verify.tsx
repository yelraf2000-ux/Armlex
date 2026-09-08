/**
 * The page a verification link lands on.
 *
 * Spends the token once and, on success, is already signed in — the server
 * sets the session cookie in the same response. Sending someone back to a
 * sign-in form after they proved both their password (set minutes ago) and
 * their address would be a step that proves nothing.
 */
import { useEffect, useRef, useState } from 'react';
import { BRAND } from './brand.js';
import { useSettings } from './Settings.js';

type State = 'working' | 'done' | 'invalid' | 'expired' | 'already_used' | 'failed';

export function Verify({ token, onVerified }: { token: string; onVerified: () => void }) {
  const { t } = useSettings();
  const [state, setState] = useState<State>('working');

  /*
   * StrictMode runs effects twice in development, and this effect SPENDS a
   * single-use token. Without the guard the second run consumes the row the
   * first one just used and the page reports `already_used` for a link that
   * worked perfectly — a bug that appears only in dev and looks exactly like
   * a real one.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void (async () => {
      try {
        const res = await fetch(`/api/auth/verify/${encodeURIComponent(token)}`, {
          method: 'POST',
        });
        if (res.ok) {
          setState('done');
          // Drop the token out of the address bar before anything else. It is
          // spent, but it would otherwise sit in history, in a screenshot, and
          // in whatever the next page sends as a Referer.
          window.history.replaceState(null, '', '/');
          onVerified();
          return;
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState(
          body.error === 'expired' || body.error === 'already_used' || body.error === 'invalid'
            ? body.error
            : 'failed',
        );
      } catch {
        setState('failed');
      }
    })();
  }, [token, onVerified]);

  const message: Record<State, string> = {
    working: t('auth.verify.working'),
    done: t('auth.verify.working'),
    invalid: t('auth.verify.invalid'),
    expired: t('auth.verify.expired'),
    already_used: t('auth.verify.alreadyUsed'),
    failed: t('auth.verify.invalid'),
  };

  return (
    <div className="login">
      <div className="login-head">
        <h1 className="login-title">{BRAND}</h1>
        <div className="masthead-rule" />
      </div>
      <div className="login-row">
        <p className="login-verify-body">{message[state]}</p>
        {state !== 'working' && state !== 'done' ? (
          <button onClick={() => window.location.assign('/')}>{t('auth.verify.toSignIn')}</button>
        ) : null}
      </div>
    </div>
  );
}
