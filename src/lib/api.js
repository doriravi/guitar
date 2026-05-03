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
};

export const handProfile = {
  get: () => apiFetch('/api/users/me/hand-profile'),

  save: (profile) =>
    apiFetch('/api/users/me/hand-profile', {
      method: 'PUT',
      body: JSON.stringify(profile),
    }),
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
