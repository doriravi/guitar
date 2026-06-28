// API base URL resolution:
//   - VITE_API_URL set to a non-empty host → use it (separate backend).
//   - VITE_API_URL "same-origin" → talk to this app's own origin via relative
//     /api/... paths (used when the backend serves the built frontend).
//   - VITE_DEV truthy or running on Vite's dev port → default to :8080.
// Default is SAME-ORIGIN (empty base) so a production build that forgets to set
// the var still points at its own host, never a dead localhost.
const _envUrl = (import.meta.env.VITE_API_URL || '').trim();
const _isLocalDev =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) &&
  window.location.port === '5173';

const API_BASE = _envUrl && _envUrl !== 'same-origin'
  ? _envUrl
  : _isLocalDev
    ? 'http://localhost:8080'
    : ''; // same-origin → relative /api/...

async function apiFetch(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  // For multipart/FormData uploads, callers pass { 'Content-Type': undefined }
  // so the browser can set the multipart boundary itself.
  if (headers['Content-Type'] === undefined) delete headers['Content-Type'];

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message = data?.message || `HTTP ${res.status}`;
    throw Object.assign(new Error(message), { status: res.status, data });
  }

  return data;
}

export const auth = {
  register: (email, password, name, language) =>
    apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, language }),
    }),

  login: (email, password) =>
    apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  refresh: () => apiFetch('/api/auth/refresh', { method: 'POST' }),

  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),

  me: () => apiFetch('/api/users/me'),

  // Which social providers the server has credentials for: { google, facebook }
  oauthConfig: () => apiFetch('/api/auth/oauth/config'),

  // token = Google ID token from Google Identity Services
  oauthGoogle: (token) =>
    apiFetch('/api/auth/oauth/google', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // token = Facebook access token from the Facebook Login SDK
  oauthFacebook: (token) =>
    apiFetch('/api/auth/oauth/facebook', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
};

export const handProfile = {
  get: () => apiFetch('/api/users/me/hand-profile'),

  save: (profile) =>
    apiFetch('/api/users/me/hand-profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    }),
};

export const user = {
  update: (data) =>
    apiFetch('/api/users/me', { method: 'PUT', body: JSON.stringify(data) }),

  delete: () =>
    apiFetch('/api/users/me', { method: 'DELETE' }),

  resendVerification: () =>
    apiFetch('/api/users/me/resend-verification', { method: 'POST' }),

  verifyEmail: (token) =>
    apiFetch(`/api/users/verify-email?token=${encodeURIComponent(token)}`, { method: 'POST' }),

  forgotPassword: (email) =>
    apiFetch('/api/users/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),

  resetPassword: (token, newPassword) =>
    apiFetch('/api/users/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword }) }),
};

export const tab = {
  // Transcribe a guitar clip — from an uploaded file OR a YouTube URL — and
  // return { ascii, bpm, events:[{string,fret,...}], chords }.
  // Pass either `audioFile` or `{ youtubeUrl }` (URL takes precedence when both given).
  transcribe: (audioFile, { youtubeUrl, durationSeconds, startSeconds } = {}) => {
    const form = new FormData();
    if (youtubeUrl) form.append('youtube_url', youtubeUrl);
    else if (audioFile) form.append('audio', audioFile);
    if (durationSeconds != null) form.append('duration_seconds', durationSeconds);
    if (startSeconds != null) form.append('start_seconds', startSeconds);
    return apiFetch('/api/tab/transcribe', {
      method: 'POST',
      body: form,
      headers: { 'Content-Type': undefined }, // let the browser set the multipart boundary
    });
  },
};

export const subscriptions = {
  getStatus: () => apiFetch('/api/subscriptions/me'),

  createCheckout: (plan) =>
    apiFetch('/api/subscriptions/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),

  cancel: () => apiFetch('/api/subscriptions/cancel', { method: 'POST' }),
};

// ── Lyrics ───────────────────────────────────────────────────────────────────
// Fetched from public, CORS-enabled lyrics databases — NOT our backend.
// Primary source is LRCLIB (free, no key, reliable); we fall back to its fuzzy
// search, then to api.lyrics.ovh, so a flaky/down source doesn't kill the
// feature. Resolves to one of:
//   { status:'done',  text }     lyrics found
//   { status:'empty' }           track exists but has no lyrics / instrumental, or no match
//   { status:'error' }           every source was unreachable (network/timeout/5xx)
export const lyrics = {
  async fetch(artist, title, { signal, timeoutMs = 8000 } = {}) {
    // Combine an external abort signal (component unmount) with a timeout.
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);

    const get = (url) => fetch(url, { signal: ctrl.signal });
    let sawError = false; // a source was unreachable (vs. cleanly "not found")

    try {
      // 1) LRCLIB exact get.
      try {
        const r = await get(`https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`);
        if (r.ok) {
          const d = await r.json();
          if (d.instrumental) return { status: 'empty' };
          if (d.plainLyrics) return { status: 'done', text: d.plainLyrics };
        } else if (r.status !== 404) {
          sawError = true;
        }
      } catch { sawError = true; }

      // 2) LRCLIB fuzzy search (handles imperfect artist/title tags). LRCLIB is
      // our reliable source — if its search succeeds but returns no usable hit,
      // treat that as a definitive "not found" and don't let the flaky legacy
      // fallback below flip it to a misleading "service unavailable".
      try {
        const r = await get(`https://lrclib.net/api/search?q=${encodeURIComponent(`${title} ${artist}`)}`);
        if (r.ok) {
          const arr = await r.json();
          const hit = Array.isArray(arr) ? arr.find(x => x && x.plainLyrics) : null;
          if (hit) return { status: 'done', text: hit.plainLyrics };
          return { status: 'empty' }; // LRCLIB answered cleanly: no such lyrics
        }
        sawError = true;
      } catch { sawError = true; }

      // 3) Legacy fallback: api.lyrics.ovh.
      try {
        const r = await get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`);
        if (r.ok) {
          const d = await r.json();
          if (d.lyrics) return { status: 'done', text: d.lyrics };
        } else if (r.status !== 404) {
          sawError = true;
        }
      } catch { sawError = true; }

      // Nothing found. If at least one source was reachable and simply had no
      // match, that's an honest "not found"; if every source errored, say so.
      return { status: sawError ? 'error' : 'empty' };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  },
};
