import { musicHeard } from './guideBus';

// Standard tuning frequencies for open strings (E2 A2 D3 G3 B3 E4)
const OPEN_HZ = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];

let _ctx = null;
let _timeouts = [];
let _lastState = 'none';
let _emdr = null;      // bilateral EMDR bed: { osc, c2, panner, lfo, lfoDepth, bedMaster, extra } | null
let _ambient = null;   // calm ambient drone: { oscs, lfo, ambMaster } | null
let _silentEl = null;   // looping silent <audio> — flips iOS into the "media"
                        // audio category so Web Audio plays even with the
                        // physical ringer/silent switch ON (see enableMediaPlayback).

// A tiny silent WAV as a data-URI (44-byte header + a few silent frames). Looping
// this through an HTML5 <audio> element convinces iOS to route audio through the
// media/playback channel, which — unlike the Web Audio "ambient" channel — is NOT
// muted by the hardware silent switch. Without this, on an iPhone with the ringer
// switch on silent, synthesized chords are inaudible while <video> sound still plays.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

/**
 * Route Web Audio through iOS's media channel so it ignores the silent switch.
 * MUST be called from inside a real user gesture (tap/click). Idempotent.
 *
 * iOS mutes the Web Audio API when the hardware ringer switch is set to silent,
 * but leaves HTML media elements audible. Starting (and keeping) a looping silent
 * <audio> element promotes the page's audio session to "playback", after which our
 * synthesized sounds play in silent mode too.
 */
export function enableMediaPlayback() {
  try {
    if (!_silentEl) {
      const el = new Audio(SILENT_WAV);
      el.loop = true;
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      el.muted = false;      // must be audible (silent content) to hold the session
      el.volume = 0.0001;    // effectively silent, but a real, non-muted stream
      _silentEl = el;
    }
    // play() must be kicked off during the gesture; ignore the promise rejection
    // that occurs if it's ever called outside one.
    const p = _silentEl.play();
    if (p && p.catch) p.catch(() => {});
  } catch { /* ignore */ }
}

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
  // Promote to the media audio session so playback survives the iOS silent switch.
  enableMediaPlayback();
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

// ── Classical (nylon-string) guitar voice ──────────────────────────────────
// A plucked string is modeled with Karplus–Strong: a short burst of filtered
// noise is fed through a tuned delay line whose feedback loop is gently
// low-passed, so high harmonics die faster than the fundamental — exactly how a
// real nylon string decays (bright attack → warm, mellow sustain). This sounds
// far more like a real classical guitar than summed oscillators, and it's cheap:
// each note is rendered ONCE into an AudioBuffer and played back natively.
//
// Rendering identical buffers repeatedly (every strum re-plucks the same pitches)
// would be wasteful, so completed buffers are cached by rounded (hz, decay). The
// cache lives ON the AudioContext (ctx._ks) so it's discarded automatically if the
// context is ever rebuilt — buffers are bound to the context that created them.
function renderKarplusStrong(ctx, hz, decay) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * (decay + 0.1)));
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);

  // Delay-line length = one period. Fractional tuning via a 2-tap read keeps
  // pitch accurate for high strings where the integer period is short.
  const period = sr / hz;
  const N = Math.max(2, Math.floor(period));
  const frac = period - N;                 // fractional remainder for tuning
  const line = new Float32Array(N + 1);

  // Excitation: a short noise burst, low-passed a little so the pluck is round
  // (nylon), not harsh (like a bright steel string / spinet). Pluck "position"
  // is emulated by comb-filtering the burst so it isn't a pure hiss.
  const burst = Math.min(N, Math.floor(N * 0.9));
  let last = 0;
  for (let i = 0; i < line.length; i++) {
    if (i < burst) {
      const white = Math.random() * 2 - 1;
      last = 0.5 * white + 0.5 * last;     // 1-pole LP → mellow nylon attack
      line[i] = last;
    } else {
      line[i] = 0;
    }
  }

  // Karplus–Strong loop. `damp` sets how fast the string loses energy (its
  // sustain); `bright` (loop lowpass coefficient) mellows successive reflections.
  // Slightly darker than a steel string to sit in nylon territory.
  const bright = 0.50;                      // loop LP mix (0=dark … 1=bright)
  // Per-sample loop gain tuned so the note fades to silence around `decay`.
  const loopGain = Math.pow(0.001, 1 / (decay * hz));
  let idx = 0;
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[idx];
    const nxt = line[(idx + 1) % line.length];
    const sample = cur + frac * (nxt - cur);   // fractional-delay read (tuning)
    out[i] = sample;
    // Feedback: average with previous (lowpass) + loop damping, written back.
    const lp = bright * sample + (1 - bright) * prev;
    prev = sample;
    line[idx] = lp * loopGain;
    idx = (idx + 1) % line.length;
  }

  // Fade the last 8 ms so cached buffers never click at their tail.
  const fade = Math.min(len, Math.floor(sr * 0.008));
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
  return buf;
}

