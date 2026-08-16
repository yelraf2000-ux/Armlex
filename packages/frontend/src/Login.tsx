/**
 * Password gate.
 *
 * One shared password, no accounts. The point is not privacy — it is that every
 * answer spends real API credit, so an open URL is a bill anyone can run up.
 */
import { useState } from 'react';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setPassword('');
        onSuccess();
        return;
      }
      setError(res.status === 401 ? 'Неверный пароль.' : `Ошибка входа (HTTP ${res.status}).`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <h2 className="login-title">ArmLex</h2>
      <p className="login-note">
        Доступ по общему паролю. Каждый ответ расходует платные API-запросы,
        поэтому инструмент закрыт.
      </p>
      <div className="login-row">
        <input
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
          placeholder="Пароль"
        />
        <button onClick={() => void submit()} disabled={busy || !password}>
          {busy ? '…' : 'Войти'}
        </button>
      </div>
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
