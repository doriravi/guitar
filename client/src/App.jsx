import { useState, createContext, useContext, useEffect } from 'react';
import StartHere from './components/StartHere';
import ChordTable from './components/ChordTable';
import ProgressionExplorer from './components/ProgressionExplorer';
import HandProfileSetup from './components/HandProfileSetup';
import ChordListener from './components/ChordListener';
import TabTranscriber from './components/TabTranscriber';
import GuitarStrings from './components/GuitarStrings';
import OscilloscopeTuner from './components/OscilloscopeTuner';
import AuthModal from './components/AuthModal';
import LandingPage from './components/LandingPage';
import GuideAvatar from './components/GuideAvatar';
import AdvisorWidget from './components/AdvisorWidget';
import SongImporter from './components/SongImporter';
import AccountSettings from './components/AccountSettings';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import { DEFAULT_PROFILE } from './lib/handProfile';
import { auth, handProfile as handProfileApi, user as userApi } from './lib/api';
import { syncSongsOnLogin } from './lib/customSongs';
import { unlockAudio } from './lib/audio';
import { useT, LANGUAGES } from './lib/i18n';

function isDefaultProfile(p) {
  return Object.keys(DEFAULT_PROFILE).every(k => p[k] === DEFAULT_PROFILE[k]);
}

export const HandProfileContext = createContext(DEFAULT_PROFILE);
export function useHandProfile() { return useContext(HandProfileContext); }

export const AIFingerContext = createContext(null);
export function useAIFingers() { return useContext(AIFingerContext); }

export const LangContext = createContext('en');
export function useLang() { return useContext(LangContext); }

// The signed-in user (or null when logged out). Lets deep components (e.g. the
// Song Editor's Save button) decide whether to persist to the DB.
export const AuthContext = createContext(null);
export function useAuth() { return useContext(AuthContext); }

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

// True when the currently active tab is one that lives in the side menu — used
// to keep the ☰ Menu button highlighted while a side tab (e.g. Tuner) is open.
function SIDE_TABS_ACTIVE(tabs, activeId) {
  return tabs.some(t => t.side && t.id === activeId);
}

function getTabs(tr) {
  return [
    { id: 'start',        label: tr.tabStart || 'Start',  icon: '🚀' },
    { id: 'hand',         label: tr.tabHand,         icon: '✋' },
    { id: 'strings',      label: tr.tabStrings,      icon: '🎶' },
    { id: 'play',         label: tr.tabPlay || 'Play',        icon: '🎸', side: true },
    { id: 'scale',        label: tr.tabScale || 'Scales',     icon: '🎵', side: true },
    { id: 'chordfinder',  label: tr.tabChordFinder || 'Chord Finder', icon: '🔎', side: true },
    { id: 'tuner',        label: tr.tabTuner,        icon: '🎚️', side: true },
    { id: 'listen',       label: tr.tabListen,       icon: '🎙️' },
    { id: 'audiotab',     label: tr.tabAudioTab || 'Audio → Tab', icon: '🎼' },
    { id: 'chords',       label: tr.tabChords,       icon: '🎸' },
    { id: 'progressions', label: tr.tabProgressions, icon: '🎼' },
    { id: 'import',       label: tr.tabImport || 'Import', icon: '📋' },
  ];
}

// Spoken explanations for each tab, in plain language (used by the guide avatar).
const TAB_HELP = {
  start:        'The Start tab is your home base. It welcomes you and points you to measure your hand first.',
  hand:         'The My Hand tab is where you measure your finger reach. Everything in the app uses these measurements to score how hard each chord is for you.',
  strings:      'The Composer tab is a step editor: lay out your song beat by beat, hear it back, and read it as sheet music in any key.',
  play:         'The Play tab is a live fretboard. Tap frets to sound notes and strum any shape you build.',
  scale:        'The Scale tab shows any scale across the fretboard so you can see and hear its notes in every position.',
  chordfinder:  'The Chord Finder lets you search a chord and see its playable voicings on the fretboard, each rated for your hand.',
  tuner:        'The Tuner listens through your microphone and tells you whether each string is in tune.',
  listen:       'The Listen tab detects the chord you play and tells you what it is in real time.',
  audiotab:     'The Audio to Tab tool turns a recording or a YouTube link into guitar tablature, and scores each shape for your hand.',
  chords:       'The Chords tab is a table of chord shapes, each rated from one to ten for how hard it is for your hand.',
  import:       'The Import tab lets you paste a chord sheet and save it as your own playable song with hand-friendly chords.',
  progressions: 'The Progressions tab shows common chord sequences and famous songs, with easier voicings and capo tips tailored to your reach.',
};

