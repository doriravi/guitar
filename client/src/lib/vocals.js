// Human-voice "singing" for the Song Editor.
//
// Uses the browser Web Speech API (SpeechSynthesis) — no network, no keys — to
// speak the lyrics in time with the song so it sounds like a rough sung guide
// track over the guitar/backing. It's TTS, not a true vocal synth, but pitching
// each line and pacing it to the beat reads as "singing along".
//
// Centralized here so the whole app has ONE place that talks to the voice engine
// (the same pattern GuideAvatar.speak follows) — a premium singing provider can
// later be swapped in behind listVoices()/singLines() without touching callers.

// Cancel anything currently being spoken/sung.
export function stopSinging() {
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}

/**
 * Speak a single short line of narration (not sung) — used by the Music Memory
 * tab to read prompts and feedback aloud. Cancels any prior speech first so
 * narration never overlaps. Returns a cancel fn.
 *
 * @param {string} text
 * @param {object} [opts] { voiceId?, rate?, pitch?, volume?, onEnd? }
 * @returns {() => void}
 */
export function say(text, { voiceId, rate = 1, pitch = 1, volume = 1, onEnd } = {}) {
  if (!vocalsSupported() || !text) { onEnd?.(); return () => {}; }
  stopSinging();
  try {
    const u = new SpeechSynthesisUtterance(String(text));
    const chosen = resolveVoice(voiceId);
    if (chosen?._voice) u.voice = chosen._voice;
    u.rate = Math.min(1.6, Math.max(0.6, rate));
    u.pitch = Math.min(2, Math.max(0.5, pitch));
    u.volume = Math.min(1, Math.max(0, volume));
    if (onEnd) u.onend = onEnd;
    window.speechSynthesis.speak(u);
  } catch { onEnd?.(); }
  return () => stopSinging();
}

/**
 * Speak the count-in's "go!" — the shared voice cue every countdown fires when it
 * finishes (see the count-in tick+go rule). Snappy and upbeat. Degrades silently
 * where speech isn't supported (the audible tick still marks the moment).
 * @returns {() => void} cancel fn
 */
export function sayGo() {
  return say('Go!', { rate: 1.3, pitch: 1.1 });
}

// Is browser speech available at all?
export function vocalsSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// The list of installed voices the user can choose from. The voices list loads
// async in some browsers, so callers should also listen for `voiceschanged`
// (see onVoicesReady). Each entry: { id, name, lang, gender } where gender is a
// best-effort guess from the voice name (used only for the default pitch).
export function listVoices() {
  if (!vocalsSupported()) return [];
  const voices = window.speechSynthesis.getVoices() || [];
  return voices.map((v, i) => ({
    id: v.voiceURI || `${v.name}-${i}`,
    name: v.name,
    lang: v.lang,
    gender: guessGender(v.name),
    _voice: v,
  }));
}

// Subscribe to the voices list becoming available/changing. Returns an
// unsubscribe fn. Fires once immediately if voices are already loaded.
export function onVoicesReady(cb) {
  if (!vocalsSupported()) return () => {};
  const handler = () => cb(listVoices());
  window.speechSynthesis.addEventListener('voiceschanged', handler);
  const now = listVoices();
  if (now.length) cb(now);
  return () => window.speechSynthesis.removeEventListener('voiceschanged', handler);
}

function guessGender(name) {
  const n = (name || '').toLowerCase();
  if (/(female|woman|zira|samantha|victoria|karen|tessa|fiona|moira|serena|susan)/.test(n)) return 'female';
  if (/(male|man|david|daniel|alex|fred|thomas|oliver|arthur|george)/.test(n)) return 'male';
  return 'neutral';
}

// Base pitch for a voice's guessed gender, so a "female voice" sings brighter and
// a "male voice" lower even before the per-line melody offset is applied.
function basePitch(gender) {
  return gender === 'female' ? 1.15 : gender === 'male' ? 0.85 : 1.0;
}

// Resolve a chosen voice id (or gender fallback) to an actual SpeechSynthesisVoice.
function resolveVoice(voiceId) {
  const all = listVoices();
  const hit = all.find(v => v.id === voiceId);
  return hit || null;
}

/**
 * "Sing" a sequence of timed lyric lines.
 *
 * @param {Array<{text:string, at:number, dur:number, melody?:number}>} lines
 *   text  — the words to sing for this line
 *   at    — seconds from now to start the line
 *   dur   — how long (seconds) the line should take (paces the speaking rate)
 *   melody— optional -1..+1 pitch nudge so the tune rises/falls per line
 * @param {object} opts
 *   voiceId — chosen voice id from listVoices() (falls back to gender default)
 *   pitch   — extra global pitch multiplier (0.5..2), default 1
 *   volume  — 0..1, default 1
 * @returns {() => void} a cancel function.
 */
export function singLines(lines, { voiceId, pitch = 1, volume = 1 } = {}) {
  if (!vocalsSupported() || !lines?.length) return () => {};
  stopSinging();

  const chosen = resolveVoice(voiceId);
  const base = basePitch(chosen?.gender || 'neutral');
  const timers = [];

  for (const line of lines) {
    const text = (line.text || '').trim();
    if (!text) continue;
    const startMs = Math.max(0, (line.at || 0) * 1000);
    timers.push(setTimeout(() => {
      const u = new SpeechSynthesisUtterance(text);
      if (chosen?._voice) u.voice = chosen._voice;
      // Pace the words to fill the line's duration: rough syllable estimate vs.
      // the beats available. Clamp so it stays intelligible.
      const words = text.split(/\s+/).length;
      const wantWordsPerSec = words / Math.max(0.6, line.dur || 2);
      // ~2.2 words/sec is natural speech at rate 1.0.
      u.rate = Math.min(1.6, Math.max(0.6, wantWordsPerSec / 2.2));
      // Melody: lift/lower the pitch a little per line so it lilts like a tune.
      const melody = 1 + 0.18 * (line.melody || 0);
      u.pitch = Math.min(2, Math.max(0.5, base * pitch * melody));
      u.volume = Math.min(1, Math.max(0, volume));
      try { window.speechSynthesis.speak(u); } catch { /* ignore */ }
    }, startMs));
  }

  return () => {
    timers.forEach(clearTimeout);
    stopSinging();
  };
}
