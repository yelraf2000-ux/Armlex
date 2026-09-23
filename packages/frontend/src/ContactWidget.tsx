/**
 * «Հարց ունե՞ք» — the corner button on the public pages.
 *
 * For questions about the PRODUCT (price, coverage, a demo), not legal
 * questions: those go in the landing's question box. The message goes to the
 * team's Telegram group and a person replies through whatever contact the
 * visitor left — no model answers here, because a generated wrong price is
 * worse than a slow reply.
 */
import { useEffect, useRef, useState } from 'react';
import { TELEGRAM_ACCOUNT } from './brand.js';
import { useSettings } from './Settings.js';
import { usePath } from './router.js';
import { track } from './analytics.js';

type State = 'idle' | 'sending' | 'sent';

export function ContactWidget() {
  const { t } = useSettings();
  const path = usePath();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [message, setMessage] = useState('');
  /** Real people never see this field; a bot filling every input does. */
  const [website, setWebsite] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && state === 'idle') firstRef.current?.focus();
  }, [open, state]);

  // Escape closes, as every other popup on the site does.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const ready = name.trim() !== '' && contact.trim() !== '' && message.trim() !== '';

  async function send(): Promise<void> {
    if (!ready || state === 'sending') return;
    setState('sending');
    setError(null);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, contact, message, page: path, website }),
      });
      if (res.ok) {
        // The server records it too, but only for a signed-in sender; most
        // are not, and this is the only count of them.
        track('contact_submitted', { page: path });
        setState('sent');
        setMessage('');
        return;
      }
      setError(res.status === 429 ? t('contact.tooMany') : t('contact.failed'));
      setState('idle');
    } catch {
      setError(t('contact.failed'));
      setState('idle');
    }
  }

  const telegram = TELEGRAM_ACCOUNT ? (
    <a
      className="contact-telegram"
      href={`https://t.me/${TELEGRAM_ACCOUNT}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => track('contact_telegram_clicked', { page: path })}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M21.5 3.6 2.9 10.8c-1.3.5-1.2 1.3-.2 1.6l4.8 1.5 1.8 5.6c.2.7.4 1 .9 1 .4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.2-15c.3-1.3-.5-1.9-1.6-1.4zM9.2 13.4l9-5.7c.4-.3.8-.1.5.2l-7.7 7-.3 3.2-1.5-4.7z" />
      </svg>
      {t('contact.telegram')}
    </a>
  ) : null;

  return (
    <>
      {open ? (
        <div className="contact-panel" role="dialog" aria-modal="false" aria-labelledby="contact-title">
          <div className="contact-head">
            <h2 id="contact-title" className="contact-title">{t('contact.title')}</h2>
            <button className="contact-close" onClick={() => setOpen(false)} aria-label={t('quota.close')} title={t('quota.close')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          {state === 'sent' ? (
            <div className="contact-sent">
              <p className="contact-sent-title">{t('contact.sentTitle')}</p>
              <p className="contact-note">{t('contact.sentBody')}</p>
              {telegram}
            </div>
          ) : (
            <form
              className="contact-form"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <p className="contact-note">{t('contact.lede')}</p>
              <label className="contact-label" htmlFor="contact-name">{t('contact.name')}</label>
              <input
                id="contact-name"
                ref={firstRef}
                className="contact-input"
                value={name}
                maxLength={100}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
              />
              <label className="contact-label" htmlFor="contact-contact">{t('contact.contact')}</label>
              <input
                id="contact-contact"
                className="contact-input"
                value={contact}
                maxLength={200}
                placeholder={t('contact.contactHint')}
                onChange={(e) => setContact(e.target.value)}
              />
              <label className="contact-label" htmlFor="contact-message">{t('contact.message')}</label>
              <textarea
                id="contact-message"
                className="contact-input contact-textarea"
                value={message}
                maxLength={2000}
                rows={4}
                onChange={(e) => setMessage(e.target.value)}
              />
              {/* The trap: off-screen, out of the tab order, ignored by autofill. */}
              <input
                className="contact-trap"
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
              {error ? <div className="contact-error" role="alert">{error}</div> : null}
              <button className="contact-send" type="submit" disabled={!ready || state === 'sending'}>
                {state === 'sending' ? '…' : t('contact.send')}
              </button>
              {telegram}
            </form>
          )}
        </div>
      ) : null}

      <button
        className={open ? 'contact-button on' : 'contact-button'}
        onClick={() => {
          if (!open) track('contact_opened', { page: path });
          setOpen((o) => !o);
          if (state === 'sent') setState('idle');
        }}
        aria-expanded={open}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span>{t('contact.button')}</span>
      </button>
    </>
  );
}
