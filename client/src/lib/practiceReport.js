// Post-run practice report — turns a Play-Along session's per-window forensics
// into a detailed, human-readable diagnosis: which chord tones failed, on which
// string / fret / FINGER, buzz-vs-mute inference, wrong-note analysis ("you were
// one fret off" / "you were still holding the previous chord"), timing trouble,
// hardest transitions, and concrete suggestions (easier voicing, capo, slower
// speed). Pure logic — the results screen just renders what this returns.
//
// Honesty note baked into the copy: an FFT hears PITCHES, not fingers. A tone
// that reads "weak" is *consistent with* a buzzing / lightly-fretted string; a
// "missing" tone is consistent with a muted string or a finger not down. The
// string+finger attribution comes from the target voicing + optimalFingering,
// i.e. "the finger that SHOULD be playing the failed note" — which is exactly
// what a teacher would point at.

import { optimalFingering, transitionDifficulty } from './fretboard';
import { personalDifficulty, recommendedMaxDifficulty } from './handProfile';
import { easiestVoicing } from './voicingLookup';
import { suggestCapo } from './lyricChords';
import { PC_NAMES } from './practiceGame';

const OPEN_MIDI = [40, 45, 50, 55, 59, 64];
const STRING_NAMES = ['low E', 'A', 'D', 'G', 'B', 'high e'];
const FINGER_NAMES = { 1: 'index', 2: 'middle', 3: 'ring', 4: 'pinky' };

const GOOD_Q = 0.6;
const FAIL_RATE = 0.4;    // a tone/timing problem is reported at ≥40% of attempts

// Which played strings of a tab produce a given pitch class.
function stringsForPc(tab, pc) {
  const out = [];
  for (let s = 0; s < 6 && s < (tab || '').length; s++) {
    const ch = tab[s];
    if (ch === 'x' || ch === 'X') continue;
    const fret = parseInt(ch, 10);
    if (Number.isNaN(fret)) continue;
    if ((OPEN_MIDI[s] + fret) % 12 === pc) out.push({ string: s, fret });
  }
  return out;
}

/**
 * Build the full session report.
 * @param {Array} windows  the play timeline (name, tab, notes, pcs …)
 * @param {Array} results  aligned per-window results carrying tones/wrongTop/onsetBeat
 * @param {object} profile the active hand profile
 * @returns {null | {
 *   chordIssues, fingerStats, transitions, capo, overall, stats
 * }} null when there's nothing scored to report on.
 */
