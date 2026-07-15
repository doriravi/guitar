// useFretboardCam — the shared camera-side pipeline for fretboard chord vision.
//
// Extracted from FretboardChordCam.jsx so BOTH the standalone Chord Cam tab and
// the Verified Practice (camera×mic) view drive the exact same MediaPipe Hands
// pipeline — one implementation, no copy-paste. It owns:
//   - loading @mediapipe/hands from CDN (classic <script> → window.Hands)
//   - getUserMedia({video}) + the requestAnimationFrame send loop
//   - the 4-tap fretboard-corner calibration → homography
//   - per-frame landmarks → mapHandToPositions → detectChord (debounced)
//
// It exposes refs (videoRef/overlayRef) for the consumer to render, and the
// live `positions`/`chord`, plus a `latestLandmarks` ref so a consumer can draw
// its own overlay. State machine: idle → loading → calibrate → live → error.

import { useRef, useState, useEffect, useCallback } from 'react';
import { detectChord } from './chordAnalyzer';
import { computeHomography, mapHandToPositions } from './fretboardMap';

// One shared CDN loader (same version the hand-measure tool uses). Module-level
// promise so the script is fetched at most once across every consumer.
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js';
let scriptPromise = null;
export function loadMediaPipeScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.Hands) { resolve(); return; }
    const s = document.createElement('script');
    s.src = CDN;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load MediaPipe from CDN'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

const DEFAULT_SPAN_FRETS = 5;   // the tapped "end" corner sits on the 5th-fret wire
const DEFAULT_STABLE_FRAMES = 4; // consecutive agreeing frames before committing a chord

/**
 * @param {object} [opts]
 * @param {number} [opts.spanFrets]     frets covered by the calibration
 * @param {number} [opts.stableFrames]  debounce window for the detected chord
 * @param {(lm:Array|null, positions:Array)=>void} [opts.onFrame]
 *        called every processed frame with the raw landmarks + mapped positions
 *        (lets a consumer, e.g. Verified Practice, react without re-deriving).
 */
