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
  /** The FIRM's pool, shared by everyone in the workspace — not a per-seat quota. */
  usage?: { used: number; limit: number | null; remaining?: number | null };
  /**
   * The caller's role in their workspace. Decides whether the upgrade route is
   * offered at all: the subscription belongs to the firm, and a member who
   * cannot buy it should not be sent to a checkout that is not theirs.
   */
  role?: 'admin' | 'member';
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

/**
 * The password field, with a reveal toggle.
 *
 * A password box that cannot be read back is the reason people mistype one and
 * then cannot tell why the form rejects them — and the confirm field below only
 * catches the typo, it never shows what the typo WAS. The eye does.
 *
 * One toggle governs both fields deliberately: the confirm box exists to be
 * compared against the first, and revealing half of a comparison is half a
 * check.
 */
function PasswordBox({
  id,
  value,
  onChange,
  onEnter,
  label,
  autoComplete,
  reveal,
  onToggle,
  revealLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  label: string;
  autoComplete: string;
  reveal: boolean;
  onToggle: () => void;
  revealLabel: string;
}) {
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-box">
        <input
          id={id}
          type={reveal ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEnter();
          }}
        />
        {/*
          type="button" matters: inside a form this would otherwise submit, and
          pressing the eye would send a half-typed password.
        */}
        <button
          type="button"
          className="password-eye"
          onClick={onToggle}
          aria-label={revealLabel}
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
    </>
  );
}

