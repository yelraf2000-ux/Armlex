/**
 * The account control: who you are, what you have left, and the way out.
 *
 * It sits at the FOOT of the register rather than in the masthead, where the
 * signature on a page belongs and where every tool of this shape has taught
 * people to look for it. The masthead is for what qualifies an answer — the
 * corpus, the date it was checked — and an allowance counter and a sign-out
 * button standing there permanently were furniture in the one place that should
 * carry nothing but provenance.
 *
 * The allowance moves with it. It is still visible before it is spent, which
 * was the point of showing it, but it is now one click away rather than
 * occupying the running head of every screen.
 */
import { useEffect, useRef, useState } from 'react';
import { useSettings } from './Settings.js';
import { COMPANY_SIZES, type Account } from './Login.js';

/** Which panel the popup is showing; `null` is the menu itself. */
type Panel = 'profile' | 'workspace' | null;

export function AccountMenu({
  account,
  onChanged,
  onSignOut,
  placement,
}: {
  account: Account;
  /** A saved change; the caller re-reads the account so every view agrees. */
  onChanged: (next: Account) => void;
  onSignOut: () => void;
  /** `rail` is the resting place; `masthead` is the phone fallback, where the
   *  register — and with it the foot of the register — does not exist. */
  placement: 'rail' | 'masthead';
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [size, setSize] = useState('');
  const [busy, setBusy] = useState(false);
  const [upgradeError, setUpgradeError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const user = account.user;
  const usage = account.usage;

  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent): void {
      if (!(e.target instanceof Node)) return;
      if (rootRef.current?.contains(e.target)) return;
      close();
    }
    function esc(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  function close(): void {
    setOpen(false);
    setPanel(null);
    setUpgradeError(null);
  }

  if (!user) return null;

  /** The name if there is one, else the local part of the address — never a blank. */
  const displayName = user.name || user.email.split('@')[0] || user.email;
  const initial = displayName.slice(0, 1).toUpperCase();

  async function save(fields: Record<string, unknown>): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (res.ok) {
        const data = (await res.json()) as Account;
        onChanged({ ...account, ...data });
        setPanel(null);
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * Upgrade.
   *
   * Billing is only wired up when the provider's keys are set, and the route
   * says so with a 404 rather than pretending. Better to say "not available
   * yet" than to send someone to a checkout that cannot take their money.
   */
  async function upgrade(): Promise<void> {
    setUpgradeError(null);
    const res = await fetch('/api/billing/checkout?plan=pro');
    if (!res.ok) {
      setUpgradeError(t('account.upgradeSoon'));
      return;
    }
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
  }

  return (
    <div className={`account account-${placement}`} ref={rootRef}>
      <button
        className="account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <span className="account-initial" aria-hidden="true">
          {initial}
        </span>
        <span className="account-name">{displayName}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </button>

      {open ? (
        <div className="account-pop" role="menu">
          {/*
            Identity first, and not a control. Naming the account is what makes
            everything under it unambiguous — on a shared machine especially,
            where the question "whose questions am I spending" has a real answer.
          */}
          <div className="account-who">
            <div className="account-who-name">{displayName}</div>
            <div className="account-who-mail">{user.email}</div>
          </div>

          {panel === null ? (
            <>
              {/*
                The allowance, where the person can see it before they spend it.
                Shown only on a capped plan — an "unlimited" counter is
                furniture, the same reason the coverage badge stays off
                confident answers.
              */}
              {usage && usage.limit !== null ? (
                <div className="account-quota">
                  <div className="account-quota-line">
                    <span>{t('account.questions')}</span>
                    <span className="num">
                      {usage.used} / {usage.limit}
                    </span>
                  </div>
                  <div className="account-bar" aria-hidden="true">
                    <div
                      className="account-bar-fill"
                      style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <button
                role="menuitem"
                onClick={() => {
                  setName(user.name ?? '');
                  setPanel('profile');
                }}
              >
                {t('account.profile')}
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setCompany(user.companyName ?? '');
                  setSize(user.companySize ?? '');
                  setPanel('workspace');
                }}
              >
                {t('account.workspace')}
              </button>
              <button role="menuitem" className="account-upgrade" onClick={() => void upgrade()}>
                {t('account.upgrade')}
              </button>
              {upgradeError ? <p className="account-note">{upgradeError}</p> : null}

              <div className="account-rule" />

              <button role="menuitem" className="account-signout" onClick={onSignOut}>
                {t('auth.signOut')}
              </button>
            </>
          ) : null}

          {panel === 'profile' ? (
            <div className="account-panel">
              <label htmlFor="account-fullname">{t('auth.fullName')}</label>
              <input
                id="account-fullname"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) void save({ name });
                }}
              />
              <div className="account-panel-actions">
                <button onClick={() => setPanel(null)}>{t('nav.cancel')}</button>
                <button
                  className="primary"
                  disabled={busy || !name.trim()}
                  onClick={() => void save({ name })}
                >
                  {t('nav.save')}
                </button>
              </div>
            </div>
          ) : null}

          {panel === 'workspace' ? (
            <div className="account-panel">
              <label htmlFor="account-company">{t('auth.companyName')}</label>
              <input
                id="account-company"
                value={company}
                autoFocus
                onChange={(e) => setCompany(e.target.value)}
              />
              <span className="account-panel-label">{t('auth.companySize')}</span>
              <div className="size-options" role="radiogroup" aria-label={t('auth.companySize')}>
                {COMPANY_SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={size === s}
                    className={size === s ? 'size-option on' : 'size-option'}
                    onClick={() => setSize(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="account-panel-actions">
                <button onClick={() => setPanel(null)}>{t('nav.cancel')}</button>
                <button
                  className="primary"
                  disabled={busy || !company.trim()}
                  onClick={() => void save({ companyName: company, companySize: size })}
                >
                  {t('nav.save')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
