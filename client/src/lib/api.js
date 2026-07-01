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

// Per-user saved songs (edited in the Song Editor, persisted to the DB).
// Each row stores the full song object JSON in `body`, keyed by the localStorage
// `clientId` so a re-save updates the same row. Save is an upsert (PUT).
export const songs = {
  list: () => apiFetch('/api/users/me/songs'),

  save: ({ clientId, title, artist, body }) =>
    apiFetch('/api/users/me/songs', {
      method: 'PUT',
      body: JSON.stringify({ clientId, title, artist, body }),
    }),

  remove: (id) =>
    apiFetch(`/api/users/me/songs/${id}`, { method: 'DELETE' }),
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

// AI-generated explanation for the guide avatar. Returns the explanation string,
// or null when the server can't help (no key / error) so the caller can fall back.
export const explain = {
  get: (ctx) =>
    apiFetch('/api/explain', { method: 'POST', body: JSON.stringify(ctx) })
      .then(r => (r && r.explanation) ? r.explanation : null)
      .catch(() => null),
};

// AI composition hints for the Song Editor's melody/style transforms. Mirrors
// `explain`: any failure (no GEMINI_API_KEY → 503, network error, malformed
// JSON) resolves to null so the caller silently falls back to the local engine.
// The backend /api/compose endpoint is NOT built yet (see editorTransforms.js
// TODO) — until it exists this always resolves null, which is the correct
// "local only" behaviour.
export const compose = {
  get: (ctx) =>
    apiFetch('/api/compose', { method: 'POST', body: JSON.stringify(ctx) })
      .then(r => r || null)
      .catch(() => null),
};

// Floating AI advisor — multi-turn music/guitar/app consultant. Sends the chat
// history plus a snapshot of the user's current app context; returns the reply
// string, or null on any failure (no key → 503, network, malformed) so the
// widget can show a graceful "unavailable" message.
export const advise = {
  ask: ({ messages, context }) =>
    apiFetch('/api/advise', { method: 'POST', body: JSON.stringify({ messages, context }) })
      .then(r => (r && r.reply) ? r.reply : null)
      .catch(() => null),
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
  async fetch(artist, title, { signal, timeoutMs = 15000 } = {}) {
    let sawError = false; // a source was unreachable (vs. cleanly "not found")

    // A song's `artist` field may list several performers ("Village People /
    // Pet Shop Boys", "Elton John & Kiki Dee", "Jay-Z feat. Rihanna"). LRCLIB
    // matches a SINGLE artist, so we split on the common separators and try each
    // performer in turn — otherwise the combined string matches nothing.
    const artistVariants = [...new Set(
      [artist, ...String(artist || '').split(/\s*(?:\/|&|,|\bfeat\.?\b|\bft\.?\b|\bx\b|\bvs\.?\b)\s*/i)]
        .map(a => a.trim())
        .filter(Boolean),
    )];

    // Each source gets its OWN timeout/abort, so a slow step doesn't poison the
    // ones after it (one shared abort used to kill every fallback at once). The
    // caller's external signal (component unmount) still cancels any in-flight
    // request. Returns null when the request times out / is aborted / throws.
    const get = async (url) => {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (signal) {
        if (signal.aborted) return null;
        signal.addEventListener('abort', onAbort, { once: true });
      }
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch(url, { signal: ctrl.signal });
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
    };

    try {
      // 1) LRCLIB exact get, per artist variant — retried once each, since this
      //    source is occasionally slow and a single timeout shouldn't drop us to
      //    the weaker fallbacks.
      for (const a of artistVariants) {
        const exactUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(a)}&track_name=${encodeURIComponent(title)}`;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (signal?.aborted) return { status: 'error' };
          const r = await get(exactUrl);
          if (!r) { sawError = true; continue; }   // timed out/threw → retry once
          if (r.ok) {
            const d = await r.json();
            if (d.instrumental) return { status: 'empty' };
            if (d.plainLyrics) return { status: 'done', text: d.plainLyrics };
          } else if (r.status !== 404) {
            sawError = true;
          }
          break; // a definite answer (200/404/non-404) → move to next variant
        }
      }

      // 2) LRCLIB fuzzy search — per artist variant, then a title-only search as
      //    a last resort. LRCLIB is our reliable source, but a "no hit" answer
      //    for ONE query no longer ends the whole search (the old code returned
      //    'empty' on the first miss, which is why a multi-artist string failed).
      const searchQueries = [
        ...artistVariants.map(a => `${title} ${a}`),
        title, // title alone — catches messy/foreign artist tags
      ];
      for (const q of searchQueries) {
        if (signal?.aborted) return { status: 'error' };
        const r = await get(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`);
        if (!r) { sawError = true; continue; }
        if (r.ok) {
          const arr = await r.json();
          const hit = Array.isArray(arr) ? arr.find(x => x && x.plainLyrics) : null;
          if (hit) return { status: 'done', text: hit.plainLyrics };
          // clean "no hit" for this query → try the next query, don't give up yet
        } else {
          sawError = true;
        }
      }

      // 3) Legacy fallback: api.lyrics.ovh, per artist variant.
      for (const a of artistVariants) {
        if (signal?.aborted) return { status: 'error' };
        const r = await get(`https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(title)}`);
        if (!r) {
          sawError = true;
        } else if (r.ok) {
          const d = await r.json();
          if (d.lyrics) return { status: 'done', text: d.lyrics };
        } else if (r.status !== 404) {
          sawError = true;
        }
      }

      // Nothing found. If at least one source was reachable and simply had no
      // match, that's an honest "not found"; if every source errored, say so.
      return { status: sawError ? 'error' : 'empty' };
    } catch {
      return { status: 'error' };
    }
  },
};
