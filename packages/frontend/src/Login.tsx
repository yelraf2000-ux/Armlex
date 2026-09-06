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
  user: {
    id: string;
    email: string;
    name: string | null;
    plan: string;
    companyName: string | null;
    companySize: string | null;
  } | null;
  usage?: { used: number; limit: number | null; remaining: number | null };
  /** False when the server has no Google credentials — then the button is not offered. */
  google?: boolean;
}

export type Tab = 'signin' | 'register';

/** The sizes the form offers — mirrors the CHECK constraint on the column. */
export const COMPANY_SIZES = ['1-5', '5-10', '10-30', '30+'] as const;

/** Held across the Google redirect, which leaves the page and loses component state. */
export const PENDING_PROFILE = 'matyan.pendingProfile';

interface Profile {
  fullName: string;
  companyName: string;
  companySize: string;
}

/** Kept in step with the server; the form promises these numbers to the user. */
export const MAX_INVITES = 4;
export const BONUS_FOR_INVITING = 10;
export const BONUS_PER_ACCEPTED = 5;

interface Invite {
  name: string;
  email: string;
}

/**
 * Starts at ONE row, not four.
 *
 * Four empty boxes read as four things being asked for, and an optional step
 * that looks like work gets skipped. One row with a way to add another asks for
 * as little as the offer allows, and the reward appears beside an address the
 * moment it could be earned.
 */
const ONE_INVITE: Invite[] = [{ name: '', email: '' }];

