import { useState } from 'react';
import { user as userApi } from '../lib/api';
import { useT } from '../lib/i18n';

export default function ResetPassword({ token, onDone, lang }) {
  const tr = useT(lang);
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) { setError(tr.passwordMismatch); return; }
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
        <div className="w-full max-w-sm rounded-xl p-6 bg-surface-750 border border-surface-550">
          <p className="text-base font-semibold mb-2 text-success">{tr.passwordUpdated}</p>
          <p className="text-sm mb-4 text-ink-subtle">{tr.canNowSignIn}</p>
          <button onClick={onDone} className="w-full py-2 rounded-xl text-sm font-semibold bg-brand text-surface-base">{tr.signIn}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-sm rounded-xl p-6 bg-surface-750 border border-surface-550">
        <h2 className="text-lg font-semibold mb-5 text-ink">{tr.setNewPassword}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input type="password" required minLength={8} value={newPassword} onChange={e => setNewPassword(e.target.value)}
            placeholder={tr.newPassword}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none bg-surface-900 text-ink border border-surface-600" />
          <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
            placeholder={tr.confirmPassword}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none bg-surface-900 text-ink border border-surface-600" />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button type="submit" disabled={loading} className="w-full rounded-lg py-2 text-sm font-semibold bg-brand text-surface-base"
            style={{ opacity: loading ? 0.6 : 1 }}>
            {loading ? tr.updating : tr.updatePassword}
          </button>
        </form>
      </div>
    </div>
  );
}
