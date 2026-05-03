// Pitch detection utilities for real-time guitar analysis.

const OPEN_HZ = [82.41, 110.0, 146.83, 196.0, 246.94, 329.63];
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// Convert frequency to MIDI note number (float)
export function hzToMidi(hz) {
  return 69 + 12 * Math.log2(hz / 440);
}

// Convert frequency to { name, octave, midi, cents }
export function hzToNote(hz) {
  if (hz <= 0) return null;
  const midi = hzToMidi(hz);
  const midiRound = Math.round(midi);
  const cents = Math.round((midi - midiRound) * 100);
  const name = NOTE_NAMES[((midiRound % 12) + 12) % 12];
  const octave = Math.floor(midiRound / 12) - 1;
  return { name, octave, midi: midiRound, cents, hz };
}

// Expected frequency for a guitar string + fret
export function fretHz(string, fret) {
  return OPEN_HZ[string] * 2 ** (fret / 12);
}

// Expected MIDI note for a guitar string + fret
export function fretMidi(string, fret) {
  return Math.round(hzToMidi(fretHz(string, fret)));
}

/**
 * YIN autocorrelation pitch detector.
 * Returns the dominant fundamental frequency (Hz) or null if none found.
 * Works best on monophonic signals (single string).
 */
export function detectPitchYIN(buffer, sampleRate) {
  const bufLen = buffer.length;
  const minFreq = 60;   // Hz — below low E2
  const maxFreq = 1400; // Hz — above high e4 harmonics
  const tauMin = Math.floor(sampleRate / maxFreq);
  const tauMax = Math.min(bufLen >> 1, Math.ceil(sampleRate / minFreq));

  // Difference function
  const diff = new Float32Array(tauMax);
  for (let tau = 1; tau < tauMax; tau++) {
    for (let i = 0; i < tauMax; i++) {
      const d = buffer[i] - buffer[i + tau];
      diff[tau] += d * d;
    }
  }

  // Cumulative mean normalized difference
  const cmnd = new Float32Array(tauMax);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau < tauMax; tau++) {
    runningSum += diff[tau];
    cmnd[tau] = runningSum === 0 ? 0 : diff[tau] * tau / runningSum;
  }

  // Find first dip below threshold
  const threshold = 0.15;
  let tau = tauMin;
  while (tau < tauMax) {
    if (cmnd[tau] < threshold) {
      // parabolic interpolation
      const prev = tau > 1 ? cmnd[tau - 1] : cmnd[tau];
      const next = tau < tauMax - 1 ? cmnd[tau + 1] : cmnd[tau];
      const shift = (next - prev) / (2 * (2 * cmnd[tau] - prev - next)) || 0;
      return sampleRate / (tau + shift);
    }
    tau++;
  }
  return null;
}

/**
 * FFT-based multi-peak detector.
 * Returns an array of { hz, amplitude } for the N strongest peaks,
 * filtered to the guitar range (60–1400 Hz).
 * Uses AnalyserNode's float frequency data.
 */
export function detectPeaksFFT(freqData, sampleRate, fftSize, maxPeaks = 6) {
  const binHz = sampleRate / fftSize;
  const minBin = Math.floor(60 / binHz);
  const maxBin = Math.ceil(1400 / binHz);

  const peaks = [];
  for (let i = minBin + 1; i < maxBin - 1; i++) {
    const v = freqData[i];
    if (v > freqData[i - 1] && v > freqData[i + 1] && v > -60) {
      // parabolic interpolation for sub-bin accuracy
      const shift = (freqData[i + 1] - freqData[i - 1]) /
        (2 * (2 * freqData[i] - freqData[i - 1] - freqData[i + 1])) || 0;
      peaks.push({ hz: (i + shift) * binHz, amplitude: v });
    }
  }

  peaks.sort((a, b) => b.amplitude - a.amplitude);
  return peaks.slice(0, maxPeaks);
}

/**
 * Given a set of detected frequencies, find the best matching chord from CHORDS.
 * Returns { chord, matchScore, stringMatches } where stringMatches is an array
 * of { string, fret, expectedHz, detectedHz, status: 'correct'|'wrong'|'missing' }.
 */
export function matchChord(detectedHzList, chords) {
  if (!detectedHzList.length) return null;

  // Convert detected Hz → pitch classes (0-11)
  const detectedPCs = new Set(
    detectedHzList.map(hz => ((Math.round(hzToMidi(hz)) % 12) + 12) % 12)
  );

  let best = null;
  let bestScore = -1;

  for (const chord of chords) {
    // Expected pitch classes from chord tab (all strings incl. open)
    const tab = chord.tab;
    const expectedPCs = new Set();
    for (let s = 0; s < 6; s++) {
      const ch = tab[s];
      if (ch !== 'x') {
        const fret = parseInt(ch);
        const midi = Math.round(hzToMidi(fretHz(s, fret)));
        expectedPCs.add(((midi % 12) + 12) % 12);
      }
    }

    // Score = intersection / union (Jaccard)
    let inter = 0;
    for (const pc of detectedPCs) if (expectedPCs.has(pc)) inter++;
    const union = detectedPCs.size + expectedPCs.size - inter;
    const score = union > 0 ? inter / union : 0;

    if (score > bestScore) {
      bestScore = score;
      best = chord;
    }
  }

  return best ? { chord: best, score: bestScore } : null;
}

/**
 * Given detected frequencies and a target chord, evaluate each string.
 * Returns array of per-string status objects.
 */
export function evaluateStrings(detectedHzList, targetChord) {
  const tab = targetChord.tab;
  const TOLERANCE_CENTS = 60; // ±60 cents = ±half a semitone

  // Build per-string expected info
  const strings = [];
  for (let s = 0; s < 6; s++) {
    const ch = tab[s];
    if (ch === 'x') {
      strings.push({ string: s, expected: 'muted', status: 'muted' });
    } else {
      const fret = parseInt(ch);
      const expectedHz = fretHz(s, fret);
      const expectedMidi = hzToMidi(expectedHz);

      // Find closest detected pitch to this expected frequency
      let closestHz = null;
      let closestCentsDiff = Infinity;
      for (const hz of detectedHzList) {
        const diff = Math.abs(hzToMidi(hz) - expectedMidi) * 100;
        if (diff < closestCentsDiff) {
          closestCentsDiff = diff;
          closestHz = hz;
        }
      }

      const status = closestHz === null
        ? 'missing'
        : closestCentsDiff <= TOLERANCE_CENTS
          ? 'correct'
          : 'wrong';

      strings.push({
        string: s,
        fret,
        expected: 'play',
        expectedHz,
        detectedHz: closestHz,
        centsDiff: Math.round(closestCentsDiff),
        status,
      });
    }
  }
  return strings;
}

// String names for display
export const STRING_LABELS = ['E₂', 'A₂', 'D₃', 'G₃', 'B₃', 'e₄'];