/** Same shape the server accepts; used only to decide when to show the reward. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function Login({
  onSuccess,
  googleEnabled,
  initialTab,
}: {
  onSuccess: () => void;
  googleEnabled?: boolean | undefined;
  /** Which tab opens first. A visitor arriving from "register and see it all"
   *  must land on Register — sending them to Sign in contradicts the button
   *  they just pressed. */
  initialTab?: Tab | undefined;
}) {
  const { t } = useSettings();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Registration is two steps: who you are, then how to sign in.
   *
   * The profile comes first because it is the easier half — a name and a
   * company are typed without deciding anything, while choosing a password is
   * the moment a person hesitates. Putting the easy half first means the
   * hesitation happens after they have already invested something.
   *
   * It is also the only moment anyone will answer "how big is your firm", and
   * that answer maps a signup straight onto a pricing tier.
   */
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [profile, setProfile] = useState<Profile>({
    fullName: '',
    companyName: '',
    companySize: '',
  });

  /**
   * Step 2: colleagues to invite. Optional, and visibly so.
   *
   * Four empty rows rather than an "add another" button — the offer is worth
   * more when the ceiling is visible, and a person deciding whether to bother
   * can see the whole cost of bothering at once.
   */
  const [invites, setInvites] = useState<Invite[]>(ONE_INVITE);
  const filledInvites = invites.filter((i) => LOOKS_LIKE_EMAIL.test(i.email.trim()));

  const profileComplete =
    profile.fullName.trim() !== '' &&
    profile.companyName.trim() !== '' &&
    profile.companySize !== '';

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
            : {
                email: email.trim(),
                password,
                name: profile.fullName.trim() || undefined,
                companyName: profile.companyName.trim() || undefined,
                companySize: profile.companySize || undefined,
                invites: filledInvites.map((i) => ({
                  email: i.email.trim(),
                  name: i.name.trim() || undefined,
                })),
                // Attributes the signup to the teaser that produced it.
                previewId: sessionStorage.getItem('matyan.pendingPreview') ?? undefined,
              },
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

      {/* Step 1 of registration: who you are and how big your firm is. */}
      {tab === 'register' && step === 1 ? (
        <div className="login-row">
          <label htmlFor="armlex-name">
            {t('auth.fullName')} <span className="req">*</span>
          </label>
          <input
            id="armlex-name"
            type="text"
            autoComplete="name"
            autoFocus
            value={profile.fullName}
            onChange={(e) => setProfile((p) => ({ ...p, fullName: e.target.value }))}
          />

          <label htmlFor="armlex-company">
            {t('auth.companyName')} <span className="req">*</span>
          </label>
          <input
            id="armlex-company"
            type="text"
            autoComplete="organization"
            value={profile.companyName}
            onChange={(e) => setProfile((p) => ({ ...p, companyName: e.target.value }))}
          />

          <span className="login-label">
            {t('auth.companySize')} <span className="req">*</span>
          </span>
          {/*
            Buttons rather than a <select>: four options is few enough to show
            at once, and a dropdown hides the range someone is choosing between
            until they open it.
          */}
          <div className="size-options" role="radiogroup" aria-label={t('auth.companySize')}>
            {COMPANY_SIZES.map((size) => (
              <button
                key={size}
                type="button"
                role="radio"
                aria-checked={profile.companySize === size}
                className={profile.companySize === size ? 'size-option on' : 'size-option'}
                onClick={() => setProfile((p) => ({ ...p, companySize: size }))}
              >
                {size === '30+' ? '30+' : size}
              </button>
            ))}
          </div>

          {/*
            Placed under the size selector rather than above the form: this is
            where the question actually occurs to someone, and a paragraph of
            reassurance before they have started typing is friction answering a
            doubt they do not have yet.

            Says what the answers are FOR, not that they improve an
            "experience". This audience verifies things for a living, and the
            vague version of this sentence is the one they have learned to skim
            past.
          */}
          <p className="login-why">{t('auth.whyWeAsk')}</p>

          <button
            onClick={() => {
              setError(null);
              setStep(2);
            }}
            disabled={!profileComplete}
          >
            {t('auth.next')}
          </button>
        </div>
      ) : null}

      {/* Step 2: invite colleagues. Optional, and the skip is a real button. */}
      {tab === 'register' && step === 2 ? (
        <div className="login-row">
          <p className="invite-offer">
            {t('auth.inviteOffer')
              .replace('{n}', String(BONUS_FOR_INVITING))
              .replace('{m}', String(BONUS_PER_ACCEPTED))}
          </p>

          <div className="invite-rows">
            {invites.map((invite, i) => (
              <div className="invite-row" key={i}>
                <input
                  type="text"
                  aria-label={`${t('auth.fullName')} ${i + 1}`}
                  placeholder={t('auth.fullName')}
                  value={invite.name}
                  onChange={(e) =>
                    setInvites((list) =>
                      list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
                <input
                  type="email"
                  aria-label={`${t('auth.email')} ${i + 1}`}
                  placeholder={t('auth.email')}
                  value={invite.email}
                  onChange={(e) =>
                    setInvites((list) =>
                      list.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)),
                    )
                  }
                />
                {/*
                  The reward appears beside the address that would earn it, the
                  moment it could be earned. A total at the bottom would say the
                  same thing while making the reader do the attribution.
                */}
                <span className="invite-bonus" aria-hidden={!LOOKS_LIKE_EMAIL.test(invite.email.trim())}>
                  {LOOKS_LIKE_EMAIL.test(invite.email.trim()) ? `+${BONUS_PER_ACCEPTED}` : ''}
                </span>
              </div>
            ))}
          </div>

          {invites.length < MAX_INVITES ? (
            <button
              className="invite-add"
              onClick={() => setInvites((list) => [...list, { name: '', email: '' }])}
            >
              + {t('auth.inviteAnother')}
            </button>
          ) : null}

          {/*
            Says what will actually happen. The +5 lands when the colleague
            registers, not when the address is typed — promising it up front
            would be a number the product then has to take back.
          */}
          <p className="login-why">
            {t('auth.inviteNote').replace('{m}', String(BONUS_PER_ACCEPTED))}
          </p>

          <button onClick={() => setStep(3)}>
            {filledInvites.length > 0
              ? t('auth.next')
              : t('auth.skip')}
          </button>

          <button className="linkish" onClick={() => setStep(1)}>
            {t('auth.backStep')}
          </button>
        </div>
      ) : null}

      {/* Step 2, and the whole of sign-in: the credentials. */}
      {tab === 'register' && step !== 3 ? null : (
      <div className="login-row">
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

        {tab === 'register' ? (
          <button className="linkish" onClick={() => setStep(2)}>
            {t('auth.backStep')}
          </button>
        ) : null}

        {googleEnabled ? (
          <>
            <div className="login-or">{t('auth.or')}</div>
            {/*
              A link, not a fetch: OAuth is a browser redirect to Google and
              back. The profile is stashed first, because that redirect destroys
              component state — `App` posts it to /api/auth/profile once the
              account exists on the other side.
            */}
            <a
              className="login-google"
              href="/api/auth/google"
              onClick={() => {
                if (tab === 'register' && profileComplete) {
                  sessionStorage.setItem(PENDING_PROFILE, JSON.stringify(profile));
                }
              }}
            >
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

      )}

      <div className="login-disclaimer">{t('corpus.disclaimer')}</div>
    </div>
  );
}
