import { useState, useEffect, useMemo } from 'react';
import { parseChordSheet, keyLabel } from '../lib/chordSheetParser';
import { loadCustomSongs, addCustomSong, updateCustomSong, deleteCustomSong, songToText } from '../lib/customSongs';
import { ALL_BUILTIN_SONGS } from '../lib/songs';
import { getDiatonicChords } from '../lib/scales';

// Paste a chord sheet → parse to structured song data → review/edit → save to
// the browser. Saved songs are listed below; each can be edited (manually or by
// re-pasting) or removed.

export default function SongImporter() {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);   // editable parsed song
  const [warnings, setWarnings] = useState([]);
  const [saved, setSaved] = useState([]);
  const [savedMsg, setSavedMsg] = useState('');
  const [editingId, setEditingId] = useState(null); // id when editing an existing song
  const [search, setSearch] = useState('');          // catalog search box

  useEffect(() => { setSaved(loadCustomSongs()); }, []);

  // Full catalog (built-ins) filtered by the search box.
  const catalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ALL_BUILTIN_SONGS;
    return ALL_BUILTIN_SONGS.filter(s =>
      `${s.title} ${s.artist}`.toLowerCase().includes(q));
  }, [search]);

  // Copy a built-in song into the editable custom list (so you can tweak it).
  // Built-ins store only `degrees`; derive explicit chord names from the key so
  // the editor always has a real `chords` array to show/edit (avoids a crash on
  // undefined). lyricLines may be empty — that's fine; the user can paste some.
  const handleCopyBuiltin = (s) => {
    let chords = s.chords;
    if (!chords && Array.isArray(s.degrees)) {
      const diatonic = getDiatonicChords(s.key, s.scaleType);
      chords = s.degrees.map(d => diatonic[d]?.chordName).filter(Boolean);
    }
    const list = addCustomSong({
      title: s.title, artist: s.artist, key: s.key, scaleType: s.scaleType,
      capo: s.capo || 0, bpm: s.bpm,
      degrees: s.degrees || [], chords: chords || [], lineChords: s.lineChords,
      lyricLines: s.lyricLines || [], custom: true,
    });
    setSaved(list);
    setSavedMsg(`Copied “${s.title}” to your songs — open Edit to customize.`);
  };

  const handleParse = () => {
    if (!text.trim()) return;
    const { song, warnings } = parseChordSheet(text);
    setParsed(editingId ? { ...song, id: editingId } : song);
    setWarnings(warnings);
    setSavedMsg('');
  };

  const handleSave = () => {
    if (!parsed) return;
    const list = editingId ? updateCustomSong(editingId, parsed) : addCustomSong(parsed);
    setSaved(list);
    setSavedMsg(editingId ? `Updated “${parsed.title}”.` : `Saved “${parsed.title}”.`);
    setParsed(null);
    setText('');
    setWarnings([]);
    setEditingId(null);
  };

  // Load a saved song into the editor (fields + re-pastable text) for editing.
  const handleEdit = (song) => {
    setEditingId(song.id);
    setParsed(song);
    setText(songToText(song));
    setWarnings([]);
    setSavedMsg('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const cancelEdit = () => {
    setParsed(null); setText(''); setWarnings([]); setEditingId(null);
  };

  const handleDelete = (id) => {
    setSaved(deleteCustomSong(id));
    if (editingId === id) cancelEdit();
  };

  const editField = (k, v) => setParsed(p => ({ ...p, [k]: v }));

  const input = { background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-600)', color: 'var(--color-ink)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };

  return (
    <div className="p-3 sm:p-5 max-w-3xl mx-auto">
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-ink)' }}>
        {editingId ? 'Edit song' : 'Import a song'}
      </h2>
      <p className="text-sm mb-4" style={{ color: 'var(--color-ink-faint)' }}>
        {editingId
          ? 'Edit the text below and Parse to re-read it, or change the fields in the preview, then Update.'
          : 'Paste a chord sheet (chords on their own line above each lyric line, like Ultimate Guitar). We turn it into a playable song with your hand-friendly chords and save it in this browser.'}
      </p>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={`Song Title Chords by Artist\nKey: A\nCapo: 1st fret\n120 bpm\n\n[Verse]\n     A           D\nPaste the chord-over-lyric lines here...`}
        rows={10}
        className="w-full font-mono text-xs rounded-lg p-3 outline-none"
        style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}
      />

      <div className="flex items-center gap-3 mt-3">
        <button onClick={handleParse} disabled={!text.trim()}
          className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}>
          Parse
        </button>
        {editingId && (
          <button onClick={cancelEdit} className="px-3 py-2 rounded-lg text-sm"
            style={{ color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>
            Cancel edit
          </button>
        )}
        {savedMsg && <span className="text-xs" style={{ color: 'var(--color-success)' }}>{savedMsg}</span>}
      </div>

      {/* ── Parsed preview / edit ── */}
      {parsed && (
        <div className="mt-5 rounded-xl p-4" style={{ background: 'var(--color-surface-850)', border: '1px solid var(--color-surface-700)' }}>
          <p className="text-xs uppercase tracking-widest font-semibold mb-3" style={{ color: 'var(--color-ink-faint)' }}>Review &amp; edit</p>

          {warnings.length > 0 && (
            <div className="mb-3 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', color: 'var(--color-warning)' }}>
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>Title</span>
              <input style={input} value={parsed.title} onChange={e => editField('title', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 col-span-2">
              <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>Artist</span>
              <input style={input} value={parsed.artist} onChange={e => editField('artist', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>Key</span>
              <input style={input} value={parsed.key} onChange={e => editField('key', e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>Scale</span>
              <select style={input} value={parsed.scaleType} onChange={e => editField('scaleType', e.target.value)}>
                <option value="major">major</option>
                <option value="minor">minor</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>Capo</span>
              <input style={input} type="number" min="0" max="11" value={parsed.capo}
                onChange={e => editField('capo', parseInt(e.target.value, 10) || 0)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px]" style={{ color: 'var(--color-ink-faint)' }}>BPM</span>
              <input style={input} type="number" min="40" max="240" value={parsed.bpm || ''}
                onChange={e => editField('bpm', parseInt(e.target.value, 10) || undefined)} />
            </label>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className="text-[10px] mr-1 self-center" style={{ color: 'var(--color-ink-faint)' }}>Detected chords:</span>
            {(parsed.chords?.length)
              ? parsed.chords.map((c, i) => (
                  <span key={i} className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-750)', color: 'var(--color-brand)' }}>{c}</span>
                ))
              : <span className="text-[11px] italic" style={{ color: 'var(--color-danger)' }}>none — check the format</span>}
          </div>

          {/* chord-over-lyric preview */}
          <div className="rounded-lg p-3 font-mono text-xs max-h-60 overflow-y-auto" style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-700)' }}>
            {(parsed.lyricLines?.length)
              ? parsed.lyricLines.map((ln, i) => (
                  <div key={i} className="mb-1">
                    {ln.chordNames?.length > 0 && (
                      <div className="font-bold" style={{ color: 'var(--color-accent)' }}>{ln.chordNames.join('  ')}</div>
                    )}
                    <div style={{ color: 'var(--color-ink-subtle)' }}>{ln.text || ' '}</div>
                  </div>
                ))
              : <span className="italic" style={{ color: 'var(--color-ink-ghost)' }}>No lyric lines parsed.</span>}
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <button onClick={cancelEdit}
              className="px-4 py-2 rounded-lg text-sm" style={{ color: 'var(--color-ink-muted)', border: '1px solid var(--color-surface-550)' }}>
              Discard
            </button>
            <button onClick={handleSave} disabled={!parsed.chords?.length}
              className="px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{ background: 'var(--color-success)', color: 'var(--color-surface-base)' }}>
              {editingId ? 'Update song' : 'Save song'}
            </button>
          </div>
        </div>
      )}

      {/* ── Saved songs ── */}
      {saved.length > 0 && (
        <div className="mt-6">
          <p className="text-xs uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--color-ink-faint)' }}>Your imported songs</p>
          <div className="space-y-1.5">
            {saved.map(s => (
              <div key={s.id} className="flex items-center justify-between rounded-lg px-3 py-2"
                style={{ background: editingId === s.id ? '#1c1c12' : 'var(--color-surface-850)',
                  border: `1px solid ${editingId === s.id ? 'rgba(201,169,110,0.4)' : 'var(--color-surface-700)'}` }}>
                <div className="min-w-0">
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{s.title}</span>
                  <span className="text-xs" style={{ color: 'var(--color-ink-faint)' }}> — {s.artist}</span>
                  <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded" style={{ background: 'rgba(56,189,248,0.1)', color: 'var(--color-info)' }}>
                    {keyLabel(s)}{s.capo ? ` · capo ${s.capo}` : ''}{s.bpm ? ` · ${s.bpm} BPM` : ''}
                  </span>
                  {editingId === s.id && <span className="text-[10px] ml-2" style={{ color: 'var(--color-brand)' }}>editing…</span>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => handleEdit(s)}
                    className="text-xs px-2 py-1 rounded"
                    style={{ color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.25)' }}>
                    Edit
                  </button>
                  <button onClick={() => handleDelete(s.id)}
                    className="text-xs px-2 py-1 rounded"
                    style={{ color: 'var(--color-danger)', border: '1px solid rgba(248,113,113,0.2)' }}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Full catalog (all built-in songs) ── */}
      <div className="mt-8">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-xs uppercase tracking-widest font-semibold" style={{ color: 'var(--color-ink-faint)' }}>
            All songs in the system ({ALL_BUILTIN_SONGS.length})
          </p>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search title or artist…"
            className="text-xs rounded-lg px-2.5 py-1.5 outline-none"
            style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)', width: 200 }}
          />
        </div>
        <div className="rounded-lg max-h-80 overflow-y-auto" style={{ border: '1px solid var(--color-surface-700)' }}>
          {catalog.length === 0 && (
            <div className="px-3 py-3 text-xs italic" style={{ color: 'var(--color-ink-ghost)' }}>No songs match “{search}”.</div>
          )}
          {catalog.map((s, i) => (
            <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5"
              style={{ borderBottom: '1px solid var(--color-surface-800)' }}>
              <div className="min-w-0 truncate">
                <span className="text-sm" style={{ color: 'var(--color-ink)' }}>{s.title}</span>
                <span className="text-xs" style={{ color: 'var(--color-ink-faint)' }}> — {s.artist}</span>
                <span className="text-[10px] ml-2 px-1.5 py-0.5 rounded" style={{ background: 'rgba(56,189,248,0.08)', color: 'var(--color-info)' }}>
                  {keyLabel(s)}
                </span>
              </div>
              <button onClick={() => handleCopyBuiltin(s)}
                className="text-[11px] px-2 py-1 rounded shrink-0"
                style={{ color: 'var(--color-success)', border: '1px solid rgba(74,222,128,0.25)' }}>
                Copy to my songs
              </button>
            </div>
          ))}
        </div>
        <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-ink-ghost)' }}>
          Built-in songs are read-only references. Copy one to your songs to edit its chords, key, or paste your own lyrics.
        </p>
      </div>
    </div>
  );
}
