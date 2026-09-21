// The access token lives ONLY in memory (a module-level variable), never in localStorage or
// sessionStorage. This means an XSS bug elsewhere in the page can't simply read a persisted token
// out of storage — the worst it can do is abuse the token for the lifetime of the current tab,
// same as it could abuse a live session either way. A page reload loses it, which is why
// bootstrapSession() (see auth.js) silently calls /api/auth/refresh — backed by the httpOnly
// refresh cookie the browser holds — to obtain a fresh one on load.
export const state = {
  accessToken: null,
  user: null, // { id, role, firstName, lastName, email, phone, referralCode, ... } or null
};

export function setSession(user, accessToken) {
  state.user = user;
  state.accessToken = accessToken;
}

export function clearSession() {
  state.user = null;
  state.accessToken = null;
}

export function isLoggedIn() {
  return !!state.user;
}

export function hasRole(...roles) {
  return !!state.user && roles.includes(state.user.role);
}
