/**
 * A shared consultation, read by someone who may have no account.
 *
 * Deliberately not the workbench with the controls removed. A recipient did not
 * come here to use a tool — they were sent a piece of reasoning to read, usually
 * by their accountant. So: the exchange, the disclaimer, and one honest way in
 * for anyone who wants to ask their own question. No composer, no session list,
 * no norm panel to pin — a control that cannot act is worse than no control.
 */
import { useEffect, useState } from 'react';
import { BRAND } from './brand.js';
import { MarkdownView } from './MarkdownView.js';
import { useSettings } from './Settings.js';

interface SharedMessage {
  role: string;
  content: string;
}

export function Shared({ token }: { token: string }) {
  const { t } = useSettings();
  const [messages, setMessages] = useState<SharedMessage[] | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/shared/${token}`);
        if (!res.ok) {
          if (!cancelled) setMissing(true);
          return;
        }
        const data = (await res.json()) as { messages: SharedMessage[] };
        if (!cancelled) setMessages(data.messages);
      } catch {
        if (!cancelled) setMissing(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (missing) {
    return (
      <div className="wrap shared-page">
        <div className="shared-head">
          <a className="brand" href="/">
            {BRAND}
          </a>
        </div>
        {/*
          A withdrawn link and a mistyped one are the same 404 on purpose — the
          server must not confirm that a token was ever real. So the message
          says what the reader can act on, not which of the two happened.
        */}
        <div className="shared-gone">{t('share.gone')}</div>
      </div>
    );
  }

  if (messages === null) return <div className="wrap shared-page" />;

  return (
    <div className="wrap shared-page">
      <div className="shared-head">
        <a className="brand" href="/">
          {BRAND}
        </a>
        <span className="shared-badge">{t('share.readOnly')}</span>
      </div>

      {messages.map((m, i) => (
        <div key={i} className={`turn ${m.role} measure`}>
          <div className="turn-role">{m.role === 'user' ? t('turn.question') : BRAND}</div>
          <div className="turn-text">
            {m.role === 'user' ? m.content : <MarkdownView text={m.content} />}
          </div>
        </div>
      ))}

      <div className="measure shared-foot">
        <div className="shared-cta">
          {t('share.ownQuestion')} <a href="/">{t('share.openTool')}</a>
        </div>
        <div className="login-disclaimer">{t('corpus.disclaimer')}</div>
      </div>
    </div>
  );
}
