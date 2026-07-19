// useSpeechAnswer — a thin wrapper over the browser's Web Speech API
// (SpeechRecognition) for the Music Memory "Say it" answer mode: the user speaks
// the answer in words ("C sharp", "G minor", "perfect fifth", "the third") and we
// hand the running transcript to memoryTrain's acceptSpoken() for grading.
//
// Imperative (ref-based) like useMic, so the session hook's async answer-window
// loop can start()/stop() it and pull the latest transcript each frame without
// re-subscribing. It does NOT run the mic's YIN pitch pipeline — in "say" mode the
// browser owns the mic for recognition, so the two never run at once.
//
// Graceful degradation: `isSpeechSupported()` is false in Firefox and limited on
// iOS Safari; the UI hides the "Say it" option there and falls back to sing/play.

import { useRef, useCallback } from 'react';

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
 *   start(lang?)         — begin listening; resolves nothing (fire-and-forget)
 *   stop()               — stop listening
 *   getTranscript()      — the accumulated transcript so far (lowercased, trimmed)
 *   getInterim()         — the latest interim (not-yet-final) phrase, for a live cue
 *   reset()              — clear the transcript for a new item
 *   onError              — assignable callback (err) => void
 */
export function useSpeechAnswer() {
  const api = useRef(null);
  if (api.current) return api.current;

  const Ctor = getRecognitionCtor();
  const supported = !!Ctor;

  let rec = null;
  let finalText = '';
  let interimText = '';
  let running = false;

  const obj = {
    supported,
    onError: null,

    start(lang = 'en-US') {
      if (!supported || running) return;
      try {
        rec = new Ctor();
        rec.lang = lang;
        rec.continuous = true;         // keep listening across pauses
        rec.interimResults = true;     // stream interim words for a live cue
        rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            const txt = (r[0] && r[0].transcript) || '';
            if (r.isFinal) finalText = `${finalText} ${txt}`.trim();
            else interim += ` ${txt}`;
          }
          interimText = interim.trim();
        };
        rec.onerror = (e) => {
          // 'no-speech'/'aborted' are normal window ends — don't surface them.
          if (e && e.error && e.error !== 'no-speech' && e.error !== 'aborted' && obj.onError) {
            obj.onError(e.error);
          }
        };
        rec.onend = () => { running = false; };
        rec.start();
        running = true;
      } catch (err) {
        running = false;
        if (obj.onError) obj.onError(err && err.message ? err.message : 'speech-failed');
      }
    },

    stop() {
      running = false;
      if (rec) { try { rec.stop(); } catch { /* ignore */ } }
      rec = null;
    },

    getTranscript() { return `${finalText} ${interimText}`.trim(); },
    getInterim() { return interimText; },
    reset() { finalText = ''; interimText = ''; },
  };

  api.current = obj;
  return obj;
}
