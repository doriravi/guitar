import { useState, useEffect } from 'react';
import { user as userApi, subscriptions as subscriptionsApi } from '../lib/api';
import { useT, LANGUAGES } from '../lib/i18n';
import { useHandProfile } from '../App';
import { recommendedMaxDifficulty, abilityLabel, flexibilityLabel } from '../lib/handProfile';
import { currentTier, currentLevelCeiling, loadManual } from '../lib/levelPlan';

function Section({ title, children }) {
  return (
    <div className="rounded-xl p-5 mb-4 bg-surface-750 border border-surface-650">
      <h3 className="text-sm font-semibold mb-4 text-brand">{title}</h3>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <label className="block text-xs mb-1 text-ink-muted">{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-600)', color: 'var(--color-ink)',
  width: '100%', borderRadius: '8px', padding: '8px 12px', fontSize: '14px', outline: 'none',
};

// One-time read of the ?checkout=success|cancel param Stripe appends when it
// redirects back to the app after the hosted checkout. Consumed on mount so a
// reload doesn't re-show the banner.
function consumeCheckoutResult() {
  try {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('checkout');
    if (result === 'success' || result === 'cancel') {
      params.delete('checkout');
      params.delete('session_id');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
      return result;
    }
  } catch { /* no-op */ }
  return null;
}

// Human-readable plan label + renewal blurb for the current subscription.
function planLabel(plan, tr) {
  switch (plan) {
    case 'MONTHLY': return tr.planMonthly || 'Monthly — Premium';
    case 'YEARLY': return tr.planYearly || 'Yearly — Premium';
    default: return tr.planFree || 'Free';
  }
}

function statusMeta(status, tr) {
  switch (status) {
    case 'ACTIVE': return { label: tr.subActive || 'Active', color: 'var(--color-success)' };
    case 'TRIALING': return { label: tr.subTrialing || 'Trial', color: 'var(--color-success)' };
    case 'PAST_DUE': return { label: tr.subPastDue || 'Payment past due', color: '#fb923c' };
    case 'CANCELED': return { label: tr.subCanceled || 'Canceled', color: 'var(--color-ink-muted)' };
    default: return { label: tr.subInactive || 'No active subscription', color: 'var(--color-ink-muted)' };
  }
}

function SubscriptionSection({ lang }) {
  const tr = useT(lang);
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyPlan, setBusyPlan] = useState(null); // plan key currently redirecting
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState(() => consumeCheckoutResult());
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  async function refresh() {
    setLoading(true);
    setError('');
    try {
      const data = await subscriptionsApi.getStatus();
      setSub(data);
    } catch (err) {
      setError(err.message || (tr.subLoadFailed || 'Could not load your subscription.'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpgrade(plan) {
    setBusyPlan(plan);
    setError('');
    try {
      const { url } = await subscriptionsApi.createCheckout(plan);
      if (url) {
        window.location.href = url; // hand off to Stripe Checkout
      } else {
        setError(tr.subCheckoutFailed || 'Could not start checkout. Please try again.');
        setBusyPlan(null);
      }
    } catch (err) {
      setError(err.message || (tr.subCheckoutFailed || 'Could not start checkout. Please try again.'));
      setBusyPlan(null);
    }
  }

  async function handleCancel() {
    setCanceling(true);
    setError('');
    try {
      await subscriptionsApi.cancel();
      setShowCancelConfirm(false);
      await refresh();
    } catch (err) {
      setError(err.message || (tr.subCancelFailed || 'Could not cancel. Please try again.'));
    } finally {
      setCanceling(false);
    }
  }

  const plan = sub?.plan || 'FREE';
  const status = sub?.status || 'INACTIVE';
  const isPremium = plan !== 'FREE' && (status === 'ACTIVE' || status === 'TRIALING');
  const canCancel = plan !== 'FREE' && (status === 'ACTIVE' || status === 'TRIALING' || status === 'PAST_DUE');
  const sm = statusMeta(status, tr);
  const renewsAt = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : null;

  const PLANS = [
    { key: 'MONTHLY', label: tr.planMonthlyName || 'Monthly', price: tr.planMonthlyPrice || '$4.99 / month', blurb: tr.planMonthlyBlurb || 'Billed monthly. Cancel anytime.' },
    { key: 'YEARLY', label: tr.planYearlyName || 'Yearly', price: tr.planYearlyPrice || '$49.99 / year', blurb: tr.planYearlyBlurb || 'Two months free vs. monthly.' },
  ];

  return (
    <Section title={tr.subscription || 'Subscription'}>
      {banner && (
        <div className="rounded-xl px-4 py-3 mb-4 text-xs" style={{
          background: banner === 'success' ? 'rgba(74,222,128,0.1)' : 'rgba(251,146,60,0.08)',
          border: `1px solid ${banner === 'success' ? 'rgba(74,222,128,0.3)' : 'rgba(251,146,60,0.2)'}`,
          color: banner === 'success' ? 'var(--color-success)' : '#fb923c',
        }}>
          <div className="flex items-center justify-between gap-3">
            <span>
              {banner === 'success'
                ? (tr.subThanks || 'Thanks! Your subscription is being activated — it may take a moment to appear.')
                : (tr.subCheckoutCanceled || 'Checkout canceled. You have not been charged.')}
            </span>
            <button onClick={() => setBanner(null)} className="text-base leading-none opacity-70">×</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-ink-muted">{tr.loading || 'Loading…'}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 mb-1">
            <span className="text-sm text-ink">{planLabel(plan, tr)}</span>
            <span className="text-xs font-semibold" style={{ color: sm.color }}>{sm.label}</span>
          </div>
          {isPremium && renewsAt && (
            <p className="text-xs text-ink-faint">
              {status === 'CANCELED'
                ? `${tr.subEndsOn || 'Access ends on'} ${renewsAt}`
                : `${tr.subRenewsOn || 'Renews on'} ${renewsAt}`}
            </p>
          )}

          {error && <p className="text-xs mt-2 text-danger">{error}</p>}

          {!isPremium && (
            <>
              <p className="text-xs mt-3 mb-3 text-ink-subtle">
                {tr.subUpgradeIntro || 'Upgrade to Premium to unlock everything.'}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {PLANS.map(p => (
                  <div key={p.key} className="rounded-xl p-4 bg-surface-900 border border-surface-650 flex flex-col">
                    <span className="text-sm font-semibold text-ink">{p.label}</span>
                    <span className="text-brand text-base font-bold mt-1">{p.price}</span>
                    <span className="text-[11px] text-ink-faint mt-1 mb-3 flex-1">{p.blurb}</span>
                    <button
                      onClick={() => handleUpgrade(p.key)}
                      disabled={!!busyPlan}
                      className="px-4 py-2 rounded-xl text-sm font-semibold bg-brand text-surface-base"
                      style={{ opacity: busyPlan ? 0.6 : 1, cursor: busyPlan ? 'wait' : 'pointer' }}>
                      {busyPlan === p.key ? (tr.subRedirecting || 'Redirecting…') : (tr.subscribe || 'Subscribe')}
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] mt-3 text-ink-ghost">
                {tr.subSecureNote || 'Payments are processed securely by Stripe. You’ll be redirected to complete checkout.'}
              </p>
            </>
          )}

          {canCancel && (
            <div className="mt-4 pt-4 border-t border-surface-650 flex items-center justify-between gap-3">
              <span className="text-xs text-ink-faint">
                {tr.subCancelNote || 'Cancel keeps access until the end of the current period.'}
              </span>
              <button
                onClick={() => setShowCancelConfirm(true)}
                disabled={canceling}
                className="px-4 py-2 rounded-xl text-sm font-semibold shrink-0"
                style={{ background: 'rgba(248,113,113,0.1)', color: 'var(--color-danger)', border: '1px solid rgba(248,113,113,0.3)', opacity: canceling ? 0.5 : 1 }}>
                {canceling ? (tr.subCanceling || 'Canceling…') : (tr.subCancel || 'Cancel subscription')}
              </button>
            </div>
          )}
        </>
      )}

      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-sm rounded-2xl p-5 bg-surface-base border border-surface-550">
            <h3 className="text-sm font-bold mb-2 text-ink">{tr.subCancelTitle || 'Cancel your subscription?'}</h3>
            <p className="text-xs mb-4 text-ink-subtle">
              {tr.subCancelBody || 'You’ll keep Premium access until the end of your current billing period, then drop to the Free plan. You can resubscribe anytime.'}
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCancelConfirm(false)} disabled={canceling}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-600)' }}>
                {tr.subKeep || 'Keep subscription'}
              </button>
              <button onClick={handleCancel} disabled={canceling}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--color-danger)', color: 'white', opacity: canceling ? 0.5 : 1 }}>
                {canceling ? (tr.subCanceling || 'Canceling…') : (tr.subConfirmCancel || 'Yes, cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

export default function AccountSettings({ currentUser, onUpdated, onDeleted, lang, onLangSelect, limitToReach, onLimitToReachChange, limitToLevel, onLimitToLevelChange }) {
  const tr = useT(lang);
  const profile = useHandProfile();
  const reachCeiling = recommendedMaxDifficulty(profile);
  const reach = abilityLabel(profile);
  const flex = flexibilityLabel(profile);
  // Current Level-Plan tier + its content ceiling, for the "limit by level" toggle.
  const levelCtx = { handProfile: profile, manual: loadManual() };
  const tier = currentTier(levelCtx);
  const levelCeil = currentLevelCeiling(levelCtx);
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [resendMsg, setResendMsg] = useState('');
  const [limitSavedMsg, setLimitSavedMsg] = useState(false);
  const [levelSavedMsg, setLevelSavedMsg] = useState(false);

  function handleLimitToggle(on) {
    onLimitToReachChange(on);
    // The preference applies instantly (no form Save needed) — confirm it so the
    // nearby Profile "Save changes" button isn't mistaken for saving this too.
    setLimitSavedMsg(true);
    setTimeout(() => setLimitSavedMsg(false), 2500);
  }

  function handleLevelToggle(on) {
    onLimitToLevelChange(on);
    setLevelSavedMsg(true);
    setTimeout(() => setLevelSavedMsg(false), 2500);
  }

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
      setShowDeleteConfirm(false);
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

  const msgColor = profileMsg?.type === 'error' ? 'var(--color-danger)' : profileMsg?.type === 'success' ? 'var(--color-success)' : 'var(--color-ink-muted)';

  return (
    <div className="p-3 sm:p-6 max-w-lg mx-auto">
      <h2 className="text-xl font-bold mb-6 text-ink">{tr.accountSettings}</h2>

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
            <input style={inputStyle} type="email"
              inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value.trim().toLowerCase())} placeholder={tr.email} />
          </Field>
          <div className="mt-4 pt-4 border-t border-surface-650">
            <p className="text-xs mb-3 text-ink-faint">{tr.leaveBlankPassword}</p>
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
              className="px-5 py-2 rounded-xl text-sm font-semibold bg-brand text-surface-base"
              style={{ opacity: profileLoading ? 0.6 : 1 }}>
              {profileLoading ? tr.saving : tr.saveChanges}
            </button>
          </div>
        </form>
      </Section>

      <SubscriptionSection lang={lang} />

      {onLimitToReachChange && (
        <Section title={tr.playability || 'Playability'}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!limitToReach}
              onChange={e => handleLimitToggle(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
            />
            <span>
              <span className="block text-sm text-ink">
                {tr.limitToReachLabel || 'Limit everything to my reach & flexibility'}
                {limitSavedMsg && (
                  <span className="ml-2 text-xs font-semibold" style={{ color: 'var(--color-success)' }}>
                    {tr.saved || 'Saved'} ✓
                  </span>
                )}
              </span>
              <span className="block text-xs mt-1 text-ink-faint">
                {tr.limitToReachHelp ||
                  'Across the whole app, prefer chord shapes you can comfortably play and flag ones beyond your reach. Based on your measured hand.'}
              </span>
              <span className="block text-[11px] mt-1" style={{ color: 'var(--color-ink-ghost)' }}>
                {tr.appliesInstantly || 'Applies instantly — no need to press “Save changes”.'}
              </span>
            </span>
          </label>
          <div className="mt-3 pt-3 border-t border-surface-650 text-xs text-ink-subtle">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>Your hand: <span className={reach.color}>{reach.label}</span></span>
              <span>Flexibility: <span className={flex.color}>{flex.label}</span></span>
              <span>Comfortable ceiling: <span className="font-semibold text-brand">{reachCeiling}/10</span></span>
            </div>
            <p className="mt-1 text-ink-faint">
              {limitToReach
                ? `Shapes harder than ${reachCeiling}/10 for your hand are avoided or flagged.`
                : 'Turn on to steer the whole app toward what you can play.'}
            </p>
          </div>
        </Section>
      )}

      {onLimitToLevelChange && (
        <Section title={tr.myLevel || 'My level'}>
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={!!limitToLevel}
              onChange={e => handleLevelToggle(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
            />
            <span>
              <span className="block text-sm text-ink">
                {tr.limitToLevelLabel || 'Limit everything by my level'}
                {levelSavedMsg && (
                  <span className="ml-2 text-xs font-semibold" style={{ color: 'var(--color-success)' }}>
                    {tr.saved || 'Saved'} ✓
                  </span>
                )}
              </span>
              <span className="block text-xs mt-1 text-ink-faint">
                {tr.limitToLevelHelp ||
                  'Hide chords — and songs that use them — that are above your current level, so you only see what fits where you are on the Level Plan.'}
              </span>
              <span className="block text-[11px] mt-1" style={{ color: 'var(--color-ink-ghost)' }}>
                {tr.appliesInstantly || 'Applies instantly — no need to press “Save changes”.'}
              </span>
            </span>
          </label>
          <div className="mt-3 pt-3 border-t border-surface-650 text-xs text-ink-subtle">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>Your level: <span className="font-semibold text-brand">{tier}</span></span>
              <span>Shows chords up to: <span className="font-semibold text-brand">{levelCeil}/10</span></span>
            </div>
            <p className="mt-1 text-ink-faint">
              {limitToLevel
                ? (levelCeil >= 10
                    ? 'You’re at the top level — everything is shown.'
                    : `Chords harder than ${levelCeil}/10, and any song that uses one, are hidden.`)
                : 'Turn on to hide anything above your Level-Plan tier. Advance tiers to unlock more.'}
            </p>
          </div>
        </Section>
      )}

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
        <p className="text-xs mb-3 text-ink-subtle">{tr.deleteAccountWarning}</p>
        {deleteError && <p className="text-xs mt-2 text-danger">{deleteError}</p>}
        <div className="flex justify-end mt-3">
          <button
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleteLoading}
            className="px-5 py-2 rounded-xl text-sm font-semibold transition-opacity"
            style={{
              background: 'rgba(248,113,113,0.1)', color: 'var(--color-danger)',
              border: '1px solid rgba(248,113,113,0.3)',
              opacity: deleteLoading ? 0.4 : 1,
              cursor: 'pointer',
            }}>
            {deleteLoading ? tr.deleting : tr.deleteAccount}
          </button>
        </div>
      </Section>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-sm rounded-2xl p-5 bg-surface-base border border-surface-550">
            <h3 className="text-sm font-bold mb-2 text-danger">
              {tr.deleteConfirmTitle || 'Delete your account?'}
            </h3>
            <p className="text-xs mb-3 text-ink-subtle">
              {tr.deleteConfirmIntro || 'This is permanent and cannot be undone. It will delete:'}
            </p>
            <ul className="text-xs mb-4 text-ink-faint list-disc pl-4 space-y-1">
              <li>{tr.deleteConfirmItemAccount || 'Your account, login, and email'}</li>
              <li>{tr.deleteConfirmItemProfile || 'Your hand profile and reach settings'}</li>
              <li>{tr.deleteConfirmItemSongs || 'Your saved and imported songs'}</li>
              <li>{tr.deleteConfirmItemHistory || 'Your practice history and progress on every song'}</li>
              <li>{tr.deleteConfirmItemSubscription || 'Your subscription and billing records'}</li>
            </ul>
            <p className="text-xs mb-3 text-ink-ghost">
              {tr.deleteConfirmNote || 'Built-in catalog songs are shared content and are not affected.'}
            </p>
            <label className="block text-xs mb-1 text-ink-muted">
              {tr.deleteConfirmTypeEmail || `Type ${currentUser.email} to confirm`}
            </label>
            <input
              style={{ ...inputStyle, borderColor: deleteConfirm === currentUser.email ? 'var(--color-danger)' : 'var(--color-surface-600)' }}
              value={deleteConfirm}
              onChange={e => setDeleteConfirm(e.target.value)}
              placeholder={currentUser.email}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-600)' }}>
                {tr.cancel || 'Cancel'}
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteConfirm !== currentUser.email || deleteLoading}
                className="px-4 py-2 rounded-xl text-sm font-semibold transition-opacity"
                style={{
                  background: 'var(--color-danger)', color: 'white',
                  opacity: deleteConfirm !== currentUser.email || deleteLoading ? 0.5 : 1,
                  cursor: deleteConfirm !== currentUser.email ? 'not-allowed' : 'pointer',
                }}>
                {deleteLoading ? tr.deleting : (tr.deleteConfirmYes || 'Yes, delete my account')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
