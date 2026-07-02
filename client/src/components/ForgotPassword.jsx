import { useState } from 'react';
import { user as userApi } from '../lib/api';
import { useT } from '../lib/i18n';

export default function ForgotPassword({ onClose, onSwitchToLogin, lang }) {
  const tr = useT(lang);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try { await userApi.forgotPassword(email); } finally {
      setSent(true);
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm rounded-xl p-6 bg-surface-750 border border-surface-550">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold text-ink">{tr.resetPassword}</h2>
          <button onClick={onClose} className="text-xl leading-none text-ink-muted">×</button>
        </div>
        {sent ? (
          <div>
            <p className="text-sm mb-4 text-ink-subtle">{tr.resetEmailSent}</p>
            <button onClick={onSwitchToLogin} className="w-full py-2 rounded-xl text-sm font-semibold bg-brand text-surface-base">{tr.backToSignIn}</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <p className="text-xs text-ink-subtle">{tr.resetEmailPrompt}</p>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value.trim().toLowerCase())}
              inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email"
              placeholder={tr.email}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none bg-surface-900 text-ink border border-surface-600" />
            <button type="submit" disabled={loading} className="w-full rounded-lg py-2 text-sm font-semibold bg-brand text-surface-base"
              style={{ opacity: loading ? 0.6 : 1 }}>
              {loading ? tr.sending : tr.sendResetLink}
            </button>
            <button type="button" onClick={onSwitchToLogin} className="text-xs underline text-brand">
              {tr.backToSignIn}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
