import { useCallback, useEffect, useRef, useState } from 'react';

// A draggable, screen-floating panel. Renders fixed-position so it can be placed
// ANYWHERE over the app; the user drags it by the grip handle (dragging from the
// body is ignored so buttons/controls inside stay clickable). Position is clamped
// to the viewport and persisted to localStorage per `storageKey`, so it stays put
// across reloads and tab switches.
//
// Pointer events (not mouse) so it works with touch/pen too, with pointer capture
// for a smooth drag that doesn't drop when the cursor outruns the element.
//
//   <FloatingPanel storageKey="composer-field" width={260} height={150}
//                  defaultPos={{ x: 24, y: 96 }} title="Composer">
//     …content…
//   </FloatingPanel>

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function loadPos(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.x === 'number' && typeof p.y === 'number') return p;
    }
  } catch { /* ignore */ }
  return fallback;
}

export default function FloatingPanel({
  storageKey,
  width = 260,
  height = 150,
  defaultPos = { x: 24, y: 96 },
  title = '',
  children,
}) {
  const [pos, setPos] = useState(() => loadPos(`floatpanel_${storageKey}`, defaultPos));
  const [dragging, setDragging] = useState(false);
  const ref = useRef(null);
  const off = useRef({ x: 0, y: 0 }); // pointer offset within the panel at grab

  // Keep the panel on-screen if the viewport shrank since it was last placed.
  const clampToView = useCallback((p) => {
    const maxX = Math.max(0, window.innerWidth - width - 4);
    const maxY = Math.max(0, window.innerHeight - height - 4);
    return { x: clamp(p.x, 4, maxX), y: clamp(p.y, 4, maxY) };
  }, [width, height]);

  useEffect(() => {
    setPos(p => clampToView(p));
    const onResize = () => setPos(p => clampToView(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampToView]);

  // Persist whenever the panel comes to rest.
  useEffect(() => {
    if (dragging) return;
    try { localStorage.setItem(`floatpanel_${storageKey}`, JSON.stringify(pos)); } catch { /* ignore */ }
  }, [pos, dragging, storageKey]);

  const onPointerDown = (e) => {
    // Only the grip starts a drag (its onPointerDown calls this).
    const rect = ref.current.getBoundingClientRect();
    off.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragging(true);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e) => {
    if (!dragging) return;
    setPos(clampToView({ x: e.clientX - off.current.x, y: e.clientY - off.current.y }));
  };
  const endDrag = (e) => {
    if (!dragging) return;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };

  return (
    <div
      ref={ref}
      className="rounded-2xl overflow-hidden border border-surface-700 shadow-2xl"
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width,
        height,
        zIndex: 50,
        background: 'radial-gradient(120% 120% at 20% 0%, rgba(201,169,110,0.18), rgba(167,139,250,0.10) 45%, var(--color-surface-850) 80%)',
        touchAction: 'none',            // let us own touch gestures (drag)
        cursor: dragging ? 'grabbing' : 'default',
        userSelect: 'none',
      }}
    >
      {/* Grip handle — the only drag target, so inner buttons stay clickable. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        title={title ? `Drag to move — ${title}` : 'Drag to move'}
        className="absolute top-0 left-0 right-0 flex items-center gap-1.5 px-2 py-1 z-20"
        style={{
          cursor: dragging ? 'grabbing' : 'grab',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(0,0,0,0))',
        }}
      >
        {/* grip dots */}
        <span aria-hidden className="leading-none tracking-[2px] text-[10px]"
          style={{ color: 'var(--color-ink-faint)' }}>⠿</span>
        {title && (
          <span className="text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--color-ink-faint)' }}>{title}</span>
        )}
      </div>

      {children}
    </div>
  );
}
