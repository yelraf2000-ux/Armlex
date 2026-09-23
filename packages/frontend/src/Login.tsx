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
import { useEffect, useRef, useState } from 'react';
import { BRAND } from './brand.js';
import { BrandLine } from './BrandLine.js';
import { BrandMark } from './BrandMark.js';
import { useSettings } from './Settings.js';
import { track } from './analytics.js';

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
  /** The firm. Analytics groups people by it; nothing in the UI reads it. */
  workspaceId?: string;
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
/** The weekly questions the person who registers brings to the firm's pool. */
export const CREATOR_ALLOWANCE = 5;
/** What each colleague who joins adds to the firm's weekly questions — their seat. */
export const SEAT_PER_COLLEAGUE = 5;

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
 * An outlined field whose label sits inside it until there is something to
 * make room for, then rides up onto the top border.
 *
 * The label is a real <label> in both positions, so it is what a screen reader
 * announces and what a click on it focuses — a placeholder would vanish the
 * moment someone typed, and take the only statement of what the box is for
 * with it. The single-space placeholder is not decoration: `:placeholder-shown`
 * is how the CSS tells an empty field from a filled one without any script.
 *
 * The label comes AFTER the input in the markup so the CSS can reach it with a
 * sibling selector; it is positioned back on top of the field.
 */
