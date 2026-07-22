// One-shot spark burst — a tiny, self-contained Canvas-2D particle pop anchored
// to a screen rect. Used to reward a correctly-played chord in "Play with me"
// (the confirmation moment) without pulling in the full Celebration component.
//
// Deliberately imperative + framework-free: it portals its own <canvas> to
// document.body (escaping any transformed/overflow-clipped ancestor, same reason
// ChordTip portals), runs its own rAF, and removes itself when the pieces fade —
// no React state, no per-frame reconciliation. Skips entirely under reduced
// motion (the caller passes that in) so it never adds vestibular motion.
//
// Colors default to the app's per-string palette so a burst reads as "your
// strings rang out". Math.random is fine here — this is view-only chrome that
// never needs to be deterministic/resumable.

const STRING_COLORS = ['#a78bfa', '#38bdf8', '#34d399', '#e9c46a', '#fb923c', '#f87171'];

/**
 * @param {DOMRect|{left,top,width,height}} rect  anchor (viewport coords) — the burst
 *        originates at its center. Pass an element's getBoundingClientRect().
 * @param {object} [opts]
 *   colors  — array of CSS colors to tint pieces (defaults to the string palette)
 *   count   — number of sparks (default 22)
 */
export function sparkBurst(rect, opts = {}) {
  if (typeof document === 'undefined' || !rect) return;
  const colors = (opts.colors && opts.colors.length) ? opts.colors : STRING_COLORS;
  const count = opts.count ?? 22;

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  // A full-viewport, fixed, click-through canvas. DPR-scaled so sparks stay crisp.
  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  Object.assign(canvas.style, {
    position: 'fixed', left: '0', top: '0', width: W + 'px', height: H + 'px',
    pointerEvents: 'none', zIndex: '60',
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);

  // Spawn pieces radiating outward with a little upward bias + gravity.
  const pieces = Array.from({ length: count }, (_, i) => {
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const speed = 2.2 + Math.random() * 3.2;
    return {
      x: cx, y: cy,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 1.4,   // slight upward launch
      size: 2 + Math.random() * 2.5,
      color: colors[i % colors.length],
    };
  });

  const MAX = 40;   // frames (~0.65s)
  let frame = 0;
  let raf = 0;

  // Safety: if the tab is backgrounded and rAF stalls, tear down after a timeout.
  const safety = setTimeout(() => { cancelAnimationFrame(raf); canvas.remove(); }, 2000);
  const teardown = () => { clearTimeout(safety); ctx.clearRect(0, 0, W, H); canvas.remove(); };

  const tick = () => {
    frame++;
    ctx.clearRect(0, 0, W, H);
    const alpha = Math.max(0, 1 - frame / MAX);
    for (const p of pieces) {
      p.vy += 0.16;         // gravity
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.98;         // drag
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    if (frame < MAX) raf = requestAnimationFrame(tick);
    else teardown();
  };
  raf = requestAnimationFrame(tick);
}
