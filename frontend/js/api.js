import { API_BASE } from './config.js';
import { state, setSession, clearSession } from './state.js';

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let refreshPromise = null;

// Cookie-authenticated calls (refresh/logout) require the CSRF header the backend's
// requireSameOrigin middleware checks for — see backend/src/middleware/csrf.js.
async function rawRefresh() {
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'x-livehere-csrf': '1' },
  });
  if (!res.ok) throw new ApiError(res.status, 'Session expired');
  const data = await res.json();
  setSession(data.user, data.accessToken);
  return data;
}

// Deduplicates concurrent refresh attempts (e.g. several 401s firing at once) into one request.
function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = rawRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request(path, { method = 'GET', body, isForm = false, retry = true, csrf = false } = {}) {
  const headers = {};
  if (!isForm && body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  // The handful of cookie-authenticated endpoints (refresh, logout) are guarded server-side by
  // requireSameOrigin, which checks for this header — see backend/src/middleware/csrf.js.
  if (csrf) headers['x-livehere-csrf'] = '1';

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (res.status === 401 && retry && state.user) {
    // Access token likely expired — try the refresh-cookie flow once, then retry the original call.
    try {
      await refreshSession();
      return request(path, { method, body, isForm, retry: false, csrf });
    } catch {
      clearSession();
      window.dispatchEvent(new CustomEvent('session:expired'));
    }
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || res.statusText, data && data.details);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  del: (path) => request(path, { method: 'DELETE' }),
  postForm: (path, formData) => request(path, { method: 'POST', body: formData, isForm: true }),
  postCsrf: (path) => request(path, { method: 'POST', csrf: true }),
  refreshSession,
};

export { ApiError };