// Single plucked string (nylon). Same signature as before so every player path
// (progression, events, solo) upgrades automatically. Also exported (as
// `pluckNylon`) so the Scales/Composer screens share this one classical-guitar
// voice instead of keeping a separate additive-synth pluck.
export function pluckNylon(ctx, hz, startTime, decay) {
  pluck(ctx, hz, startTime, decay);
  // Single-string plucks (the interactive strings/fretboard) also count as
  // "music heard" — a short pulse; repeated plucks keep the guide dancing.
  musicHeard(Math.min(1500, (Math.max(0.3, decay || 0.6) + 0.4) * 1000));
}
function pluck(ctx, hz, startTime, decay) {
  if (!ctx._ks) ctx._ks = new Map();
  const key = `${Math.round(hz * 4)}:${Math.round(decay * 20)}`;
  let buf = ctx._ks.get(key);
  if (!buf) { buf = renderKarplusStrong(ctx, hz, decay); ctx._ks.set(key, buf); }

  const src = ctx.createBufferSource();
  src.buffer = buf;

  // Guitar-body resonance: a gentle low-pass + a warm low-mid peak give the
  // hollow, woody character of a classical guitar's soundboard.
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 3200;
  body.Q.value = 0.7;
  const warmth = ctx.createBiquadFilter();
  warmth.type = 'peaking';
  warmth.frequency.value = 220;
  warmth.gain.value = 3;
  warmth.Q.value = 0.9;

  const env = ctx.createGain();
  env.gain.value = 0.32;

  src.connect(body);
  body.connect(warmth);
  warmth.connect(env);
  env.connect(ctx._out);

  src.start(startTime);
  src.stop(startTime + decay + 0.12);
}

// ─── Calm voice + EMDR beds (for the Music Memory / ear-training tab) ─────────
// A soft, warm prompt voice (not the metallic Karplus–Strong pluck), a bilateral
// stereo EMDR pad that pans LEFT↔RIGHT once per breath, and a quiet ambient drone.
// The two beds route to ctx.destination on their OWN gain (NOT ctx._out): _out is
// a mono-summing DynamicsCompressor whose sidechain would duck the pad on every
// strum, and stopAudio() disconnects+rebuilds _out (which would orphan, not
// silence, a bed on it). The beds hold their own node handles and are stopped
// explicitly by stopEmdrBed()/stopAmbient() (also called from stopAudio()).

/**
 * Soft, warm prompt voice for Music Memory (replaces the metallic pluck for
 * prompts). Two detuned sines + a quiet sub-octave triangle → gentle lowpass →
 * slow ADSR → ctx._out (foreground cue, mono-summed with guitar, silenced by
 * stopAudio()). Does NOT call musicHeard() — the calm session keeps the guide still.
 */
