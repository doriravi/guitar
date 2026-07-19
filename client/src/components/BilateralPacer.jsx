// BilateralPacer — the EMDR-style calming pacer for the Music Memory tab.
//
// A large luminous orb glides slowly left↔right at a breathing tempo (one full
// left→right→left per `breathMs`, default 8s) and blooms brightest at the turns.
// The bilateral (side-to-side) motion is the regulating element; the slow
// ease-in-out gives the natural slow-at-the-turn feel of a breath. A soft stereo
// tone pans with it (see audio.js startEmdrBed), so eyes and ears move together.
//
// Compositor-only: the glide/bloom are CSS @keyframes on `transform`/`opacity`
// (compositor thread) — they CANNOT contend with the mic's YIN rAF loop. Crucially
// we do NOT animate box-shadow spread (that repaints every frame); the glow is a
// separate blurred layer animating only opacity + scale. The only JS is a single
// setInterval at the breath half-period to flip the "in/out" label.
//
// Phase alignment: `pacerEpoch` is a performance.now() value captured when the
// audio pan LFO started. We convert it to a NEGATIVE animation-delay in the SAME
// performance.now() clock so the orb starts where the pan is (both LEFT at t=0).
// We never mix in ctx.currentTime (a different epoch). Alignment is "same 8s
// period, closely aligned", not sample-locked.
//
// prefers-reduced-motion: the orb does NOT translate (vestibular safety); two
// end-anchored dots cross-fade on the breath cycle and the label stays. The AUDIO
// pan keeps sweeping (audio is not a vestibular trigger).

import { useEffect, useState, useId } from 'react';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {object} props
 * @param {number} [props.breathMs=8000]  one full left→right→left cycle
 * @param {boolean} [props.active=true]    whether the pacer is animating
 * @param {number} [props.pacerEpoch=0]    performance.now() when the audio LFO started
 * @param {string} [props.inLabel]         "Breathe in"
 * @param {string} [props.outLabel]        "Breathe out"
 * @param {string} [props.caption]         a persistent explanation under the orb
 */
