// Celebration — the "you advanced!" reward that fires when a practice/recording
// take produces REAL progression (a new star best, a mastery crown, a cleared
// tempo, a Level-Plan milestone). Per the app rule: on advancement, show a
// congratulation message, play a happy sound, run a special visual effect, and
// DESCRIBE exactly what the player unlocked — so progress feels earned and clear.
//
// Reusable on purpose: it takes an `advancement` object (the shape
// detectAdvancement() in scaleGame.js returns) and renders itself. Any other
// practice surface can drop it in with its own advancement result.
//
// Honest about restraint:
//   • Only render it when advancement.advanced is true — the caller guards this,
//     and this component also no-ops otherwise. Firing on every take is noise.
//   • prefers-reduced-motion → no confetti / no pulsing; the message + describe
//     text still show (the information isn't motion-dependent).
//   • The sound plays once, from inside the results render that follows a tap, so
//     it stays within the audio gesture unlock.

import { useEffect, useRef, useState } from 'react';
import { playFanfare, getAudioAnalyser } from '../lib/audio';
import Lazy3D from './Lazy3D';

// Lazy loader for the big-win GPU particle burst. Static-literal specifier so
// Vite splits it into the shared three-vendor chunk; Lazy3D only fetches it when
// should3D() passes. Module-scoped so Lazy3D's memo stays stable across renders.
const loadCelebrationBurst = () => import('./three/CelebrationBurst');

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Turn one achievement into { headline, detail } strings, i18n where available.
function describe(top, tr) {
  if (!top) return null;
  const d = top.detail || {};
  switch (top.type) {
    case 'crownMax':
      return {
        headline: tr.sqCelebCrownMax || 'MASTERED! ⭐ 5-star crown',
        detail: tr.sqCelebCrownMaxSub || 'You can play it AND find it, at the top tier. This scale is yours.',
      };
    case 'crownNew':
      return {
        headline: `${tr.sqCelebCrownNew || 'New mastery crown!'} ${'★'.repeat(d.crown || 1)}`,
        detail: tr.sqCelebCrownNewSub || 'You just proved you can both play this scale and find it from memory.',
      };
    case 'crownUp':
      return {
        headline: `${tr.sqCelebCrownUp || 'Crown leveled up!'} ${'★'.repeat(d.crown || 1)}`,
        detail: `${tr.sqCelebFrom || 'Up from'} ${'★'.repeat(d.prev || 0) || '—'}.`,
      };
    case 'milestone':
      return {
        headline: tr.sqCelebMilestone || 'Level Plan advanced! 🗺️',
        detail: tr.sqCelebMilestoneSub || 'This take cleared a milestone on your roadmap.',
      };
    case 'bpmCleared':
      return {
        headline: `${tr.sqCelebSpeed || 'New top speed!'} ${d.bpm} BPM`,
        detail: `${tr.sqCelebFrom || 'Up from'} ${d.prev || 0} BPM — cleared clean at 4★+.`,
      };
    case 'starBest':
      return {
        headline: `${tr.sqCelebStar || 'New personal best!'} ${'★'.repeat(d.stars || 1)}`,
        detail: `${d.mode === 'hunt' ? (tr.sqModeHunt || 'Note-Hunt') : (tr.sqModeRun || 'Run')} · ${tr.sqCelebFrom || 'up from'} ${'★'.repeat(d.prev || 0) || '—'}.`,
      };
    // ── Music Memory (ear-training) achievements — additive, so ScaleQuest's
    //    cases are untouched and an un-extended build still hits `default`. ──
    case 'mmLevelUp':
      return {
        headline: tr.mmCelebLevelUp || 'Ear level up! 🎧',
        detail: (tr.mmCelebLevelUpSub || 'Now training at level ${level}.').replace('${level}', d.level || 1),
      };
    case 'mmBestScore':
      return {
        headline: tr.mmCelebBest || 'New best ear score!',
        detail: (tr.mmCelebBestSub || '${score} of ${total} heard.').replace('${score}', d.score ?? '').replace('${total}', d.total ?? ''),
      };
    case 'mmPerfect':
      return {
        headline: tr.mmCelebPerfect || 'Perfect session! ✨',
        detail: tr.mmCelebPerfectSub || 'Every element, by ear.',
      };
    // ── Play-With-Me (Progressions tab) — you played a whole song, self-paced,
    //    chord by chord through the lyrics. Additive, so existing cases are
    //    untouched and an un-extended build still hits `default`. ──
    case 'songComplete':
      return {
        headline: tr.pwmCelebSong || 'You played the whole song! 🎸',
        detail: d.title
          ? (tr.pwmCelebSongSub || 'Every chord of “${title}”, at your own pace.').replace('${title}', d.title)
          : (tr.pwmCelebSongSub2 || 'Every chord, at your own pace.'),
      };
    default:
      return { headline: tr.sqCelebGeneric || 'You advanced! 🎉', detail: '' };
  }
}

