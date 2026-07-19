// BilateralPacer — the EMDR-style calming pacer used by the Music Memory tab.
//
// An orb glides slowly left↔right at a breathing tempo (one full inhale+exhale
// per `breathMs`, default 8s ≈ 7.5 breaths/min), with a breath cue ("Breathe
// in" / "Breathe out") synced to the sweep. The bilateral (side-to-side) motion
// is the regulating element; the slow ease-in-out gives the natural slow-at-the-
// turn feel of a breath.
//
// Why pure CSS, not a JS rAF: the animation is a CSS @keyframes on `transform`,
// which the browser runs on the compositor thread — it CANNOT contend with the
// mic's YIN detection rAF loop (the whole point). The only JS is a single
// setInterval at the breath half-period to flip the "in"/"out" label — never a
// per-frame callback. No external lib, no Math.random / Date.now.
//
// prefers-reduced-motion: the orb does NOT translate (vestibular safety); instead
// two end-anchored dots cross-fade opacity on the same breath cycle, and the text
// cue remains. Honors both the JS matchMedia check and the global reduced-motion
// CSS block in index.css.

import { useEffect, useState, useId } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {object} props
 * @param {number} [props.breathMs=8000]  one full inhale+exhale cycle
 * @param {boolean} [props.active=true]   whether the pacer is animating
 * @param {string}  [props.inLabel]       "Breathe in" text
 * @param {string}  [props.outLabel]      "Breathe out" text
 */
export default function BilateralPacer({ breathMs = 8000, active = true, inLabel = 'Breathe in', outLabel = 'Breathe out' }) {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [inhale, setInhale] = useState(true);
  const uid = useId().replace(/:/g, '');       // safe for a CSS class/animation name
  const anim = `bp-glide-${uid}`;
  const fade = `bp-fade-${uid}`;

  // Track the OS reduced-motion preference live.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Flip the breath label at each half-cycle. A single interval — not per-frame.
  useEffect(() => {
    if (!active) return undefined;
    setInhale(true);
    const id = setInterval(() => setInhale((v) => !v), breathMs / 2);
    return () => clearInterval(id);
  }, [active, breathMs]);

  const dur = `${breathMs}ms`;

  return (
    <div className="w-full select-none" aria-hidden="true">
      <style>{`
        @keyframes ${anim} {
          0%   { transform: translateX(0); }
          50%  { transform: translateX(var(--bp-travel, 220px)); }
          100% { transform: translateX(0); }
        }
        @keyframes ${fade} {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.15; }
        }
        .${anim}-track { position: relative; height: 34px; }
        .${anim}-orb {
          position: absolute; top: 50%; left: 8px; margin-top: -9px;
          width: 18px; height: 18px; border-radius: 9999px;
          background: radial-gradient(circle at 35% 30%, #f3e2b8, var(--color-brand));
          box-shadow: 0 0 14px 3px rgba(201,169,110,0.45);
          animation: ${anim} ${dur} ease-in-out infinite;
          animation-play-state: ${active ? 'running' : 'paused'};
        }
        .${fade}-a, .${fade}-b {
          position: absolute; top: 50%; margin-top: -7px;
          width: 14px; height: 14px; border-radius: 9999px;
          background: var(--color-brand); box-shadow: 0 0 10px 2px rgba(201,169,110,0.4);
        }
        .${fade}-a { left: 8px; animation: ${fade} ${dur} ease-in-out infinite; }
        .${fade}-b { right: 8px; animation: ${fade} ${dur} ease-in-out infinite reverse; }
        @media (prefers-reduced-motion: reduce) {
          .${anim}-orb { animation: none; left: 50%; margin-left: -9px; }
        }
      `}</style>

      <div className="text-center text-[11px] uppercase tracking-[0.3em] font-semibold mb-2"
        style={{ color: 'var(--color-brand)', opacity: active ? 0.9 : 0.4, transition: 'opacity 400ms' }}>
        {inhale ? inLabel : outLabel}
      </div>

      <div className={`${anim}-track`} style={{ '--bp-travel': 'calc(100% - 26px)' }}>
        {reduced ? (
          <>
            <span className={`${fade}-a`} />
            <span className={`${fade}-b`} />
          </>
        ) : (
          <span className={`${anim}-orb`} />
        )}
      </div>
    </div>
  );
}