export default function BilateralPacer({
  breathMs = 8000, active = true, pacerEpoch = 0,
  inLabel = 'Breathe in', outLabel = 'Breathe out', caption,
}) {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const [inhale, setInhale] = useState(true);
  const uid = useId().replace(/:/g, '');
  const glide = `bpg-${uid}`;
  const bloom = `bpb-${uid}`;
  const fade = `bpf-${uid}`;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  // Flip the breath label at each half-cycle, seeded from the shared epoch so the
  // text can't drift from the motion. A single interval — never per-frame.
  useEffect(() => {
    if (!active) return undefined;
    const half = breathMs / 2;
    // Where are we in the current half-cycle right now?
    const elapsed = pacerEpoch ? (performance.now() - pacerEpoch) : 0;
    const intoCycle = ((elapsed % breathMs) + breathMs) % breathMs;
    const startInhale = intoCycle < half;   // first half = moving left→right = "in"
    setInhale(startInhale);
    const toNextFlip = half - (intoCycle % half);
    let id;
    const timeout = setTimeout(() => {
      setInhale((v) => !v);
      id = setInterval(() => setInhale((v) => !v), half);
    }, toNextFlip);
    return () => { clearTimeout(timeout); if (id) clearInterval(id); };
  }, [active, breathMs, pacerEpoch]);

  // Publish which way the light leans, so the aurora can drift with it.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    document.documentElement.style.setProperty('--mm-lean', inhale ? '-1' : '1');
    return () => document.documentElement.style.setProperty('--mm-lean', '0');
  }, [inhale]);

  const dur = `${breathMs}ms`;
  // Negative animation-delay in the performance.now() domain aligns the orb start
  // with the audio pan (both LEFT at t=0). Recomputed on each (epoch, active) change.
  const delaySec = (active && pacerEpoch)
    ? -((((performance.now() - pacerEpoch) / 1000) % (breathMs / 1000)))
    : 0;
  const delay = `${delaySec}s`;
  const playState = active ? 'running' : 'paused';

  return (
    <div className="w-full select-none flex flex-col items-center" aria-hidden="true">
      <style>{`
        @keyframes ${glide} {
          0%   { transform: translate(calc(-1 * var(--bp-travel, 130px)), -50%); }
          50%  { transform: translate(var(--bp-travel, 130px), -50%); }
          100% { transform: translate(calc(-1 * var(--bp-travel, 130px)), -50%); }
        }
        @keyframes ${bloom} {
          0%, 100% { opacity: 0.95; transform: translate(-50%, -50%) scale(1.25); }
          50%      { opacity: 0.95; transform: translate(-50%, -50%) scale(1.25); }
          25%, 75% { opacity: 0.4;  transform: translate(-50%, -50%) scale(0.7); }
        }
        @keyframes ${fade} { 0%,100%{opacity:1} 50%{opacity:0.12} }

        .${glide}-lane { position: relative; height: 56px; width: 100%; max-width: 420px; }
        .${glide}-track {
          position: absolute; top: 50%; left: 8px; right: 8px; height: 2px; margin-top: -1px;
          border-radius: 2px;
          background: linear-gradient(90deg, transparent, rgba(233,196,106,0.28), transparent);
        }
        .${glide}-rider {
          position: absolute; top: 50%; left: 50%; width: 0; height: 0;
          animation: ${glide} ${dur} ease-in-out infinite;
          animation-delay: ${delay}; animation-play-state: ${playState};
        }
        .${glide}-core {
          position: absolute; top: 50%; left: 50%; width: 22px; height: 22px;
          margin: -11px 0 0 -11px; border-radius: 9999px;
          background: radial-gradient(circle at 36% 32%, #fff7e6, #f3e2b8 40%, var(--color-brand) 72%);
          box-shadow: 0 0 22px 6px rgba(233,196,106,0.55), 0 0 44px 14px rgba(233,196,106,0.25);
        }
        .${glide}-glow {
          position: absolute; top: 50%; left: 50%; width: 64px; height: 64px;
          border-radius: 9999px; background: radial-gradient(circle, rgba(233,196,106,0.5), transparent 70%);
          filter: blur(6px);
          animation: ${bloom} ${dur} ease-in-out infinite;
          animation-delay: ${delay}; animation-play-state: ${playState};
        }
        .${fade}-a, .${fade}-b {
          position: absolute; top: 50%; margin-top: -8px; width: 16px; height: 16px;
          border-radius: 9999px; background: var(--color-brand);
          box-shadow: 0 0 16px 4px rgba(233,196,106,0.5);
        }
        .${fade}-a { left: 10px; animation: ${fade} ${dur} ease-in-out infinite; }
        .${fade}-b { right: 10px; animation: ${fade} ${dur} ease-in-out infinite reverse; }
        @media (prefers-reduced-motion: reduce) {
          .${glide}-rider, .${glide}-glow { animation: none; }
        }
      `}</style>

      <div className="text-center text-[11px] uppercase tracking-[0.35em] font-semibold mb-1"
        style={{ color: 'var(--color-brand)', opacity: active ? 0.9 : 0.4, transition: 'opacity 500ms' }}>
        {inhale ? inLabel : outLabel}
      </div>

      <div className={`${glide}-lane`} style={{ '--bp-travel': 'calc(50% - 32px)' }}>
        <span className={`${glide}-track`} />
        {reduced ? (
          <>
            <span className={`${fade}-a`} />
            <span className={`${fade}-b`} />
          </>
        ) : (
          <span className={`${glide}-rider`}>
            <span className={`${glide}-glow`} />
            <span className={`${glide}-core`} />
          </span>
        )}
      </div>

      {caption && (
        <div className="text-center text-[11px] leading-relaxed mt-2 max-w-sm mx-auto"
          style={{ color: 'var(--color-ink-faint)' }}>
          {caption}
        </div>
      )}
    </div>
  );
}
