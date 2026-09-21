const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requireSameOrigin } = require('../middleware/csrf');
const { authLimiter, loginLimiter } = require('../middleware/rateLimit');
const authService = require('../services/auth.service');
const { toPublicUser } = require('../services/user.service');
const { isStrongPassword } = require('../utils/passwords');
const { badRequest } = require('../utils/http-errors');
const env = require('../config/env');

const router = express.Router();

const passwordSchema = z.string().refine(isStrongPassword, {
  message: 'Password must be at least 10 characters and include at least 3 of: lowercase, uppercase, numbers, symbols',
});

const nameField = z.string().trim().min(1).max(80);
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{9,15}$/, 'Enter a valid phone number, e.g. +2547XXXXXXXX');

const signupSchema = z
  .object({
    role: z.enum(['TENANT', 'LANDLORD']), // ADMIN can never self-register
    firstName: nameField,
    lastName: nameField,
    email: z.string().trim().toLowerCase().email(),
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    referralCode: z.string().trim().max(20).optional(),
    agencyName: z.string().trim().max(120).optional(),
    yearsExperience: z.coerce.number().int().min(0).max(80).optional(),
    operatingAreas: z.string().trim().max(300).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    domain: env.COOKIE_DOMAIN || undefined,
    path: '/api/auth',
    maxAge: require('../utils/tokens').refreshTtlMs(),
  });
}

function clearRefreshCookie(res) {
  res.clearCookie('refreshToken', { path: '/api/auth', domain: env.COOKIE_DOMAIN || undefined });
}

function meta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

router.post(
  '/signup',
  authLimiter,
  validate(signupSchema),
  asyncHandler(async (req, res) => {
    const { user, accessToken, refreshToken } = await authService.signup(req.body, meta(req));
    setRefreshCookie(res, refreshToken);
    res.status(201).json({ user: toPublicUser(user), accessToken });
  })
);

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(200),
});

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { user, accessToken, refreshToken } = await authService.login(req.body, meta(req));
    setRefreshCookie(res, refreshToken);
    res.json({ user: toPublicUser(user), accessToken });
  })
);

router.post(
  '/refresh',
  requireSameOrigin,
  asyncHandler(async (req, res) => {
    const { user, accessToken, refreshToken } = await authService.refresh(req.cookies.refreshToken, meta(req));
    setRefreshCookie(res, refreshToken);
    res.json({ user: toPublicUser(user), accessToken });
  })
);

router.post(
  '/logout',
  requireSameOrigin,
  asyncHandler(async (req, res) => {
    await authService.logout(req.cookies.refreshToken);
    clearRefreshCookie(res);
    res.json({ ok: true });
  })
);

router.post(
  '/logout-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await authService.logoutAll(req.user.id);
    clearRefreshCookie(res);
    res.json({ ok: true });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: toPublicUser(req.user) });
  })
);

router.post(
  '/verify-email',
  authLimiter,
  validate(z.object({ token: z.string().min(10) })),
  asyncHandler(async (req, res) => {
    await authService.verifyEmail(req.body.token);
    res.json({ ok: true });
  })
);

router.post(
  '/forgot-password',
  authLimiter,
  validate(z.object({ email: z.string().trim().toLowerCase().email() })),
  asyncHandler(async (req, res) => {
    await authService.requestPasswordReset(req.body.email);
    // Always 200 — do not reveal whether the email exists.
    res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
  })
);

router.post(
  '/reset-password',
  authLimiter,
  validate(z.object({ token: z.string().min(10), password: passwordSchema })),
  asyncHandler(async (req, res) => {
    if (!req.body.token) throw badRequest('Token required');
    await authService.resetPassword(req.body.token, req.body.password);
    res.json({ ok: true });
  })
);

module.exports = router;
