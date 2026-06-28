import { useState, useEffect } from 'react';
import { tab as tabApi } from '../lib/api';
import { calcDifficulty } from '../lib/fretboard';
import { personalDifficulty } from '../lib/handProfile';
import { useHandProfile } from '../App';
import { useT } from '../lib/i18n';
import { playEvents, stopAudio } from '../lib/audio';
import FretboardDiagram from './FretboardDiagram';
import DifficultyBadge from './DifficultyBadge';

// Events from the service use string 0=low E … 5=high e (our convention).
// Build a 6-char EADGBe tab string ("x32010") + a {string,fret}[] notes array
// from a group of events, keeping the lowest fret per string.
function eventsToChord(name, events) {
  const byString = {}; // string idx -> fret
  for (const e of events) {
    if (e.string < 0 || e.string > 5) continue;
    if (byString[e.string] == null || e.fret < byString[e.string]) {
      byString[e.string] = e.fret;
    }
  }
  let tabStr = '';
  const notes = [];
  for (let s = 0; s < 6; s++) {
    if (byString[s] == null) {
      tabStr += 'x';
    } else {
      const f = byString[s];
      tabStr += f > 9 ? String.fromCharCode(97 + f - 10) : String(f); // 10→'a' etc (rare)
      if (f > 0) notes.push({ string: s, fret: f });
    }
  }
  return { name: name || '—', tab: tabStr, notes };
}

// Slice the flat event list into chord-shaped groups using the detected
// per-measure chords (their start times). Falls back to one group if none.
function groupIntoChords(events, chords) {
  if (!events.length) return [];
  if (!chords || !chords.length) {
    return [eventsToChord('Detected', events)].filter(c => c.notes.length || c.tab.includes('0'));
  }
  const sorted = [...chords].sort((a, b) => a.time - b.time);
  const groups = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i].time;
    const end = i + 1 < sorted.length ? sorted[i + 1].time : Infinity;
    const slice = events.filter(e => e.time >= start && e.time < end);
    if (slice.length) groups.push(eventsToChord(sorted[i].name, slice));
  }
  return groups;
}

function isYoutubeUrl(v) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)[\w-]+/.test(v.trim());
}