export function buildSessionReport(windows, results, profile) {
  if (!results?.length) return null;
  const n = Math.min(results.length, windows.length);

  // ── Aggregate per chord name ──
  const byChord = new Map();
  // ── Aggregate per finger (all fretted tone attempts across the whole run) ──
  const fingerAgg = { 1: { issues: 0, attempts: 0 }, 2: { issues: 0, attempts: 0 }, 3: { issues: 0, attempts: 0 }, 4: { issues: 0, attempts: 0 } };
  // ── Aggregate transitions (prev chord → this chord) ──
  const byTransition = new Map();

  let silentCount = 0, lateCount = 0, wrongEnergyRuns = 0;

  for (let i = 0; i < n; i++) {
    const w = windows[i], r = results[i];
    if (r.quality === 'silent') silentCount++;
    if (r.onsetBeat != null && r.onsetBeat > 2.5) lateCount++;
    if ((r.wrongTop || []).length) wrongEnergyRuns++;

    // chord aggregation
    let c = byChord.get(w.name);
    if (!c) {
      c = { name: w.name, tab: w.tab, notes: w.notes, attempts: 0, qSum: 0, late: 0, silent: 0,
            toneFails: new Map(), wrongPcs: new Map(), prevNames: new Map() };
      byChord.set(w.name, c);
    }
    c.attempts++;
    c.qSum += r.q || 0;
    if (r.onsetBeat != null && r.onsetBeat > 2.5) c.late++;
    if (r.quality === 'silent') c.silent++;
    for (const t of r.tones || []) {
      const e = c.toneFails.get(t.pc) || { pc: t.pc, required: t.required, missing: 0, weak: 0, attempts: 0 };
      e.attempts++;
      if (t.status === 'missing') e.missing++;
      else if (t.status === 'weak') e.weak++;
      c.toneFails.set(t.pc, e);
    }
    for (const wr of r.wrongTop || []) {
      c.wrongPcs.set(wr.pc, (c.wrongPcs.get(wr.pc) || 0) + wr.share);
    }
    if (i > 0 && windows[i - 1].name !== w.name) {
      c.prevNames.set(windows[i - 1].name, (c.prevNames.get(windows[i - 1].name) || 0) + 1);
      // transition aggregation
      const key = `${windows[i - 1].name}→${w.name}`;
      const tr = byTransition.get(key) || { from: windows[i - 1].name, to: w.name, count: 0, qSum: 0, late: 0, fromNotes: windows[i - 1].notes, toNotes: w.notes };
      tr.count++;
      tr.qSum += r.q || 0;
      if (r.onsetBeat != null && r.onsetBeat > 2.5) tr.late++;
      byTransition.set(key, tr);
    }

    // finger aggregation: every fretted tone attempt in this window, attributed
    // to the finger that should be playing it
    if (w.tab && (r.tones || []).length && r.quality !== 'silent') {
      const fing = optimalFingering(w.notes);
      const fingerByString = {};
      if (fing) for (const a of fing.assignment) fingerByString[a.string] = a.finger;
      for (const t of r.tones) {
        for (const pos of stringsForPc(w.tab, t.pc)) {
          if (pos.fret === 0) continue;                    // opens have no finger
          const f = fingerByString[pos.string];
          if (!f) continue;
          fingerAgg[f].attempts++;
          if (t.status !== 'ok') fingerAgg[f].issues++;
        }
      }
    }
  }

  const reachCeiling = recommendedMaxDifficulty(profile);

  // ── Per-chord issue reports ──
  const chordIssues = [];
  for (const c of byChord.values()) {
    const avgQ = c.attempts ? c.qSum / c.attempts : 0;
    const failedTones = [...c.toneFails.values()]
      .map(e => ({ ...e, failRate: (e.missing + e.weak) / e.attempts, missRate: e.missing / e.attempts }))
      .filter(e => e.failRate >= FAIL_RATE);
    const lateRate = c.late / c.attempts;
    const isIssue = avgQ < GOOD_Q || failedTones.length > 0 || lateRate >= 0.5 || c.silent / c.attempts >= 0.5;
    if (!isIssue) continue;

    const fing = c.notes?.length ? optimalFingering(c.notes) : null;
    const fingerByString = {};
    let barreFret = null;
    if (fing) for (const a of fing.assignment) {
      fingerByString[a.string] = a.finger;
      if (a.barre) barreFret = a.fret;
    }

    // Tone diagnostics: map each failing pitch class onto the string(s) that
    // should play it, with fret + finger + a buzz/mute interpretation.
    const tones = [];
    let barreFailures = 0;
    for (const ft of failedTones.sort((a, b) => b.failRate - a.failRate)) {
      const spots = stringsForPc(c.tab, ft.pc);
      const spotDescs = spots.map(pos => {
        const finger = pos.fret > 0 ? fingerByString[pos.string] : null;
        const isBarre = barreFret != null && pos.fret === barreFret && finger === 1;
        if (isBarre) barreFailures++;
        return {
          string: pos.string, stringName: STRING_NAMES[pos.string],
          fret: pos.fret, open: pos.fret === 0,
          finger, fingerName: finger ? FINGER_NAMES[finger] : null, barre: isBarre,
        };
      });
      const mostlyMissing = ft.missRate >= ft.failRate / 2;
      tones.push({
        noteName: PC_NAMES[ft.pc],
        required: ft.required,
        failRate: ft.failRate,
        kind: mostlyMissing ? 'missing' : 'weak',
        spots: spotDescs,
        text: toneText(PC_NAMES[ft.pc], mostlyMissing, spotDescs, ft.failRate, c.attempts),
      });
    }

    // Wrong-note analysis with musical hints.
    const wrongNotes = [...c.wrongPcs.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 2)
      .map(([pc, shareSum]) => ({
        noteName: PC_NAMES[pc],
        hint: wrongNoteHint(pc, c, byChord),
        share: shareSum / c.attempts,
      }));

    // Reach analysis + suggestions.
    const suggestions = [];
    const v = easiestVoicing(c.name);
    const personalScore = v ? personalDifficulty(v.score, profile) : null;
    const beyondReach = personalScore != null && personalScore > reachCeiling;

    if (barreFailures >= 2) {
      suggestions.push(`Your barre (index finger flat across fret ${barreFret}) isn't sealing all the strings — roll the finger slightly onto its bony edge and pull back with the arm, not just the thumb.`);
    }
    for (const t of tones) {
      if (t.spots.some(s => s.open)) {
        suggestions.push(`The open ${t.spots.find(s => s.open).stringName} string didn't ring — one of your fretting fingers is probably leaning on it. Arch the fingers more (thumb lower behind the neck helps).`);
        break;   // one open-string tip is enough
      }
    }
    const frettedFail = tones.find(t => t.spots.some(s => !s.open && !s.barre));
    if (frettedFail) {
      const s = frettedFail.spots.find(x => !x.open && !x.barre);
      if (frettedFail.kind === 'weak') {
        suggestions.push(`The ${frettedFail.noteName} (${s.stringName} string, fret ${s.fret}, ${s.fingerName} finger) sounded weak — that's the signature of a buzzing or half-pressed string. Move the ${s.fingerName} finger closer behind the fret wire and press with the fingertip, not the pad.`);
      } else {
        suggestions.push(`The ${frettedFail.noteName} (${s.stringName} string, fret ${s.fret}, ${s.fingerName} finger) didn't sound at all — the string is being muted. Check the ${s.fingerName} finger is actually down and that a neighbouring finger isn't touching that string.`);
      }
    }
    if (lateRate >= FAIL_RATE) {
      const hardestFrom = [...c.prevNames.entries()].sort((a, b) => b[1] - a[1])[0];
      suggestions.push(hardestFrom
        ? `You consistently arrive late on ${c.name} — the ${hardestFrom[0]}→${c.name} change is the bottleneck. Practice just that switch slowly, 10 times in a row, before playing the song.`
        : `You consistently arrive late on ${c.name} — try the song at a slower speed until the shape lands on the beat.`);
    }
    if (c.silent / c.attempts >= 0.5) {
      suggestions.push(`You stopped playing on ${c.name} — a classic sign the shape isn't automatic yet. Drill it alone in the Practice tab first.`);
    }
    if (beyondReach) {
      const easier = easiestVoicing(c.name, { profile, limitToReach: true });
      suggestions.push(easier && easier.tab !== c.tab
        ? `${c.name} scores ${personalScore}/10 for your hand (your comfort ceiling is ${reachCeiling}). Try the easier shape ${easier.tab} instead.`
        : `${c.name} scores ${personalScore}/10 for your hand (ceiling ${reachCeiling}) — this stretch is genuinely hard for you; a capo version of the song may serve better.`);
    }

    chordIssues.push({
      name: c.name, tab: c.tab, notes: c.notes,
      attempts: c.attempts, avgQ, lateRate,
      silentRate: c.silent / c.attempts,
      personalScore, beyondReach,
      tones, wrongNotes, suggestions,
    });
  }
  chordIssues.sort((a, b) => a.avgQ - b.avgQ);

  // ── Finger stats ──
  const fingerStats = Object.entries(fingerAgg)
    .map(([f, a]) => ({
      finger: Number(f), name: FINGER_NAMES[f],
      issues: a.issues, attempts: a.attempts,
      rate: a.attempts ? a.issues / a.attempts : 0,
    }))
    .filter(x => x.attempts >= 4)
    .sort((a, b) => b.rate - a.rate);

  // ── Hardest transitions ──
  const transitions = [...byTransition.values()]
    .map(t => ({
      from: t.from, to: t.to, count: t.count,
      avgQ: t.qSum / t.count, lateRate: t.late / t.count,
      physicalCost: (t.fromNotes?.length && t.toNotes?.length)
        ? Math.round(transitionDifficulty(t.fromNotes, t.toNotes) * 10) / 10 : null,
    }))
    .filter(t => t.avgQ < 0.7 || t.lateRate >= FAIL_RATE)
    .sort((a, b) => a.avgQ - b.avgQ)
    .slice(0, 3);

  // ── Capo suggestion across the song's chords ──
  const capo = suggestCapo([...byChord.keys()]);

  // ── Overall narrative ──
  const overall = [];
  const resolved = n;
  const avgAll = results.slice(0, n).reduce((s, r) => s + (r.q || 0), 0) / resolved;
  if (silentCount / resolved >= 0.2) {
    overall.push(`You went quiet for ${silentCount} of ${resolved} bars — usually the changes are coming faster than the hands can form the shapes. Play the song at a slower speed until you can keep strumming through every change, even sloppily.`);
  }
  const dominantFailedTones = chordIssues.reduce((s, c) => s + c.tones.length, 0);
  if (dominantFailedTones > 0 && wrongEnergyRuns / resolved < 0.25) {
    overall.push(`Your main issue is strings not ringing cleanly rather than wrong notes — that's a pressing/placement problem (buzz or accidental muting), not a knowledge problem. The per-chord notes below say exactly which finger to fix.`);
  } else if (wrongEnergyRuns / resolved >= 0.25) {
    overall.push(`A lot of off-chord notes came through — check you're on the right frets, and that you're not still holding the previous shape when the bar changes.`);
  }
  if (fingerStats.length && fingerStats[0].rate >= 0.35) {
    const f = fingerStats[0];
    overall.push(`Across the whole run, notes assigned to your ${f.name} finger failed ${Math.round(f.rate * 100)}% of the time (${f.issues} of ${f.attempts}) — it's your weakest link this session. Slow chromatic exercises focusing on that finger will pay off fastest.`);
  }
  const bestChord = [...byChord.values()].filter(c => c.attempts >= 2).sort((a, b) => b.qSum / b.attempts - a.qSum / a.attempts)[0];
  if (bestChord && bestChord.qSum / bestChord.attempts >= 0.75) {
    overall.push(`On the bright side: your ${bestChord.name} is solid (${Math.round((bestChord.qSum / bestChord.attempts) * 100)}% average match) — use it as the anchor you relax into.`);
  }
  if (capo) {
    const pairs = Object.entries(capo.map).filter(([a, b]) => a !== b).slice(0, 3)
      .map(([a, b]) => `${a}→${b}`).join(', ');
    overall.push(`Capo tip: with a capo on fret ${capo.fret} this song becomes open shapes (${pairs}) — a much friendlier workout for the same music.`);
  }
  if (!overall.length && avgAll >= 0.75) {
    overall.push('A clean run — no systematic problems detected. Push the speed up a notch or pick a harder song.');
  }

  return {
    chordIssues, fingerStats, transitions, capo, overall,
    stats: { resolved, silentCount, lateCount, avgQ: avgAll },
  };
}

