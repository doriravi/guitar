import { useState, useEffect, useMemo } from 'react';
import { parseChordSheet, keyLabel } from '../lib/chordSheetParser';
import { loadCustomSongs, addCustomSong, updateCustomSong, deleteCustomSong, removeCustomSong, songToText, saveCustomSong } from '../lib/customSongs';
import { chordSheet as chordSheetApi } from '../lib/api';
import { ALL_BUILTIN_SONGS } from '../lib/songs';
import { getDiatonicChords } from '../lib/scales';
import SongEditor from './SongEditor';
import ChordTip from './ChordTip';
import SoloTabView from './SoloTabView';
import { useHandProfile, useAuth } from '../App';

// Import a song BY NAME: the generate-music-data pipeline fetches the real
// chord sheet through the backend (/api/chordsheet), parses it into the app's
// structured song shape, and saves it straight into the user's imported songs
// (localStorage, plus the DB when logged in). Pasting a sheet by hand remains
// as the manual fallback. Saved songs are listed below; each can be edited or
// removed.

export default function SongImporter() {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);   // editable parsed song
  const [warnings, setWarnings] = useState([]);
  const [saved, setSaved] = useState([]);
  const [savedMsg, setSavedMsg] = useState('');
  const [editingId, setEditingId] = useState(null); // id when editing an existing song
  const [search, setSearch] = useState('');          // catalog search box
  const [nameQuery, setNameQuery] = useState('');    // import-by-name: song title
  const [artistQuery, setArtistQuery] = useState(''); // import-by-name: optional artist
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState('');
  // "Try another version" state: the query we last imported + which ranked sheet
  // we're on, so the button can re-fetch the next version of the SAME song.
  const [lastQuery, setLastQuery] = useState(null); // { title, artist } | null
  const [version, setVersion] = useState(0);        // 0-based index into ranked sheets
  const [moreVersions, setMoreVersions] = useState(false);
  const [tryingAnother, setTryingAnother] = useState(false);
  const [lastImported, setLastImported] = useState(null); // the parsed song from the last import (displayed; saved on demand)
  const [songSaved, setSongSaved] = useState(false);      // has lastImported been persisted yet?
  const [originText, setOriginText] = useState('');       // the raw fetched sheet, for the "Show origin" compare
  const [showOrigin, setShowOrigin] = useState(false);    // toggle the raw-sheet panel
  const [editorSong, setEditorSong] = useState(null); // song open in the full Song Editor
  const editorProfile = useHandProfile();
  const loggedIn = !!useAuth();   // drives DB-backed save/delete vs. localStorage-only

  useEffect(() => { setSaved(loadCustomSongs()); }, []);

  // Import by name — the whole generate-music-data pipeline in one click:
  // fetch the REAL sheet (actual chords + full lyrics) → parse → save as an
  // imported song. The saved song then behaves exactly like a pasted one.
  // Core import: fetch the `skip`-th ranked sheet for a title/artist and parse
  // it. It DOES NOT save — the parsed song is just displayed; saving is an
  // explicit click. Shared by the initial Import and "Try another version".
  const importByName = async (title, artist, skip) => {
    const res = await chordSheetApi.fetch(artist, title, skip); // { url, text, version, matchCount }
    const { song } = parseChordSheet(res.text);
    const withMeta = { ...song, custom: true, sourceUrl: res.url };
    // Show the parsed song without persisting it (unsaved until "Save song").
    setLastImported(withMeta);
    setSongSaved(false);
    // Keep the raw fetched sheet so "Show origin" can compare it to what we parsed.
    setOriginText(res.text || '');
    setShowOrigin(false);
    // Remember the query + version so "Try another version" can advance.
    setLastQuery({ title, artist });
    const ver = res.version ?? skip;
    setVersion(ver);
    setMoreVersions((res.matchCount ?? 1) > ver + 1);
    return { song, ver, matchCount: res.matchCount ?? 1 };
  };

  const handleImportByName = async () => {
    const title = nameQuery.trim();
    if (!title || fetching) return;
    setFetching(true); setFetchErr(''); setSavedMsg('');
    try {
      const { song } = await importByName(title, artistQuery.trim(), 0);
      setSavedMsg(`Found “${song.title}”. Review it below, then click Save song to keep it — or Try another version if the chords look wrong.`);
      setNameQuery(''); setArtistQuery('');
    } catch (e) {
      setFetchErr(e?.status === 404
        ? 'No chord sheet found for that name — check the spelling, or add the artist.'
        : 'The chord-sheet service is unavailable right now — is the backend running?');
    } finally {
      setFetching(false);
    }
  };

  // Persist the currently-displayed imported song (localStorage + DB when logged
  // in). This is the ONLY place a name-imported song gets written.
  const handleSaveImported = async () => {
    if (!lastImported || songSaved) return;
    const list = await saveCustomSong(lastImported, loggedIn);
    setSaved(list);
    // Adopt the persisted copy (it now has an id/serverId) so Edit/Delete target it.
    const savedSong = list.find(s =>
      (s.title || '').trim().toLowerCase() === (lastImported.title || '').trim().toLowerCase()) || lastImported;
    setLastImported(savedSong);
    setSongSaved(true);
    setSavedMsg(`Saved “${savedSong.title}” to your songs.`);
  };

  // Re-import the SAME song at the next ranked sheet — for when the first
  // version's chords/lyrics were wrong. Advances `version`; stops (and says so)
  // once there are no more versions.
  const handleTryAnother = async () => {
    if (!lastQuery || tryingAnother) return;
    setTryingAnother(true); setFetchErr(''); setSavedMsg('');
    try {
      const { song, ver, matchCount } = await importByName(lastQuery.title, lastQuery.artist, version + 1);
      setSavedMsg(`Loaded another version of “${song.title}” (version ${ver + 1} of ${matchCount}). Review it, then Save song to keep it.`);
    } catch (e) {
      if (e?.status === 404) {
        setMoreVersions(false);
        setFetchErr('That was the last version available for this song.');
      } else {
        setFetchErr('The chord-sheet service is unavailable right now — is the backend running?');
      }
    } finally {
      setTryingAnother(false);
    }
  };

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

  // Edit opens the SAME full-screen Song Editor the Progressions tab uses
  // (section transforms, easier voicings, capo, melody…). It saves through
  // saveCustomSong itself; we just reload the list when it closes.
  const handleEdit = (song) => {
    setEditorSong(song);
  };

  const cancelEdit = () => {
    setParsed(null); setText(''); setWarnings([]); setEditingId(null);
  };

  const handleDelete = async (id) => {
    // removeCustomSong deletes from the DB too (when logged in), so a deleted
    // song doesn't reappear on the next login sync. Update the list optimistically
    // then reconcile with the awaited result.
    setSaved(loadCustomSongs().filter(s => s.id !== id));
    if (editingId === id) cancelEdit();
    // If the just-imported song is the one being deleted, disable the Edit button.
    setLastImported(prev => (prev && prev.id === id ? null : prev));
    const remaining = await removeCustomSong(id, loggedIn);
    setSaved(remaining);
  };

  const editField = (k, v) => setParsed(p => ({ ...p, [k]: v }));

  const input = { background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-600)', color: 'var(--color-ink)', borderRadius: 8, padding: '6px 10px', fontSize: 13 };

  return (
    <div className="p-3 sm:p-5 max-w-3xl mx-auto">
      {editorSong && (
        <SongEditor
          song={editorSong}
          profile={editorProfile}
          onClose={() => {
            setEditorSong(null);
            const list = loadCustomSongs();
            setSaved(list);
            // If the editor persisted this song, reflect that in the Save button.
            if (lastImported && list.some(s =>
              s.id === lastImported.id ||
              (s.title || '').trim().toLowerCase() === (lastImported.title || '').trim().toLowerCase())) {
              setSongSaved(true);
            }
          }}
        />
      )}
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--color-ink)' }}>
        {editingId ? 'Edit song' : 'Import a song'}
      </h2>
      <p className="text-sm mb-4" style={{ color: 'var(--color-ink-faint)' }}>
        {editingId
          ? 'Edit the text below and Parse to re-read it, or change the fields in the preview, then Update.'
          : 'Type a song name — we fetch its real chord sheet (actual chords + full lyrics) and save it straight to your songs.'}
      </p>

      {/* ── Import by name (primary) ── */}
      {!editingId && (
        <div className="rounded-xl p-4 mb-5" style={{ background: 'var(--color-surface-850)', border: '1px solid var(--color-surface-700)' }}>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={nameQuery}
              onChange={e => { setNameQuery(e.target.value); setFetchErr(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleImportByName(); }}
              placeholder="Song name — e.g. Autumn Leaves"
              className="flex-1 text-sm rounded-lg px-3 py-2 outline-none"
              style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}
            />
            <input
              value={artistQuery}
              onChange={e => setArtistQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleImportByName(); }}
              placeholder="Artist (optional)"
              className="sm:w-48 text-sm rounded-lg px-3 py-2 outline-none"
              style={{ background: 'var(--color-surface-900)', border: '1px solid var(--color-surface-550)', color: 'var(--color-ink)' }}
            />
            <button
              onClick={handleImportByName}
              disabled={!nameQuery.trim() || fetching || tryingAnother}
              className="px-5 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 shrink-0"
              style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}
            >
              {fetching ? 'Fetching…' : 'Import'}
            </button>
            {/* Edit — importing no longer auto-opens the editor; this opens the
                just-imported song for review/tweaks on demand. Always shown,
                enabled once a song has been imported. */}
            <button
              onClick={() => {
                if (!lastImported) return;
                // Open the freshest saved copy (by id, else title) so the editor
                // always gets the up-to-date song, not a stale in-memory snapshot.
                const fresh = loadCustomSongs().find(
                  s => s.id === lastImported.id ||
                    (s.title || '').trim().toLowerCase() === (lastImported.title || '').trim().toLowerCase(),
                ) || lastImported;
                handleEdit(fresh);
              }}
              disabled={!lastImported || fetching || tryingAnother}
              title={lastImported ? `Edit “${lastImported.title}”` : 'Import a song first to edit it'}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 shrink-0"
              style={{ background: 'transparent', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }}
            >
              Edit
            </button>
            {/* Try another version — always shown next to Import so it's
                discoverable, but only active once a song has been imported (it
                re-fetches the next ranked sheet for that same song). */}
            <button
              onClick={handleTryAnother}
              disabled={!lastQuery || tryingAnother || fetching || !moreVersions}
              title={!lastQuery
                ? 'Import a song first, then use this to load a different chord sheet if the first one was wrong'
                : moreVersions ? 'Load a different chord sheet for the same song' : 'No more versions available'}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 shrink-0"
              style={{ background: 'transparent', color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }}
            >
              {tryingAnother ? 'Finding…' : '↻ Try another version'}
            </button>
          </div>
          {fetchErr && (
            <div className="mt-2 text-xs" style={{ color: 'var(--color-danger)' }}>{fetchErr}</div>
          )}
          <p className="text-[10px] mt-2" style={{ color: 'var(--color-ink-ghost)' }}>
            Fetches the real published sheet, structures it, and saves it to your songs — it then shows up in the Progressions tab under whatever progression its chords match. Or paste a sheet by hand below.
          </p>
        </div>
      )}

      {/* ── Imported song, displayed read-only ── The import just saves and
          SHOWS the song here; editing is opt-in via the Edit button above or
          the one below. */}
      {!editingId && lastImported && (
        <div className="mb-5 rounded-xl p-4" style={{ background: 'var(--color-surface-850)', border: '1px solid var(--color-surface-700)' }}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="text-base font-bold truncate" style={{ color: 'var(--color-ink)' }}>{lastImported.title}</div>
              <div className="text-xs" style={{ color: 'var(--color-ink-faint)' }}>
                {lastImported.artist}
                <span className="ml-2">{keyLabel(lastImported)}{lastImported.capo ? ` · capo ${lastImported.capo}` : ''}{lastImported.bpm ? ` · ${lastImported.bpm} BPM` : ''}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {/* Show origin — reveal the raw fetched sheet + a link to the source
                  page, so the parsed result can be compared against the original. */}
              {(originText || lastImported.sourceUrl) && (
                <button onClick={() => setShowOrigin(v => !v)}
                  className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                  style={{ color: 'var(--color-info)', border: '1px solid rgba(56,189,248,0.4)' }}>
                  {showOrigin ? 'Hide origin' : 'Show origin'}
                </button>
              )}
              <button onClick={() => handleEdit(loadCustomSongs().find(s => s.id === lastImported.id) || lastImported)}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                style={{ color: 'var(--color-brand)', border: '1px solid rgba(201,169,110,0.4)' }}>
                Edit
              </button>
              {/* Save song — nothing is written until this is clicked. Flips to a
                  "Saved ✓" confirmation once persisted. */}
              <button onClick={handleSaveImported} disabled={songSaved}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
                style={songSaved
                  ? { color: 'var(--color-success)', border: '1px solid rgba(74,222,128,0.4)' }
                  : { background: 'var(--color-success)', color: 'var(--color-surface-base)' }}>
                {songSaved ? 'Saved ✓' : 'Save song'}
              </button>
            </div>
          </div>
          {!songSaved && (
            <div className="mb-3 text-[11px]" style={{ color: 'var(--color-warning)' }}>
              Not saved yet — click <span className="font-semibold">Save song</span> to keep it, or Try another version to compare.
            </div>
          )}

          {/* Origin panel: the raw sheet as fetched, side by side with a link to
              the published source, for comparing against the parsed result above. */}
          {showOrigin && (
            <div className="mb-3 rounded-lg p-3" style={{ background: 'var(--color-surface-base)', border: '1px solid rgba(56,189,248,0.25)' }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: 'var(--color-info)' }}>
                  Original sheet (as fetched)
                </span>
                {lastImported.sourceUrl && (
                  <a href={lastImported.sourceUrl} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] underline" style={{ color: 'var(--color-info)' }}>
                    Open source page ↗
                  </a>
                )}
              </div>
              {originText
                ? <pre className="font-mono text-[11px] whitespace-pre-wrap max-h-72 overflow-y-auto" style={{ color: 'var(--color-ink-subtle)' }}>{originText}</pre>
                : <span className="text-[11px] italic" style={{ color: 'var(--color-ink-ghost)' }}>Raw sheet not available for this import — open the source page to compare.</span>}
            </div>
          )}

          {/* chord chips with hover shapes */}
          {lastImported.chords?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {lastImported.chords.map((c, i) => (
                <ChordTip key={i} name={c}>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-750)', color: 'var(--color-brand)' }}>{c}</span>
                </ChordTip>
              ))}
            </div>
          )}

          {/* chord-over-lyric display (read-only) */}
          {lastImported.lyricLines?.length > 0 && (
            <div className="rounded-lg p-3 font-mono text-xs max-h-72 overflow-y-auto" style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-700)' }}>
              {lastImported.lyricLines.map((ln, i) => (
                <div key={i} className="mb-1">
                  {ln.chordNames?.length > 0 && (
                    <div className="font-bold" style={{ color: 'var(--color-accent)' }}>
                      {ln.chordNames.map((n, k) => (
                        <ChordTip key={k} name={n}><span className="mr-2">{n}</span></ChordTip>
                      ))}
                    </div>
                  )}
                  <div style={{ color: 'var(--color-ink-subtle)' }}>{ln.text || ' '}</div>
                </div>
              ))}
            </div>
          )}

          {/* any solo/riff tab passages, with their own Play buttons */}
          <SoloTabView song={lastImported} bpm={lastImported.bpm} profile={editorProfile} />
        </div>
      )}

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
                  <ChordTip key={i} name={c}>
                    <span className="text-[11px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--color-surface-750)', color: 'var(--color-brand)' }}>{c}</span>
                  </ChordTip>
                ))
              : <span className="text-[11px] italic" style={{ color: 'var(--color-danger)' }}>none — check the format</span>}
          </div>

          {/* chord-over-lyric preview */}
          <div className="rounded-lg p-3 font-mono text-xs max-h-60 overflow-y-auto" style={{ background: 'var(--color-surface-base)', border: '1px solid var(--color-surface-700)' }}>
            {(parsed.lyricLines?.length)
              ? parsed.lyricLines.map((ln, i) => (
                  <div key={i} className="mb-1">
                    {ln.chordNames?.length > 0 && (
                      <div className="font-bold" style={{ color: 'var(--color-accent)' }}>
                        {ln.chordNames.map((n, k) => (
                          <ChordTip key={k} name={n}><span className="mr-2">{n}</span></ChordTip>
                        ))}
                      </div>
                    )}
                    <div style={{ color: 'var(--color-ink-subtle)' }}>{ln.text || ' '}</div>
                  </div>
                ))
              : <span className="italic" style={{ color: 'var(--color-ink-ghost)' }}>No lyric lines parsed.</span>}
          </div>

          {/* Any solo/riff tab passages we pulled out of the sheet — confirm they
              were captured; they'll play & be scored in Play-Along. */}
          <SoloTabView song={parsed} bpm={parsed.bpm} profile={editorProfile} />

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
