const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
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
  register: (email, password, name) =>
    apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
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

export const subscriptions = {
  getStatus: () => apiFetch('/api/subscriptions/me'),

  createCheckout: (plan) =>
    apiFetch('/api/subscriptions/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    }),

  cancel: () => apiFetch('/api/subscriptions/cancel', { method: 'POST' }),
};
