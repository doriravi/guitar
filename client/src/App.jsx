import { useState, createContext, useContext, useEffect } from 'react';
import StartHere from './components/StartHere';
import LevelPlan from './components/LevelPlan';
import FretboardMeasures from './components/FretboardMeasures';
import ChordTable from './components/ChordTable';
import ProgressionExplorer from './components/ProgressionExplorer';
import MusicMemory from './components/MusicMemory';
import HandProfileSetup from './components/HandProfileSetup';
import ChordListener from './components/ChordListener';
import TabTranscriber from './components/TabTranscriber';
import GuitarStrings from './components/GuitarStrings';
import FretboardNoteMap from './components/FretboardNoteMap';
import VirtualFretboard from './components/VirtualFretboard';
import OscilloscopeTuner from './components/OscilloscopeTuner';
import AuthModal from './components/AuthModal';
import LandingPage from './components/LandingPage';
import GuideAvatar from './components/GuideAvatar';
import AdvisorWidget from './components/AdvisorWidget';
import SongImporter from './components/SongImporter';
import AccountSettings from './components/AccountSettings';
import Paywall from './components/Paywall';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import Lazy3D from './components/Lazy3D';
import { DEFAULT_PROFILE } from './lib/handProfile';

// Static-literal dynamic import → shares the lazily-fetched three-vendor chunk.
const loadAmbient = () => import('./components/three/AmbientBackground');
import { auth, handProfile as handProfileApi, user as userApi, subscriptions as subscriptionsApi, onPaymentRequired } from './lib/api';
import { syncSongsOnLogin } from './lib/customSongs';
import { unlockAudio } from './lib/audio';
import { useT, LANGUAGES } from './lib/i18n';
import { usePwaInstall } from './lib/usePwaInstall';

function isDefaultProfile(p) {
  return Object.keys(DEFAULT_PROFILE).every(k => p[k] === DEFAULT_PROFILE[k]);
}

export const HandProfileContext = createContext(DEFAULT_PROFILE);
export function useHandProfile() { return useContext(HandProfileContext); }

// Global "limit me to my reach & flexibility" preference. When on, the whole app
// steers toward chord shapes the user can comfortably play (easier voicings are
// auto-preferred, out-of-reach shapes are flagged). Read via useReachLimit().
export const ReachLimitContext = createContext(false);
export function useReachLimit() { return useContext(ReachLimitContext); }

// Global "limit everything by my level" preference. When on, chords — and songs
// containing them — harder than the user's current Level-Plan tier allows are
// hidden across the app (skill-based, distinct from the hand-reach limit above).
// Read via useLevelLimit().
export const LevelLimitContext = createContext(false);
export function useLevelLimit() { return useContext(LevelLimitContext); }

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

function loadLimitToLevel() {
  try { return localStorage.getItem('guitar_limit_to_level') === '1'; } catch { return false; }
}
function loadLimitToReach() {
  try { return localStorage.getItem('guitar_limit_to_reach') === '1'; } catch { return false; }
}

function getTokenFromUrl(param) {
  return new URLSearchParams(window.location.search).get(param);
}

// True when the currently active tab is one that lives in the side menu — used
// to keep the ☰ Menu button highlighted while a side tab (e.g. Tuner) is open.
function SIDE_TABS_ACTIVE(tabs, activeId) {
  return tabs.some(t => t.side && t.id === activeId);
}

