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
      <div className="w-full max-w-sm rounded-xl p-6" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold" style={{ color: '#f0ede8' }}>{tr.resetPassword}</h2>
          <button onClick={onClose} style={{ color: '#888' }} className="text-xl leading-none">×</button>
        </div>
        {sent ? (
          <div>
            <p className="text-sm mb-4" style={{ color: '#7a7a7a' }}>{tr.resetEmailSent}</p>
            <button onClick={onSwitchToLogin} className="w-full py-2 rounded-xl text-sm font-semibold"
              style={{ background: '#c9a96e', color: '#0f0f0f' }}>{tr.backToSignIn}</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <p className="text-xs" style={{ color: '#666' }}>{tr.resetEmailPrompt}</p>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder={tr.email}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: '#111', border: '1px solid #333', color: '#f0ede8' }} />
            <button type="submit" disabled={loading} className="w-full rounded-lg py-2 text-sm font-semibold"
              style={{ background: '#c9a96e', color: '#0f0f0f', opacity: loading ? 0.6 : 1 }}>
              {loading ? tr.sending : tr.sendResetLink}
            </button>
            <button type="button" onClick={onSwitchToLogin} className="text-xs underline" style={{ color: '#c9a96e' }}>
              {tr.backToSignIn}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
