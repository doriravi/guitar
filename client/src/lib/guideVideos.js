// guideVideos.js
// ==============
// Per-milestone intro videos for the Level Plan. Each milestone's "Go →" can be
// gated behind a short guide the user must watch the FIRST time (with a "Skip
// this time" escape hatch), and can replay later.
//
// The videos are NOT bundled in the app — they stream from YouTube (upload each
// clip as "Unlisted": not searchable, playable only with the link), so the repo
// / PWA stays small, streaming is rock-solid, and there's no file-size or CORS
// grief. A single in-app manifest (GUIDE_VIDEOS below) maps each milestone `id`
// to its YouTube video id — the ?v=XXXX part of the watch URL.
//
//   GUIDE_VIDEOS = {
//     'beg-open-chords': 'dQw4w9WgXcQ',   // youtu.be/dQw4w9WgXcQ
//     'int-f-barre':     '...'
//   }
//
// A value may also be a FULL URL (any host) — it's passed through untouched, so
// you can point at a self-hosted .mp4 or a Drive link if you ever want to.
//
// NAMING CONVENTION (decided once, kept everywhere):
//   • manifest KEY      = the milestone id, verbatim (e.g. "beg-open-chords")
//   • YouTube title     = guide_<milestone-id>_v<N>  (for your own sanity; the
//                         app never reads the title, only the video id)
//   • "seen" FLAG       = localStorage  guideSeen:<milestone-id>
//
// Everything fails SOFT: an unknown/empty id → "no guide" and practice proceeds
// unblocked. A milestone never blocks on a missing or broken video.

// ── The manifest — add one line per milestone as you record its guide ─────────
// Paste the YouTube video id (the 11-char code after ?v= or after youtu.be/).
// Leave a milestone out (or set '') to have no guide for it yet.
//
//   Example after you upload the CAGED guide:
//     'beg-open-chords': 'AbCdEfGhIjK',
export const GUIDE_VIDEOS = {
  'beg-open-chords': 'Hku-YqnH7_k',   // CAGED open-chords guide (youtu.be/Hku-YqnH7_k)
};

// Optional: override/extend the manifest at build time (or host it remotely)
// with VITE_GUIDE_MANIFEST_URL pointing at a JSON of the same {id: videoId} shape.
export const GUIDE_MANIFEST_URL =
  import.meta.env.VITE_GUIDE_MANIFEST_URL || '';

const SEEN_PREFIX = 'guideSeen:';

// A guide "video" descriptor the modal understands.
//   { kind: 'youtube', id }  → embedded YouTube player
//   { kind: 'file', url }    → a plain <video src>
// Returns null when there's no guide.
export function guideVideoSource(value) {
  if (!value) return null;
  // Full URL? Could be a YouTube watch/share link or a direct media file.
  if (/^https?:\/\//i.test(value)) {
    const yt = extractYouTubeId(value);
    if (yt) return { kind: 'youtube', id: yt };
    return { kind: 'file', url: value };
  }
  // Otherwise treat it as a bare YouTube video id.
  return { kind: 'youtube', id: value };
}

// Pull the 11-char video id out of any common YouTube URL form.
export function extractYouTubeId(url) {
  const m = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

// Privacy-friendly, no-related-videos embed URL for a video id.
// Autoplay is REQUIRED for guide videos (they must start on their own). Browsers
// only allow autoplay when muted, so mute=1 is mandatory — the user unmutes with
// the player's own control. rel=0 keeps related videos off the end screen.
export function youTubeEmbedUrl(id) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&mute=1&rel=0&modestbranding=1&playsinline=1`;
}

// ── Manifest (in-app GUIDE_VIDEOS, optionally merged with a remote JSON) ──────
let _manifestPromise = null;

export function loadGuideManifest() {
  if (_manifestPromise) return _manifestPromise;
  if (!GUIDE_MANIFEST_URL) {
    _manifestPromise = Promise.resolve({ ...GUIDE_VIDEOS });
    return _manifestPromise;
  }
  // Remote JSON, if configured, is layered ON TOP of the in-app defaults.
  _manifestPromise = fetch(GUIDE_MANIFEST_URL, { credentials: 'omit' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((m) => ({ ...GUIDE_VIDEOS, ...(m && typeof m === 'object' ? m : {}) }))
    .catch(() => ({ ...GUIDE_VIDEOS }));   // network/CORS/parse failure → defaults
  return _manifestPromise;
}

// Force a re-fetch (e.g. after the author updates the manifest and wants to test).
export function refreshGuideManifest() {
  _manifestPromise = null;
  return loadGuideManifest();
}

/**
 * Resolve a milestone id to a video SOURCE descriptor the modal can play
 * ({ kind:'youtube', id } | { kind:'file', url }), or null when there's no guide.
 */
export async function guideVideoFor(milestoneId) {
  const manifest = await loadGuideManifest();
  return guideVideoSource(manifest[milestoneId]);
}

// ── "Seen" flags (localStorage, one key per milestone) ───────────────────────
export function hasSeenGuide(milestoneId) {
  try { return localStorage.getItem(SEEN_PREFIX + milestoneId) === '1'; }
  catch { return false; }
}

export function markGuideSeen(milestoneId) {
  try { localStorage.setItem(SEEN_PREFIX + milestoneId, '1'); }
  catch { /* storage may be unavailable (private mode) — non-fatal */ }
}

/** Clear a single milestone's seen flag (used by "watch again" replays if desired). */
export function clearGuideSeen(milestoneId) {
  try { localStorage.removeItem(SEEN_PREFIX + milestoneId); }
  catch { /* ignore */ }
}
