import { useEffect, useRef } from 'react';
import './LandingPage.css';

// The landing page is a self-contained animated explainer served as a static
// asset (client/public/explainer.html — canvas FX, embedded intro video, and
// its own scripted scenes). We render it full-screen in an iframe so the
// animation runs exactly as authored, and overlay the app's own controls:
//   • a "Get started" button + language picker (top-right)
//   • the explainer's in-frame "Open the app" CTA posts a message back to us,
//     which we route to onGetStarted (the in-app sign-in flow).
export default function LandingPage({ onGetStarted, langSlot }) {
  // The embedded explainer signals "open the app" via postMessage (see the
  // script appended to explainer.html). Route it to the in-app sign-in flow.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.data && e.data.type === 'fretfit:getStarted') onGetStarted?.();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onGetStarted]);

  // Decorative music elements that drift across the BACKGROUND (behind the
  // framed explainer) and through the margin around it. Realistic inline-SVG
  // guitars and notes, each randomized so no two runs look alike. The layer is
  // pointer-events:none so clicks still reach the explainer.
  const rand = (min, max) => min + Math.random() * (max - min);
  const GUITAR_COUNT = 7;
  const NOTE_COUNT = 14;

  return (
    <div className="lp-embed-root">
      {/* Ambient particle field — the very back layer, behind everything.
          420 particles on a single canvas. Non-interactive; never covers the
          framed content (it sits below it in the stack). */}
      <ParticleField count={420} />

      {/* Background music FX — behind the frame. Non-interactive. */}
      <div className="lp-fx" aria-hidden="true">
        {Array.from({ length: GUITAR_COUNT }, (_, i) => (
          <GuitarSVG
            key={`g-${i}`}
            className="lp-guitar"
            style={{
              top: `${rand(-5, 90)}%`,
              width: `${rand(90, 220)}px`,
              animationDelay: `${rand(0, 12)}s`,
              '--fly-dur': `${rand(12, 26)}s`,
              '--spin': `${rand(-50, 50)}deg`,
              '--drift': `${rand(-120, 120)}px`,
            }}
          />
        ))}
        {Array.from({ length: NOTE_COUNT }, (_, i) => (
          <NoteSVG
            key={`n-${i}`}
            variant={i % 3}
            className="lp-note-fx"
            style={{
              left: `${rand(0, 98)}%`,
              width: `${rand(28, 64)}px`,
              animationDuration: `${rand(9, 20)}s`,
              animationDelay: `${rand(0, 14)}s`,
              '--sway': `${rand(-90, 90)}px`,
            }}
          />
        ))}
      </div>

      <iframe
        src="/explainer.html"
        title="FretFit — the full story"
        className="lp-embed-frame"
        scrolling="no"
        allow="autoplay; fullscreen; encrypted-media"
      />

      {/* Overlay controls — sit above the iframe, top-right. */}
      <div className="lp-embed-controls">
        {langSlot}
        <button className="lp-embed-cta" onClick={onGetStarted}>Get started</button>
      </div>
    </div>
  );
}

