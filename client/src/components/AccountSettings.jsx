import { useState } from 'react';
import { user as userApi } from '../lib/api';
import { useT, LANGUAGES } from '../lib/i18n';

function Section({ title, children }) {
  return (
    <div className="rounded-xl p-5 mb-4" style={{ background: '#1a1a1a', border: '1px solid #222' }}>
      <h3 className="text-sm font-semibold mb-4" style={{ color: '#c9a96e' }}>{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <label className="block text-xs mb-1" style={{ color: '#888' }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  background: '#111', border: '1px solid #333', color: '#f0ede8',
  width: '100%', borderRadius: '8px', padding: '8px 12px', fontSize: '14px', outline: 'none',
};

export default function AccountSettings({ currentUser, onUpdated, onDeleted, lang, onLangSelect }) {
  const tr = useT(lang);
  const [name, setName] = useState(currentUser.name || '');
  const [email, setEmail] = useState(currentUser.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [resendMsg, setResendMsg] = useState('');

  async function handleUpdateProfile(e) {
    e.preventDefault();
    setProfileMsg(null);
    if (newPassword && newPassword !== confirmPassword) {
      setProfileMsg({ type: 'error', text: tr.newPasswordMismatch });
      return;
    }
    setProfileLoading(true);
    try {
      const payload = {};
      if (name !== currentUser.name) payload.name = name;
      if (email !== currentUser.email) payload.email = email;
      if (newPassword) { payload.currentPassword = currentPassword; payload.newPassword = newPassword; }
      if (Object.keys(payload).length === 0) {
        setProfileMsg({ type: 'info', text: tr.noChanges });
        return;
      }
      const updated = await userApi.update(payload);
      setProfileMsg({ type: 'success', text: tr.profileUpdated });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      onUpdated(updated);
    } catch (err) {
      setProfileMsg({ type: 'error', text: err.message || tr.updateFailed });
    } finally {
      setProfileLoading(false);
    }
  }

  async function handleDelete() {
    if (deleteConfirm !== currentUser.email) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await userApi.delete();
      onDeleted();
    } catch (err) {
      setDeleteError(err.message || 'Failed to delete account.');
      setDeleteLoading(false);
    }
  }

  async function handleResend() {
    setResendMsg('');
    try {
      await userApi.resendVerification();
      setResendMsg(tr.verificationSent);
    } catch {
      setResendMsg(tr.failedToSendEmail);
    }
  }

  const msgColor = profileMsg?.type === 'error' ? '#f87171' : profileMsg?.type === 'success' ? '#4ade80' : '#888';

  return (
    <div className="p-3 sm:p-6 max-w-lg mx-auto">
      <h2 className="text-xl font-bold mb-6" style={{ color: '#f0ede8' }}>{tr.accountSettings}</h2>

      {!currentUser.emailVerified && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 mb-5 text-xs"
          style={{ background: 'rgba(251,146,60,0.08)', border: '1px solid rgba(251,146,60,0.2)', color: '#fb923c' }}>
          <span>{tr.emailNotVerified}</span>
          <button onClick={handleResend} className="underline font-semibold">
            {resendMsg || tr.resendEmail}
          </button>
        </div>
      )}

      <Section title={tr.profile}>
        <form onSubmit={handleUpdateProfile}>
          <Field label={tr.name}>
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder={tr.yourName} />
          </Field>
          <Field label={tr.email}>
            <input style={inputStyle} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={tr.email} />
          </Field>
          <div className="mt-4 pt-4" style={{ borderTop: '1px solid #222' }}>
            <p className="text-xs mb-3" style={{ color: '#555' }}>{tr.leaveBlankPassword}</p>
            <Field label={tr.currentPassword}>
              <input style={inputStyle} type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder={tr.requiredToChange} />
            </Field>
            <Field label={tr.newPasswordShort}>
              <input style={inputStyle} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={tr.eightPlus} minLength={newPassword ? 8 : undefined} />
            </Field>
            <Field label={tr.confirmPassword}>
              <input style={inputStyle} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} placeholder={tr.repeatNewPassword} />
            </Field>
          </div>
          {profileMsg && <p className="text-xs mt-2" style={{ color: msgColor }}>{profileMsg.text}</p>}
          <div className="flex justify-end mt-4">
            <button type="submit" disabled={profileLoading}
              className="px-5 py-2 rounded-xl text-sm font-semibold"
              style={{ background: '#c9a96e', color: '#0f0f0f', opacity: profileLoading ? 0.6 : 1 }}>
              {profileLoading ? tr.saving : tr.saveChanges}
            </button>
          </div>
        </form>
      </Section>

      {onLangSelect && (
        <Section title={tr.language || 'Language'}>
          <Field label={tr.language || 'Language'}>
            <select
              style={inputStyle}
              value={lang}
              onChange={e => onLangSelect(e.target.value)}
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
          </Field>
        </Section>
      )}

      <Section title={tr.dangerZone}>
        <p className="text-xs mb-3" style={{ color: '#666' }}>{tr.deleteAccountWarning}</p>
        <input
          style={{ ...inputStyle, borderColor: deleteConfirm === currentUser.email ? '#f87171' : '#333' }}
          value={deleteConfirm}
          onChange={e => setDeleteConfirm(e.target.value)}
          placeholder={currentUser.email}
        />
        {deleteError && <p className="text-xs mt-2" style={{ color: '#f87171' }}>{deleteError}</p>}
        <div className="flex justify-end mt-3">
          <button
            onClick={handleDelete}
            disabled={deleteConfirm !== currentUser.email || deleteLoading}
            className="px-5 py-2 rounded-xl text-sm font-semibold transition-opacity"
            style={{
              background: 'rgba(248,113,113,0.1)', color: '#f87171',
              border: '1px solid rgba(248,113,113,0.3)',
              opacity: deleteConfirm !== currentUser.email || deleteLoading ? 0.4 : 1,
              cursor: deleteConfirm !== currentUser.email ? 'not-allowed' : 'pointer',
            }}>
            {deleteLoading ? tr.deleting : tr.deleteAccount}
          </button>
        </div>
      </Section>
    </div>
  );
}
