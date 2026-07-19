// useSpeechAnswer — a thin wrapper over the browser's Web Speech API
// (SpeechRecognition) for the Music Memory "Say it" answer mode: the user speaks
// the answer in words ("C sharp", "G minor", "perfect fifth", "the third") and we
// hand every heard candidate phrase to memoryTrain's acceptSpoken() for grading.
//
// Short note names ("C", "E", "G") are the hardest thing for browser speech to
// get right — a single letter is often mis-heard ("C"→"see"/"sea"/"si") and the
// top guess is frequently wrong. So we (a) ask for SEVERAL alternatives per result
// and expose ALL of them as candidates (the grader accepts if ANY parses to the
// right answer), and (b) AUTO-RESTART recognition if the browser ends it early on
// silence, so the mic keeps listening for the whole answer window.
//
// Imperative (ref-based) like useMic, so the session hook's async answer-window
// loop can start()/stop() it and pull candidates each frame without re-subscribing.
// In "say" mode the browser owns the mic for recognition, so the YIN pitch path is
// never running at the same time.
//
// Graceful degradation: `supported` is false in Firefox and limited on iOS Safari;
// the UI hides the "Say it" option there and falls back to sing/play.

import { useRef } from 'react';

function getRecognitionCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/** Is browser speech recognition available at all? (Chrome/Edge/Android: yes.) */
export function isSpeechSupported() {
  return !!getRecognitionCtor();
}

/**
 * @returns a stable ref-object API:
 *   supported            — boolean
 *   start(lang?)         — begin listening (auto-restarts on early end)
 *   stop()               — stop listening for good
 *   getTranscript()      — the best running transcript (for the on-screen cue)
 *   getCandidates()      — ALL heard phrases (final + interim + alternatives),
 *                          deduped — the grader tries each
 *   reset()              — clear for a new item
 *   onError              — assignable (err) => void
 */
export function useSpeechAnswer() {
  const api = useRef(null);
  if (api.current) return api.current;

  const Ctor = getRecognitionCtor();
  const supported = !!Ctor;

  let rec = null;
  let lang = 'en-US';
  let running = false;      // are we in an active listen window?
  let bestText = '';        // best single transcript (highest-confidence final/interim)
  const candidates = new Set();  // every phrase we've heard, any alternative

  function addCandidate(txt) {
    const t = (txt || '').trim().toLowerCase();
    if (t) candidates.add(t);
  }

  function build() {
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;         // keep listening across pauses
    r.interimResults = true;     // stream partial words for a live cue
    r.maxAlternatives = 5;       // several guesses — a single letter is ambiguous
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        // Capture EVERY alternative (not just [0]) — "C" often ranks below "see".
        for (let a = 0; a < result.length; a++) {
          addCandidate(result[a] && result[a].transcript);
        }
        // Track the top guess as the display transcript.
        const top = (result[0] && result[0].transcript) || '';
        if (result.isFinal) bestText = `${bestText} ${top}`.trim();
        else if (top) bestText = top.trim();
      }
    };
    r.onerror = (e) => {
      const err = e && e.error;
      if (err && err !== 'no-speech' && err !== 'aborted' && api.current.onError) {
        api.current.onError(err);
      }
    };
    // Browsers end recognition after a short silence. While our window is still
    // open, immediately restart so the user can answer at any point.
    r.onend = () => {
      if (running) {
        try { rec = build(); rec.start(); } catch { /* ignore — window will end */ }
      }
    };
    return r;
  }

  const obj = {
    supported,
    onError: null,

    start(l = 'en-US') {
      if (!supported || running) return;
      lang = l;
      running = true;
      try { rec = build(); rec.start(); }
      catch (err) {
        running = false;
        if (obj.onError) obj.onError(err && err.message ? err.message : 'speech-failed');
      }
    },

    stop() {
      running = false;   // set first so onend doesn't restart
      if (rec) { try { rec.stop(); } catch { /* ignore */ } }
      rec = null;
    },

    getTranscript() { return bestText; },
    getCandidates() { return [...candidates]; },
    reset() { bestText = ''; candidates.clear(); },
  };

  api.current = obj;
  return obj;
}