export function Login({
  onSuccess,
  googleEnabled,
  initialTab,
  initialError,
}: {
  onSuccess: () => void;
  googleEnabled?: boolean | undefined;
  /** An outcome from the OAuth round trip, which has no other way back here —
   *  the redirect destroys component state, so it arrives as a query
   *  parameter and is handed in already translated. */
  initialError?: string | undefined;
  /** Which tab opens first. A visitor arriving from "register and see it all"
   *  must land on Register — sending them to Sign in contradicts the button
   *  they just pressed. */
  initialTab?: Tab | undefined;
}) {
  const { t, lang } = useSettings();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'signin');
  /**
   * Set when an address needs proving. Replaces the whole form rather than
   * sitting beside it: the next act is in their inbox, and leaving the fields
   * on screen invites a second registration with the same address, which only
   * earns them `email_taken`.
   *
   * Reached from BOTH directions — a fresh registration, and a sign-in by
   * someone who registered earlier and never clicked. The second is the more
   * common one in practice, because it is the person who closed the tab.
   */
  const [pending, setPending] = useState<{ email: string; sent: boolean } | null>(null);
  const [resent, setResent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * The OAuth outcome is kept APART from the form's own error.
   *
   * Form errors render beside the submit button, which on the register tab
   * only exists at step 3 — so seeding that state with an arrival message left
   * it invisible for anyone landing on step 1, which is exactly where
   * no_account sends them. This one renders under the note instead, above
   * whichever step is showing.
   */
  const [arrival, setArrival] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);

  /**
   * Registration is three steps: who you are, who you would invite, then how
   * to sign in.
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
   */
  const [invites, setInvites] = useState<Invite[]>(ONE_INVITE);
  const filledInvites = invites.filter((i) => LOOKS_LIKE_EMAIL.test(i.email.trim()));

  /**
   * Complain when a typed character DIVERGES, not merely when the second field
   * is shorter than the first.
   *
   * `confirm !== password` is true from the very first keystroke, so it marks
   * every half-typed entry as wrong and trains people to ignore the message by
   * the time it means something. A confirmation that is still a prefix of the
   * password is unfinished, not mistaken; one that is not a prefix cannot
   * become correct by typing more, and saying so at that moment is the earliest
   * the warning is honest. (A longer-than-password entry is not a prefix
   * either, so this covers the overrun case too.)
   */
  const mismatch = tab === 'register' && confirm !== '' && !password.startsWith(confirm);
  const credentialsReady =
    email.trim() !== '' && password !== '' && (tab === 'signin' || confirm === password);

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
    if (busy || !credentialsReady) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(tab === 'signin' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          tab === 'signin'
            ? { email: email.trim(), password, lang }
            : {
                email: email.trim(),
                password,
                // Decides which language the verification mail is written in.
                // The account has no stored preference yet — this request is
                // the only place that knowledge exists.
                lang,
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
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        needsVerification?: boolean;
        verificationSent?: boolean;
        email?: string;
      };

      if (res.ok) {
        setPassword('');
        setConfirm('');
        // A 200 that withholds the session. Registration succeeded; the
        // account is simply not usable until the address is proved.
        if (body.needsVerification) {
          setPending({ email: body.email ?? email.trim(), sent: body.verificationSent !== false });
          return;
        }
        onSuccess();
        return;
      }

      // Right password, unproved address. Not an error to correct — a step to
      // finish — so it opens the same panel rather than reddening the form.
      if (res.status === 403 && body.error === 'email_unverified') {
        setPassword('');
        setPending({ email: body.email ?? email.trim(), sent: true });
        return;
      }

      setError(messageFor(body.error ?? '', res.status));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend(): Promise<void> {
    if (!pending || busy) return;
    setBusy(true);
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pending.email, lang }),
      });
      // The route answers `ok` whether or not the address exists, so there is
      // nothing here to branch on — and nothing worth telling the user apart,
      // since the honest message for both is "if that address is waiting, a
      // link is on its way".
      setPending({ ...pending, sent: true });
      setResent(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <div className="login">
        <div className="login-head">
          <h1 className="login-title">{BRAND}</h1>
          <div className="login-sub">{t('masthead.sub')}</div>
          <div className="masthead-rule" />
        </div>
        <div className="login-row">
          <h2 className="login-verify-title">{t('auth.verify.title')}</h2>
          <p className="login-verify-body">{t('auth.verify.body')}</p>
          <p className="login-verify-email">{pending.email}</p>

          {!pending.sent ? <div className="error">{t('auth.verify.sendFailed')}</div> : null}
          {error ? <div className="error">{error}</div> : null}

          <p className="login-verify-hint">{t('auth.verify.hint')}</p>

          <button disabled={busy || resent} onClick={() => void resend()}>
            {busy ? '…' : resent ? t('auth.verify.resent') : t('auth.verify.resend')}
          </button>
        </div>

        <button
          className="linkish"
          onClick={() => {
            setPending(null);
            setResent(false);
            setError(null);
            setTab('signin');
          }}
        >
          {t('auth.verify.toSignIn')}
        </button>
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

      <div className="login-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'signin'}
          className={tab === 'signin' ? 'on' : ''}
          onClick={() => {
            setTab('signin');
            setError(null);
            // The arrival message described the door they came from, not the
            // one they just chose.
            setArrival(null);
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
            setArrival(null);
          }}
        >
          {t('auth.register')}
        </button>
      </div>

      <p className="login-note">{tab === 'signin' ? t('auth.signInNote') : t('auth.registerNote')}</p>

      {/*
        Why the Google round trip sent them back. Sits here, above the steps,
        because the form's own errors live beside the submit button — which on
        the register tab does not exist until step 3, and `no_account` lands
        them on step 1.
      */}
      {arrival ? <div className="error">{arrival}</div> : null}

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

      {/* Step 3, and the whole of sign-in: the credentials. */}
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

        <PasswordBox
          id="armlex-password"
          label={t('login.password')}
          autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
          value={password}
          onChange={setPassword}
          onEnter={() => void submit()}
          reveal={reveal}
          onToggle={() => setReveal((r) => !r)}
          revealLabel={reveal ? t('auth.hidePassword') : t('auth.showPassword')}
        />

        {tab === 'register' ? (
          <PasswordBox
            id="armlex-password-confirm"
            label={t('auth.confirmPassword')}
            autoComplete="new-password"
            value={confirm}
            onChange={setConfirm}
            onEnter={() => void submit()}
            reveal={reveal}
            onToggle={() => setReveal((r) => !r)}
            revealLabel={reveal ? t('auth.hidePassword') : t('auth.showPassword')}
          />
        ) : null}

        {mismatch ? <div className="error">{t('auth.passwordMismatch')}</div> : null}
        {error ? <div className="error">{error}</div> : null}

        <button onClick={() => void submit()} disabled={busy || !credentialsReady}>
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
            {/*
              The intent travels so the server knows which door this was. From
              here it is only a hint — it is re-signed into the OAuth state and
              verified on the way back, because a query parameter the user can
              edit is no basis for deciding who may create an account.
            */}
            <a
              className="login-google"
              href={`/api/auth/google?intent=${tab === 'register' ? 'register' : 'signin'}`}
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