export function playSoftTone(ctx, hz, startTime, dur = 1.2, opts = {}) {
  const g0      = opts.gain ?? 0.18;
  const attack  = opts.attack ?? 0.06;
  const release = opts.release ?? 0.40;
  const detune  = opts.detuneCents ?? 7;

  const osc1 = ctx.createOscillator(); osc1.type = 'sine';     osc1.frequency.value = hz;
  const osc2 = ctx.createOscillator(); osc2.type = 'sine';     osc2.frequency.value = hz; osc2.detune.value = detune;
  const sub  = ctx.createOscillator(); sub.type  = 'triangle'; sub.frequency.value  = hz / 2;

  const mix = ctx.createGain();
  const subGain = ctx.createGain(); subGain.gain.value = 0.35;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(2600, hz * 6 + 400);
  lp.Q.value = 0.4;

  const env = ctx.createGain();
  const t = startTime;
  const end = t + dur;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(g0, t + attack);
  env.gain.setValueAtTime(g0, Math.max(t + attack, end - release));
  env.gain.exponentialRampToValueAtTime(0.0001, end + release);

  osc1.connect(mix); osc2.connect(mix);
  sub.connect(subGain); subGain.connect(mix);
  mix.connect(lp); lp.connect(env);
  env.connect(ctx._out);

  const stopAt = end + release + 0.05;
  osc1.start(t); osc2.start(t); sub.start(t);
  osc1.stop(stopAt); osc2.stop(stopAt); sub.stop(stopAt);
}

/**
 * Soft chord/arpeggio prompt (warm, lightly rolled). Per-voice gain stays low so
 * the summed voices never clip ctx._out (an un-catalogued chord can carry 3–4
 * tones as plucks).
 */
export function playSoftChord(ctx, hzs, startTime, opts = {}) {
  const list = hzs || [];
  const dur    = opts.dur ?? 1.6;
  const spread = (opts.spreadMs ?? 90) / 1000;
  const per = opts.gain ?? Math.max(0.07, Math.min(0.13, 0.34 / Math.max(1, list.length)));
  list.forEach((hz, i) => {
    playSoftTone(ctx, hz, startTime + i * spread, dur, { gain: per, release: 0.5 });
  });
}

/**
 * Bilateral EMDR stereo bed. A soft drone whose stereo PAN sweeps LEFT↔RIGHT once
 * per breathMs, phase-exact via a cosine PeriodicWave LFO. Pan = 0 + (−1)·cos(2πt/T)
 * = −cos, so it is −1 (LEFT) at t=0 (matching the pacer orb, which starts left) and
 * +1 (RIGHT) at T/2. Routes to ctx.destination on its own gain to preserve stereo
 * and avoid the master compressor's ducking. Idempotent.
 *
 * @returns {number} perfEpoch — performance.now() at LFO start, for the CSS pacer
 *          to phase-offset against (never ctx.currentTime — different clock).
 */
