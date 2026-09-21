const rateLimit = require('express-rate-limit');

// Generic API-wide limiter — generous, just a backstop against runaway clients/scripts.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tight limiter for auth endpoints — the primary defense against credential-stuffing / brute force
// on top of the per-account lockout implemented in the auth service.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// Even tighter for the actual login attempt (as opposed to signup/refresh) to slow down guessing.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' },
});

// Payment initiation is rate-limited per IP to blunt STK-push spam (each call costs a Daraja
// API request and annoys the phone number holder with unsolicited prompts).
const paymentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payment attempts. Please wait a few minutes and try again.' },
});

// Contact/enquiry/review forms — cheap to abuse for spam otherwise.
const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { apiLimiter, authLimiter, loginLimiter, paymentLimiter, writeLimiter };
