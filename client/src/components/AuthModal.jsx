import { useState } from 'react';
import { auth } from '../lib/api';
import { useT } from '../lib/i18n';

export default function AuthModal({ onSuccess, onClose, onForgotPassword, lang }) {
  const tr = useT(lang);
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = mode === 'login'
        ? await auth.login(form.email, form.password)
        : await auth.register(form.email, form.password, form.name);
      onSuccess(user);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="w-full max-w-sm rounded-xl p-6"
        style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}
      >
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold" style={{ color: '#f0ede8' }}>
            {mode === 'login' ? tr.signIn : tr.createAccount}
          </h2>
          <button onClick={onClose} style={{ color: '#888' }} className="text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {mode === 'register' && (
            <input
              name="name" type="text" placeholder={tr.yourName}
              value={form.name} onChange={handleChange} required
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: '#111', border: '1px solid #333', color: '#f0ede8' }}
            />
          )}
          <input
            name="email" type="email" placeholder={tr.email}
            value={form.email} onChange={handleChange} required
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: '#111', border: '1px solid #333', color: '#f0ede8' }}
          />
          <input
            name="password" type="password"
            placeholder={mode === 'register' ? tr.passwordHint : tr.password}
            value={form.password} onChange={handleChange} required
            minLength={mode === 'register' ? 8 : undefined}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: '#111', border: '1px solid #333', color: '#f0ede8' }}
          />
          {error && <p className="text-sm" style={{ color: '#e87070' }}>{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full rounded-lg py-2 text-sm font-semibold transition-opacity"
            style={{ background: '#c9a96e', color: '#0f0f0f', opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? tr.pleaseWait : mode === 'login' ? tr.signIn : tr.createAccount}
          </button>
        </form>

        {mode === 'login' && (
          <p className="mt-3 text-center text-xs">
            <button onClick={onForgotPassword} className="underline" style={{ color: '#888' }}>
              {tr.forgotPassword}
            </button>
          </p>
        )}

        <p className="mt-3 text-center text-xs" style={{ color: '#666' }}>
          {mode === 'login' ? tr.noAccount : tr.haveAccount}{' '}
          <button
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            className="underline" style={{ color: '#c9a96e' }}>
            {mode === 'login' ? tr.signUp : tr.signIn}
          </button>
        </p>
      </div>
    </div>
  );
}
