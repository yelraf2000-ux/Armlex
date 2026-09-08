/**
 * The page a reset link lands on: choose a new password.
 *
 * Signs in on success. They have just proved they read the mailbox AND chosen
 * the password — sending them back to a form to type it again proves nothing
 * and offers one more chance to mistype it.
 */
import { useState } from 'react';
import { BRAND } from './brand.js';
import { useSettings } from './Settings.js';

const MIN_PASSWORD = 8;

export function Reset({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = useSettings();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Diverges, not merely shorter — a confirmation still a prefix is unfinished. */
  const mismatch = confirm !== '' && !password.startsWith(confirm);
  const ready = password.length >= MIN_PASSWORD && confirm === password;

  async function submit(): Promise<void> {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/reset/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword('');
        setConfirm('');
        // The token is spent, and leaving it in history or a Referer header
        // would be careless with a credential that granted account access.
        window.history.replaceState(null, '', '/');
        onDone();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        body.error === 'expired'
          ? t('reset.expired')
          : body.error === 'already_used'
            ? t('reset.used')
            : body.error === 'weak_password'
              ? t('auth.weakPassword')
              : t('reset.invalid'),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <div className="login-head">
        <h1 className="login-title">{BRAND}</h1>
        <div className="masthead-rule" />
      </div>

      <p className="login-note">{t('reset.chooseNew')}</p>

      <div className="login-row">
        <label htmlFor="reset-pw">{t('login.password')}</label>
        <div className="password-box">
          <input
            id="reset-pw"
            type={reveal ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            autoFocus
          />
          <button
            type="button"
            className="password-eye"
            onClick={() => setReveal(!reveal)}
            aria-label={reveal ? t('auth.hidePassword') : t('auth.showPassword')}
            aria-pressed={reveal}
            tabIndex={-1}
          >
            <svg width="19" height="19" viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M1.8 10S5 4.8 10 4.8 18.2 10 18.2 10 15 15.2 10 15.2 1.8 10 1.8 10z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle cx="10" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
              {reveal ? (
                <path d="M3.4 3.4 16.6 16.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
              ) : null}
            </svg>
          </button>
        </div>

        <label htmlFor="reset-pw2">{t('auth.confirmPassword')}</label>
        <input
          id="reset-pw2"
          type={reveal ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />

        {mismatch ? <div className="error">{t('auth.passwordMismatch')}</div> : null}
        {error ? <div className="error">{error}</div> : null}

        <button onClick={() => void submit()} disabled={busy || !ready}>
          {busy ? '…' : t('reset.save')}
        </button>
      </div>

      <button className="linkish" onClick={() => window.location.assign('/')}>
        {t('auth.verify.toSignIn')}
      </button>
    </div>
  );
}