export function startEmdrBed({ breathMs = 8000, gain = 0.05, droneHz = 174.6 } = {}) {
  const ctx = getCtx();
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch { /* ignore */ } }
  stopEmdrBed();

  const breathS = breathMs / 1000;
  const now = ctx.currentTime + 0.02;
  const perfEpoch = performance.now();

  const bedMaster = ctx.createGain();
  bedMaster.gain.setValueAtTime(0.0001, now);
  bedMaster.gain.linearRampToValueAtTime(gain, now + 1.5);
  bedMaster.connect(ctx.destination);

  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900; lp.Q.value = 0.2;
  const c1 = ctx.createOscillator(); c1.type = 'sine'; c1.frequency.value = droneHz;
  const c2 = ctx.createOscillator(); c2.type = 'sine'; c2.frequency.value = droneHz * 2 ** (7 / 12);
  const c2g = ctx.createGain(); c2g.gain.value = 0.35;
  c1.connect(lp); c2.connect(c2g); c2g.connect(lp);

  if (typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(0, now);                 // BASE 0 — LFO supplies the full swing
    const lfo = ctx.createOscillator();
    // Cosine wave: real=[0,1] → lfo(t)=cos(2πft). No negative start; exact period.
    const cosWave = ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]));
    lfo.setPeriodicWave(cosWave);
    lfo.frequency.value = 1 / breathS;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = -1;  // pan = -cos → LEFT at t=0
    lfo.connect(lfoDepth); lfoDepth.connect(panner.pan);
    lp.connect(panner); panner.connect(bedMaster);
    lfo.start(now);
    c1.start(now); c2.start(now);
    _emdr = { osc: c1, c2, panner, lfo, lfoDepth, bedMaster, extra: [] };
    return perfEpoch;
  }

  // Fallback (no StereoPanner): equal-power L/R via a merger, sin/cos gains.
  const merger = ctx.createChannelMerger(2);
  const gL = ctx.createGain(); const gR = ctx.createGain();
  const cosWave = ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]));
  const sinWave = ctx.createPeriodicWave(new Float32Array([0, 0]), new Float32Array([0, 1]));
  const lCos = ctx.createOscillator(); lCos.setPeriodicWave(cosWave); lCos.frequency.value = 1 / breathS;
  const rSin = ctx.createOscillator(); rSin.setPeriodicWave(sinWave); rSin.frequency.value = 1 / breathS;
  const lDepth = ctx.createGain(); lDepth.gain.value = -0.5;
  const rDepth = ctx.createGain(); rDepth.gain.value = 0.5;
  const biasL = ctx.createConstantSource(); biasL.offset.value = 0.5;
  const biasR = ctx.createConstantSource(); biasR.offset.value = 0.5;
  biasL.connect(gL.gain); lCos.connect(lDepth); lDepth.connect(gL.gain);
  biasR.connect(gR.gain); rSin.connect(rDepth); rDepth.connect(gR.gain);
  lp.connect(gL); lp.connect(gR);
  gL.connect(merger, 0, 0); gR.connect(merger, 0, 1);
  merger.connect(bedMaster);
  biasL.start(now); biasR.start(now); lCos.start(now); rSin.start(now);
  c1.start(now); c2.start(now);
  _emdr = { osc: c1, c2, panner: null, lfo: lCos, lfoDepth: rSin, bedMaster, extra: [biasL, biasR, rSin] };
  return perfEpoch;
}

export function stopEmdrBed() {
  const ctx = _ctx;
  if (!ctx || !_emdr) return;
  const n = _emdr; _emdr = null;
  const t = ctx.currentTime;
  try {
    n.bedMaster.gain.cancelScheduledValues(t);
    n.bedMaster.gain.setValueAtTime(n.bedMaster.gain.value, t);
    n.bedMaster.gain.linearRampToValueAtTime(0.0001, t + 0.4);
  } catch { /* ignore */ }
  const stopAt = t + 0.45;
  [n.osc, n.c2, n.lfo, ...(n.extra || [])].forEach((o) => {
    if (o) { try { o.stop(stopAt); } catch { /* ignore */ } }
  });
  setTimeout(() => { try { n.bedMaster.disconnect(); } catch { /* ignore */ } }, 600);
}

/**
 * Calm ambient bed: a very quiet, slowly-evolving 3-partial sine drone with a
 * ~30 s filter-drift LFO. Own gain → ctx.destination (independent of _out). Idempotent.
 */
export function startAmbient({ gain = 0.04, rootHz = 130.8 } = {}) {
  const ctx = getCtx();
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch { /* ignore */ } }
  stopAmbient();

  const now = ctx.currentTime + 0.02;
  const ambMaster = ctx.createGain();
  ambMaster.gain.setValueAtTime(0.0001, now);
  ambMaster.gain.linearRampToValueAtTime(gain, now + 2.0);
  ambMaster.connect(ctx.destination);

  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = 0.3;
  lp.connect(ambMaster);
  const mix = ctx.createGain(); mix.gain.value = 0.5; mix.connect(lp);

  const partials = [1, 1.5, 2.02];
  const oscs = partials.map((r, i) => {
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = rootHz * r;
    const g = ctx.createGain(); g.gain.value = i === 0 ? 1 : 0.4;
    o.connect(g); g.connect(mix); o.start(now); return o;
  });

  const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.033;
  const lpDepth = ctx.createGain(); lpDepth.gain.value = 220;
  lfo.connect(lpDepth); lpDepth.connect(lp.frequency); lfo.start(now);

  _ambient = { oscs, lfo, ambMaster };
}

