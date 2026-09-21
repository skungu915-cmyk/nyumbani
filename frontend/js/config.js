// Backend API origin. Defaults to the explicit local dev backend when served from localhost (the
// two-process "npm run dev" + "python3 -m http.server" setup in README.md), and to '' (same
// origin) everywhere else — which is exactly right for the Netlify deployment, where
// netlify.toml redirects /api/* and /media/* to the backend function on the same domain, and for
// any other reverse-proxied deployment that puts the frontend and /api on one origin.
// A build-time value can't be injected here without a bundler, and CSP intentionally blocks inline
// <script> config, so editing this file directly is the escape hatch for anything else (e.g. a
// frontend and backend deployed to two different HTTPS origins — remember to add that origin to
// the backend's FRONTEND_ORIGINS allowlist too).
const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
export const API_BASE = isLocalDev ? 'http://localhost:4000' : '';