function Field({
  id,
  label,
  required,
  ...input
}: {
  id: string;
  label: string;
  required?: boolean;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <input id={id} placeholder=" " {...input} />
      <label htmlFor={id}>
        {label}
        {required ? <span className="req"> *</span> : null}
      </label>
    </div>
  );
}

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
      <div className="field password-box">
        <input
          id={id}
          type={reveal ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder=" "
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEnter();
          }}
        />
        <label htmlFor={id}>{label}</label>
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
  onTabChange,
  onHome,
  fromPreview,
}: {
  onSuccess: () => void;
  /** Back to the landing. Registration draws its own masthead, so it needs it. */
  onHome?: (() => void) | undefined;
  /** The visitor came from a preview, so registering opens that answer. */
  fromPreview?: boolean | undefined;
  /** The reader switched forms. The caller owns the address, so it moves it. */
  onTabChange?: ((tab: Tab) => void) | undefined;
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
  const { t } = useSettings();
  const [tab, setTab] = useState<Tab>(initialTab ?? 'signin');
  /* The address can change without this form doing anything — the back and
     forward buttons move between /login and /registration — so the tab follows
     it rather than keeping whichever it opened on. */
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);
  /** Switch forms, and tell whoever owns the address. */
  const switchTab = (next: Tab): void => {
    if (next !== tab) track('auth_tab_switched', { to: next });
    setTab(next);
    onTabChange?.(next);
  };
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
  /**
   * Set once a reset link has been asked for.
   *
   * The message deliberately does NOT say whether that address has an account.
   * The endpoint answers the same either way, and a screen that revealed what
   * the endpoint conceals would give the answer back.
   */
  const [forgotSent, setForgotSent] = useState(false);
  const [forgot, setForgot] = useState(false);
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
   * Which fields someone actually put something into, and how far they got.
   *
   * Reported once per field on the first CHANGE, never on focus: a focus fires
   * when the caret is tabbed through an empty box, and the question this
   * answers is where a person stopped typing, not where the caret passed.
   * Once per field, not per keystroke — an event per character would be a
   * transcript of what was typed, arriving one letter at a time.
   *
   * The value never travels. These boxes hold a person's name, their firm and
   * their colleagues' addresses; only the fact that the box was reached goes
   * out. `signup_step_done` already says who FINISHED a step, and these say
   * who started one and left, which is the half that was invisible.
   */
  const started = useRef<Set<string>>(new Set());
  const furthest = useRef<1 | 2 | 3>(1);
  /** Read by the unload handler, which is bound once and would otherwise see
      whichever tab the form opened on. */
  const tabRef = useRef(tab);
  tabRef.current = tab;
  /** Set when registration succeeds, so leaving afterwards is not abandoning. */
  const settled = useRef(false);

  function noteField(field: string): void {
    if (started.current.has(field)) return;
    started.current.add(field);
    track('auth_field_started', { tab, step, field });
  }

  useEffect(() => {
    if (step > furthest.current) furthest.current = step;
  }, [step]);

  /**
   * Where the form was left. Fires on the way out — a closed tab, a back
   * button, a navigation inside the app — but only if something was typed:
   * opening the form and leaving it untouched is already `auth_form_opened`
   * with nothing after it.
   *
   * `pagehide` rather than `beforeunload`: it fires for a tab restored from
   * the back/forward cache and on mobile, where `beforeunload` often does not.
   */
  useEffect(() => {
    function report(): void {
      if (settled.current || started.current.size === 0) return;
      settled.current = true;
      track('auth_abandoned', {
        tab: tabRef.current,
        step: furthest.current,
        fields_started: started.current.size,
        fields: [...started.current],
      });
    }
    window.addEventListener('pagehide', report);
    return () => {
      window.removeEventListener('pagehide', report);
      report();
    };
    // Bound once, for the life of the form: everything it reads is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Step 2: colleagues to invite. Optional, and visibly so.
   */
  const [invites, setInvites] = useState<Invite[]>(ONE_INVITE);
  /** A row nobody has typed in. Empty rows are simply not invitations. */
  const rowEmpty = (i: Invite): boolean => !i.name.trim() && !i.email.trim();
  /** A usable invitation: both a name and an address that looks like one. */
  const rowValid = (i: Invite): boolean =>
    Boolean(i.name.trim()) && LOOKS_LIKE_EMAIL.test(i.email.trim());
  const filledInvites = invites.filter(rowValid);
  /**
   * Whether Continue has been pressed over a half-filled row. Until then no
   * field is marked wrong — a row someone is still typing into is not an error
   * yet. After, the marks follow the fields live and clear as they are fixed.
   */
  const [inviteCheck, setInviteCheck] = useState(false);
  const invalidRows = invites.filter((i) => !rowEmpty(i) && !rowValid(i)).length;
  const lastInvite = invites[invites.length - 1];
  /** Another row only once the last one has something in it. */
  const canAddInvite =
    invites.length < MAX_INVITES && lastInvite !== undefined && !rowEmpty(lastInvite);

  /**
   * The step's only button.
   *
   * Nothing typed: it skips, because inviting is optional and a separate Skip
   * button beside a Continue button made the reader choose between two ways of
   * moving forward. Something typed: every non-empty row must be a name and a
   * real-looking address, or it stops and says so — silently dropping a row
   * with a typo would leave someone believing they had invited a colleague who
   * never hears about it.
   */
  function continueFromInvites(): void {
    // `selfInvited` can be true here only on the way BACK — the address is
    // typed at the next step — and then this is the step that can fix it.
    if (invalidRows > 0 || selfInvited) {
      setInviteCheck(true);
      return;
    }
    setInviteCheck(false);
    track('signup_step_done', { step: 'invites', invites: filledInvites.length });
    setStep(3);
  }

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

  /**
   * The address being registered is also on the invitation list.
   *
   * You cannot be your own colleague: the invitation would mail you a link to
   * join the firm you are creating, and the seat it offers is the one you are
   * sitting in. The two fields are a step apart — the colleagues at step 2,
   * your own address at step 3 — so this can only be judged here, and it is
   * judged live, both ways round, since the reader may fix it from either end.
   */
  const selfInvited =
    tab === 'register' &&
    email.trim() !== '' &&
    filledInvites.some((i) => i.email.trim().toLowerCase() === email.trim().toLowerCase());

  const credentialsReady =
    email.trim() !== '' &&
    password !== '' &&
    !selfInvited &&
    (tab === 'signin' || confirm === password);

  const profileComplete =
    profile.fullName.trim() !== '' &&
    profile.companyName.trim() !== '' &&
    profile.companySize !== '' &&
    // Shape only. Whether the address is free is the server's answer, and it
    // comes back at the end — see `submit`, which returns the reader here.
    LOOKS_LIKE_EMAIL.test(email.trim());

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
            ? { email: email.trim(), password }
            : {
                email: email.trim(),
                password,
                // Decides which language the verification mail is written in.
                // The account has no stored preference yet — this request is
                // the only place that knowledge exists.
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
        // Reached the end: leaving from here is finishing, not abandoning.
        settled.current = true;
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

      // Which wall people hit on the way in: a taken address, a short
      // password, a wrong one. The server records the successes.
      track('auth_failed', { tab, error: body.error ?? `http_${res.status}` });
      setError(messageFor(body.error ?? '', res.status));
      /*
        Refusals ABOUT THE ADDRESS go back to the address.

        It is typed at step 1 now, so «this address is already registered»
        would otherwise stand on a screen holding nothing but two password
        boxes — a correction with nothing to correct it in.
      */
      if (tab === 'register' && (body.error === 'email_taken' || body.error === 'invalid_email')) {
        setStep(1);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function askReset(): Promise<void> {
    if (busy || !LOOKS_LIKE_EMAIL.test(email.trim())) return;
    setBusy(true);
    setError(null);
    track('password_reset_requested');
    try {
      await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Nothing to branch on: the route answers `ok` for an unknown address
      // too, and showing anything else here would leak what it withholds.
      setForgotSent(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend(): Promise<void> {
    if (!pending || busy) return;
    setBusy(true);
    track('verification_resent');
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pending.email }),
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

  /**
   * The masthead registration draws for itself.
   *
   * Sign-in keeps the one the landing puts above it. Registration's first step
   * has no masthead at all — the mark sits inside its card — and the later
   * steps put it back, so only this component, which knows the step, can say
   * whether there is one.
   */
  const masthead =
    tab === 'register' ? (
      <header className="provenance lp-header">
        <div className="masthead-top">
          <button className="brand" onClick={onHome}>
            <BrandMark />
          </button>
        </div>
      </header>
    ) : null;

  const toSignIn = (): void => {
    switchTab('signin');
    setError(null);
    // The arrival message described the door they came from, not the one they
    // just chose.
    setArrival(null);
  };

  if (pending) {
    return (
      <>
        {masthead}
        <div className="login">
          <div className="login-head">
            {/* No mark of its own: it is in the masthead above, where it also
                sits once you are signed in. */}
            <div className="login-sub">
              <BrandLine text={t('masthead.sub')} />
            </div>
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
              switchTab('signin');
            }}
          >
            {t('auth.verify.toSignIn')}
          </button>
        </div>
      </>
    );
  }

  /*
    Why the Google round trip sent them back. Sits above the fields, because the
    form's own errors live beside the submit button — which on the register tab
    does not exist until step 3, and `no_account` lands them on step 1.
  */
  const arrivalNote = arrival ? <div className="error">{arrival}</div> : null;

  /*
    Step 3, and the whole of sign-in: the credentials.

    The address is asked for HERE when signing in and at step 1 when
    registering. It moved because the invitation step sits between them: with
    the address already known, a colleague row that repeats it is answered as
    it is typed, instead of a step later on a screen that has no such row on
    it. What stands here in its place is the address itself, and the way back
    to the field that holds it.
  */
  const credentials = (
    <div className="login-row">
      {tab === 'signin' ? (
        <Field
          id="armlex-email"
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => {
            noteField('email');
            setEmail(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
      ) : (
        <p className="reg-as">
          {t('reg.registeringAs')} <strong>{email.trim()}</strong>{' '}
          <button type="button" className="linkish" onClick={() => setStep(1)}>
            {t('reg.changeEmail')}
          </button>
        </p>
      )}

      <PasswordBox
        id="armlex-password"
        label={t('login.password')}
        autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
        value={password}
        onChange={(v) => {
          noteField('password');
          setPassword(v);
        }}
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
          onChange={(v) => {
            noteField('password_confirm');
            setConfirm(v);
          }}
          onEnter={() => void submit()}
          reveal={reveal}
          onToggle={() => setReveal((r) => !r)}
          revealLabel={reveal ? t('auth.hidePassword') : t('auth.showPassword')}
        />
      ) : null}

      {mismatch ? <div className="error">{t('auth.passwordMismatch')}</div> : null}
      {/*
        Named where it is discovered, with the way back to the row it is about:
        the offending line is on the previous step, and an error that cannot be
        acted on from where it is shown is an error the reader has to solve
        twice.
      */}
      {selfInvited ? (
        <div className="error" role="alert">
          {t('auth.selfInvite')}{' '}
          <button type="button" className="linkish" onClick={() => setStep(2)}>
            {t('auth.backToInvites')}
          </button>
        </div>
      ) : null}
      {error ? <div className="error">{error}</div> : null}

      <button onClick={() => void submit()} disabled={busy || !credentialsReady}>
        {busy ? '…' : tab === 'signin' ? t('login.enter') : t('auth.createAccount')}
      </button>

      {/*
        Sign-in only. On the register tab there is no password to have
        forgotten, and offering the escape hatch there would read as a hint
        that an account already exists.

        The confirmation is deliberately vague about whether that address is
        registered — the endpoint answers identically either way, and saying
        more here would hand back what it withholds.
      */}
      {tab === 'signin' ? (
        forgotSent ? (
          <p className="login-verify-hint">{t('reset.maybeSent')}</p>
        ) : forgot ? (
          <button
            className="linkish"
            disabled={busy || !LOOKS_LIKE_EMAIL.test(email.trim())}
            onClick={() => void askReset()}
          >
            {busy ? '…' : t('reset.send')}
          </button>
        ) : (
          <button
            className="linkish"
            onClick={() => {
              track('password_reset_opened');
              setForgot(true);
            }}
          >
            {t('reset.forgot')}
          </button>
        )
      ) : null}

      {googleEnabled ? (
        <>
          {/* Ruled either side: this is the one place a line separates two
              genuinely different ways of doing the same thing. */}
          <div className="login-or">
            <span>{t('auth.or')}</span>
          </div>
          {/*
            A link, not a fetch: OAuth is a browser redirect to Google and back.
            The profile is stashed first, because that redirect destroys
            component state — `App` posts it to /api/auth/profile once the
            account exists on the other side.

            The intent travels so the server knows which door this was. From
            here it is only a hint — it is re-signed into the OAuth state and
            verified on the way back, because a query parameter the user can
            edit is no basis for deciding who may create an account.
          */}
          <a
            className="login-google"
            href={`/api/auth/google?intent=${tab === 'register' ? 'register' : 'signin'}`}
            onClick={() => {
              track('google_clicked', { tab });
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
  );

  /* Sign-in: unchanged — a title, a line under it, the credentials, the other door. */
  if (tab === 'signin') {
    return (
      <div className="login">
        <div className="auth-head">
          <h1 className="auth-title">{t('auth.signIn')}</h1>
          <p className="auth-sub">{t('auth.signInNote')}</p>
        </div>
        {arrivalNote}
        {credentials}
        <p className="auth-switch">
          {t('auth.noAccount')}{' '}
          <button
            type="button"
            className="auth-switch-link"
            onClick={() => {
              switchTab('register');
              setError(null);
              setArrival(null);
            }}
          >
            {t('auth.register')}
          </button>
        </p>
      </div>
    );
  }

  /*
    Registration, step 1: who you are and how big your firm is — a card split
    in two, the form on the left and what registering gets you on the right.
  */
  if (step === 1) {
    const soloWidth = CREATOR_ALLOWANCE / (CREATOR_ALLOWANCE + MAX_INVITES * SEAT_PER_COLLEAGUE);
    const pairWidth =
      (CREATOR_ALLOWANCE + SEAT_PER_COLLEAGUE) / (CREATOR_ALLOWANCE + MAX_INVITES * SEAT_PER_COLLEAGUE);
    return (
      <div className="reg-split">
        <section className="reg-main">
          {/* The mark is the way home here, in the card, as the design has it. */}
          <button className="brand reg-brand" onClick={onHome}>
            <BrandMark />
          </button>
          <h1 className="reg-title">{fromPreview ? t('reg.titlePreview') : t('reg.title')}</h1>
          <p className="reg-sub">{t('reg.sub')}</p>

          {arrivalNote}

          <div className="login-row">
            <Field
              id="armlex-name"
              label={t('auth.fullName')}
              required
              type="text"
              autoComplete="name"
              autoFocus
              value={profile.fullName}
              onChange={(e) => {
                noteField('full_name');
                setProfile((p) => ({ ...p, fullName: e.target.value }));
              }}
            />

            {/*
              Before the firm, and before the invitations: this is the address
              the account will be, and step 2 needs it to recognise a colleague
              row that repeats it.
            */}
            <Field
              id="armlex-email"
              label={t('auth.email')}
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                noteField('email');
                setEmail(e.target.value);
              }}
            />

            <Field
              id="armlex-company"
              label={t('auth.companyName')}
              required
              type="text"
              autoComplete="organization"
              value={profile.companyName}
              onChange={(e) => {
                noteField('company_name');
                setProfile((p) => ({ ...p, companyName: e.target.value }));
              }}
            />

            <span className="login-label reg-label">
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
                  onClick={() => {
                    noteField('company_size');
                    setProfile((p) => ({ ...p, companySize: size }));
                  }}
                >
                  {size}
                </button>
              ))}
            </div>

            {/*
              Under the size selector rather than above the form: this is where
              the question actually occurs to someone. Says what the answers are
              FOR — this audience verifies things for a living, and the vague
              version of this sentence is the one they have learned to skim past.
            */}
            <p className="login-why">{t('auth.whyWeAsk')}</p>

            {/* Where an address the server refuses comes back to — the field
                that can answer it is on this step now. */}
            {error ? <div className="error">{error}</div> : null}

            <button
              className="reg-continue"
              onClick={() => {
                // Where registration is abandoned: after the profile, after
                // the invitations, or at the credentials.
                track('signup_step_done', { step: 'profile', company_size: profile.companySize });
                setError(null);
                setStep(2);
              }}
              disabled={!profileComplete}
            >
              {t('auth.next')}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </div>

          <div className="reg-foot">
            <span>
              {t('auth.haveAccount')}{' '}
              <button type="button" className="auth-switch-link" onClick={toSignIn}>
                {t('reg.signIn')}
              </button>
            </span>
            {/* Plain text until the terms page exists — a link to nothing is worse
                than no link. */}
            <span>{t('reg.terms')}</span>
          </div>
        </section>

        {/* Hidden on narrow screens: the form is the task, this is the pitch. */}
        <aside className="reg-aside">
          <div className="lp-overline lp-overline-accent">{t('reg.benefits')}</div>
          <ul className="reg-benefits">
            {fromPreview ? <li>{t('reg.benefitAnswer')}</li> : null}
            <li>{t('reg.benefitWeekly').replace('{n}', String(CREATOR_ALLOWANCE))}</li>
            <li>{t('reg.benefitTeam')}</li>
          </ul>

          <div className="reg-team">
            <h2 className="reg-team-title">{t('reg.teamTitle')}</h2>
            <p className="reg-team-sub">{t('reg.teamSub')}</p>
            <div className="reg-tier">
              <div className="reg-tier-row">
                <span>{t('reg.teamSolo')}</span>
                <strong>
                  {CREATOR_ALLOWANCE} {t('reg.perWeek')}
                </strong>
              </div>
              <div className="reg-bar">
                <i style={{ width: `${soloWidth * 100}%` }} />
              </div>
            </div>
            <div className="reg-tier">
              <div className="reg-tier-row">
                <span>{t('reg.teamPlusOne')}</span>
                <strong className="reg-tier-more">
                  {CREATOR_ALLOWANCE}+{SEAT_PER_COLLEAGUE} {t('reg.perWeek')}
                </strong>
              </div>
              <div className="reg-bar">
                <i style={{ width: `${pairWidth * 100}%` }} />
              </div>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  /* Registration, steps 2 and 3: the masthead back, one card. */
  return (
    <>
      {masthead}
      <div className="reg-card">
        <div className="auth-head">
          <h1 className="auth-title">{t('auth.register')}</h1>
          <p className="auth-sub">{t('reg.plan').replace('{n}', String(CREATOR_ALLOWANCE))}</p>
        </div>

        {arrivalNote}

        {step === 2 ? (
          <div className="login-row">
            <h2 className="reg-invite-title">{t('reg.inviteTitle')}</h2>
            <p className="reg-invite-offer">
              {t('reg.inviteOffer')
                .replace('{m}', String(SEAT_PER_COLLEAGUE))
                .replace('{max}', String(MAX_INVITES + 1))}
            </p>

            <div className="invite-rows">
              {invites.map((invite, i) => (
                <div className="invite-row" key={i}>
                  <input
                    type="text"
                    aria-label={`${t('auth.fullName')} ${i + 1}`}
                    aria-invalid={inviteCheck && !rowEmpty(invite) && !invite.name.trim()}
                    placeholder={t('auth.fullName')}
                    value={invite.name}
                    onChange={(e) => {
                      noteField('invite_name');
                      setInvites((list) =>
                        list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                      );
                    }}
                  />
                  <input
                    type="email"
                    aria-label={`${t('auth.email')} ${i + 1}`}
                    aria-invalid={
                      (inviteCheck &&
                        !rowEmpty(invite) &&
                        !LOOKS_LIKE_EMAIL.test(invite.email.trim())) ||
                      (email.trim() !== '' &&
                        invite.email.trim().toLowerCase() === email.trim().toLowerCase())
                    }
                    placeholder={t('auth.email')}
                    value={invite.email}
                    onChange={(e) => {
                      noteField('invite_email');
                      setInvites((list) =>
                        list.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)),
                      );
                    }}
                  />
                  {/* The last remaining row is emptied rather than removed: the
                      step always offers one row to fill. */}
                  <button
                    type="button"
                    className="invite-remove"
                    aria-label={`${t('reg.removeRow')} ${i + 1}`}
                    title={t('reg.removeRow')}
                    onClick={() =>
                      setInvites((list) =>
                        list.length === 1 ? ONE_INVITE : list.filter((_, j) => j !== i),
                      )
                    }
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>

            {/*
              Shown while there is room, but usable only once the last row has
              something in it — a stack of empty rows asks for work nobody has
              decided to do.
            */}
            {invites.length < MAX_INVITES ? (
              <button
                className="invite-add"
                disabled={!canAddInvite}
                onClick={() => setInvites((list) => [...list, { name: '', email: '' }])}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {t('auth.inviteAnother')}
              </button>
            ) : null}

            {/*
              Says what will actually happen. The +5 lands when the colleague
              registers, not when the address is typed — promising it up front
              would be a number the product then has to take back.
            */}
            <div className="reg-info">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              <span>{t('reg.inviteInfo').replace('{m}', String(SEAT_PER_COLLEAGUE))}</span>
            </div>

            {inviteCheck && invalidRows > 0 ? (
              <div className="error" role="alert">
                {t('auth.inviteFix')}
              </div>
            ) : null}

            {/* Reached by going back from the credentials step, where the
                address was typed. */}
            {selfInvited ? (
              <div className="error" role="alert">
                {t('auth.selfInvite')}
              </div>
            ) : null}

            <button onClick={continueFromInvites}>{t('auth.next')}</button>

            {/* Skipping discards whatever was typed: a half-filled row is not an
                invitation anyone meant to send. */}
            <button
              type="button"
              className="reg-skip"
              onClick={() => {
                track('signup_step_done', { step: 'invites', invites: 0, skipped: true });
                setInvites(ONE_INVITE);
                setInviteCheck(false);
                setStep(3);
              }}
            >
              {t('reg.skip')}
            </button>
          </div>
        ) : (
          credentials
        )}

        <p className="auth-switch reg-switch">
          {t('auth.haveAccount')}{' '}
          <button type="button" className="auth-switch-link" onClick={toSignIn}>
            {t('auth.signIn')}
          </button>
        </p>
      </div>
    </>
  );
}
