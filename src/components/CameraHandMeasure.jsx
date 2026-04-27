import { useRef, useState, useEffect, useCallback } from 'react';

const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const MCP = { index: 5, pinky: 17 };
const PALM_REF_CM = 8.5;

const RANGES = {
  thumbToIndex:  [8, 18],
  indexToMiddle: [4, 12],
  middleToRing:  [3, 10],
  ringToLittle:  [5, 14],
};

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function landmarksToMeasurements(lm) {
  const palmPx = dist(lm[MCP.index], lm[MCP.pinky]);
  if (palmPx < 1e-6) return null;
  const scale = PALM_REF_CM / palmPx;
  return {
    thumbToIndex:  dist(lm[TIP.thumb],  lm[TIP.index])  * scale,
    indexToMiddle: dist(lm[TIP.index],  lm[TIP.middle]) * scale,
    middleToRing:  dist(lm[TIP.middle], lm[TIP.ring])   * scale,
    ringToLittle:  dist(lm[TIP.ring],   lm[TIP.pinky])  * scale,
  };
}

function clampMeasurements(m) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(RANGES)) {
    out[k] = Math.min(hi, Math.max(lo, Math.round(m[k] * 10) / 10));
  }
  return out;
}

function drawHand(ctx, lm, W, H) {
  const CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17],
  ];
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = '#c9a96e';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7;
  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(lm[a].x * W, lm[a].y * H);
    ctx.lineTo(lm[b].x * W, lm[b].y * H);
    ctx.stroke();
  }
  const tipColors = ['#a78bfa','#38bdf8','#34d399','#c9a96e','#f87171'];
  [TIP.thumb, TIP.index, TIP.middle, TIP.ring, TIP.pinky].forEach((idx, i) => {
    ctx.globalAlpha = 1;
    ctx.fillStyle = tipColors[i];
    ctx.beginPath();
    ctx.arc(lm[idx].x * W, lm[idx].y * H, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

// Load MediaPipe from CDN as a classic script (avoids ESM bundling issues)
const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js';
let scriptPromise = null;
function loadMediaPipeScript() {
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

export default function CameraHandMeasure({ onMeasured }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const handsRef  = useRef(null);
  const rafRef    = useRef(null);
  const streamRef = useRef(null);
  const latestLm  = useRef(null);

  const [phase, setPhase]         = useState('idle');
  const [statusMsg, setStatus]    = useState('');
  const [countdown, setCountdown] = useState(null);
  const [captured, setCaptured]   = useState(null);
  const [handVisible, setHandVisible] = useState(false);
  const pendingStreamRef = useRef(null); // stream waiting for video element to mount

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    if (handsRef.current) handsRef.current.close?.();
    rafRef.current = null;
    streamRef.current = null;
    handsRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setPhase('loading');
    setStatus('Loading hand detection model…');
    try {
      await loadMediaPipeScript();

      // window.Hands is now available from CDN
      const hands = new window.Hands({
        locateFile: f =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${f}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5,
      });
      hands.onResults(results => {
        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) return;
        const W = canvas.width  = video.videoWidth  || 640;
        const H = canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, W, H);
        if (results.multiHandLandmarks?.length) {
          const lm = results.multiHandLandmarks[0];
          latestLm.current = lm;
          setHandVisible(true);
          drawHand(ctx, lm, W, H);
        } else {
          latestLm.current = null;
          setHandVisible(false);
        }
      });
      handsRef.current = hands;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      });
      streamRef.current = stream;
      pendingStreamRef.current = stream;

      // Transition to ready — video element mounts after this re-render.
      // The useEffect below attaches the stream once the element is available.
      setPhase('ready');
      setStatus('');

    } catch (err) {
      console.error(err);
      setPhase('error');
      setStatus(err.message || 'Camera or model failed to load.');
    }
  }, []);

  const capture = useCallback(() => {
    if (!latestLm.current) return;
    const raw = landmarksToMeasurements(latestLm.current);
    if (!raw) return;
    setCaptured(clampMeasurements(raw));
    setPhase('done');
    stop();
  }, [stop]);

  const startCountdown = useCallback(() => {
    if (!handVisible) return;
    setPhase('measuring');
    let n = 3;
    setCountdown(n);
    const id = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(id);
        setCountdown(null);
        capture();
      } else {
        setCountdown(n);
      }
    }, 1000);
  }, [handVisible, capture]);

  // Attach stream to video element once it mounts after phase → 'ready'
  useEffect(() => {
    if (phase !== 'ready') return;
    const video = videoRef.current;
    const stream = pendingStreamRef.current;
    if (!video || !stream) return;
    pendingStreamRef.current = null;
    video.srcObject = stream;
    video.play().catch(console.error);

    const loop = async () => {
      if (videoRef.current && handsRef.current && videoRef.current.readyState >= 2) {
        await handsRef.current.send({ image: videoRef.current });
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [phase]);

  useEffect(() => () => stop(), [stop]);

  const retry = () => {
    setCaptured(null);
    setPhase('idle');
    setHandVisible(false);
    latestLm.current = null;
  };

  const GAP_LABELS = [
    { key: 'thumbToIndex',  label: 'Thumb → Index',  color: '#a78bfa' },
    { key: 'indexToMiddle', label: 'Index → Middle', color: '#38bdf8' },
    { key: 'middleToRing',  label: 'Middle → Ring',  color: '#34d399' },
    { key: 'ringToLittle',  label: 'Ring → Pinky',   color: '#c9a96e' },
  ];

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#1a1a1a', border: '1px solid #222' }}>
      <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #222' }}>
        <div className="flex items-center gap-2">
          <span className="text-base">📷</span>
          <span className="text-sm font-semibold" style={{ color: '#f0ede8' }}>Camera Measurement</span>
        </div>
        {(phase === 'ready' || phase === 'measuring') && (
          <button
            onClick={() => { stop(); setPhase('idle'); setHandVisible(false); }}
            className="text-xs px-3 py-1 rounded-lg"
            style={{ color: '#5a5a5a', border: '1px solid #2a2a2a' }}
          >
            Cancel
          </button>
        )}
      </div>

      {phase === 'idle' && (
        <div className="p-5 text-center">
          <p className="text-sm mb-1" style={{ color: '#7a7a7a' }}>
            Hold your hand flat in front of the camera with fingers fully spread.
          </p>
          <p className="text-xs mb-4" style={{ color: '#4a4a4a' }}>
            MediaPipe detects your fingertips and computes gaps automatically.
            Scale is estimated using palm width as a reference (~8.5 cm).
          </p>
          <button
            onClick={startCamera}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold"
            style={{ background: '#c9a96e', color: '#0f0f0f' }}
          >
            Open Camera
          </button>
        </div>
      )}

      {phase === 'loading' && (
        <div className="p-5 flex items-center justify-center gap-3">
          <div className="w-4 h-4 rounded-full border-2 animate-spin"
            style={{ borderColor: '#c9a96e', borderTopColor: 'transparent' }} />
          <span className="text-sm" style={{ color: '#5a5a5a' }}>{statusMsg}</span>
        </div>
      )}

      {(phase === 'ready' || phase === 'measuring') && (
        <div>
          <div className="relative bg-black" style={{ aspectRatio: '16/9' }}>
            <video
              ref={videoRef}
              className="w-full h-full object-cover"
              style={{ transform: 'scaleX(-1)' }}
              playsInline muted
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ transform: 'scaleX(-1)' }}
            />
            <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(0,0,0,0.75)', color: handVisible ? '#4ade80' : '#f87171' }}>
              <div className="w-2 h-2 rounded-full" style={{ background: handVisible ? '#4ade80' : '#f87171' }} />
              {handVisible ? 'Hand detected' : 'No hand detected'}
            </div>
            {countdown !== null && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-8xl font-black"
                  style={{ color: '#c9a96e', textShadow: '0 0 40px rgba(201,169,110,0.9)' }}>
                  {countdown}
                </span>
              </div>
            )}
          </div>
          <div className="p-4 flex items-center justify-between gap-4">
            <p className="text-xs" style={{ color: '#5a5a5a' }}>
              Splay fingers as wide as possible, palm facing camera.
            </p>
            <button
              onClick={startCountdown}
              disabled={!handVisible || phase === 'measuring'}
              className="px-5 py-2 rounded-xl text-sm font-semibold shrink-0 transition-all"
              style={handVisible && phase !== 'measuring'
                ? { background: '#c9a96e', color: '#0f0f0f' }
                : { background: '#1e1e1e', color: '#3a3a3a', cursor: 'not-allowed' }}
            >
              {phase === 'measuring' ? 'Capturing…' : 'Measure (3s)'}
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && captured && (
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <span>✅</span>
            <span className="text-sm font-semibold" style={{ color: '#4ade80' }}>Measurement complete</span>
          </div>
          <div className="space-y-2 mb-4">
            {GAP_LABELS.map(({ key, label, color }) => (
              <div key={key} className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ background: '#141414' }}>
                <span className="text-xs font-medium" style={{ color: '#7a7a7a' }}>{label}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color }}>
                  {captured[key].toFixed(1)} cm
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs mb-4" style={{ color: '#3a3a3a' }}>
            Fine-tune values with the sliders below after applying.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onMeasured(captured)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: '#c9a96e', color: '#0f0f0f' }}
            >
              Apply Measurements
            </button>
            <button
              onClick={retry}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: '#1e1e1e', color: '#5a5a5a', border: '1px solid #2a2a2a' }}
            >
              Retake
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="p-5 text-center">
          <p className="text-sm mb-3" style={{ color: '#f87171' }}>⚠ {statusMsg}</p>
          <button
            onClick={retry}
            className="px-5 py-2 rounded-xl text-sm font-semibold"
            style={{ background: '#1e1e1e', color: '#5a5a5a', border: '1px solid #2a2a2a' }}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}
