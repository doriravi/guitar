// useHandTrack — camera + MediaPipe Hands, and nothing else.
//
// This replaced the old useFretboardCam, which was built around finding a
// PHYSICAL neck (a 'calibrate' phase running edge/orientation detection, a
// homography, 4-corner fine-tuning). That detection was removed from the app: it
// could not find a real neck reliably — clutter won the dominant axis, lighting
// moved the band, and the board drifted while playing. The virtual fretboard
// draws its own board instead, so there is nothing to detect and nothing to
// calibrate.
//
// This hook is therefore the minimum: open a camera, run MediaPipe Hands, hand
// back the raw landmarks. State machine: idle → loading → live | error.

import { useRef, useState, useEffect, useCallback } from 'react';

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

export function useHandTrack(opts = {}) {
  const videoRef = useRef(null);
  const overlayRef = useRef(null);
  const handsRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const pendingStreamRef = useRef(null);
  const latestLandmarks = useRef(null);
  const onFrameRef = useRef(opts.onFrame);
  onFrameRef.current = opts.onFrame;

  const [phase, setPhase] = useState('idle'); // idle | loading | live | error
  const [status, setStatus] = useState('');
  const [handVisible, setHandVisible] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState(null);
  const [primed, setPrimed] = useState(false);
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
  useEffect(() => () => stop(), [stop]);

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

  // Browsers hide camera labels until access has been granted at least once, so
  // we open a stream briefly (and release it) purely to unlock the real names.
  const prime = useCallback(async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      s.getTracks().forEach((t) => t.stop());
    } catch { /* denied / none: still enumerate, labels stay blank */ }
    const cams = await refreshCameras();
    if (!cameraIdRef.current && cams[0]) setCameraId(cams[0].deviceId);
    setPrimed(true);
    return cams;
  }, [refreshCameras]);

  const acquireStream = useCallback(async (deviceId) => {
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    const attempts = deviceId
      ? [{ ...base, deviceId: { exact: deviceId } }, base, true]
      : [base, true];
    let lastErr = null;
    for (const video of attempts) {
      try { return await navigator.mediaDevices.getUserMedia({ video }); }
      catch (err) { lastErr = err; }
    }
    throw lastErr || new Error('No camera available');
  }, []);

  const cameraErrorMessage = useCallback((err) => {
    const name = err?.name || '';
    if (name === 'NotReadableError' || name === 'AbortError' || /video source/i.test(err?.message || '')) {
      return 'Camera is in use by another app. Close Zoom, Teams, or the Camera app, then try again.';
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Camera permission was blocked. Allow camera access for this site, then try again.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'No usable camera found.';
    }
    return err?.message || 'Camera failed to start.';
  }, []);

  const onResults = useCallback((results) => {
    const lm = results.multiHandLandmarks?.[0] ?? null;
    latestLandmarks.current = lm;
    setHandVisible(!!lm);
    onFrameRef.current?.(lm);
  }, []);

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
      const cams = await refreshCameras();
      const activeId = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
      if (activeId && cams.some((c) => c.deviceId === activeId)) setCameraId(activeId);
      setPhase('live'); // no calibration step — the board is virtual
    } catch (err) {
      console.error(err);
      setStatus(cameraErrorMessage(err));
      setPhase('error');
    }
  }, [onResults, acquireStream, refreshCameras, cameraErrorMessage]);

  const switchCamera = useCallback(async (deviceId) => {
    setCameraId(deviceId);
    if (phase !== 'live') return;
    try {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      const stream = await acquireStream(deviceId);
      streamRef.current = stream;
      pendingStreamRef.current = stream;
      setStatus('');
    } catch (err) {
      setStatus(cameraErrorMessage(err));
      setPhase('error');
    }
  }, [acquireStream, cameraErrorMessage, phase]);

  // Attach the stream + drive the detection pump once the video is mounted.
  useEffect(() => {
    if (phase !== 'live') return undefined;
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

  const close = useCallback(() => {
    stop();
    latestLandmarks.current = null;
    setHandVisible(false);
    setStatus('');
    setPhase('idle');
  }, [stop]);

  return {
    videoRef, overlayRef, latestLandmarks,
    phase, status, handVisible, cameras, cameraId, primed,
    start, stop, close, switchCamera, prime,
  };
}
