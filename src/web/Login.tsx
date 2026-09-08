import { type FormEvent, useState } from 'react';
import { authApi } from './authApi.ts';
import { markAuthenticated } from './authState.ts';
import { useI18n } from './i18n/index.ts';

/** Gate shown instead of team content when server-mode auth is enabled and
 * this browser has no valid session. Dry railway-bureau tone, one field. */
export function Login() {
  const { t } = useI18n();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.login(password);
      if (result.ok) {
        markAuthenticated();
        return;
      }
      setError(result.status === 429 ? t('auth.rateLimited') : t('auth.wrongPassword'));
    } catch {
      setError(t('apiError.connectionFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="split">
      <form onSubmit={submit} className="stack">
        <p className="label">{t('auth.title')}</p>
        <p className="lede">{t('auth.lede')}</p>
        <label className="field">
          <span className="label">{t('auth.passwordLabel')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {t('auth.submitButton')}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </section>
  );
}
