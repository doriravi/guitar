import { useState } from 'react';
import { user as userApi } from '../lib/api';

export default function ResetPassword({ token, onDone }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      await userApi.resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Reset failed. The link may have expired.');
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="w-full max-w-sm rounded-xl p-6" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
          <p className="text-base font-semibold mb-2" style={{ color: '#4ade80' }}>Password updated!</p>
          <p className="text-sm mb-4" style={{ color: '#7a7a7a' }}>You can now sign in with your new password.</p>
          <button onClick={onDone} className="w-full py-2 rounded-xl text-sm font-semibold"
            style={{ background: '#c9a96e', color: '#0f0f0f' }}>Sign in</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-sm rounded-xl p-6" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
        <h2 className="text-lg font-semibold mb-5" style={{ color: '#f0ede8' }}>Set new password</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input type="password" required minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)}
            placeholder="New password (8+ characters)"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: '#111', border: '1px solid #333', color: '#f0ede8' }} />
          <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder="Confirm new password"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: '#111', border: '1px solid #333', color: '#f0ede8' }} />
          {error && <p className="text-sm" style={{ color: '#f87171' }}>{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full rounded-lg py-2 text-sm font-semibold"
            style={{ background: '#c9a96e', color: '#0f0f0f', opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  );
}
