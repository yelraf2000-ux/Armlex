/**
 * Accepting an invitation: a password, and nothing else.
 *
 * The address and the name were typed by the colleague who sent this. Asking
 * the invitee to retype them would be work that produces nothing — and worse,
 * it would let them enter a different address than the one invited, which
 * silently applies the invitation to nobody.
 *
 * Both are shown, not hidden: someone should be able to see whose invitation
 * they are accepting and to what address, before they choose a password for it.
 */
import { useEffect, useState } from 'react';
import { BRAND } from './brand.js';
import { useSettings } from './Settings.js';

interface InvitationView {
  email: string;
  name: string | null;
  inviter: string;
  workspace: string | null;
}

const MIN_PASSWORD = 8;

export function Invite({ token, onAccepted }: { token: string; onAccepted: () => void }) {
  const { t, lang } = useSettings();
  const [view, setView] = useState<InvitationView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'gone'>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/invite/${encodeURIComponent(token)}`);
        if (!res.ok) return setState('gone');
        setView((await res.json()) as InvitationView);
        setState('ready');
      } catch {
        setState('gone');
      }
    })();
  }, [token]);

  /*
   * Same rule as the registration form: complain when a typed character
   * DIVERGES, not merely when the second field is shorter than the first. A
   * confirmation that is still a prefix is unfinished, not wrong.
   */
  const mismatch = confirm !== '' && !password.startsWith(confirm);
  const ready = password.length >= MIN_PASSWORD && confirm === password;

  async function submit(): Promise<void> {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, lang }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        needsVerification?: boolean;
        email?: string;
      };

      if (res.ok) {
        setPassword('');
        setConfirm('');
        // The account exists but is not usable yet: a workspace seat is exactly
        // the thing worth proving the mailbox for, so the same gate applies.
        if (body.needsVerification) return setSent(body.email ?? view?.email ?? '');
        onAccepted();
        return;
      }
      setError(
        body.error === 'email_taken'
          ? t('auth.emailTaken')
          : body.error === 'weak_password'
            ? t('auth.weakPassword')
            : t('invite.failed'),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="login">
        <div className="login-head">
          <h1 className="login-title">{BRAND}</h1>
          <div className="masthead-rule" />
        </div>
        <p className="login-verify-body">{t('invite.loading')}</p>
      </div>
    );
  }

  if (state === 'gone') {
    return (
      <div className="login">
        <div className="login-head">
          <h1 className="login-title">{BRAND}</h1>
          <div className="masthead-rule" />
        </div>
        <div className="login-row">
          <p className="login-verify-body">{t('invite.gone')}</p>
          <button onClick={() => window.location.assign('/')}>{t('auth.verify.toSignIn')}</button>
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="login">
        <div className="login-head">
          <h1 className="login-title">{BRAND}</h1>
          <div className="masthead-rule" />
        </div>
        <div className="login-row">
          <h2 className="login-verify-title">{t('auth.verify.title')}</h2>
          <p className="login-verify-body">{t('auth.verify.body')}</p>
          <p className="login-verify-email">{sent}</p>
          <p className="login-verify-hint">{t('invite.thenMember')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="login-head">
        <h1 className="login-title">{BRAND}</h1>
        <div className="login-sub">{t('masthead.sub')}</div>
        <div className="masthead-rule" />
      </div>

      <p className="login-note">
        {view?.inviter
          ? `${view.inviter} — ${t('invite.invitedYou')}`
          : t('invite.invitedYou')}
      </p>

      <div className="login-row">
        {/* Read-only, and visibly so: these are the colleague's answers, not a
            form to fill. Shown rather than hidden so the invitee can see whose
            invitation this is and which address it binds to. */}
        <label>{t('auth.email')}</label>
        <p className="login-verify-email">{view?.email}</p>
        {view?.name ? (
          <>
            <label>{t('auth.fullName')}</label>
            <p className="invite-given">{view.name}</p>
          </>
        ) : null}
        {view?.workspace ? (
          <>
            <label>{t('ws.members')}</label>
            <p className="invite-given">{view.workspace}</p>
          </>
        ) : null}

        <label htmlFor="invite-pw">{t('login.password')}</label>
        <div className="password-box">
          <input
            id="invite-pw"
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

        <label htmlFor="invite-pw2">{t('auth.confirmPassword')}</label>
        <input
          id="invite-pw2"
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
          {busy ? '…' : t('invite.accept')}
        </button>
      </div>

      <div className="login-disclaimer">{t('corpus.disclaimer')}</div>
    </div>
  );
}