export function stopAmbient() {
  const ctx = _ctx;
  if (!ctx || !_ambient) return;
  const n = _ambient; _ambient = null;
  const t = ctx.currentTime;
  try {
    n.ambMaster.gain.cancelScheduledValues(t);
    n.ambMaster.gain.setValueAtTime(n.ambMaster.gain.value, t);
    n.ambMaster.gain.linearRampToValueAtTime(0.0001, t + 0.6);
  } catch { /* ignore */ }
  const stopAt = t + 0.65;
  [...(n.oscs || []), n.lfo].forEach((o) => { if (o) { try { o.stop(stopAt); } catch { /* ignore */ } } });
  setTimeout(() => { try { n.ambMaster.disconnect(); } catch { /* ignore */ } }, 800);
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
  const base = ctx.currentTime + lead;

  // Chunked look-ahead scheduling: creating every oscillator up front chokes the
  // audio thread on long songs (150 chords ≈ thousands of nodes → silence), so
  // only the next ~SCHED_WINDOW seconds of strums exist at any moment.
  let idx = 0;
  const pump = () => {
    const horizon = ctx.currentTime + SCHED_WINDOW;
    while (idx < voicings.length) {
      const tChord = base + idx * chordDur;
      if (tChord > horizon) break;
      // Strum: 16 ms between each string (low → high)
      tabToNotes(voicings[idx].tab).forEach((note, ni) => {
        pluck(ctx, fretHz(note.string, note.fret), tChord + ni * 0.016, noteDur);
      });
      idx++;
    }
    if (idx < voicings.length) _timeouts.push(setTimeout(pump, SCHED_TICK_MS));
  };
  pump();

  if (onChord) {
    voicings.forEach((_, i) => {
      const ms = Math.max(0, (base + i * chordDur - ctx.currentTime) * 1000);
      _timeouts.push(setTimeout(() => onChord(i), ms));
    });
  }

  const totalMs = (lead + voicings.length * chordDur + 0.4) * 1000;
  musicHeard(totalMs);   // make the guide dance for the length of the progression
  if (onDone) {
    _timeouts.push(setTimeout(onDone, totalMs));
  }
}

// Look-ahead scheduling shared by all players: how far ahead audio nodes are
// created, and how often the scheduler tops the window up.
const SCHED_WINDOW = 12;      // seconds of audio built ahead
const SCHED_TICK_MS = 4000;   // top-up interval (well inside the window)

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
  playable.sort((a, b) => (a.time || 0) - (b.time || 0));
  const t0 = playable[0].time || 0;   // normalize so playback starts now
  const base = ctx.currentTime + lead;

  let endRel = 0;
  for (const e of playable) {
    const decay = Math.min(2.5, Math.max(0.25, e.duration || 0.4));
    endRel = Math.max(endRel, ((e.time || 0) - t0) + decay);
  }

  // Chunked look-ahead scheduling — see playProgression. A full song is
  // thousands of note events; building them all up front silences the engine.
  let idx = 0;
  const pump = () => {
    const horizon = ctx.currentTime + SCHED_WINDOW;
    while (idx < playable.length) {
      const e = playable[idx];
      const at = base + ((e.time || 0) - t0);
      if (at > horizon) break;
      // Ring for the note's own duration, with sane floor/ceiling so very short
      // detected notes are still audible and very long ones don't pile up.
      const decay = Math.min(2.5, Math.max(0.25, e.duration || 0.4));
      pluck(ctx, fretHz(e.string, e.fret), at, decay);
      idx++;
    }
    if (idx < playable.length) _timeouts.push(setTimeout(pump, SCHED_TICK_MS));
  };
  pump();

  musicHeard((lead + endRel) * 1000);   // dance while the clip plays
  if (onDone) {
    _timeouts.push(setTimeout(onDone, (lead + endRel + 0.2) * 1000));
  }
  return lead + endRel;
}