// Lightweight canvas confetti — a one-shot burst, no external lib. Cleans itself
// up when the pieces fall off-screen. Skipped entirely under reduced-motion.
function useConfetti(canvasRef, active, big) {
  useEffect(() => {
    if (!active) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const parent = canvas.parentElement;
    const W = (canvas.width = parent.clientWidth);
    const H = (canvas.height = parent.clientHeight);
    const COLORS = ['#e0a93a', '#34d399', '#5b8def', '#ef6f6f', '#f5d76e', '#a78bfa'];
    const count = big ? 160 : 90;
    const g = 0.12;
    const pieces = Array.from({ length: count }, (_, i) => ({
      x: W / 2 + (i % 7 - 3) * 6,
      y: H * 0.32,
      vx: (i * 2654435761 % 200) / 100 - 1,       // deterministic spread, no Math.random
      vy: -3 - ((i * 40503) % 100) / 40,
      w: 4 + (i % 4),
      h: 6 + (i % 5),
      rot: (i % 360) * (Math.PI / 180),
      vr: ((i % 7) - 3) * 0.08,
      c: COLORS[i % COLORS.length],
    }));

    // Audio-reactive re-loft: for the first ~0.5s the confetti listens to the
    // fanfare that plays over it (via the shared master-bus analyser) and gives
    // each piece a small upward nudge scaled by live energy — so the burst
    // visibly pulses up on the fanfare's ascending arpeggio hits instead of a
    // launch that's blind to the sound. Fully backward-compatible: when no
    // analyser exists the energy is 0 and the confetti behaves exactly as before.
    // This code only runs when `active` (advanced && !reduced), so it's already
    // inside the reduced-motion guard.
    const analyser = (() => { try { return getAudioAnalyser(); } catch { return null; } })();
    const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const REACT_FRAMES = 30; // ~0.5s — the fanfare arpeggio's active window
    const fanfareEnergy = () => {
      if (!analyser || frame > REACT_FRAMES) return 0;
      analyser.getByteFrequencyData(freq);   // reuses `freq` — no per-frame alloc
      let sum = 0;
      for (let i = 0; i < freq.length; i++) sum += freq[i];
      return sum / (freq.length * 255);      // 0..1 average bin energy
    };

    let raf;
    let frame = 0;
    const MAX_FRAMES = 180; // ~3s then stop
    const tick = () => {
      frame += 1;
      ctx.clearRect(0, 0, W, H);
      const energy = fanfareEnergy();          // 0 when no fanfare / past the window
      let alive = 0;
      for (const p of pieces) {
        p.vy += g;
        if (energy > 0) p.vy -= energy * 0.9;  // re-loft on each arpeggio peak
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y < H + 20) alive += 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - frame / MAX_FRAMES);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive > 0 && frame < MAX_FRAMES) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, W, H);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, [canvasRef, active, big]);
}

/**
 * @param {object} advancement  detectAdvancement() result: { advanced, big, top, achievements }
 * @param {object} tr           translation table (from useT)
 */
export default function Celebration({ advancement, tr = {} }) {
  const canvasRef = useRef(null);
  const [reduced] = useState(prefersReducedMotion);
  const soundedRef = useRef(false);
  const [burstDone, setBurstDone] = useState(false); // GPU burst finished → unmount it

  const advanced = !!advancement?.advanced;
  const big = !!advancement?.big;

  // Play the fanfare exactly once when this celebration appears.
  useEffect(() => {
    if (!advanced || soundedRef.current) return;
    soundedRef.current = true;
    try { playFanfare({ big }); } catch { /* audio may be unavailable */ }
  }, [advanced, big]);

  useConfetti(canvasRef, advanced && !reduced, big);

  if (!advanced) return null;

  const main = describe(advancement.top, tr);
  const extras = (advancement.achievements || []).slice(1);

  return (
    <div
      role="status"
      aria-live="polite"
      className="relative rounded-xl overflow-hidden text-center"
      style={{
        background:
          'linear-gradient(135deg, rgba(224,169,58,0.16), rgba(52,211,153,0.12))',
        border: '1px solid rgba(224,169,58,0.5)',
        boxShadow: big ? '0 0 26px 3px rgba(224,169,58,0.35)' : '0 0 14px 1px rgba(224,169,58,0.2)',
      }}
    >
      {/* Confetti canvas overlays the banner; pointer-events off so it never blocks. */}
      {!reduced && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ pointerEvents: 'none' }}
          aria-hidden="true"
        />
      )}

      {/* Big-win GPU particle burst — an additive point spray over the banner for
          the highest-effort achievements. Lazy3D gates should3D() (never mounts /
          fetches the chunk under reduced-motion, no-GPU, or user opt-out) and the
          confetti above remains the universal base layer. Self-unmounts via
          onDone when the ~1.8s ramp finishes, freeing the GPU context. */}
      {big && !reduced && !burstDone && (
        <div className="absolute inset-0" style={{ pointerEvents: 'none' }} aria-hidden="true">
          <Lazy3D load={loadCelebrationBurst} fallback={null}
            componentProps={{ onDone: () => setBurstDone(true) }} />
        </div>
      )}

      <div className="relative p-5 z-10">
        <div
          className="text-3xl mb-1"
          style={reduced ? undefined : { animation: 'celeb-pop 700ms ease-out' }}
          aria-hidden="true"
        >
          {big ? '🏆' : '🎉'}
        </div>
        <div className="text-base font-extrabold" style={{ color: 'var(--color-brand, #e0a93a)' }}>
          {tr.sqCelebCongrats || 'Congratulations!'}
        </div>
        {main && (
          <>
            <div className="text-sm font-bold mt-1" style={{ color: 'var(--color-ink)' }}>
              {main.headline}
            </div>
            {main.detail && (
              <div className="text-xs mt-1" style={{ color: 'var(--color-ink-muted)' }}>
                {main.detail}
              </div>
            )}
          </>
        )}
        {extras.length > 0 && (
          <div className="text-[11px] mt-2" style={{ color: 'var(--color-ink-faint)' }}>
            {tr.sqCelebAlso || 'Also unlocked:'}{' '}
            {extras.map((a, i) => {
              const e = describe(a, tr);
              return (
                <span key={a.type}>
                  {i > 0 ? ' · ' : ''}
                  {e?.headline}
                </span>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes celeb-pop {
          0%   { transform: scale(0.3); opacity: 0; }
          60%  { transform: scale(1.25); opacity: 1; }
          100% { transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="celeb-pop"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
