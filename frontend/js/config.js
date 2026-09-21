// Backend API origin. In production, either:
//   (a) reverse-proxy /api on the same origin as this frontend and set this to '', or
//   (b) point it at the backend's own HTTPS origin (must be in the backend's FRONTEND_ORIGINS
//       allowlist and CORS will only allow this exact origin).
// A build-time value can't be injected here without a bundler, and CSP intentionally blocks inline
// <script> config, so this constant is the single place to edit per environment.
export const API_BASE = 'http://localhost:4000';