export function useFretboardCam(opts = {}) {
  const spanFrets = opts.spanFrets ?? DEFAULT_SPAN_FRETS;
  const stableFrames = opts.stableFrames ?? DEFAULT_STABLE_FRAMES;
  const onFrameRef = useRef(opts.onFrame);
  onFrameRef.current = opts.onFrame;

  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const handsRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const pendingStreamRef = useRef(null);
  const homographyRef = useRef(null);
  const latestLandmarks = useRef(null);
  const candidateRef = useRef({ name: null, count: 0 });

  const [phase, setPhase] = useState('idle'); // idle | loading | calibrate | live | error
  const [status, setStatus] = useState('');
  const [corners, setCorners] = useState([]);
  const [handVisible, setHandVisible] = useState(false);
  const [positions, setPositions] = useState([]);
  const [chord, setChord] = useState(null);
  const [cameras, setCameras] = useState([]);      // [{deviceId, label}]
  const [cameraId, setCameraId] = useState(null);  // currently-selected deviceId
  const cameraIdRef = useRef(null);
  cameraIdRef.current = cameraId;

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (handsRef.current) handsRef.current.close?.();
    rafRef.current = null;
    streamRef.current = null;
    handsRef.current = null;
  }, []);

  // Acquire a camera stream with graceful fallback. A phone has a rear camera
  // (ideal for filming the neck), but a laptop only has a front webcam — so we
  // PREFER the rear camera rather than DEMANDING it: if a specific device is
  // chosen use it; else ask for the rear camera as a soft hint; and if that
  // throws (no such camera), fall back to any available video input so the
  // feature still works for testing on a laptop.
  const acquireStream = useCallback(async (deviceId) => {
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const attempts = deviceId
      ? [{ ...base, deviceId: { exact: deviceId } }]
      : [{ ...base, facingMode: { ideal: 'environment' } }, base, true];
    let lastErr = null;
    for (const video of attempts) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video });
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('No camera available');
  }, []);

  // List available cameras (labels only populate after permission is granted).
  const refreshCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
      setCameras(cams);
      return cams;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  // Refs so the persistent onResults closure always reads current values.
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const spanRef = useRef(spanFrets);
  spanRef.current = spanFrets;

  const onResults = useCallback((results) => {
    const lm = results.multiHandLandmarks?.[0] ?? null;
    latestLandmarks.current = lm;
    setHandVisible(!!lm);

    if (phaseRef.current !== 'live' || !lm || !homographyRef.current) {
      onFrameRef.current?.(lm, []);
      return;
    }
    const pos = mapHandToPositions(homographyRef.current, lm, spanRef.current);
    setPositions(pos);
    const detected = detectChord(pos);

    const cand = candidateRef.current;
    if (detected === cand.name) cand.count += 1;
    else { cand.name = detected; cand.count = 1; }
    if (cand.count >= stableFrames) {
      setChord((prev) => (prev === detected ? prev : detected));
    }
    onFrameRef.current?.(lm, pos);
  }, [stableFrames]);

  useEffect(() => {
    if (handsRef.current) handsRef.current.onResults(onResults);
  }, [onResults]);

  const start = useCallback(async () => {
    setPhase('loading');
    setStatus('');
    try {
      await loadMediaPipeScript();
      const hands = new window.Hands({
        locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
      hands.onResults(onResults);
      handsRef.current = hands;

      const stream = await acquireStream(cameraIdRef.current);
      streamRef.current = stream;
      pendingStreamRef.current = stream;
      // Now that permission is granted, camera labels are readable — populate the
      // picker and remember which device we actually got.
      const cams = await refreshCameras();
      const activeId = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
      if (activeId && cams.some((c) => c.deviceId === activeId)) setCameraId(activeId);
      homographyRef.current = null;
      candidateRef.current = { name: null, count: 0 };
      setCorners([]);
      setChord(null);
      setPositions([]);
      setPhase('calibrate');
    } catch (err) {
      console.error(err);
      setStatus(err.message || 'Camera or model failed to load.');
      setPhase('error');
    }
  }, [onResults, acquireStream, refreshCameras]);

  // Switch to a different camera mid-session (e.g. laptop → external webcam).
  // Re-acquires the stream and re-enters calibration (the neck map is tied to
  // the old camera's framing, so corners must be re-tapped).
  const switchCamera = useCallback(async (deviceId) => {
    setCameraId(deviceId);
    if (phaseRef.current !== 'calibrate' && phaseRef.current !== 'live') return;
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      const stream = await acquireStream(deviceId);
      streamRef.current = stream;
      pendingStreamRef.current = stream;
      homographyRef.current = null;
      candidateRef.current = { name: null, count: 0 };
      setCorners([]);
      setChord(null);
      setPositions([]);
      setStatus('');
      setPhase('calibrate');
    } catch (err) {
      setStatus(err.message || 'Could not switch camera.');
    }
  }, [acquireStream]);

  // Attach the stream + start the rAF pump once the video element is mounted.
  useEffect(() => {
    if (phase !== 'calibrate' && phase !== 'live') return undefined;
    const video = videoRef.current;
    const stream = pendingStreamRef.current;
    if (!video || !stream) return undefined;
    pendingStreamRef.current = null;
    video.srcObject = stream;
    video.play().catch(console.error);
    const loop = async () => {
      if (handsRef.current && videoRef.current && videoRef.current.readyState >= 2) {
        await handsRef.current.send({ image: videoRef.current });
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [phase]);

  // Record a tapped corner (normalized to the tapped element's box). Once four
  // are placed, solve the homography and go live; a degenerate quad resets.
  const tapCorner = useCallback((e) => {
    if (phaseRef.current !== 'calibrate') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setCorners((prev) => {
      if (prev.length >= 4) return prev;
      const next = [...prev, { x, y }];
      if (next.length === 4) {
        const h = computeHomography(next);
        if (!h) {
          setStatus('Those corners are too close together — tap again.');
          return [];
        }
        homographyRef.current = h.H;
        setStatus('');
        setPhase('live');
      }
      return next;
    });
  }, []);

  const recalibrate = useCallback(() => {
    homographyRef.current = null;
    candidateRef.current = { name: null, count: 0 };
    setCorners([]);
    setChord(null);
    setPositions([]);
    setStatus('');
    setPhase('calibrate');
  }, []);

  const close = useCallback(() => {
    stop();
    setCorners([]);
    setChord(null);
    setPositions([]);
    setHandVisible(false);
    setStatus('');
    setPhase('idle');
  }, [stop]);

  return {
    // refs to render
    videoRef, overlayRef, latestLandmarks,
    // state
    phase, status, corners, handVisible, positions, chord, spanFrets,
    cameras, cameraId,
    // actions
    start, stop, close, tapCorner, recalibrate, switchCamera,
  };
}
