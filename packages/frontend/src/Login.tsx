/**
 * Password gate.
 *
 * One shared password, no accounts. The point is not privacy — it is that every
 * answer spends real API credit, so an open URL is a bill anyone can run up.
 */
import { useState } from 'react';
import { BRAND } from './brand.js';
import { useSettings } from './Settings.js';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useSettings();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword('');
        onSuccess();
        return;
      }
      setError(res.status === 401 ? t('login.wrong') : `HTTP ${res.status}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // A title page rather than a login form: the first thing anyone sees of the
    // edition should say what it is and how current it is.
    <div className="login">
      <div className="login-head">
        <h1 className="login-title">{BRAND}</h1>
        <div className="login-sub">{t('masthead.sub')}</div>
        <div className="masthead-rule" />
      </div>

      <p className="login-note">{t('login.note')}</p>

      <div className="login-row">
        <label htmlFor="armlex-password">{t('login.password')}</label>
        <input
          id="armlex-password"
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        {error ? <div className="error">{error}</div> : null}
        <button onClick={() => void submit()} disabled={busy || !password}>
          {busy ? '…' : t('login.enter')}
        </button>
      </div>

      <div className="login-disclaimer">{t('corpus.disclaimer')}</div>
    </div>
  );
}