// Side-menu entry that lets users install the PWA on demand, in case the
// browser's own install prompt was dismissed or never surfaced. On Android/
// desktop it fires the native install dialog; on iOS/iPadOS it reveals the
// Share → "Add to Home Screen" instructions. Hidden when already installed
// and the browser offers no install path.
function InstallMenuItem({ tr, onClose }) {
  const { canInstall, ios, installed, promptInstall } = usePwaInstall();
  const [showIosHelp, setShowIosHelp] = useState(false);

  if (installed || (!canInstall && !ios)) return null;

  const label = tr.installApp || 'Install app';

  const handle = async () => {
    if (canInstall) {
      await promptInstall();
      onClose();
    } else {
      setShowIosHelp(v => !v);
    }
  };

  return (
    <div className="mt-auto pt-2" style={{ borderTop: '1px solid var(--color-surface-600)' }}>
      <button
        onClick={handle}
        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all text-left"
        style={{ color: 'var(--color-brand)' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-700)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        <span className="text-base leading-none">📲</span>
        <span>{label}</span>
      </button>
      {showIosHelp && (
        <p className="px-3 pb-2 text-xs leading-relaxed" style={{ color: 'var(--color-ink-muted)' }}>
          {tr.installIosHint || 'Tap the Share button, then “Add to Home Screen”.'}
        </p>
      )}
    </div>
  );
}

function getTabs(tr) {
  return [
    { id: 'start',        label: tr.tabStart || 'Start',  icon: '🚀', side: true },
    { id: 'hand',         label: tr.tabHand,         icon: '✋' },
    { id: 'strings',      label: tr.tabStrings,      icon: '🎶' },
    { id: 'play',         label: tr.tabPlay || 'Play',        icon: '🎸', side: true },
    { id: 'scale',        label: tr.tabScale || 'Scales',     icon: '🎵', side: true },
    { id: 'memory',       label: tr.tabMemory || 'Music Memory', icon: '🧠', side: true },
    { id: 'chordfinder',  label: tr.tabChordFinder || 'Chord Finder', icon: '🔎', side: true },
    { id: 'tuner',        label: tr.tabTuner,        icon: '🎚️', side: true },
    { id: 'recorder',     label: tr.tabRecorder || 'Recorder',     icon: '🎤', side: true },
    { id: 'micpractice',  label: tr.tabMicPractice || 'Practice',  icon: '🎸', side: true },
    { id: 'mictune',      label: tr.tabMicTune || 'Mic Tune',      icon: '⚙️', side: true },
    { id: 'listen',       label: tr.tabPlayAlong || 'Play-Along',  icon: '🎮' },
    { id: 'notemap',      label: tr.tabNoteMap || 'Note Map',      icon: '🎼', side: true },
    { id: 'virtual',      label: tr.tabVirtual || 'Virtual Neck',  icon: '🎸', side: true },
    { id: 'levelplan',    label: tr.tabLevelPlan || 'Level Plan', icon: '🗺️', side: true },
    { id: 'fbmeasure',    label: tr.tabFretboardMeasures || 'Fretboard Measures', icon: '📏', side: true },
    { id: 'audiotab',     label: tr.tabAudioTab || 'Audio → Tab', icon: '🎼', side: true },
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
  memory:       'Music Memory is an ear-training drill wrapped in a calming routine. The app plays or names a note, interval, chord, scale degree, or progression; you answer by singing, humming, or playing into the mic; it grades your ear and guides your breathing between rounds.',
  chordfinder:  'The Chord Finder lets you search a chord and see its playable voicings on the fretboard, each rated for your hand.',
  tuner:        'The Tuner listens through your microphone and tells you whether each string is in tune.',
  recorder:     'The Recorder listens through your microphone and names the chords you play in real time.',
  micpractice:  'Practice mode shows you a chord to play and checks with the microphone that you hit it.',
  mictune:      'Mic Tune adjusts how the chord detector hears you — sensitivity, snapshot rate, and scan range.',
  listen:       'Play-Along is a game: chords scroll in time with a song while the microphone listens, scores each change, and tracks your improvement.',
  notemap:      'The Note Map labels every note on the fretboard (all strings and frets). Hit "Listen & improvise" and play a chord — it lights up the chord tones and the scale you can solo with over it.',
  virtual:      'The Virtual Neck draws its own fretboard instead of detecting your real one — no calibration. It tracks your hand and maps your fingertips onto the virtual grid, marking any finger it cannot actually see as unconfirmed.',
  levelplan:    'The Level Plan is your roadmap from Beginner to Master. It tracks the milestones the app can measure and points you to the exact tab to practice the rest.',
  fbmeasure:    'Fretboard Measures visualizes the physical geometry of the neck and measures the exact horizontal, vertical, and diagonal hand stretch between the fingers you place, in millimetres.',
  audiotab:     'The Audio to Tab tool turns a recording or a YouTube link into guitar tablature, and scores each shape for your hand.',
  chords:       'The Chords tab is a table of chord shapes, each rated from one to ten for how hard it is for your hand.',
  import:       'The Import tab lets you paste a chord sheet and save it as your own playable song with hand-friendly chords.',
  progressions: 'The Progressions tab shows common chord sequences and famous songs, with easier voicings and capo tips tailored to your reach.',
};

export default function App() {
  const [activeTab, setActiveTab] = useState('start');
  // Optional chord sequence handed to the mic Practice screen when a Level Plan
  // milestone routes there for a guided walk (e.g. "Learn C A G E D").
  const [practiceSequence, setPracticeSequence] = useState(null);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  // Switch tabs by hand (tab bar / ☰ menu). Always clears any pending guided
  // practice sequence so opening Practice normally shows the free-pick screen,
  // not a stale Level-Plan walk.
  const selectTab = (id) => { setPracticeSequence(null); setActiveTab(id); };
  const [handProfile, setHandProfile] = useState(loadLocalProfile);
  const [limitToReach, setLimitToReach] = useState(loadLimitToReach);
  const [limitToLevel, setLimitToLevel] = useState(loadLimitToLevel);
  const [currentUser, setCurrentUser] = useState(null);
  // Guest mode: use the app without an account. Nothing is persisted — the hand
  // profile and any edits live only in this tab's memory and vanish on close.
  const [guestMode, setGuestMode] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  // Whether a never-logged-in visitor has moved past the marketing landing page
  // to the sign-in form. Skipped automatically when arriving via an email link,
  // or via ?login=1 (used after account deletion to land straight on sign-in).
  const [showSignIn, setShowSignIn] = useState(() => getTokenFromUrl('login') === '1');
  const [showForgot, setShowForgot] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Paywall: using the backend costs $10/year. `paywalled` is raised either by
  // the subscription status check on login, or reactively by ANY api call that
  // comes back 402 (see onPaymentRequired in lib/api.js). Guests are never
  // paywalled — they already get no backend.
  const [paywalled, setPaywalled] = useState(false);
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

  // Toggle the app-wide "limit to my reach & flexibility" preference (persisted
  // locally so it survives reloads and applies whether signed in or not).
  function handleLimitToReach(on) {
    setLimitToReach(on);
    try { localStorage.setItem('guitar_limit_to_reach', on ? '1' : '0'); } catch {}
  }

  // Toggle the app-wide "limit everything by my level" preference (persisted
  // locally, applies whether signed in or not — the same as limitToReach).
  function handleLimitToLevel(on) {
    setLimitToLevel(on);
    try { localStorage.setItem('guitar_limit_to_level', on ? '1' : '0'); } catch {}
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

  // ── Paywall ────────────────────────────────────────────────────────────────
  // Any API call that comes back 402 means "signed in, but the yearly pass isn't
  // paid". Listening centrally means a feature added later is covered without
  // touching it: whichever call trips the server's gate raises this screen.
  useEffect(() => onPaymentRequired(() => setPaywalled(true)), []);

  // Check paid status whenever a user session appears, so the paywall shows up
  // front rather than on the first feature they try. Read-only and fail-open on
  // a network error — the SERVER is the real gate, so a flaky status check must
  // never lock out someone who has actually paid.
  useEffect(() => {
    if (!currentUser) { setPaywalled(false); return; }
    let alive = true;
    subscriptionsApi.getStatus()
      .then(sub => { if (alive) setPaywalled(!sub?.active); })
      .catch(() => {});
    return () => { alive = false; };
  }, [currentUser]);

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
  // gesture, AND mutes Web Audio entirely when the hardware silent switch is on
  // (unless we promote to the media audio session — see enableMediaPlayback).
  // We prime on EVERY interaction (not just the first): iOS can drop the audio
  // session when the tab is backgrounded or after the embedded video plays, so
  // re-asserting it on each gesture keeps later play buttons audible. unlockAudio()
  // is cheap/idempotent, so re-running it per tap is harmless.
  useEffect(() => {
    const prime = () => { unlockAudio(); };
    window.addEventListener('touchend', prime, { passive: true });
    window.addEventListener('pointerdown', prime);
    window.addEventListener('click', prime);
    // Re-assert the media session when returning to the tab (iOS suspends it).
    const onVisible = () => { if (document.visibilityState === 'visible') unlockAudio(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('touchend', prime);
      window.removeEventListener('pointerdown', prime);
      window.removeEventListener('click', prime);
      document.removeEventListener('visibilitychange', onVisible);
    };
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
    // A profile counts as "really measured" ONLY if the server saved it — i.e.
    // it carries an `updatedAt` stamp (set on save via @UpdateTimestamp). A
    // brand-new account (incl. first Google/OAuth login) gets a fabricated
    // default row back from the API with no `updatedAt`; its numbers differ from
    // the frontend DEFAULT_PROFILE, so an `isDefaultProfile` check would wrongly
    // treat it as real and skip onboarding. `updatedAt` is the reliable signal.
    if (remote && remote.updatedAt) {
      // Server has a real, saved profile — always use it as source of truth
      const merged = { ...DEFAULT_PROFILE, ...remote };
      setHandProfile(merged);
      try { localStorage.setItem('guitar_hand_profile', JSON.stringify(merged)); } catch {}
      return true;
    } else {
      // No real profile on the server for this account. Do NOT trust a leftover
      // local profile to skip onboarding — it may belong to a since-deleted
      // account (a re-registered user with the same email, or a delete done
      // outside this browser). The account itself has never measured a hand, so
      // it must go through the mandatory measurement. Clear the stale local copy
      // so the difficulty scores start from defaults during onboarding.
      try { localStorage.removeItem('guitar_hand_profile'); } catch {}
      setHandProfile(DEFAULT_PROFILE);
      return false;
    }
  }

  async function handleSaveProfile(profile) {
    setHandProfile(profile);
    setSaveError(false);
    // Guests keep everything in memory only — never touch localStorage or the
    // backend, so nothing survives closing the tab.
    if (!guestMode) {
      try { localStorage.setItem('guitar_hand_profile', JSON.stringify(profile)); } catch {}
    }
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

  // Enter the app without an account. Everything stays in this tab's memory
  // only — start from a clean default profile and persist nothing. Guests still
  // go through the mandatory hand-measurement onboarding first (same as a new
  // account): the profile drives every difficulty score, so we must measure it
  // before showing the app — the measurement just lives in memory for guests.
  function enterGuestMode() {
    setHandProfile(DEFAULT_PROFILE);
    setGuestMode(true);
    setShowSignIn(false);
    setNeedsOnboarding(true);
  }

  // Leave guest mode to sign in / create an account (from the persistent notice).
  function exitGuestMode() {
    setGuestMode(false);
    setShowSignIn(true);
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
      // Only this account's own data — never guitar_catalog_songs_v1, the
      // shared built-in song catalog cache, which must survive account deletion.
      [
        'guitar_hand_profile',
        'guitar_ai_fingers',
        'guitar_lang',
        'guitar_limit_to_reach',
        'guitar_limit_to_level',
        'guitar_songs',
        'guitar_custom_songs',
        'guitar_saved_sequences',
        'guitar_detect_config',
        'guitar_practice_history_v1',
        'guitar_memory_train_v1',
        'guitar_mm_narrate',
      ].forEach(key => localStorage.removeItem(key));
    } catch {}
    window.location.href = '/?login=1';
  }

  function handleSaveAIFingers(fingers) {
    setAIFingers(fingers);
    // Guests: keep in memory only (see enterGuestMode).
    if (!guestMode) {
      try { localStorage.setItem('guitar_ai_fingers', JSON.stringify(fingers)); } catch {}
    }
  }

  // Shared app header (logo + language selector + account/sign-out). Used by
  // both the onboarding gate and the main app shell so there's one source of
  // truth for the header.
  function renderHeader() {
    return (
      <header className="relative z-10 border-b border-surface-700 bg-surface-base">
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
          {/* Level Plan — the Beginner→Master roadmap, reachable from anywhere. */}
          <button onClick={() => setActiveTab('levelplan')}
            data-explain="The Level Plan button opens your roadmap from Beginner to Master."
            className="text-xs px-2 py-1 rounded font-semibold text-brand border border-surface-550 flex items-center gap-1">
            <span>🗺️</span>
            <span className="hidden sm:inline">{tr.tabLevelPlan || 'Level Plan'}</span>
          </button>
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

  if (!currentUser && !guestMode) {
    // Never-logged-in visitors land on the marketing page first; the CTA reveals
    // the sign-in form. Email-link flows (reset/forgot) skip straight to the form.
    const inEmailFlow = showResetModal || showForgot;
    if (!inEmailFlow && !showSignIn) {
      return (
        <LangContext.Provider value={lang}>
          <LandingPage
            onGetStarted={() => setShowSignIn(true)}
            onTryGuest={enterGuestMode}
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
              onGuest={enterGuestMode}
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

  // --- Paywall gate: a signed-in account whose $10/year pass is unpaid or
  // lapsed. Shown BEFORE onboarding — there's no point measuring a hand for an
  // account that can't save it. Guests never reach here (they use no backend),
  // and signing out is always available so nobody is trapped behind the wall.
  if (currentUser && !guestMode && paywalled) {
    return (
      <LangContext.Provider value={lang}>
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-4 bg-surface-base">
          <Paywall
            lang={lang}
            compact
            onPaid={() => setPaywalled(false)}
          />
          <button
            onClick={handleLogout}
            className="text-xs underline text-ink-muted">
            {tr.signOut || 'Sign out'}
          </button>
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
      <ReachLimitContext.Provider value={limitToReach}>
      <LevelLimitContext.Provider value={limitToLevel}>
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
                    limitToReach={limitToReach}
                    onLimitToReachChange={handleLimitToReach}
                    limitToLevel={limitToLevel}
                    onLimitToLevelChange={handleLimitToLevel}
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
      </LevelLimitContext.Provider>
      </ReachLimitContext.Provider>
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
    <ReachLimitContext.Provider value={limitToReach}>
    <LevelLimitContext.Provider value={limitToLevel}>
      <div className="min-h-screen bg-surface-base">

        {/* Ambient 3D backdrop — a subtle shader layer behind all content.
            Fixed, non-interactive, mounted ONCE here (above the key={activeTab}
            panel boundary) so it never remounts on tab switches. Gated + code-
            split via Lazy3D; when 3D is off it renders nothing and the plain
            bg-surface-base shows through. Cards are opaque, so it only reads in
            the gutters — never behind text. */}
        <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
          <Lazy3D load={loadAmbient} fallback={null} />
        </div>

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
                  limitToReach={limitToReach}
                  onLimitToReachChange={handleLimitToReach}
                  limitToLevel={limitToLevel}
                  onLimitToLevelChange={handleLimitToLevel}
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

        <main className="relative z-10 max-w-4xl mx-auto px-2 sm:px-4 pt-3 sm:pt-6 pb-20">

          {/* Guest-mode notice: persistent reminder that nothing is saved. */}
          {guestMode && (
            <div className="mb-4 px-4 py-2.5 rounded-xl text-xs sm:text-sm flex items-center gap-3 flex-wrap"
              style={{
                background: 'rgba(201,169,110,0.10)',
                border: '1px solid rgba(201,169,110,0.30)',
                color: 'var(--color-ink)',
              }}>
              <span className="text-base leading-none">👋</span>
              <span className="flex-1 min-w-[180px] leading-snug">
                {tr.guestNotice ||
                  "You're exploring as a guest — your hand profile and edits stay in this tab only and are lost when you close it."}
              </span>
              <button onClick={exitGuestMode}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold whitespace-nowrap"
                style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}>
                {tr.guestSaveCta || 'Sign up to save'}
              </button>
            </div>
          )}

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
                onClick={() => selectTab(tab.id)}
                className="ui-press flex-1 flex flex-col sm:flex-row items-center justify-center gap-0 sm:gap-2 px-1 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs font-semibold transition-all"
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
                    onClick={() => { selectTab(tab.id); setSideMenuOpen(false); }}
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
                <InstallMenuItem tr={tr} onClose={() => setSideMenuOpen(false)} />
              </aside>
            </div>
          )}

          {/* Content — keyed by activeTab so each panel re-mounts and eases in */}
          <div key={activeTab} className="tab-panel-enter rounded-2xl overflow-hidden bg-surface-850 border border-surface-700">
            {activeTab === 'start'        && <StartHere lang={lang} onGoToHand={() => setActiveTab('hand')} />}
            {activeTab === 'hand'         && <HandProfileSetup profile={handProfile} onSave={handleSaveProfile} onSaveAIFingers={handleSaveAIFingers} saveError={saveError} lang={lang} />}
            {activeTab === 'strings'      && <GuitarStrings lang={lang} mode="editor" />}
            {activeTab === 'play'         && <GuitarStrings lang={lang} mode="play" />}
            {activeTab === 'scale'        && <GuitarStrings lang={lang} mode="scale" />}
            {activeTab === 'memory'       && <MusicMemory lang={lang} onClose={() => setActiveTab('start')} />}
            {activeTab === 'chordfinder'  && <GuitarStrings lang={lang} mode="chord" />}
            {activeTab === 'tuner'        && <OscilloscopeTuner lang={lang} />}
            {activeTab === 'listen'       && <ChordListener lang={lang} mode="game" />}
            {activeTab === 'notemap'      && <FretboardNoteMap lang={lang} />}
            {activeTab === 'virtual'      && <VirtualFretboard lang={lang} />}
            {activeTab === 'levelplan'    && <LevelPlan lang={lang} onNavigate={(tab, seq = null) => { setPracticeSequence(seq); setActiveTab(tab); }} />}
            {activeTab === 'fbmeasure'    && <FretboardMeasures lang={lang} />}
            {activeTab === 'recorder'     && <ChordListener lang={lang} mode="recorder" />}
            {activeTab === 'micpractice'  && <ChordListener lang={lang} mode="practice" sequence={practiceSequence} />}
            {activeTab === 'mictune'      && <ChordListener lang={lang} mode="tune" />}
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
    </LevelLimitContext.Provider>
    </ReachLimitContext.Provider>
    </HandProfileContext.Provider>
    </AIFingerContext.Provider>
    </LangContext.Provider>
    </AuthContext.Provider>
  );
}