/**
 * Sound a song's solo/riff notes UNDER an already-started Play-Along run, so the
 * lead line plays through the speakers on the beat while chord windows are still
 * mic-scored. Mirrors playBacking's contract: schedule-only (never clears the
 * shared timeout list), routes through ctx._out so stopAudio() silences it.
 *
 * @param {Array<{string:number, fret:number, atSec:number, durSec?:number}>} notes
 *        `atSec` is seconds from NOW (this module's clock) until the note sounds.
 */
export function playSoloGuitar(notes) {
  if (!notes || !notes.length) return;
  const ctx = getCtx();
  const base = ctx.currentTime;
  const list = notes
    .filter(n => n && n.string >= 0 && n.string <= 5 && n.fret >= 0)
    .sort((a, b) => a.atSec - b.atSec);

  let idx = 0;
  const pump = () => {
    const horizon = ctx.currentTime + SCHED_WINDOW;
    while (idx < list.length) {
      const n = list[idx];
      const t = base + n.atSec;
      if (t > horizon) break;
      if (t >= ctx.currentTime - 0.01) {
        const decay = Math.min(1.6, Math.max(0.3, n.durSec || 0.6));
        pluck(ctx, fretHz(n.string, n.fret), t, decay);
      }
      idx++;
    }
    if (idx < list.length) _timeouts.push(setTimeout(pump, SCHED_TICK_MS));
  };
  pump();
}

// ─── Backing band (drums / bass) ─────────────────────────────────────────────
// Synthesized accompaniment scheduled ALONGSIDE an already-started guitar
// playback (playProgression / playEvents). Everything routes through ctx._out,
// so stopAudio() silences the band together with the guitar. playBacking never
// clears the shared timeout list — call it AFTER starting the guitar part.

const BACKING_NOTE_PC = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

let _noiseBuf = null;
function noiseBuffer(ctx) {
  if (!_noiseBuf || _noiseBuf.sampleRate !== ctx.sampleRate) {
    const len = ctx.sampleRate;   // 1s of white noise, reused by every hit
    _noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = _noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return _noiseBuf;
}

// Kick: a sine whose pitch drops fast (120 → 45 Hz) with a short thump envelope.
function drumKick(ctx, t) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.1);
  g.gain.setValueAtTime(0.85, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  osc.connect(g); g.connect(ctx._out);
  osc.start(t); osc.stop(t + 0.25);
}

// Snare: a noise burst through a band-pass plus a short 190 Hz body tone.
function drumSnare(ctx, t) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.28, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  src.connect(bp); bp.connect(g); g.connect(ctx._out);
  src.start(t); src.stop(t + 0.18);

  const osc = ctx.createOscillator();
  const og = ctx.createGain();
  osc.type = 'triangle'; osc.frequency.value = 190;
  og.gain.setValueAtTime(0.18, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(og); og.connect(ctx._out);
  osc.start(t); osc.stop(t + 0.1);
}

// Closed hi-hat: a tick of high-passed noise.
function drumHat(ctx, t) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.09, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.connect(hp); hp.connect(g); g.connect(ctx._out);
  src.start(t); src.stop(t + 0.06);
}

// Bass note: a plucked classical-guitar bass string (the same nylon
// Karplus–Strong voice as the melody, just in the low register), so the backing
// band's bass line sounds like a real guitar rather than a synth sine.
function bassNote(ctx, hz, t, dur) {
  pluck(ctx, hz, t, Math.max(0.4, dur));
}

/**
 * Schedule a drums/bass backing track under playback already started with
 * playProgression or playEvents (same 0.15 s lead, so the band lands on the
 * same grid). 4/4 feel: kick on 1 & 3, snare on 2 & 4, closed hats in eighths;
 * bass walks root (beat 1) and fifth (beat 3) of each chord.
 *
 * @param {Array<{name: string, beats?: number}>} chords  chord names in play order
 * @param {number} bpm
 * @param {{drums?: boolean, bass?: boolean}} parts
 */
