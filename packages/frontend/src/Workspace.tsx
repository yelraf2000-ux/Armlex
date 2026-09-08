/**
 * The workspace: who is in the firm, and what the firm has spent.
 *
 * A full page rather than another popup. The account menu is for things you do
 * in a second and dismiss; this is a list you read, compare and act on, and it
 * belongs on a surface that can hold a table.
 *
 * Everything an admin may do is offered only to an admin — but the server
 * re-checks every one of them. Hiding a button is presentation; presentation is
 * not authorisation.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSettings } from './Settings.js';

interface Member {
  id: string;
  name: string | null;
  email: string;
  role: 'admin' | 'member';
  /** The one admin who cannot be demoted or removed. */
  owner: boolean;
}

interface Invitee {
  id: string;
  name: string | null;
  email: string;
  invitedAt: string;
}

interface WorkspaceView {
  id: string;
  name: string | null;
  role: 'admin' | 'member';
  members: Member[];
  invitees: Invitee[];
}

interface MemberUsage {
  id: string;
  name: string | null;
  email: string;
  /** A share of the firm's pool, not a ceiling of their own. */
  used: number;
}

interface UsageView {
  members: MemberUsage[];
  used: number;
  limit: number | null;
}

type Section = 'members' | 'usage';

export function Workspace({ onClose, meId }: { onClose: () => void; meId: string }) {
  const { t, lang } = useSettings();
  const [section, setSection] = useState<Section>('members');
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which row is asking "are you sure" — removal is not undoable from here. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const res = await fetch('/api/workspace');
    if (res.ok) setView((await res.json()) as WorkspaceView);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Usage is fetched only when its tab is opened: it is the expensive read of
  // the two, and most visits to this page are about people, not numbers.
  useEffect(() => {
    if (section !== 'usage') return;
    void (async () => {
      const res = await fetch('/api/workspace/usage');
      if (res.ok) setUsage((await res.json()) as UsageView);
    })();
  }, [section]);

  const isAdmin = view?.role === 'admin';
  const [upgradeError, setUpgradeError] = useState<string | null>(null);

  function messageFor(code: string): string {
    switch (code) {
      case 'already_here':
        return t('ws.alreadyHere');
      case 'invalid_email':
        return t('auth.invalidEmail');
      case 'workspace_full':
        return t('ws.full');
      default:
        return t('ws.failed');
    }
  }

  async function invite(): Promise<void> {
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Carries the language so the invitation mail is written in the one the
        // inviter works in -- the invitee has no account and so no preference.
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined, lang }),
      });
      if (res.ok) {
        setView((await res.json()) as WorkspaceView);
        setName('');
        setEmail('');
        setAdding(false);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(messageFor(body.error ?? ''));
    } finally {
      setBusy(false);
    }
  }

  /** Both removals return the fresh workspace, so the list never guesses. */
  async function drop(path: string): Promise<void> {
    setConfirming(null);
    const res = await fetch(path, { method: 'DELETE' });
    if (res.ok) setView((await res.json()) as WorkspaceView);
  }

  /** Promote or demote. Returns the fresh workspace for the same reason. */
  async function setRole(memberId: string, admin: boolean): Promise<void> {
    const res = await fetch(`/api/workspace/members/${memberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin }),
    });
    if (res.ok) setView((await res.json()) as WorkspaceView);
  }

  /*
   * The plan belongs to the firm, so this only ever runs for an admin — the
   * button is not rendered otherwise, and the checkout route checks the session
   * again regardless.
   */
  async function upgrade(): Promise<void> {
    setUpgradeError(null);
    const res = await fetch('/api/billing/checkout?plan=pro');
    if (!res.ok) return setUpgradeError(t('account.upgradeSoon'));
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
  }

  return (
    <div className="ws">
      <div className="ws-head">
        <button className="ws-back" onClick={onClose}>
          ← {t('ws.back')}
        </button>
        <h1 className="ws-title">{view?.name || t('account.workspace')}</h1>
      </div>

      <div className="ws-body">
        <nav className="ws-nav">
          <button
            className={section === 'members' ? 'on' : ''}
            onClick={() => setSection('members')}
          >
            {t('ws.members')}
          </button>
          <button className={section === 'usage' ? 'on' : ''} onClick={() => setSection('usage')}>
            {t('ws.usage')}
          </button>
        </nav>

        <div className="ws-main">
          {view === null ? <p className="ws-empty">…</p> : null}

          {view && section === 'members' ? (
            <>
              <div className="ws-section-head">
                <h2>{t('ws.members')}</h2>
                {isAdmin ? (
                  <button className="ws-add" onClick={() => setAdding((a) => !a)}>
                    + {t('ws.newMember')}
                  </button>
                ) : null}
              </div>

              {adding ? (
                <div className="ws-invite">
                  <input
                    placeholder={t('auth.fullName')}
                    aria-label={t('auth.fullName')}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <input
                    type="email"
                    placeholder={t('auth.email')}
                    aria-label={t('auth.email')}
                    value={email}
                    autoFocus
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void invite();
                    }}
                  />
                  <button className="primary" disabled={busy || !email.trim()} onClick={() => void invite()}>
                    {t('ws.send')}
                  </button>
                  <button
                    onClick={() => {
                      setAdding(false);
                      setError(null);
                    }}
                  >
                    {t('nav.cancel')}
                  </button>
                </div>
              ) : null}
              {error ? <p className="ws-error">{error}</p> : null}

              <table className="ws-table">
                <tbody>
                  {view.members.map((m) => (
                    <tr key={m.id}>
                      <td className="ws-name">
                        {m.name || '—'}
                        {m.id === meId ? <span className="ws-you"> · {t('ws.you')}</span> : null}
                      </td>
                      <td className="ws-mail">{m.email}</td>
                      <td className="ws-role">
                        <span className={m.role === 'admin' ? 'ws-badge admin' : 'ws-badge'}>
                          {m.role === 'admin' ? t('ws.roleAdmin') : t('ws.roleMember')}
                        </span>
                      </td>
                      <td className="ws-act">
                        {/*
                          The OWNER is untouchable — not removable, not
                          demotable — so no control is offered for them. A
                          disabled button invites the click that teaches you it
                          does nothing. Other admins can be demoted, which is
                          what makes promotion safe to offer at all.
                        */}
                        {isAdmin && !m.owner ? (
                          confirming === m.id ? (
                            <span className="ws-confirm">
                              <button className="danger" onClick={() => void drop(`/api/workspace/members/${m.id}`)}>
                                {t('ws.removeYes')}
                              </button>
                              <button onClick={() => setConfirming(null)}>{t('nav.cancel')}</button>
                            </span>
                          ) : (
                            <span className="ws-confirm">
                              <button
                                className="ws-role-set"
                                onClick={() => void setRole(m.id, m.role !== 'admin')}
                              >
                                {m.role === 'admin' ? t('ws.demote') : t('ws.promote')}
                              </button>
                              <button className="ws-remove" onClick={() => setConfirming(m.id)}>
                                {t('ws.remove')}
                              </button>
                            </span>
                          )
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/*
                Invitees are a separate list, not members with a badge. Someone
                who has not registered has no account, no usage and no role —
                putting them in the same table would mean showing empty cells
                for three of the four columns and calling it a member.
              */}
              {view.invitees.length > 0 ? (
                <>
                  <div className="ws-section-head">
                    <h2>{t('ws.invitees')}</h2>
                  </div>
                  <table className="ws-table">
                    <tbody>
                      {view.invitees.map((i) => (
                        <tr key={i.id}>
                          <td className="ws-name">{i.name || '—'}</td>
                          <td className="ws-mail">{i.email}</td>
                          <td className="ws-role">
                            <span className="ws-badge pending">{t('ws.pending')}</span>
                          </td>
                          <td className="ws-act">
                            {isAdmin ? (
                              confirming === i.id ? (
                                <span className="ws-confirm">
                                  <button className="danger" onClick={() => void drop(`/api/workspace/invites/${i.id}`)}>
                                    {t('ws.removeYes')}
                                  </button>
                                  <button onClick={() => setConfirming(null)}>{t('nav.cancel')}</button>
                                </span>
                              ) : (
                                <button className="ws-remove" onClick={() => setConfirming(i.id)}>
                                  {t('ws.remove')}
                                </button>
                              )
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/*
                    Said plainly, because it is the difference between "they
                    have not replied" and "nothing was ever sent to them".
                  */}
                  <p className="ws-note">{t('ws.inviteNote')}</p>
                </>
              ) : null}
            </>
          ) : null}

          {view && section === 'usage' ? (
            <>
              <div className="ws-section-head">
                <h2>{t('ws.usage')}</h2>
              </div>
              {usage === null ? (
                <p className="ws-empty">…</p>
              ) : (
                <>
                  <div className="ws-total">
                    <div className="ws-total-line">
                      <span>{t('ws.totalThisMonth')}</span>
                      <span className="num">
                        {usage.used} / {usage.limit ?? '∞'}
                      </span>
                    </div>
                    {usage.limit !== null ? (
                      <div className="ws-bar" aria-hidden="true">
                        <div
                          className="ws-bar-fill"
                          style={{ width: `${Math.min(100, (usage.used / usage.limit) * 100)}%` }}
                        />
                      </div>
                    ) : null}

                    {/*
                      Directly beneath the number it answers. Someone reading
                      7 / 15 is at the one moment they care how to get more —
                      and only an admin can act on it, so only an admin is
                      shown the way.
                    */}
                    {isAdmin && usage.limit !== null ? (
                      <button className="ws-upgrade" onClick={() => void upgrade()}>
                        {t('account.upgrade')}
                      </button>
                    ) : null}
                    {upgradeError ? <p className="ws-note">{upgradeError}</p> : null}
                  </div>

                  <table className="ws-table">
                    <tbody>
                      {usage.members.map((m) => (
                        <tr key={m.id}>
                          <td className="ws-name">
                            {m.name || m.email}
                            {m.id === meId ? <span className="ws-you"> · {t('ws.you')}</span> : null}
                          </td>
                          <td className="ws-mail">{m.email}</td>
                          {/* A share of the pool, not a quota. The only ceiling
                              is the firm total shown above this table. */}
                          <td className="ws-count num">{m.used}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
