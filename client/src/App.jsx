import { useState, createContext, useContext, useEffect } from 'react';
import ChordTable from './components/ChordTable';
import TripletTable from './components/TripletTable';
import ProgressionExplorer from './components/ProgressionExplorer';
import HandProfileSetup from './components/HandProfileSetup';
import ChordListener from './components/ChordListener';
import GuitarStrings from './components/GuitarStrings';
import OscilloscopeTuner from './components/OscilloscopeTuner';
import AuthModal from './components/AuthModal';
import AccountSettings from './components/AccountSettings';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import { DEFAULT_PROFILE } from './lib/handProfile';
import { auth, handProfile as handProfileApi, user as userApi } from './lib/api';
import { useT } from './lib/i18n';

function isDefaultProfile(p) {
  return Object.keys(DEFAULT_PROFILE).every(k => p[k] === DEFAULT_PROFILE[k]);
}

export const HandProfileContext = createContext(DEFAULT_PROFILE);
export function useHandProfile() { return useContext(HandProfileContext); }

export const LangContext = createContext('en');
export function useLang() { return useContext(LangContext); }

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ar', label: 'العربية' },
  { code: 'pt', label: 'Português' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
];

function loadLocalProfile() {
  try {
    const raw = localStorage.getItem('guitar_hand_profile');
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PROFILE;
}

function getTokenFromUrl(param) {
  return new URLSearchParams(window.location.search).get(param);
}

function getTabs(tr) {
  return [
    { id: 'hand',         label: tr.tabHand,         icon: '✋' },
    { id: 'strings',      label: tr.tabStrings,      icon: '🎶' },
    { id: 'tuner',        label: tr.tabTuner,        icon: '🎚️' },
    { id: 'listen',       label: tr.tabListen,       icon: '🎙️' },
    { id: 'chords',       label: tr.tabChords,       icon: '🎸' },
    { id: 'triplets',     label: tr.tabTriplets,     icon: '🎵' },
    { id: 'progressions', label: tr.tabProgressions, icon: '🎼' },
  ];
}

export default function App() {
  const [activeTab, setActiveTab] = useState('hand');
  const [handProfile, setHandProfile] = useState(loadLocalProfile);
  const [currentUser, setCurrentUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [lang, setLang] = useState(() => localStorage.getItem('guitar_lang') || 'en');
  const [showLangMenu, setShowLangMenu] = useState(false);
  const tr = useT(lang);

  function handleLangSelect(code) {
    setLang(code);
    localStorage.setItem('guitar_lang', code);
    setShowLangMenu(false);
  }

  // Handle deep-link tokens from email links
  const resetToken = getTokenFromUrl('reset-password') ? getTokenFromUrl('reset-password') : null;
  const verifyToken = getTokenFromUrl('verify-email') ? getTokenFromUrl('verify-email') : null;
  const [verifyMsg, setVerifyMsg] = useState(null);
  const [showResetModal, setShowResetModal] = useState(!!resetToken);

  // Handle email verification token from URL on mount
  useEffect(() => {
    if (verifyToken) {
      userApi.verifyEmail(verifyToken)
        .then(() => {
          setVerifyMsg({ type: 'success', text: 'Email verified! You can now sign in.' });
          window.history.replaceState({}, '', window.location.pathname);
        })
        .catch(() => {
          setVerifyMsg({ type: 'error', text: 'Verification link is invalid or expired.' });
        });
    }
  }, []);

  // Restore session from httpOnly cookie on mount
  useEffect(() => {
    auth.me()
      .then(user => {
        setCurrentUser(user);
        return syncProfileOnLogin();
      })
      .catch(() => {});
  }, []);

  async function syncProfileOnLogin() {
    const remote = await handProfileApi.get().catch(() => null);
    if (remote && !isDefaultProfile(remote)) {
      // Server has a real profile — always use it as source of truth
      const merged = { ...DEFAULT_PROFILE, ...remote };
      setHandProfile(merged);
      try { localStorage.setItem('guitar_hand_profile', JSON.stringify(merged)); } catch {}
    } else {
      // Server has defaults — push local if the user customised it as a guest
      const local = loadLocalProfile();
      if (!isDefaultProfile(local)) {
        await handProfileApi.save(local).catch(() => {});
      }
    }
  }

  async function handleSaveProfile(profile) {
    setHandProfile(profile);
    setSaveError(false);
    try { localStorage.setItem('guitar_hand_profile', JSON.stringify(profile)); } catch {}
    if (currentUser) {
      try { await handProfileApi.save(profile); }
      catch { setSaveError(true); }
    }
  }

  function handleAuthSuccess(user) {
    setCurrentUser(user);
    setShowAuth(false);
    syncProfileOnLogin().catch(() => {});
  }

  async function handleLogout() {
    await auth.logout().catch(() => {});
    localStorage.removeItem('guitar_hand_profile');
    window.location.reload();
  }

  return (
    <LangContext.Provider value={lang}>
    <HandProfileContext.Provider value={handProfile}>
      <div className="min-h-screen" style={{ background: '#0f0f0f' }}>

        {showAuth && !showForgot && (
          <AuthModal
            onSuccess={handleAuthSuccess}
            onClose={() => setShowAuth(false)}
            onForgotPassword={() => { setShowAuth(false); setShowForgot(true); }}
            lang={lang}
          />
        )}

        {showForgot && (
          <ForgotPassword
            onClose={() => setShowForgot(false)}
            onSwitchToLogin={() => { setShowForgot(false); setShowAuth(true); }}
            lang={lang}
          />
        )}

        {showResetModal && (
          <ResetPassword
            token={resetToken}
            onDone={() => {
              setShowResetModal(false);
              window.history.replaceState({}, '', window.location.pathname);
              setShowAuth(true);
            }}
            lang={lang}
          />
        )}

        {showSettings && currentUser && (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70" onClick={e => e.target === e.currentTarget && setShowSettings(false)}>
            <div className="min-h-screen flex items-start justify-center py-10 px-4">
              <div className="w-full max-w-lg rounded-2xl relative" style={{ background: '#0f0f0f', border: '1px solid #2a2a2a' }}>
                <button onClick={() => setShowSettings(false)}
                  className="absolute top-4 right-4 text-xl leading-none" style={{ color: '#888' }}>×</button>
                <AccountSettings
                  currentUser={currentUser}
                  onUpdated={updated => setCurrentUser(updated)}
                  onDeleted={() => { localStorage.removeItem('guitar_hand_profile'); window.location.reload(); }}
                  lang={lang}
                />
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <header style={{ borderBottom: '1px solid #1e1e1e' }}>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
            <span className="text-xl sm:text-2xl">🎸</span>
            <div className="flex-1">
              <h1 className="text-sm sm:text-base font-bold tracking-tight leading-none" style={{ color: '#f0ede8' }}>
                Guitar Reach
              </h1>
              <p className="text-xs mt-0.5 hidden sm:block" style={{ color: '#5a5a5a' }}>
                {tr.appSubtitle}
              </p>
            </div>
            {/* Language selector */}
            <div className="relative">
              <button
                onClick={() => setShowLangMenu(v => !v)}
                className="text-xs px-2 py-1 rounded flex items-center gap-1"
                style={{ color: '#888', border: '1px solid #2a2a2a' }}
              >
                🌐 {LANGUAGES.find(l => l.code === lang)?.label}
              </button>
              {showLangMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowLangMenu(false)} />
                  <div
                    className="absolute right-0 mt-1 rounded-xl overflow-hidden z-50"
                    style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', minWidth: '130px' }}
                  >
                  {LANGUAGES.map(l => (
                    <button
                      key={l.code}
                      onClick={() => handleLangSelect(l.code)}
                      className="w-full text-left text-xs px-3 py-2 transition-colors"
                      style={{
                        color: l.code === lang ? '#c9a96e' : '#aaa',
                        background: l.code === lang ? 'rgba(201,169,110,0.08)' : 'transparent',
                      }}
                      onMouseEnter={e => { if (l.code !== lang) e.currentTarget.style.background = '#222'; }}
                      onMouseLeave={e => { if (l.code !== lang) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
                </>
              )}
            </div>

            {currentUser ? (
              <div className="flex items-center gap-2">
                <button onClick={() => setShowSettings(true)}
                  className="text-xs hidden sm:block" style={{ color: '#888' }}>
                  {currentUser.email}
                  {!currentUser.emailVerified && <span style={{ color: '#fb923c' }}> ⚠</span>}
                </button>
                <button onClick={() => setShowSettings(true)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: '#c9a96e', border: '1px solid #2a2a2a' }}>
                  {tr.settings}
                </button>
                <button onClick={handleLogout}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: '#888', border: '1px solid #2a2a2a' }}>
                  {tr.signOut}
                </button>
              </div>
            ) : (
              <button onClick={() => setShowAuth(true)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                style={{ background: '#c9a96e', color: '#0f0f0f' }}>
                {tr.signIn}
              </button>
            )}
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-2 sm:px-4 pt-3 sm:pt-6 pb-20">

          {/* Email verify banner */}
          {verifyMsg && (
            <div className="mb-4 px-4 py-2 rounded-xl text-xs font-medium flex items-center justify-between"
              style={{
                background: verifyMsg.type === 'success' ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
                border: `1px solid ${verifyMsg.type === 'success' ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.2)'}`,
                color: verifyMsg.type === 'success' ? '#4ade80' : '#f87171',
              }}>
              <span>{verifyMsg.type === 'success' ? tr.emailVerified : tr.emailVerifyFailed}</span>
              <button onClick={() => setVerifyMsg(null)} style={{ color: 'inherit', opacity: 0.6 }}>×</button>
            </div>
          )}

          {/* Tab bar */}
          <div className="flex gap-0.5 sm:gap-1 mb-3 sm:mb-5 p-1 rounded-xl" style={{ background: '#161616' }}>
            {getTabs(tr).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-0 sm:gap-2 px-1 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs font-semibold transition-all"
                style={activeTab === tab.id ? {
                  background: '#1e1e1e', color: '#c9a96e', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                } : { color: '#5a5a5a' }}
                onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.color = '#a0a0a0'; }}
                onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.color = '#5a5a5a'; }}
              >
                <span className="text-base sm:text-sm leading-none">{tab.icon}</span>
                <span className="text-[10px] sm:text-xs mt-0.5 sm:mt-0 leading-tight">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="rounded-2xl overflow-hidden" style={{ background: '#141414', border: '1px solid #1e1e1e' }}>
            {activeTab === 'hand'         && <HandProfileSetup profile={handProfile} onSave={handleSaveProfile} saveError={saveError} lang={lang} />}
            {activeTab === 'strings'      && <GuitarStrings lang={lang} />}
            {activeTab === 'tuner'        && <OscilloscopeTuner lang={lang} />}
            {activeTab === 'listen'       && <ChordListener lang={lang} />}
            {activeTab === 'chords'       && <ChordTable lang={lang} />}
            {activeTab === 'triplets'     && <TripletTable lang={lang} />}
            {activeTab === 'progressions' && <ProgressionExplorer lang={lang} />}
          </div>
        </main>
      </div>
    </HandProfileContext.Provider>
    </LangContext.Provider>
  );
}