// ── Ambient particle field ───────────────────────────────────────────────────
// A single <canvas> drawing `count` slowly-drifting dots. One element instead of
// hundreds of DOM nodes keeps 420 particles cheap. It's the backmost layer
// (z-index below the frame) and pointer-events:none, so it never covers or
// blocks the visual content. Honors prefers-reduced-motion (renders one static
// frame, no animation loop).
function ParticleField({ count = 420 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    // Double-helix layout: two strands of `count/2` particles each, spread along
    // the band's width. Each strand is a sine wave (offset by π from the other);
    // the whole helix rotates over time so it reads as 3D — a particle's depth
    // (front/back) comes from cos(phase), driving its size and brightness.
    const perStrand = Math.floor(count / 2);
    const total = perStrand * 2;
    const parts = Array.from({ length: total }, (_, i) => {
      const strand = i % 2;                 // 0 or 1
      const idx = Math.floor(i / 2);        // position along the strand
      const u = idx / (perStrand - 1);      // 0..1 along the width
      return {
        u,
        phase0: strand * Math.PI,           // second strand offset by π
        gold: (idx + strand) % 5 !== 0,     // mostly gold, occasional purple
      };
    });

    // Pre-rendered glow sprites (one per hue), reused via drawImage for every
    // particle. ctx.shadowBlur is a real per-shape Gaussian blur recomputed on
    // every fill() call — doing that 420x/frame (60fps) measured as the single
    // biggest CPU cost on this page (near-continuous high CPU on the landing
    // page). Baking the blur once into an offscreen canvas and compositing it
    // with drawImage keeps the same soft-glow look at a fraction of the cost.
    const GLOW_SIZE = 24; // px, at 1x — big enough to hold the blur falloff
    function makeGlowSprite(hue) {
      const c = document.createElement('canvas');
      c.width = c.height = GLOW_SIZE;
      const g = c.getContext('2d');
      const r = GLOW_SIZE / 2;
      const grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, `rgba(${hue}, 0.9)`);
      grad.addColorStop(0.4, `rgba(${hue}, 0.35)`);
      grad.addColorStop(1, `rgba(${hue}, 0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, GLOW_SIZE, GLOW_SIZE);
      return c;
    }
    const glowSprites = {
      gold: makeGlowSprite('201,169,110'),
      purple: makeGlowSprite('167,139,250'),
    };

    let t = 0;
    // Helix geometry, recomputed from current size each frame.
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const midY = h * 0.5;
      const amp = h * 0.32;                 // vertical radius of the helix
      const turns = 3.2;                    // how many twists across the band
      const spin = t * 0.02;                // rotation speed
      // Draw back-to-front by sorting on depth so nearer dots overlap farther ones.
      const pts = parts.map(p => {
        const angle = p.u * Math.PI * 2 * turns + p.phase0 + spin;
        const depth = Math.cos(angle);      // -1 (back) .. 1 (front)
        return {
          x: 8 + p.u * (w - 16),
          y: midY + Math.sin(angle) * amp,
          depth,
          gold: p.gold,
        };
      }).sort((a, b) => a.depth - b.depth);

      for (const pt of pts) {
        const front = (pt.depth + 1) / 2;             // 0..1
        const r = 0.6 + front * 1.6;                  // smaller in back, bigger in front
        const alpha = 0.25 + front * 0.75;            // dimmer in back, brighter in front
        const sprite = pt.gold ? glowSprites.gold : glowSprites.purple;
        const size = GLOW_SIZE * (r / 1.2);           // scale sprite with particle size
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, pt.x - size / 2, pt.y - size / 2, size, size);
      }
      ctx.globalAlpha = 1;
    };
    const step = () => {
      t += 1;
      draw();
      raf = requestAnimationFrame(step);
    };

    if (reduce) {
      draw(); // one static frame
    } else {
      raf = requestAnimationFrame(step);
    }
    window.addEventListener('resize', resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); };
  }, [count]);

  return <canvas ref={canvasRef} className="lp-particles" aria-hidden="true" />;
}

// ── Decorative SVGs ──────────────────────────────────────────────────────────

// A stylized-but-realistic acoustic guitar: figure-8 body, rosette sound hole,
// neck with frets, headstock with tuners, and six strings.
function GuitarSVG({ className, style }) {
  return (
    <svg className={className} style={style} viewBox="0 0 220 90" fill="none"
      xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
      {/* Body */}
      <path
        d="M64 45 C64 20 84 12 104 16 C120 19 126 30 126 45 C126 60 120 71 104 74 C84 78 64 70 64 45 Z"
        fill="#3a2416" stroke="#8a6a3a" strokeWidth="2" />
      <path
        d="M72 45 C72 27 88 21 103 24 C116 27 120 35 120 45 C120 55 116 63 103 66 C88 69 72 63 72 45 Z"
        fill="#5a3c22" opacity="0.55" />
      {/* Rosette + sound hole */}
      <circle cx="99" cy="45" r="11" fill="#1a0f08" stroke="#c9a96e" strokeWidth="1.5" />
      <circle cx="99" cy="45" r="7" fill="#120a04" />
      {/* Bridge */}
      <rect x="112" y="41" width="10" height="8" rx="2" fill="#1a0f08" />
      {/* Neck */}
      <rect x="18" y="41" width="52" height="8" rx="2" fill="#2a1a10" stroke="#8a6a3a" strokeWidth="1.5" />
      {/* Frets */}
      {[26, 34, 42, 50, 58, 66].map((x) => (
        <line key={x} x1={x} y1="41" x2={x} y2="49" stroke="#c9a96e" strokeWidth="1" opacity="0.7" />
      ))}
      {/* Headstock */}
      <path d="M18 39 L6 36 C2 36 2 54 6 54 L18 51 Z" fill="#2a1a10" stroke="#8a6a3a" strokeWidth="1.5" />
      {/* Tuning pegs */}
      {[39, 45, 51].map((y) => (
        <circle key={`l${y}`} cx="9" cy={y} r="1.6" fill="#d8c090" />
      ))}
      {/* Strings (neck → bridge) */}
      {[43, 44.2, 45.4, 46.6].map((y, i) => (
        <line key={i} x1="9" y1={y} x2="120" y2={45} stroke="#e8dcc0" strokeWidth="0.5" opacity="0.6" />
      ))}
    </svg>
  );
}

// Musical notes: eighth note, beamed eighth-pair, and quarter note.
function NoteSVG({ variant = 0, className, style }) {
  const c = '#c9a96e';
  if (variant === 1) {
    // Beamed pair
    return (
      <svg className={className} style={style} viewBox="0 0 40 48" role="img" aria-hidden="true">
        <rect x="12" y="6" width="3" height="30" fill={c} />
        <rect x="31" y="4" width="3" height="30" fill={c} />
        <rect x="12" y="4" width="22" height="5" rx="1.5" fill={c} />
        <ellipse cx="9" cy="37" rx="7" ry="5" fill={c} transform="rotate(-20 9 37)" />
        <ellipse cx="28" cy="35" rx="7" ry="5" fill={c} transform="rotate(-20 28 35)" />
      </svg>
    );
  }
  if (variant === 2) {
    // Quarter note
    return (
      <svg className={className} style={style} viewBox="0 0 28 48" role="img" aria-hidden="true">
        <rect x="16" y="6" width="3" height="30" fill={c} />
        <ellipse cx="11" cy="37" rx="8" ry="5.5" fill={c} transform="rotate(-20 11 37)" />
      </svg>
    );
  }
  // Eighth note with flag
  return (
    <svg className={className} style={style} viewBox="0 0 32 48" role="img" aria-hidden="true">
      <rect x="16" y="6" width="3" height="30" fill={c} />
      <path d="M19 6 q10 4 6 16 q6 -10 -6 -16 Z" fill={c} />
      <ellipse cx="11" cy="37" rx="8" ry="5.5" fill={c} transform="rotate(-20 11 37)" />
    </svg>
  );
}