export default function App() {
  const [activeTab, setActiveTab] = useState('start');
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  const [handProfile, setHandProfile] = useState(loadLocalProfile);
  const [currentUser, setCurrentUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  // Whether a never-logged-in visitor has moved past the marketing landing page
  // to the sign-in form. Skipped automatically when arriving via an email link.
  const [showSignIn, setShowSignIn] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [lang, setLang] = useState(() => localStorage.getItem('guitar_lang') || 'en');
  const [aiFingers, setAIFingers] = useState(() => {
    try { const r = localStorage.getItem('guitar_ai_fingers'); return r ? JSON.parse(r) : null; } catch { return null; }
  });
  const tr = useT(lang);

  // Apply a language choice: update UI immediately, remember it locally, and —
  // when signed in — persist it to the account so it follows the user across
  // devices. Used by the lobby picker and Account Settings (language lives on
  // the lobby / settings, not in the app header).
  function handleLangSelect(code) {
    setLang(code);
    try { localStorage.setItem('guitar_lang', code); } catch {}
    if (currentUser) {
      userApi.update({ language: code }).catch(() => {});
    }
  }

  // When a session is restored or a user signs in, switch the UI to the language
  // saved on their account (set on the lobby at registration). Falls back to the
  // current selection when the account has none.
  function adoptUserLanguage(user) {
    const code = user?.language;
    if (code && LANGUAGES.some(l => l.code === code)) {
      setLang(code);
      try { localStorage.setItem('guitar_lang', code); } catch {}
    }
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
        adoptUserLanguage(user);
        syncSongsOnLogin().catch(() => {}); // best-effort merge of saved songs
        return syncProfileOnLogin();
      })
      .then(hasProfile => {
        // hasProfile is undefined if auth.me() rejected (caught below).
        if (hasProfile === false) setNeedsOnboarding(true);
      })
      .catch(() => {})
      .finally(() => setAuthChecking(false));
  }, []);

  // iOS Safari keeps audio muted until a sound is played during a real user
  // gesture. Prime the AudioContext on the very first interaction so every
  // later play button works without the user having to "warm up" audio.
  useEffect(() => {
    const prime = () => { unlockAudio(); cleanup(); };
    const cleanup = () => {
      window.removeEventListener('touchend', prime);
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('click', prime);
    };
    window.addEventListener('touchend', prime, { once: false, passive: true });
    window.addEventListener('pointerdown', prime, { once: false });
    window.addEventListener('click', prime, { once: false });
    return cleanup;
  }, []);

  // Returns true if, after syncing, the user has a real (non-default) saved
  // hand profile — used to decide whether to send them to measure their hand.
  // For a brand-new registration (isNew), we never adopt a leftover guest
  // profile from localStorage — a new account must measure fresh.
  async function syncProfileOnLogin(isNew = false) {
    if (isNew) {
      // New account: clear any leftover guest profile so the difficulty scores
      // start from defaults and the onboarding gate fires.
      try { localStorage.removeItem('guitar_hand_profile'); } catch {}
      setHandProfile(DEFAULT_PROFILE);
      return false;
    }
    const remote = await handProfileApi.get().catch(() => null);
    if (remote && !isDefaultProfile(remote)) {
      // Server has a real profile — always use it as source of truth
      const merged = { ...DEFAULT_PROFILE, ...remote };
      setHandProfile(merged);
      try { localStorage.setItem('guitar_hand_profile', JSON.stringify(merged)); } catch {}
      return true;
    } else {
      // Returning login with only defaults server-side — push a customised
      // guest profile if one exists locally.
      const local = loadLocalProfile();
      if (!isDefaultProfile(local)) {
        await handProfileApi.save(local).catch(() => {});
        return true;
      }
      return false;
    }
  }

  async function handleSaveProfile(profile) {
    setHandProfile(profile);
    setSaveError(false);
    try { localStorage.setItem('guitar_hand_profile', JSON.stringify(profile)); } catch {}
    // Saving a real (non-default) measurement clears the onboarding gate.
    if (!isDefaultProfile(profile)) setNeedsOnboarding(false);
    if (currentUser) {
      try { await handProfileApi.save(profile); }
      catch { setSaveError(true); }
    }
  }

  function handleAuthSuccess(user, opts = {}) {
    setCurrentUser(user);
    adoptUserLanguage(user);
    setShowAuth(false);
    if (!opts.isNew) syncSongsOnLogin().catch(() => {}); // merge saved songs (not for fresh accounts)
    // After a successful login/registration, force users who have never saved a
    // real hand profile through the mandatory measurement step before the rest
    // of the app becomes available. A new registration always onboards.
    syncProfileOnLogin(opts.isNew)
      .then(hasProfile => { setNeedsOnboarding(!hasProfile); })
      .catch(() => {});
  }

  async function handleLogout() {
    await auth.logout().catch(() => {});
    localStorage.removeItem('guitar_hand_profile');
    window.location.reload();
  }

  // After the account is deleted server-side, sign the user out (clear cookies +
  // local data) and return to the login screen.
  async function handleDeleted() {
    await auth.logout().catch(() => {});
    try {
      localStorage.removeItem('guitar_hand_profile');
      localStorage.removeItem('guitar_ai_fingers');
    } catch {}
    window.location.reload();
  }

  function handleSaveAIFingers(fingers) {
    setAIFingers(fingers);
    try { localStorage.setItem('guitar_ai_fingers', JSON.stringify(fingers)); } catch {}
  }

  // Shared app header (logo + language selector + account/sign-out). Used by
  // both the onboarding gate and the main app shell so there's one source of
  // truth for the header.
  function renderHeader() {
    return (
      <header className="border-b border-surface-700">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
          <span className="text-xl sm:text-2xl">🎸</span>
          <div className="flex-1">
            <h1 className="text-sm sm:text-base font-bold tracking-tight leading-none text-ink">
              Guitar Reach
            </h1>
            <p className="text-xs mt-0.5 hidden sm:block text-ink-faint">
              {tr.appSubtitle}
            </p>
          </div>
          {currentUser ? (
            <div className="flex items-center gap-2">
              <button onClick={() => setShowSettings(true)}
                className="text-xs hidden sm:block text-ink-muted">
                {currentUser.email}
                {!currentUser.emailVerified && <span className="text-warning"> ⚠</span>}
              </button>
              <button onClick={() => setShowSettings(true)}
                data-explain="The Settings button opens your account — change your name, email, password, language, or delete your account."
                className="text-xs px-2 py-1 rounded text-brand border border-surface-550">
                {tr.settings}
              </button>
              <button onClick={handleLogout}
                data-explain="The Sign out button logs you out of your account and returns you to the welcome screen."
                className="text-xs px-2 py-1 rounded text-ink-muted border border-surface-550">
                {tr.signOut}
              </button>
            </div>
          ) : (
            <button onClick={() => setShowAuth(true)}
              className="text-xs px-3 py-1.5 rounded-lg font-semibold bg-brand text-surface-base">
              {tr.signIn}
            </button>
          )}
        </div>
      </header>
    );
  }

  // --- Auth gate: the app requires login. Until the user is authenticated,
  // the login screen IS the landing page (no app shell behind it). ---
  if (authChecking) {
    return (
      <LangContext.Provider value={lang}>
        <div className="min-h-screen flex items-center justify-center bg-surface-base text-ink-muted">
          <span className="text-sm">{tr.pleaseWait}</span>
        </div>
      </LangContext.Provider>
    );
  }

  if (!currentUser) {
    // Never-logged-in visitors land on the marketing page first; the CTA reveals
    // the sign-in form. Email-link flows (reset/forgot) skip straight to the form.
    const inEmailFlow = showResetModal || showForgot;
    if (!inEmailFlow && !showSignIn) {
      return (
        <LangContext.Provider value={lang}>
          <LandingPage
            onGetStarted={() => setShowSignIn(true)}
            langSlot={
              <select
                value={lang}
                onChange={e => handleLangSelect(e.target.value)}
                aria-label="Language"
                style={{ background: 'var(--color-surface-800)', color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-600)',
                  borderRadius: 9, padding: '7px 10px', fontSize: 13 }}
              >
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            }
          />
        </LangContext.Provider>
      );
    }
    return (
      <LangContext.Provider value={lang}>
        <div className="min-h-screen bg-surface-base">
          {showResetModal ? (
            <ResetPassword
              token={resetToken}
              onDone={() => {
                setShowResetModal(false);
                window.history.replaceState({}, '', window.location.pathname);
              }}
              lang={lang}
            />
          ) : showForgot ? (
            <ForgotPassword
              onClose={() => setShowForgot(false)}
              onSwitchToLogin={() => setShowForgot(false)}
              lang={lang}
            />
          ) : (
            <AuthModal
              fullPage
              onSuccess={handleAuthSuccess}
              onForgotPassword={() => setShowForgot(true)}
              onBack={() => setShowSignIn(false)}
              lang={lang}
              onLangSelect={handleLangSelect}
            />
          )}
          {verifyMsg && (
            <div className="fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-xs font-medium z-50"
              style={{
                background: verifyMsg.type === 'success' ? 'rgba(74,222,128,0.12)' : 'rgba(248,113,113,0.12)',
                border: `1px solid ${verifyMsg.type === 'success' ? 'rgba(74,222,128,0.3)' : 'rgba(248,113,113,0.3)'}`,
                color: verifyMsg.type === 'success' ? '#4ade80' : '#f87171',
              }}>
              {verifyMsg.type === 'success' ? tr.emailVerified : tr.emailVerifyFailed}
            </div>
          )}
        </div>
      </LangContext.Provider>
    );
  }

  // --- Onboarding gate: a logged-in user with no real measured hand profile
  // must complete and save a measurement before the rest of the app is shown.
  if (needsOnboarding) {
    return (
      <LangContext.Provider value={lang}>
      <AIFingerContext.Provider value={aiFingers}>
      <HandProfileContext.Provider value={handProfile}>
        <div className="min-h-screen bg-surface-base">
          {showSettings && currentUser && (
            <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70" onClick={e => e.target === e.currentTarget && setShowSettings(false)}>
              <div className="min-h-screen flex items-start justify-center py-10 px-4">
                <div className="w-full max-w-lg rounded-2xl relative bg-surface-base border border-surface-550">
                  <button onClick={() => setShowSettings(false)}
                    className="absolute top-4 right-4 text-xl leading-none text-ink-muted">×</button>
                  <AccountSettings
                    currentUser={currentUser}
                    onUpdated={updated => setCurrentUser(updated)}
                    onDeleted={handleDeleted}
                    lang={lang}
                    onLangSelect={handleLangSelect}
                  />
                </div>
              </div>
            </div>
          )}

          {renderHeader()}

          <main className="max-w-4xl mx-auto px-2 sm:px-4 pt-3 sm:pt-6 pb-20">
            <div className="mb-4 px-4 py-3 rounded-xl text-sm leading-relaxed"
              style={{ background: 'rgba(201,169,110,0.06)', border: '1px solid rgba(201,169,110,0.15)', color: '#c9a96e' }}>
              {tr.measureFirstPrompt ||
                'First, measure your hand so we can personalize difficulty scores. This takes about a minute.'}
            </div>
            <div className="rounded-2xl overflow-hidden bg-surface-850 border border-surface-700">
              <HandProfileSetup
                profile={handProfile}
                onSave={handleSaveProfile}
                onSaveAIFingers={handleSaveAIFingers}
                saveError={saveError}
                lang={lang}
              />
            </div>
          </main>
        </div>
      </HandProfileContext.Provider>
      </AIFingerContext.Provider>
      </LangContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={currentUser}>
    <LangContext.Provider value={lang}>
    <AIFingerContext.Provider value={aiFingers}>
    <HandProfileContext.Provider value={handProfile}>
      <div className="min-h-screen bg-surface-base">

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
              <div className="w-full max-w-lg rounded-2xl relative bg-surface-base border border-surface-550">
                <button onClick={() => setShowSettings(false)}
                  className="absolute top-4 right-4 text-xl leading-none" style={{ color: '#888' }}>×</button>
                <AccountSettings
                  currentUser={currentUser}
                  onUpdated={updated => setCurrentUser(updated)}
                  onDeleted={handleDeleted}
                  lang={lang}
                  onLangSelect={handleLangSelect}
                />
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        {renderHeader()}

        {/* Side-menu toggle — fixed at the top-left of the screen. */}
        <button
          onClick={() => setSideMenuOpen(true)}
          aria-label={tr.menu || 'Menu'}
          data-explain="Opens the side menu with extra tools, like the Tuner."
          className="fixed top-3 left-3 z-30 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition-all"
          style={{
            background: 'var(--color-surface-800)', border: '1px solid var(--color-surface-600)',
            color: SIDE_TABS_ACTIVE(getTabs(tr), activeTab) ? 'var(--color-brand)' : 'var(--color-ink-muted)',
            boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-ink)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = SIDE_TABS_ACTIVE(getTabs(tr), activeTab) ? 'var(--color-brand)' : 'var(--color-ink-muted)'; }}
        >
          <span className="text-base leading-none">☰</span>
          <span className="hidden sm:inline">{tr.menu || 'Menu'}</span>
        </button>

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

          {/* Tab bar — main tabs inline; tabs flagged `side` live in the side menu,
              opened by the ☰ button. The active side tab stays highlighted here too. */}
          <div className="flex items-stretch gap-0.5 sm:gap-1 mb-3 sm:mb-5 p-1 rounded-xl bg-surface-800"
            data-explain="This is the tab bar. Each tab opens a different tool — your hand profile, chord tables, song progressions, and more. The menu button at the top-left of the screen opens extra tools like the tuner.">
            {getTabs(tr).filter(t => !t.side).map(tab => (
              <button
                key={tab.id}
                data-explain={TAB_HELP[tab.id] || `Opens the ${tab.label} tool.`}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-0 sm:gap-2 px-1 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs font-semibold transition-all"
                style={activeTab === tab.id ? {
                  background: 'var(--color-surface-700)', color: 'var(--color-brand)', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                } : { color: 'var(--color-ink-faint)' }}
                onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.color = 'var(--color-ink-muted)'; }}
                onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.color = 'var(--color-ink-faint)'; }}
              >
                <span className="text-base sm:text-sm leading-none">{tab.icon}</span>
                <span className="text-[10px] sm:text-xs mt-0.5 sm:mt-0 leading-tight">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Side menu — slide-in drawer for tabs flagged `side` (e.g. the Tuner). */}
          {sideMenuOpen && (
            <div className="fixed inset-0 z-40" onClick={() => setSideMenuOpen(false)}>
              <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} />
              <aside
                onClick={e => e.stopPropagation()}
                className="absolute top-0 left-0 h-full w-64 max-w-[80vw] p-4 flex flex-col gap-1"
                style={{ background: 'var(--color-surface-800)', borderRight: '1px solid var(--color-surface-600)', boxShadow: '2px 0 24px rgba(0,0,0,0.5)' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    {tr.menu || 'Menu'}
                  </span>
                  <button onClick={() => setSideMenuOpen(false)} aria-label="Close"
                    className="text-lg leading-none px-1 text-ink-faint">×</button>
                </div>
                {getTabs(tr).filter(t => t.side).map(tab => (
                  <button
                    key={tab.id}
                    data-explain={TAB_HELP[tab.id] || `Opens the ${tab.label} tool.`}
                    onClick={() => { setActiveTab(tab.id); setSideMenuOpen(false); }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all text-left"
                    style={activeTab === tab.id
                      ? { background: 'var(--color-surface-700)', color: 'var(--color-brand)' }
                      : { color: 'var(--color-ink-muted)' }}
                    onMouseEnter={e => { if (activeTab !== tab.id) e.currentTarget.style.color = 'var(--color-ink)'; }}
                    onMouseLeave={e => { if (activeTab !== tab.id) e.currentTarget.style.color = 'var(--color-ink-muted)'; }}
                  >
                    <span className="text-base leading-none">{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                ))}
              </aside>
            </div>
          )}

          {/* Content */}
          <div className="rounded-2xl overflow-hidden bg-surface-850 border border-surface-700">
            {activeTab === 'start'        && <StartHere lang={lang} onGoToHand={() => setActiveTab('hand')} />}
            {activeTab === 'hand'         && <HandProfileSetup profile={handProfile} onSave={handleSaveProfile} onSaveAIFingers={handleSaveAIFingers} saveError={saveError} lang={lang} />}
            {activeTab === 'strings'      && <GuitarStrings lang={lang} mode="editor" />}
            {activeTab === 'play'         && <GuitarStrings lang={lang} mode="play" />}
            {activeTab === 'scale'        && <GuitarStrings lang={lang} mode="scale" />}
            {activeTab === 'chordfinder'  && <GuitarStrings lang={lang} mode="chord" />}
            {activeTab === 'tuner'        && <OscilloscopeTuner lang={lang} />}
            {activeTab === 'listen'       && <ChordListener lang={lang} />}
            {activeTab === 'audiotab'     && <TabTranscriber />}
            {activeTab === 'chords'       && <ChordTable lang={lang} />}
            {activeTab === 'progressions' && <ProgressionExplorer lang={lang} onSaveProfile={handleSaveProfile} />}
            {activeTab === 'import'       && <SongImporter />}
          </div>
        </main>

        {/* Draggable guide: drag onto (or click then click) any component to
            hear what it does. Voice via the browser's speech synthesis. */}
        <GuideAvatar userName={currentUser?.name} />

        {/* Floating AI advisor — music-theory + guitar + this-app consultant */}
        <AdvisorWidget activeTab={activeTab} />
      </div>
    </HandProfileContext.Provider>
    </AIFingerContext.Provider>
    </LangContext.Provider>
    </AuthContext.Provider>
  );
}
