/**
 * Sign in, or create an account.
 *
 * Replaces the shared-password gate. That gate was never about privacy — it
 * was about money, since every answer spends API credit — and accounts keep
 * that protection through a monthly allowance per user rather than a secret
 * everybody shares.
 *
 * Still a title page rather than a bare form: the first thing anyone sees of
 * the edition should say what it is.
 */
import { useState } from 'react';
import { BRAND } from './brand.js';
import { useSettings } from './Settings.js';

export interface Account {
  user: { id: string; email: string; name: string | null; plan: string } | null;
  usage?: { used: number; limit: number | null; remaining: number | null };
  /** False when the server has no Google credentials — then the button is not offered. */
  google?: boolean;
}

type Tab = 'signin' | 'register';

export function Login({
  onSuccess,
  googleEnabled,
}: {
  onSuccess: () => void;
  googleEnabled?: boolean | undefined;
}) {
  const { t } = useSettings();
  const [tab, setTab] = useState<Tab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Server error codes are stable; the message the user reads is translated. */
  function messageFor(code: string, status: number): string {
    switch (code) {
      case 'bad_credentials':
        return t('auth.badCredentials');
      case 'email_taken':
        return t('auth.emailTaken');
      case 'weak_password':
        return t('auth.weakPassword');
      case 'invalid_email':
        return t('auth.invalidEmail');
      default:
        return `HTTP ${status}`;
    }
  }

  async function submit(): Promise<void> {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(tab === 'signin' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          tab === 'signin'
            ? { email: email.trim(), password }
            : { email: email.trim(), password, name: name.trim() || undefined },
        ),
      });
      if (res.ok) {
        setPassword('');
        onSuccess();
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(messageFor(body.error ?? '', res.status));
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
        <div className="login-sub">{t('masthead.sub')}</div>
        <div className="masthead-rule" />
      </div>

      <div className="login-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'signin'}
          className={tab === 'signin' ? 'on' : ''}
          onClick={() => {
            setTab('signin');
            setError(null);
          }}
        >
          {t('auth.signIn')}
        </button>
        <button
          role="tab"
          aria-selected={tab === 'register'}
          className={tab === 'register' ? 'on' : ''}
          onClick={() => {
            setTab('register');
            setError(null);
          }}
        >
          {t('auth.register')}
        </button>
      </div>

      <p className="login-note">{tab === 'signin' ? t('auth.signInNote') : t('auth.registerNote')}</p>

      <div className="login-row">
        {tab === 'register' ? (
          <>
            <label htmlFor="armlex-name">{t('auth.name')}</label>
            <input
              id="armlex-name"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </>
        ) : null}

        <label htmlFor="armlex-email">{t('auth.email')}</label>
        <input
          id="armlex-email"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />

        <label htmlFor="armlex-password">{t('login.password')}</label>
        <input
          id="armlex-password"
          type="password"
          autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />

        {error ? <div className="error">{error}</div> : null}

        <button onClick={() => void submit()} disabled={busy || !email.trim() || !password}>
          {busy ? '…' : tab === 'signin' ? t('login.enter') : t('auth.createAccount')}
        </button>

        {googleEnabled ? (
          <>
            <div className="login-or">{t('auth.or')}</div>
            {/* A link, not a fetch: OAuth is a browser redirect to Google and back. */}
            <a className="login-google" href="/api/auth/google">
              <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.6 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.94v2.33A9 9 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.94a9 9 0 0 0 0 8.1l3.03-2.33z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .94 4.95l3.03 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
              </svg>
              {t('auth.google')}
            </a>
          </>
        ) : null}
      </div>

      <div className="login-disclaimer">{t('corpus.disclaimer')}</div>
    </div>
  );
}
