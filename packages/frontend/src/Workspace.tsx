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
import { Popup } from './Popup.js';

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
  role: 'admin' | 'member';
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

/**
 * No Back button of its own: the masthead is the way home from here, as it is
 * from anywhere else in the app (`goHome` in App.tsx closes this page).
 */
export function Workspace({
  meId,
  section,
  onSection,
}: {
  meId: string;
  /** Which half to show. It lives in the address, so a reload stays put. */
  section: Section;
  onSection: (section: Section) => void;
}) {
  const { t } = useSettings();
  const [view, setView] = useState<WorkspaceView | null>(null);
  const [usage, setUsage] = useState<UsageView | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  /*
   * Member unless said otherwise.
   *
   * It is one control rather than a pair, and it starts on the rank almost
   * every invitation carries — an admin can spend the firm's money and remove
   * colleagues, so it is the answer that should be chosen deliberately, not the
   * one that is one careless click away.
   */
  const [admin, setAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which row is asking "are you sure" — removal is not undoable from here. */
  const [confirming, setConfirming] = useState<{
    kind: 'member' | 'invite';
    id: string;
    name: string | null;
    email: string;
    /** The workspace's creator: removing them hands ownership to you. */
    owner: boolean;
  } | null>(null);

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
      case 'name_required':
        return t('ws.nameRequired');
      case 'role_required':
        return t('ws.roleRequired');
      case 'workspace_full':
        return t('ws.full');
      default:
        return t('ws.failed');
    }
  }

  /** Both free-text fields answered; the rank always has a value. The server
   *  checks all three regardless. */
  const invitable = Boolean(name.trim()) && Boolean(email.trim());

  async function invite(): Promise<void> {
    if (busy || !invitable) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim(), admin }),
      });
      if (res.ok) {
        setView((await res.json()) as WorkspaceView);
        setName('');
        setEmail('');
        setAdmin(false);
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
        <h1 className="ws-title">{view?.name || t('account.workspace')}</h1>
      </div>

      <div className="ws-body">
        <nav className="ws-nav">
          <button className={section === 'members' ? 'on' : ''} onClick={() => onSection('members')}>
            {t('ws.members')}
          </button>
          <button className={section === 'usage' ? 'on' : ''} onClick={() => onSection('usage')}>
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
                  <button
                    className={adding ? 'ws-add on' : 'ws-add'}
                    aria-expanded={adding}
                    onClick={() => setAdding((a) => !a)}
                  >
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
                    autoFocus
                    onChange={(e) => setName(e.target.value)}
                  />
                  <input
                    type="email"
                    placeholder={t('auth.email')}
                    aria-label={t('auth.email')}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void invite();
                    }}
                  />
                  {/*
                    The rank, asked here rather than left to a promotion
                    afterwards. The invitee never sees this — their link asks
                    for a password and nothing else — so this is the only
                    moment it can be said.
                  */}
                  <select
                    className="ws-rank"
                    aria-label={t('ws.roleLabel')}
                    value={admin ? 'admin' : 'member'}
                    onChange={(e) => setAdmin(e.target.value === 'admin')}
                  >
                    <option value="member">{t('ws.roleMember')}</option>
                    <option value="admin">{t('ws.roleAdmin')}</option>
                  </select>
                  <button
                    className="primary"
                    disabled={busy || !invitable}
                    onClick={() => void invite()}
                  >
                    {t('ws.send')}
                  </button>
                  <button
                    onClick={() => {
                      setAdding(false);
                      setAdmin(false);
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
                          Your OWN row carries no controls: you may not remove
                          yourself or change your own rank, and a disabled
                          button invites the click that teaches you so.

                          Everyone else can be removed, the workspace's creator
                          included — ownership passes to whoever removes them.
                          The creator's RANK is still not offered: owning the
                          workspace makes them an admin, so the button would
                          appear to do something and do nothing.
                        */}
                        {isAdmin && m.id !== meId ? (
                          <span className="ws-confirm">
                            {m.owner ? null : (
                              <button
                                className="ws-role-set"
                                onClick={() => void setRole(m.id, m.role !== 'admin')}
                              >
                                {m.role === 'admin' ? t('ws.demote') : t('ws.promote')}
                              </button>
                            )}
                            <button
                              className="ws-remove"
                              onClick={() =>
                                setConfirming({
                                  kind: 'member',
                                  id: m.id,
                                  name: m.name,
                                  email: m.email,
                                  owner: m.owner,
                                })
                              }
                            >
                              {t('ws.remove')}
                            </button>
                          </span>
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
                          {/* The rank they were invited at, beside the fact that
                              they have not arrived yet — an admin choosing it at
                              send time should be able to see what they chose. */}
                          <td className="ws-role">
                            <span className={i.role === 'admin' ? 'ws-badge admin' : 'ws-badge'}>
                              {i.role === 'admin' ? t('ws.roleAdmin') : t('ws.roleMember')}
                            </span>
                            <span className="ws-badge pending">{t('ws.pending')}</span>
                          </td>
                          <td className="ws-act">
                            {isAdmin ? (
                              <button
                                className="ws-remove"
                                onClick={() =>
                                  setConfirming({
                                    kind: 'invite',
                                    id: i.id,
                                    name: i.name,
                                    email: i.email,
                                    owner: false,
                                  })
                                }
                              >
                                {t('ws.remove')}
                              </button>
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

      {/*
        Removal asks in a popup, not in the row.

        The inline pair of buttons it replaces swapped "Remove" for "Confirm"
        in the same spot, so a double click removed someone — and it said
        nothing about what removal does, which is the one thing an admin needs
        to know before doing it. The popup names the person and says plainly
        what they keep and what they lose. The action is red because it is the
        destructive choice; Cancel is the default-looking one.
      */}
      {confirming ? (
        <Popup
          title={confirming.kind === 'member' ? t('ws.removeMemberTitle') : t('ws.removeInviteTitle')}
          onClose={() => setConfirming(null)}
        >
          <p className="popup-who">
            <strong>{confirming.name || confirming.email}</strong>
            {confirming.name ? <span className="popup-who-mail"> · {confirming.email}</span> : null}
          </p>
          <p className="popup-body">
            {confirming.kind === 'member' ? t('ws.removeMemberBody') : t('ws.removeInviteBody')}
          </p>
          {confirming.owner ? <p className="popup-body">{t('ws.removeOwnerNote')}</p> : null}
          <div className="popup-actions">
            <button className="popup-secondary" onClick={() => setConfirming(null)}>
              {t('nav.cancel')}
            </button>
            <button
              className="popup-danger"
              onClick={() =>
                void drop(
                  confirming.kind === 'member'
                    ? `/api/workspace/members/${confirming.id}`
                    : `/api/workspace/invites/${confirming.id}`,
                )
              }
            >
              {t('ws.remove')}
            </button>
          </div>
        </Popup>
      ) : null}
    </div>
  );
}
