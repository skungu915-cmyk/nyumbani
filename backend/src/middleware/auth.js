const { verifyAccessToken } = require('../utils/tokens');
const { unauthorized, forbidden } = require('../utils/http-errors');
const prisma = require('../lib/prisma');

// Requires a valid, non-expired access token in the Authorization header. Access tokens are sent
// as `Authorization: Bearer <token>` from the frontend's JS (kept in memory, never localStorage),
// which sidesteps CSRF for all authenticated JSON API calls: a cross-site form/img/script tag
// cannot set a custom Authorization header, so it cannot forge an authenticated request here.
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next(unauthorized('Missing or invalid access token'));

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return next(unauthorized('Access token expired or invalid'));
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'active') return next(unauthorized('Account not active'));

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Populates req.user if a valid token is present, but never rejects the request. Used for public
// endpoints (e.g. property listing) whose response shape depends on whether the caller is logged in.
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) return next();
    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (user && user.status === 'active') req.user = user;
    next();
  } catch {
    next();
  }
}

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!roles.includes(req.user.role)) return next(forbidden('You do not have access to this resource'));
  next();
};

module.exports = { requireAuth, optionalAuth, requireRole };
