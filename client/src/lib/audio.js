// Standard tuning frequencies for open strings (E2 A2 D3 G3 B3 E4)
const OPEN_HZ = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];

let _ctx = null;
let _timeouts = [];
let _lastState = 'none';

// Diagnostic: current AudioContext state + sampleRate, for on-screen debugging
// of audio problems on devices we can't open a console on (iOS).
export function audioDebug() {
  return {
    state: _ctx ? _ctx.state : 'no-context',
    last: _lastState,
    sampleRate: _ctx ? _ctx.sampleRate : 0,
    currentTime: _ctx ? Number(_ctx.currentTime.toFixed(2)) : 0,
  };
}

// Build (once) a single shared AudioContext. iOS Safari starts it suspended and
// will only let it resume from inside a user gesture, so we never close/recreate
// it — closing it would drop the gesture "unlock" and silence later playback.
function buildCtx() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctor();
  // Master compressor prevents clipping when all strings ring at once
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 6;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  comp.connect(ctx.destination);
  ctx._out = comp;
  return ctx;
}

function getCtx() {
  if (!_ctx || _ctx.state === 'closed') _ctx = buildCtx();
  return _ctx;
}

/**
 * Unlock/resume audio from inside a user-gesture handler. MUST be called
 * synchronously from a real tap/click (not after an await) on iOS, or the
 * AudioContext stays suspended and everything is silent.
 *
 * Plays a 1-sample silent buffer to satisfy iOS's "sound during gesture"
 * requirement, then resumes. Returns a promise that resolves once running.
 */
export async function unlockAudio() {
  const ctx = getCtx();
  // Prime with a silent buffer — required to unlock audio on iOS.
  try {
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  } catch { /* ignore */ }
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch { /* ignore */ }
  }
  return ctx;
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
  // Stop any prior playback (without tearing down the shared context).
  _timeouts.forEach(clearTimeout);
  _timeouts = [];

  const ctx = getCtx();

  // iOS unlock MUST happen synchronously inside the tap handler (no await
  // before it). Prime with a silent buffer, then resume. We do NOT await the
  // resume — instead we schedule everything a safe lead-time in the future so
  // notes land after the clock starts running.
  try {
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch { /* ignore */ }
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch { /* ignore */ } }
  _lastState = ctx.state;

  const chordDur = (60 / bpm) * 4;   // 4 beats per chord
  const noteDur  = chordDur * 0.88;  // notes ring slightly shorter than the beat

  // Larger lead so the first strum isn't scheduled before the (just-resumed)
  // clock has actually advanced on iOS.
  const lead = 0.15;

  voicings.forEach((voicing, i) => {
    const tChord = ctx.currentTime + lead + i * chordDur;

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

/**
 * Play a transcribed clip from its timed note events.
 *
 * Unlike playProgression (fixed tempo, one strum per chord), this honors each
 * note's real onset time and duration, so it sounds like what was transcribed.
 *
 * @param {Array<{string:number, fret:number, time:number, duration?:number}>} events
 *        Note events from the tab service (string 0=low E … 5=high e). `time` and
 *        `duration` are in seconds, relative to the clip start.
 * @param {() => void} onDone  - called when playback finishes.
 * @returns {number} the total playback duration in seconds (0 if nothing to play).
 */
export function playEvents(events, onDone) {
  _timeouts.forEach(clearTimeout);
  _timeouts = [];

  const ctx = getCtx();

  // iOS unlock — same synchronous prime + resume as playProgression.
  try {
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch { /* ignore */ }
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch { /* ignore */ } }
  _lastState = ctx.state;

  const playable = (events || []).filter(
    e => e && e.string >= 0 && e.string <= 5 && e.fret >= 0,
  );
  if (!playable.length) {
    if (onDone) onDone();
    return 0;
  }

  const lead = 0.15;
  const t0 = Math.min(...playable.map(e => e.time || 0)); // normalize so playback starts now
  let endRel = 0;

  for (const e of playable) {
    const rel = (e.time || 0) - t0;
    // Ring for the note's own duration, with sane floor/ceiling so very short
    // detected notes are still audible and very long ones don't pile up.
    const decay = Math.min(2.5, Math.max(0.25, e.duration || 0.4));
    pluck(ctx, fretHz(e.string, e.fret), ctx.currentTime + lead + rel, decay);
    endRel = Math.max(endRel, rel + decay);
  }

  if (onDone) {
    _timeouts.push(setTimeout(onDone, (lead + endRel + 0.2) * 1000));
  }
  return lead + endRel;
}

export function stopAudio() {
  _timeouts.forEach(clearTimeout);
  _timeouts = [];
  // Silence any currently-ringing notes by disconnecting the master output,
  // then reconnect a fresh compressor — but keep the SAME AudioContext so the
  // iOS gesture unlock is preserved for the next play.
  if (_ctx && _ctx.state !== 'closed') {
    try {
      _ctx._out.disconnect();
      const comp = _ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.ratio.value = 6;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      comp.connect(_ctx.destination);
      _ctx._out = comp;
    } catch { /* ignore */ }
  }
}
