import { useState } from 'react';
import { user as userApi } from '../lib/api';

export default function ForgotPassword({ onClose, onSwitchToLogin }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await userApi.forgotPassword(email);
    } finally {
      setSent(true); // always show success to prevent email enumeration
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-xl p-6" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold" style={{ color: '#f0ede8' }}>Reset password</h2>
          <button onClick={onClose} style={{ color: '#888' }} className="text-xl leading-none">×</button>
        </div>

        {sent ? (
          <div>
            <p className="text-sm mb-4" style={{ color: '#7a7a7a' }}>
              If an account exists for <strong style={{ color: '#f0ede8' }}>{email}</strong>, you'll receive a reset link shortly.
            </p>
            <button onClick={onSwitchToLogin} className="w-full py-2 rounded-xl text-sm font-semibold"
              style={{ background: '#c9a96e', color: '#0f0f0f' }}>
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <p className="text-xs" style={{ color: '#666' }}>Enter your email and we'll send you a link to reset your password.</p>
            <input
              type="email" required value={email} onChange={e => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: '#111', border: '1px solid #333', color: '#f0ede8' }}
            />
            <button type="submit" disabled={loading}
              className="w-full rounded-lg py-2 text-sm font-semibold"
              style={{ background: '#c9a96e', color: '#0f0f0f', opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
            <button type="button" onClick={onSwitchToLogin} className="text-xs underline" style={{ color: '#c9a96e' }}>
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
