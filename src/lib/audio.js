// Standard tuning frequencies for open strings (E2 A2 D3 G3 B3 E4)
const OPEN_HZ = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];

let _ctx = null;
let _timeouts = [];

function getCtx() {
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioContext();
    // Master compressor prevents clipping when all strings ring at once
    const comp = _ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(_ctx.destination);
    _ctx._out = comp;
  }
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

function fretHz(string, fret) {
  return OPEN_HZ[string] * 2 ** (fret / 12);
}

// Parse tab string ('x32010') into playable notes (skip muted strings)
function tabToNotes(tab) {
  return tab
    .split('')
    .map((v, s) => (v === 'x' ? null : { string: s, fret: parseInt(v) }))
    .filter(Boolean);
}

// Single plucked string: triangle fundamental + harmonic sines, exponential decay
function pluck(ctx, hz, startTime, decay) {
  const env = ctx.createGain();
  env.connect(ctx._out);
  env.gain.setValueAtTime(0, startTime);
  env.gain.linearRampToValueAtTime(0.22, startTime + 0.004);
  env.gain.exponentialRampToValueAtTime(0.001, startTime + decay);

  [
    [1, 'triangle', 0.60],
    [2, 'sine',     0.24],
    [3, 'sine',     0.10],
    [4, 'sine',     0.06],
  ].forEach(([harmonic, type, amp]) => {
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz * harmonic;
    g.gain.value = amp;
    osc.connect(g);
    g.connect(env);
    osc.start(startTime);
    osc.stop(startTime + decay + 0.05);
  });
}

/**
 * Play a chord progression.
 * @param {Array<{tab: string}>} voicings  - one voicing per chord (must have .tab)
 * @param {number} bpm
 * @param {(chordIdx: number) => void} onChord  - called when each chord starts
 * @param {() => void} onDone                   - called when playback finishes
 */
export function playProgression(voicings, bpm = 72, onChord, onDone) {
  // Stop any prior playback
  _timeouts.forEach(clearTimeout);
  _timeouts = [];
  if (_ctx) { _ctx.close(); _ctx = null; }

  const ctx = getCtx();
  const chordDur = (60 / bpm) * 4;   // 4 beats per chord
  const noteDur  = chordDur * 0.88;  // notes ring slightly shorter than the beat

  voicings.forEach((voicing, i) => {
    const tChord = ctx.currentTime + 0.08 + i * chordDur;

    // Strum: 16 ms between each string (low → high)
    tabToNotes(voicing.tab).forEach((note, ni) => {
      pluck(ctx, fretHz(note.string, note.fret), tChord + ni * 0.016, noteDur);
    });

    if (onChord) {
      const ms = Math.max(0, (tChord - ctx.currentTime) * 1000);
      _timeouts.push(setTimeout(() => onChord(i), ms));
    }
  });

  if (onDone) {
    const totalMs = (voicings.length * chordDur + 0.4) * 1000;
    _timeouts.push(setTimeout(onDone, totalMs));
  }
}

export function stopAudio() {
  _timeouts.forEach(clearTimeout);
  _timeouts = [];
  if (_ctx) { _ctx.close(); _ctx = null; }
}
