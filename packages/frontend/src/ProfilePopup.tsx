/**
 * Change your name.
 *
 * Lifted out of the account menu so it has one mount and one URL. The menu is
 * rendered TWICE — once at the foot of the register, once in the masthead for
 * the widths where the register does not exist — and a popup owned by the menu
 * and opened by the path would have appeared twice over, since it portals to
 * <body> where the CSS that hides one of the two menus cannot reach it.
 */
import { useState } from 'react';
import { Popup } from './Popup.js';
import { useSettings } from './Settings.js';
import type { Account } from './Login.js';

export function ProfilePopup({
  account,
  onChanged,
  onClose,
}: {
  account: Account;
  /** A saved change; the caller re-reads the account so every view agrees. */
  onChanged: (next: Account) => void;
  onClose: () => void;
}) {
  const { t } = useSettings();
  const user = account.user;
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        onChanged({ ...account, ...((await res.json()) as Account) });
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popup title={t('account.profileTitle')} onClose={onClose}>
      <p className="popup-hint">{t('account.profileHint')}</p>
      <div className="popup-row">
        <input
          autoFocus
          value={name}
          aria-label={t('auth.fullName')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) void save();
          }}
        />
      </div>
      <div className="popup-actions">
        <button className="popup-secondary" onClick={onClose}>
          {t('nav.cancel')}
        </button>
        <button className="popup-primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          {t('nav.save')}
        </button>
      </div>
    </Popup>
  );
}
