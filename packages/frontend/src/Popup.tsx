/**
 * The one popup shell: backdrop, title, close button, and nothing else.
 *
 * Shared by the share and delete popups so they behave identically — Escape,
 * a click outside, or the × all dismiss — rather than each growing its own
 * slightly different idea of how a dialog closes.
 *
 * Rendered through a portal to <body>. Its triggers live inside the sidebar
 * and inside conversation turns, and a fixed overlay nested in either inherits
 * whatever clipping or stacking context those containers happen to set.
 */
import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSettings } from './Settings.js';

export function Popup({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useSettings();
  const titleId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="popup-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="popup" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="popup-head">
          <h2 id={titleId}>{title}</h2>
          <button className="popup-close" onClick={onClose} aria-label={t('nav.cancel')}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
