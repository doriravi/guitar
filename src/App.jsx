import { useState, createContext, useContext } from 'react';
import ChordTable from './components/ChordTable';
import TripletTable from './components/TripletTable';
import ProgressionExplorer from './components/ProgressionExplorer';
import HandProfileSetup from './components/HandProfileSetup';
import ChordListener from './components/ChordListener';
import { DEFAULT_PROFILE } from './lib/handProfile';

export const HandProfileContext = createContext(DEFAULT_PROFILE);
export function useHandProfile() { return useContext(HandProfileContext); }

function loadProfile() {
  try {
    const raw = localStorage.getItem('guitar_hand_profile');
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PROFILE;
}

const TABS = [
  { id: 'hand',         label: 'My Hand',     icon: '✋' },
  { id: 'listen',       label: 'Listen',       icon: '🎙️' },
  { id: 'chords',       label: 'Chords',       icon: '🎸' },
  { id: 'triplets',     label: 'Triplets',     icon: '🎵' },
  { id: 'progressions', label: 'Progressions', icon: '🎼' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('hand');
  const [handProfile, setHandProfile] = useState(loadProfile);

  function handleSaveProfile(profile) {
    setHandProfile(profile);
    try { localStorage.setItem('guitar_hand_profile', JSON.stringify(profile)); } catch {}
  }

  return (
    <HandProfileContext.Provider value={handProfile}>
      <div className="min-h-screen" style={{ background: '#0f0f0f' }}>

        {/* Header */}
        <header style={{ borderBottom: '1px solid #1e1e1e' }}>
          <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center gap-3">
            <span className="text-xl sm:text-2xl">🎸</span>
            <div>
              <h1 className="text-sm sm:text-base font-bold tracking-tight leading-none" style={{ color: '#f0ede8' }}>
                Guitar Reach
              </h1>
              <p className="text-xs mt-0.5 hidden sm:block" style={{ color: '#5a5a5a' }}>
                Difficulty scores for your hand
              </p>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-2 sm:px-4 pt-3 sm:pt-6 pb-20">

          {/* Tab bar */}
          <div className="flex gap-0.5 sm:gap-1 mb-3 sm:mb-5 p-1 rounded-xl" style={{ background: '#161616' }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-0 sm:gap-2 px-1 sm:px-3 py-2 sm:py-2.5 rounded-lg text-xs font-semibold transition-all"
                style={activeTab === tab.id ? {
                  background: '#1e1e1e',
                  color: '#c9a96e',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                } : {
                  color: '#5a5a5a',
                }}
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
            {activeTab === 'hand'         && <HandProfileSetup profile={handProfile} onSave={handleSaveProfile} />}
            {activeTab === 'listen'       && <ChordListener />}
            {activeTab === 'chords'       && <ChordTable />}
            {activeTab === 'triplets'     && <TripletTable />}
            {activeTab === 'progressions' && <ProgressionExplorer />}
          </div>
        </main>
      </div>
    </HandProfileContext.Provider>
  );
}
