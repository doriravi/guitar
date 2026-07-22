import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { markGuideSeen } from '../lib/guideVideos';

// A forced first-time guide video for a Level Plan milestone. It:
//   • autoplays the instant it opens, and plays at FULL volume — browsers block
//     un-muted autoplay, so we start muted, then unmute + set volume to max the
//     moment playback begins (via the YouTube IFrame API / the <video> element).
//     If a browser still refuses (Safari sometimes does), a one-tap "🔊 Sound"
//     button appears.
//   • unlocks "Continue to practice" when the video ENDS (real end event), with a
//     "Skip this time" escape hatch after a few seconds so nobody is trapped.
// Both exits mark the guide seen so it won't force again (replayable later).
//
// Portalled to <body> so a transformed Level-Plan ancestor can't trap this fixed
// overlay off-screen (see the fixed-element-portal lesson).

const SKIP_APPEARS_AFTER_MS = 6000;    // grace before the "Skip this time" escape hatch
const YT_MAX_WATCH_FALLBACK = 90000;   // safety unlock if the end event never fires

// Load the YouTube IFrame API once, resolving when window.YT.Player is ready.
let _ytApiPromise = null;
function loadYouTubeApi() {
  if (_ytApiPromise) return _ytApiPromise;
  _ytApiPromise = new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(window.YT); return; }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch { /* ignore */ } resolve(window.YT); };
    if (!document.getElementById('yt-iframe-api')) {
      const s = document.createElement('script');
      s.id = 'yt-iframe-api';
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(s);
    }
  });
  return _ytApiPromise;
}

export default function GuideVideoModal({ milestoneId, title, source, onClose }) {
  const [ended, setEnded]       = useState(false);
  const [canSkip, setCanSkip]   = useState(false);
  const [failed, setFailed]     = useState(false);
  const [needsTap, setNeedsTap] = useState(false);   // browser refused programmatic unmute
  const videoRef  = useRef(null);
  const ytHostRef = useRef(null);
  const ytPlayer  = useRef(null);

  const isYouTube = source?.kind === 'youtube';

  // Reveal "Skip this time" after a short grace period.
  useEffect(() => {
    const t = setTimeout(() => setCanSkip(true), SKIP_APPEARS_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  const handleError = () => { setFailed(true); setEnded(true); setCanSkip(true); };

  // ── YouTube: build a player via the IFrame API so we can unmute at full volume ──
  useEffect(() => {
    if (!isYouTube || !source?.id) return undefined;
    let cancelled = false;
    let fallback;
    loadYouTubeApi().then((YT) => {
      if (cancelled || !ytHostRef.current) return;
      ytPlayer.current = new YT.Player(ytHostRef.current, {
        videoId: source.id,
        playerVars: {
          autoplay: 1, mute: 1,           // muted autoplay is the only kind browsers allow
          rel: 0, modestbranding: 1, playsinline: 1, controls: 1,
        },
        events: {
          onReady: (e) => {
            try { e.target.playVideo(); } catch { /* ignore */ }
          },
          onStateChange: (e) => {
            // PLAYING (1): now that playback started, raise volume and unmute.
            if (e.data === 1) {
              try {
                e.target.setVolume(100);
                e.target.unMute();
                // If the browser silently kept it muted, offer a one-tap unmute.
                setTimeout(() => {
                  try { if (ytPlayer.current?.isMuted?.()) setNeedsTap(true); } catch { /* ignore */ }
                }, 300);
              } catch { /* ignore */ }
            }
            // ENDED (0): unlock Continue.
            if (e.data === 0) setEnded(true);
          },
          onError: handleError,
        },
      });
    });
    // Safety: unlock Continue even if the end event never arrives.
    fallback = setTimeout(() => setEnded(true), YT_MAX_WATCH_FALLBACK);
    return () => {
      cancelled = true;
      if (fallback) clearTimeout(fallback);
      try { ytPlayer.current?.destroy?.(); } catch { /* ignore */ }
      ytPlayer.current = null;
    };
  }, [isYouTube, source?.id]);

  // ── File <video>: play at full volume; fall back to muted autoplay if blocked ──
  const onVideoRef = useCallback((el) => {
    videoRef.current = el;
    if (!el) return;
    el.volume = 1;
    el.muted = false;
    const p = el.play?.();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Un-muted autoplay refused — start muted, then show a one-tap unmute.
        el.muted = true;
        el.play?.().catch(() => {});
        setNeedsTap(true);
      });
    }
  }, []);

  // The one-tap "enable sound" handler for browsers that refused auto-unmute.
  const enableSound = () => {
    setNeedsTap(false);
    try {
      if (isYouTube) { ytPlayer.current?.unMute?.(); ytPlayer.current?.setVolume?.(100); }
      else if (videoRef.current) { videoRef.current.muted = false; videoRef.current.volume = 1; }
    } catch { /* ignore */ }
  };

  const finish = () => { markGuideSeen(milestoneId); onClose(true); };
  const skip   = () => { markGuideSeen(milestoneId); onClose(true); };

  const overlay = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.72)' }}
      role="dialog"
      aria-modal="true"
      aria-label={`Guide: ${title}`}
    >
      <div
        className="w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{ background: 'var(--color-surface-850)', border: '1px solid var(--color-surface-700)', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}
      >
        {/* No title bar — just the video (the milestone name / source stays hidden). */}
        <div className="relative bg-black flex items-center justify-center" style={{ aspectRatio: '16 / 9' }}>
          {failed || !source ? (
            <div className="text-center px-6 py-10">
              <p className="text-3xl mb-2">📼</p>
              <p className="text-sm" style={{ color: 'var(--color-ink-faint)' }}>
                The guide video couldn’t load right now. You can continue to practice.
              </p>
            </div>
          ) : isYouTube ? (
            <div ref={ytHostRef} className="w-full h-full" />
          ) : (
            <video
              ref={onVideoRef}
              src={source.url}
              controls
              autoPlay
              playsInline
              onEnded={() => setEnded(true)}
              onError={handleError}
              className="w-full h-full"
              style={{ background: '#000' }}
            />
          )}

          {/* Shown only if the browser refused to auto-unmute. */}
          {needsTap && !failed && (
            <button
              onClick={enableSound}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 text-sm px-4 py-2 rounded-full font-semibold shadow-lg"
              style={{ background: 'var(--color-brand)', color: 'var(--color-surface-base)' }}
            >
              🔊 Tap for sound
            </button>
          )}
        </div>

        <div className="px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
          <span className="text-xs" style={{ color: 'var(--color-ink-ghost)' }}>
            {ended ? 'Great — you’re ready.' : 'Watch the guide, then continue.'}
          </span>
          <div className="flex items-center gap-2">
            {!ended && canSkip && (
              <button
                onClick={skip}
                className="text-xs px-3 py-1.5 rounded-lg font-semibold"
                style={{ background: 'transparent', color: 'var(--color-ink-faint)', border: '1px solid var(--color-surface-600)' }}
              >
                Skip this time
              </button>
            )}
            <button
              onClick={finish}
              disabled={!ended}
              className="text-sm px-4 py-2 rounded-lg font-semibold transition-all"
              style={ended
                ? { background: 'var(--color-brand)', color: 'var(--color-surface-base)' }
                : { background: 'var(--color-surface-700)', color: 'var(--color-ink-ghost)', cursor: 'not-allowed' }}
            >
              Continue to practice →
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