export default function TabTranscriber() {
  const tr = useT();
  const handProfile = useHandProfile();
  const [source, setSource] = useState('file'); // 'file' | 'youtube'
  const [file, setFile] = useState(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const urlValid = isYoutubeUrl(youtubeUrl);
  const canSubmit = source === 'file' ? !!file : urlValid;

  async function handleTranscribe() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = source === 'youtube'
        ? await tabApi.transcribe(null, { youtubeUrl: youtubeUrl.trim() })
        : await tabApi.transcribe(file);
      setResult(data);
    } catch (e) {
      // 503 from the proxy when the sidecar isn't configured/running.
      const msg = e.status === 503
        ? (tr.tabAudioUnavailable || 'Transcription service is not running. Start tab-service locally (see tab-service/README.md).')
        : (e.data?.error || e.message || 'Transcription failed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handlePlay() {
    if (isPlaying) {
      stopAudio();
      setIsPlaying(false);
      return;
    }
    if (!result?.events?.length) return;
    setIsPlaying(true);
    playEvents(result.events, () => setIsPlaying(false));
  }

  // Stop playback when a new result arrives or the component unmounts.
  useEffect(() => {
    setIsPlaying(false);
    stopAudio();
  }, [result]);
  useEffect(() => () => stopAudio(), []);

  const chordGroups = result ? groupIntoChords(result.events || [], result.chords || []) : [];

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h2 className="text-xl font-bold mb-1">{tr.tabAudioTab || 'Audio → Tab'}</h2>
      <p className="text-sm text-gray-500 mb-4">
        {tr.tabAudioIntro ||
          'Upload a short guitar clip. We transcribe it to tab and score each detected shape for your hand.'}
      </p>

      {/* Source toggle: upload a file or paste a YouTube link */}
      <div className="flex gap-1 mb-3 p-1 rounded-lg w-max" style={{ background: '#161616' }}>
        {[
          { id: 'file',    label: tr.tabAudioSourceFile || 'Upload file' },
          { id: 'youtube', label: tr.tabAudioSourceYoutube || 'YouTube link' },
        ].map(opt => (
          <button
            key={opt.id}
            onClick={() => { setSource(opt.id); setError(null); }}
            className="px-3 py-1.5 rounded-md text-xs font-semibold transition-all"
            style={source === opt.id
              ? { background: '#1e1e1e', color: '#c9a96e' }
              : { color: '#5a5a5a' }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-2">
        {source === 'file' ? (
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); setError(null); }}
            className="text-sm"
          />
        ) : (
          <input
            type="url"
            inputMode="url"
            value={youtubeUrl}
            onChange={(e) => { setYoutubeUrl(e.target.value); setResult(null); setError(null); }}
            placeholder={tr.tabAudioYoutubePlaceholder || 'https://www.youtube.com/watch?v=…'}
            className="text-sm rounded-md px-3 py-2 flex-1 min-w-[260px] outline-none"
            style={{ background: '#111', border: `1px solid ${youtubeUrl && !urlValid ? '#7f1d1d' : '#333'}`, color: '#f0ede8' }}
          />
        )}
        <button
          onClick={handleTranscribe}
          disabled={!canSubmit || loading}
          className="px-4 py-2 rounded-md text-sm font-semibold bg-gray-800 text-white disabled:opacity-40"
        >
          {loading ? (tr.tabAudioWorking || 'Transcribing…') : (tr.tabAudioGo || 'Transcribe')}
        </button>
      </div>

      {source === 'youtube' && youtubeUrl && !urlValid && (
        <p className="text-xs mb-2" style={{ color: '#f87171' }}>
          {tr.tabAudioYoutubeInvalid || 'Enter a valid YouTube link (youtube.com/watch?v=… or youtu.be/…).'}
        </p>
      )}
      {source === 'youtube' && (
        <p className="text-xs mb-2" style={{ color: '#5a5a5a' }}>
          {tr.tabAudioYoutubeNote || 'We transcribe roughly the first minute of the video.'}
        </p>
      )}

      {loading && (
        <p className="text-xs text-gray-400 mb-4">
          {tr.tabAudioSlow || 'This can take 30–60s — the model separates and analyzes the audio.'}
        </p>
      )}

      {error && (
        <div className="my-4 p-3 rounded-md text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={handlePlay}
              disabled={!result.events?.length}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40"
              style={isPlaying
                ? { background: 'rgba(239,68,68,0.15)', color: '#f87171' }
                : { background: '#c9a96e', color: '#0f0f0f' }}
            >
              <span className="text-base leading-none">{isPlaying ? '■' : '▶'}</span>
              {isPlaying ? (tr.tabAudioStop || 'Stop') : (tr.tabAudioPlay || 'Play transcription')}
            </button>
            <span className="text-sm text-gray-500">
              BPM {result.bpm} · {result.note_count} {tr.tabAudioNotes || 'notes'}
            </span>
          </div>

          {chordGroups.length > 0 && (
            <>
              <h3 className="text-sm font-semibold mb-2">{tr.tabAudioChords || 'Detected shapes'}</h3>
              <div className="flex flex-wrap gap-4 mb-6">
                {chordGroups.map((chord, i) => {
                  const personal = personalDifficulty(calcDifficulty(chord.notes), handProfile);
                  return (
                    <div key={i} className="flex flex-col items-center gap-1">
                      <FretboardDiagram chord={chord} showFingers />
                      <DifficultyBadge score={personal} />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <h3 className="text-sm font-semibold mb-2">{tr.tabAudioRaw || 'Tablature'}</h3>
          <pre className="text-xs overflow-x-auto p-3 rounded-md bg-gray-900 text-gray-100 whitespace-pre">
            {result.ascii}
          </pre>
        </div>
      )}
    </div>
  );
}