export function playBacking(chords, bpm = 72, { drums = true, bass = true } = {}) {
  if (!drums && !bass) return;
  const ctx = getCtx();
  const lead = 0.15;
  const spb = 60 / bpm;
  const base = ctx.currentTime + lead;

  // Build the flat hit list first, then schedule it in look-ahead chunks —
  // a full song's worth of drum hits is thousands of nodes otherwise.
  const hits = [];   // { rel, kind, hz?, dur? }
  let beat = 0;
  for (const c of (chords || [])) {
    const beats = c.beats || 4;
    const m = (c.name || '').match(/^([A-G][#b]?)/);
    const rootPc = m ? BACKING_NOTE_PC[m[1]] : null;
    // Bass register around E2 (82 Hz) — low, but audible on small speakers.
    const rootHz = rootPc != null ? 82.41 * 2 ** (((rootPc - 4 + 12) % 12) / 12) : null;

    for (let b = 0; b < beats; b++) {
      const rel = (beat + b) * spb;
      if (drums) {
        hits.push({ rel, kind: b % 2 === 0 ? 'kick' : 'snare' });
        hits.push({ rel, kind: 'hat' });
        hits.push({ rel: rel + spb / 2, kind: 'hat' });
      }
      if (bass && rootHz != null) {
        if (b === 0) hits.push({ rel, kind: 'bass', hz: rootHz, dur: Math.min(spb * 1.8, 1.6) });
        else if (b === 2) hits.push({ rel, kind: 'bass', hz: rootHz * 2 ** (7 / 12), dur: Math.min(spb * 1.8, 1.6) });
      }
    }
    beat += beats;
  }
  hits.sort((a, b) => a.rel - b.rel);

  let idx = 0;
  const pump = () => {
    const horizon = ctx.currentTime + SCHED_WINDOW;
    while (idx < hits.length) {
      const h = hits[idx];
      const t = base + h.rel;
      if (t > horizon) break;
      if (h.kind === 'kick') drumKick(ctx, t);
      else if (h.kind === 'snare') drumSnare(ctx, t);
      else if (h.kind === 'hat') drumHat(ctx, t);
      else if (h.kind === 'bass') bassNote(ctx, h.hz, t, h.dur);
      idx++;
    }
    if (idx < hits.length) _timeouts.push(setTimeout(pump, SCHED_TICK_MS));
  };
  pump();
}

/**
 * Metronome ticks for the Play-Along count-in (and optional in-play beat).
 * Deliberately pitched at 2.5–3 kHz — ABOVE the chord detector's default
 * 1200 Hz scan ceiling — so the ticks can play through speakers without
 * polluting the mic's chord detection. Routed through ctx._out so stopAudio()
 * silences them like everything else.
 *
 * @param {number} count  how many ticks
 * @param {number} spb    seconds per beat
 * @param {{ accentFirst?: boolean, delaySec?: number }} opts
 * @returns {number} total duration in seconds until the last tick has sounded
 */
export function playTicks(count, spb, { accentFirst = true, delaySec = 0.05 } = {}) {
  const ctx = getCtx();
  try {
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
  } catch { /* ignore */ }
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch { /* ignore */ } }

  const base = ctx.currentTime + delaySec;
  for (let i = 0; i < count; i++) {
    const t = base + i * spb;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = accentFirst && i === 0 ? 3000 : 2500;
    g.gain.setValueAtTime(accentFirst && i === 0 ? 0.3 : 0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    osc.connect(g); g.connect(ctx._out);
    osc.start(t); osc.stop(t + 0.07);
  }
  return delaySec + count * spb;
}

/**
 * Continuous metronome for the full song. Scheduled in look-ahead chunks like
 * playBacking so we never create thousands of nodes upfront. Beat 1 of every
 * bar (every 4th beat) is accented. Pitched at 2.5–2.8 kHz — above the chord
 * detector's 1200 Hz ceiling — so it is safe through speakers.
 *
 * @param {number} totalBeats  total beats to tick (count-in NOT included)
 * @param {number} spb         seconds per beat
 * @param {{ startInSec?: number, accentPhase?: number }} opts
 *   startInSec = seconds from NOW until beat 0. A relative delay, not an
 *   absolute time — callers measure time on the mic's AudioContext, which is
 *   a different clock from this module's; absolute times don't transfer.
 *   accentPhase = which beat-in-bar (0–3) beat 0 falls on, so a mid-song
 *   start keeps the bar accent in the right place.
 * @returns {() => void} stop function — silences this metronome only,
 *   without touching other scheduled audio (drums etc.)
 */
export function playMetronome(totalBeats, spb, { startInSec = 0.05, accentPhase = 0 } = {}) {
  const ctx = getCtx();
  const base = ctx.currentTime + Math.max(0.02, startInSec);
  const bus = ctx.createGain();
  bus.connect(ctx._out);
  let beat = 0;
  let stopped = false;

  const pump = () => {
    if (stopped) return;
    const horizon = ctx.currentTime + SCHED_WINDOW;
    while (beat < totalBeats) {
      const t = base + beat * spb;
      if (t > horizon) break;
      if (t >= ctx.currentTime - 0.01) {
        const accent = (beat + accentPhase) % 4 === 0;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = accent ? 2800 : 2500;
        g.gain.setValueAtTime(accent ? 0.28 : 0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        osc.connect(g); g.connect(bus);
        osc.start(t); osc.stop(t + 0.06);
      }
      beat++;
    }
    if (beat < totalBeats) _timeouts.push(setTimeout(pump, SCHED_TICK_MS));
  };
  pump();
  return () => { stopped = true; try { bus.disconnect(); } catch { /* ignore */ } };
}

/**
 * A short, happy "you advanced!" fanfare — an ascending major arpeggio capped by
 * an octave sparkle, plucked-bell timbre. Played once when a practice/recording
 * take produces real progression (level-up, new star tier, unlock). Reuses the
 * shared AudioContext + master bus like every other cue, so it survives the iOS
 * gesture unlock. `big` adds a higher, brighter final flourish for a bigger win
 * (e.g. a new mastery crown vs. just a new personal best).
 *
 * @param {{ big?: boolean }} opts
 * @returns {number} approximate duration in seconds
 */
export function playFanfare({ big = false } = {}) {
  const ctx = getCtx();
  if (ctx.state === 'suspended') { try { ctx.resume(); } catch { /* ignore */ } }
  const base = ctx.currentTime + 0.04;

  // C major triad up two octaves, then a top sparkle. Bright, unambiguous "win".
  const notes = big
    ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]  // C5 E5 G5 C6 E6 G6
    : [523.25, 659.25, 783.99, 1046.5];                  // C5 E5 G5 C6
  const step = 0.09;

  notes.forEach((hz, i) => {
    const t = base + i * step;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';                 // soft, bell-ish — not a harsh saw
    osc.frequency.value = hz;
    const peak = 0.22 - i * 0.015;         // gently taper so it doesn't pile up
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.06, peak), t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    osc.connect(g); g.connect(ctx._out);
    osc.start(t); osc.stop(t + 0.5);
  });

  // A shimmering top note held under the arpeggio for a triumphant tail.
  const shimmerHz = big ? 2093.0 : 1567.98;               // C7 / G6
  const st = base + notes.length * step;
  const so = ctx.createOscillator();
  const sg = ctx.createGain();
  so.type = 'sine';
  so.frequency.value = shimmerHz;
  sg.gain.setValueAtTime(0.0001, st);
  sg.gain.exponentialRampToValueAtTime(0.12, st + 0.02);
  sg.gain.exponentialRampToValueAtTime(0.0001, st + 0.6);
  so.connect(sg); sg.connect(ctx._out);
  so.start(st); so.stop(st + 0.65);

  const dur = notes.length * step + 0.65;
  musicHeard(dur * 1000);   // dance along with the celebration fanfare
  return dur;
}

export function stopAudio() {
  // The EMDR/ambient beds live on ctx.destination (not _out), so the _out rebuild
  // below would NOT silence them — stop them explicitly first.
  stopEmdrBed();
  stopAmbient();
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
