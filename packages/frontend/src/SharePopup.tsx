/**
 * Share a conversation: one popup, one link, one Copy button.
 *
 * Replaces a share control that was also a state machine — "shared" badges,
 * "stop sharing", a toggle whose label changed meaning with every click, and
 * an inline link box that appeared beside the question. A person sharing a
 * conversation wants the link; everything else was machinery they had to read.
 *
 * Opening it asks the server for the link every time. The endpoint is
 * idempotent — it returns the existing link rather than minting a new one — so
 * there is no local "already shared?" state to keep in step with the server.
 *
 * Rendered through a portal to <body>. The share button lives inside the
 * sidebar and inside a conversation turn, and a fixed-position overlay nested
 * in either inherits whatever clipping or stacking context those containers
 * happen to set.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from './Settings.js';

export function SharePopup({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t } = useSettings();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/share`, { method: 'POST' });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { url: string };
        if (!cancelled) setUrl(`${window.location.origin}${body.url}`);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Pre-selected, so Ctrl+C works the moment the link appears — even where the
  // clipboard API is refused.
  useEffect(() => {
    if (url) inputRef.current?.select();
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy(): Promise<void> {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Clipboard refused (embedded contexts do this). The link is selected in
      // the box, so the fallback is one keystroke rather than a dead button.
      inputRef.current?.select();
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return createPortal(
    <div
      className="share-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="share-popup" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div className="share-popup-head">
          <h2 id="share-title">{t('share.title')}</h2>
          <button className="share-close" onClick={onClose} aria-label={t('nav.cancel')}>
            ×
          </button>
        </div>

        {failed ? (
          <p className="error">{t('share.failed')}</p>
        ) : (
          <div className="share-row">
            <input
              ref={inputRef}
              readOnly
              value={url ?? '…'}
              onFocus={(e) => e.target.select()}
              aria-label={t('share.title')}
            />
            <button className="share-copy" disabled={!url} onClick={() => void copy()}>
              {copied ? t('share.copied') : t('share.copy')}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