// "The E didn't ring on 7 of 10 tries (D string, fret 2, middle finger)."
function toneText(noteName, missing, spots, failRate, attempts) {
  const failedTimes = Math.round(failRate * attempts);
  const where = spots.map(s =>
    s.open ? `open ${s.stringName} string`
      : s.barre ? `${s.stringName} string, fret ${s.fret} (barre)`
      : `${s.stringName} string, fret ${s.fret}, ${s.fingerName} finger`,
  ).join(' / ');
  return `${noteName} ${missing ? "didn't sound" : 'rang weak (buzz?)'} on ${failedTimes} of ${attempts} tries — ${where}`;
}

// A musical hint for a wrong pitch class: fret-off? previous-chord hangover?
function wrongNoteHint(pc, chord, byChord) {
  // One semitone from an expected tone → probably one fret off.
  for (const spot of allTabPcs(chord.tab)) {
    const d = Math.min((pc - spot.pc + 12) % 12, (spot.pc - pc + 12) % 12);
    if (d === 1) {
      return `one fret off the ${PC_NAMES[spot.pc]} (${STRING_NAMES[spot.string]} string) — check finger placement`;
    }
  }
  // A tone of the chord that usually PRECEDES this one → late change hangover.
  for (const [prevName] of [...chord.prevNames.entries()].sort((a, b) => b[1] - a[1])) {
    const prev = byChord.get(prevName);
    if (prev && allTabPcs(prev.tab).some(s => s.pc === pc)) {
      return `a ${prevName} tone — you were likely still holding ${prevName} when the bar changed`;
    }
  }
  return 'a stray note — possibly an unmuted string ringing through';
}

function allTabPcs(tab) {
  const out = [];
  for (let s = 0; s < 6 && s < (tab || '').length; s++) {
    const ch = tab[s];
    if (ch === 'x' || ch === 'X') continue;
    const fret = parseInt(ch, 10);
    if (Number.isNaN(fret)) continue;
    out.push({ string: s, fret, pc: (OPEN_MIDI[s] + fret) % 12 });
  }
  return out;
}
