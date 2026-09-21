const env = require('../config/env');
const { forbidden } = require('../utils/http-errors');

// CSRF defense for the one cookie-authenticated endpoint (/api/auth/refresh) — every other
// authenticated route uses a bearer token in an Authorization header, which is immune to CSRF
// by construction (cross-site requests can't attach a custom header without our CORS allowing it).
//
// Belt-and-braces here: the refresh cookie is set SameSite=Strict (browser won't send it on a
// cross-site navigation/request at all in modern browsers), and on top of that we require a
// custom header that only same-origin JS could have attached, plus we check Origin/Referer match
// an allowlisted frontend origin.
function requireSameOrigin(req, res, next) {
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    const matches = env.frontendOrigins.some((o) => origin.startsWith(o));
    if (!matches) return next(forbidden('Cross-origin request rejected'));
  }
  const marker = req.headers[env.CSRF_HEADER_NAME.toLowerCase()];
  if (marker !== '1') {
    return next(forbidden('Missing CSRF header'));
  }
  next();
}

module.exports = { requireSameOrigin };
