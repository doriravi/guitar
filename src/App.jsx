import { useState } from 'react';
import DifficultyTable from './components/DifficultyTable';
import ChordTable from './components/ChordTable';
import TripletTable from './components/TripletTable';
import ProgressionExplorer from './components/ProgressionExplorer';

const TABS = [
  { id: 'pairs',        label: 'Note Pairs' },
  { id: 'triplets',     label: 'Triplets' },
  { id: 'chords',       label: 'Chords' },
  { id: 'progressions', label: 'Progressions' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('chords');

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gray-900 text-white px-6 py-4">
        <h1 className="text-xl font-bold">Guitar Reach Difficulty</h1>
        <p className="text-gray-400 text-sm">Fretboard reach scores calibrated for short fingers</p>
      </header>

      <main className="max-w-4xl mx-auto mt-6">
        {/* Tab bar */}
        <div className="flex border-b border-gray-300 mb-0 px-4">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bg-white border border-t-0 border-gray-300 rounded-b">
          {activeTab === 'pairs'        && <DifficultyTable />}
          {activeTab === 'triplets'     && <TripletTable />}
          {activeTab === 'chords'       && <ChordTable />}
          {activeTab === 'progressions' && <ProgressionExplorer />}
        </div>
      </main>
    </div>
  );
}
