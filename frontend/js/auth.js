import { api, ApiError } from './api.js';
import { state, setSession, clearSession, isLoggedIn } from './state.js';
import { closeModal, openModal } from './modal.js';
import { toast } from './toast.js';
import { qs, escapeHtml } from './utils.js';

function showErr(id, msg) {
  const el = qs(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
}
function clearErr(id) {
  const el = qs(id);
  if (!el) return;
  el.textContent = '';
  el.classList.remove('show');
}

// On page load, we hold no token in memory yet. This silently tries to exchange the httpOnly
// refresh cookie (if the browser still has one from a prior visit) for a fresh access token,
// so a returning logged-in user doesn't have to log in again on every reload.
export async function bootstrapSession() {
  try {
    await api.refreshSession();
  } catch {
    clearSession();
  }
  renderAuthUI();
}

export function renderAuthUI() {
  const guest = qs('navRightGuest');
  const user = qs('navRightUser');
  if (isLoggedIn()) {
    guest?.classList.add('hidden');
    user?.classList.remove('hidden');
    const nameEl = qs('navUserName');
    if (nameEl) nameEl.textContent = `Hi, ${state.user.firstName}`;
    const llName = qs('llUserName');
    if (llName) llName.textContent = `${state.user.firstName} ${state.user.lastName}`;
    const adName = qs('adUserName');
    if (adName) adName.textContent = `${state.user.firstName} ${state.user.lastName}`;
  } else {
    guest?.classList.remove('hidden');
    user?.classList.add('hidden');
  }
  window.dispatchEvent(new CustomEvent('auth:changed'));
}

export function openLogin() {
  closeModal('signupOvl');
  openModal('loginOvl');
}
export function openSignup() {
  closeModal('loginOvl');
  openModal('signupOvl');
}

export async function handleLoginSubmit(form) {
  clearErr('loginErr');
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await api.post('/api/auth/login', data);
    setSession(res.user, res.accessToken);
    renderAuthUI();
    closeModal('loginOvl');
    form.reset();
    toast('👋', 'Welcome back', `Logged in as ${res.user.firstName}`);
  } catch (err) {
    showErr('loginErr', err instanceof ApiError ? err.message : 'Login failed. Please try again.');
  }
}

export async function handleSignupSubmit(form) {
  clearErr('signupErr');
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await api.post('/api/auth/signup', data);
    setSession(res.user, res.accessToken);
    renderAuthUI();
    closeModal('signupOvl');
    form.reset();
    toast('🎉', 'Account created', `Welcome, ${res.user.firstName}!`);
  } catch (err) {
    if (err instanceof ApiError && err.details) {
      const first = Object.values(err.details)[0];
      showErr('signupErr', Array.isArray(first) ? first[0] : err.message);
    } else {
      showErr('signupErr', err instanceof ApiError ? err.message : 'Signup failed. Please try again.');
    }
  }
}

export async function logout() {
  try {
    await api.postCsrf('/api/auth/logout');
  } catch {
    /* best-effort */
  }
  clearSession();
  renderAuthUI();
  toast('👋', 'Logged out', 'See you again soon');
  window.dispatchEvent(new CustomEvent('nav:home'));
}

export function requireLoginOrPrompt(actionLabel) {
  if (isLoggedIn()) return true;
  toast('🔒', 'Login required', `Please log in to ${actionLabel}`);
  openLogin();
  return false;
}

export { escapeHtml };
