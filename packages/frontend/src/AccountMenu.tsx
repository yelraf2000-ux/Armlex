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
import type { Account } from './Login.js';
import { track } from './analytics.js';

export function AccountMenu({
  account,
  onSignOut,
  onOpenProfile,
  onOpenWorkspace,
  placement,
}: {
  account: Account;
  onSignOut: () => void;
  /** Both of these are screens with addresses of their own; the menu only points. */
  onOpenProfile: () => void;
  /** Workspace is a page, not a panel — it holds tables of people and numbers. */
  onOpenWorkspace: () => void;
  /** `rail` is the resting place; `masthead` is the phone fallback, where the
   *  register — and with it the foot of the register — does not exist. */
  placement: 'rail' | 'masthead';
}) {
  const { t } = useSettings();
  const [open, setOpen] = useState(false);
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
    setUpgradeError(null);
  }

  if (!user) return null;

  /** The name if there is one, else the local part of the address — never a blank. */
  const displayName = user.name || user.email.split('@')[0] || user.email;
  const initial = displayName.slice(0, 1).toUpperCase();

  /**
   * Upgrade.
   *
   * Billing is only wired up when the provider's keys are set, and the route
   * says so with a 404 rather than pretending. Better to say "not available
   * yet" than to send someone to a checkout that cannot take their money.
   */
  async function upgrade(): Promise<void> {
    setUpgradeError(null);
    track('upgrade_clicked', { from: 'menu' });
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
                  className={usage.used >= usage.limit ? 'account-bar-fill depleted' : 'account-bar-fill'}
                  style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }}
                />
              </div>
            </div>
          ) : null}

          <button
            role="menuitem"
            onClick={() => {
              close();
              onOpenProfile();
            }}
          >
            {t('account.profile')}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              close();
              onOpenWorkspace();
            }}
          >
            {t('account.workspace')}
          </button>
          {/*
            Admins only. The plan is bought for the firm, so a member
            following this would land on a checkout for a subscription that
            is not theirs to buy — and if they did buy it, the firm would be
            paying twice for one pool.
          */}
          {account.role !== 'member' ? (
            <>
              <button
                role="menuitem"
                className="account-upgrade"
                onClick={() => void upgrade()}
              >
                {t('account.upgrade')}
              </button>
              {upgradeError ? <p className="account-note">{upgradeError}</p> : null}
            </>
          ) : null}

          <div className="account-rule" />

          <button role="menuitem" className="account-signout" onClick={onSignOut}>
            {t('auth.signOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
