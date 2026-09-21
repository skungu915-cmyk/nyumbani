const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const { isStrongPassword } = require('../utils/passwords');

const adminService = require('../services/admin.service');
const propertyService = require('../services/property.service');
const reviewsService = require('../services/reviews.service');
const { getSettings, updateSettings } = require('../services/settings.service');
const prisma = require('../lib/prisma');

const router = express.Router();

router.use(requireAuth, requireRole('ADMIN'));

router.get('/overview', asyncHandler(async (req, res) => res.json(await adminService.getOverview())));

// Read-only status — never returns the actual consumer key/secret/passkey (those exist only in
// server env vars and are never persisted to the DB or serialized to any HTTP response).
router.get(
  '/mpesa-status',
  asyncHandler(async (req, res) => {
    const env = require('../config/env');
    res.json({
      environment: env.MPESA_ENV,
      shortcode: env.MPESA_SHORTCODE,
      callbackUrl: env.MPESA_CALLBACK_URL,
      consumerKeyConfigured: !!env.MPESA_CONSUMER_KEY,
      consumerSecretConfigured: !!env.MPESA_CONSUMER_SECRET,
      passkeyConfigured: !!env.MPESA_PASSKEY,
    });
  })
);

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['PENDING_REVIEW', 'ACTIVE', 'RENTED', 'SUSPENDED', 'EXPIRED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

router.get(
  '/listings',
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await propertyService.listProperties(req.query, { role: 'ADMIN' });
    res.json(result);
  })
);

router.patch(
  '/listings/:id/status',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ status: z.enum(['PENDING_REVIEW', 'ACTIVE', 'RENTED', 'SUSPENDED', 'EXPIRED']) })),
  asyncHandler(async (req, res) => {
    const property = await propertyService.updateProperty(req.params.id, { status: req.body.status }, { role: 'ADMIN', userId: req.user.id });
    await adminService.writeAudit({ actorId: req.user.id, action: 'listing.status_change', entityType: 'Property', entityId: req.params.id, metadata: { status: req.body.status }, ip: req.ip });
    res.json({ property });
  })
);

router.delete(
  '/listings/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    await propertyService.deleteProperty(req.params.id, { role: 'ADMIN', userId: req.user.id });
    await adminService.writeAudit({ actorId: req.user.id, action: 'listing.delete', entityType: 'Property', entityId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  })
);

router.get(
  '/transactions',
  validate(
    z.object({
      q: z.string().trim().max(120).optional(),
      status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED']).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    }),
    'query'
  ),
  asyncHandler(async (req, res) => res.json(await adminService.listTransactions(req.query)))
);

router.post(
  '/transactions/:id/mark-paid',
  writeLimiter,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ reason: z.string().trim().min(5).max(300) })),
  asyncHandler(async (req, res) => {
    await adminService.markTransactionPaid(req.params.id, req.user, req.body.reason);
    res.json({ ok: true });
  })
);

router.get('/landlords', asyncHandler(async (req, res) => res.json({ items: await adminService.listLandlords() })));

router.get(
  '/users',
  validate(z.object({ q: z.string().trim().max(120).optional(), role: z.enum(['TENANT', 'LANDLORD', 'ADMIN']).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) }), 'query'),
  asyncHandler(async (req, res) => res.json(await adminService.listUsers(req.query)))
);

router.patch(
  '/users/:id/status',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ status: z.enum(['active', 'suspended']) })),
  asyncHandler(async (req, res) => res.json({ user: await adminService.setUserStatus(req.params.id, req.body.status, req.user) }))
);

const createStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().regex(/^\+?[0-9]{9,15}$/),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  role: z.enum(['TENANT', 'LANDLORD', 'ADMIN']),
  password: z.string().refine(isStrongPassword, 'Password too weak'),
});

router.post(
  '/users',
  writeLimiter,
  validate(createStaffSchema),
  asyncHandler(async (req, res) => res.status(201).json({ user: await adminService.createStaffUser(req.body, req.user) }))
);

router.get('/reviews/pending', asyncHandler(async (req, res) => res.json({ items: await reviewsService.listPendingReviews() })));

router.patch(
  '/reviews/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ status: z.enum(['APPROVED', 'REJECTED']) })),
  asyncHandler(async (req, res) => {
    const review = await reviewsService.moderateReview(req.params.id, req.body.status);
    await adminService.writeAudit({ actorId: req.user.id, action: `review.${req.body.status.toLowerCase()}`, entityType: 'Review', entityId: req.params.id, ip: req.ip });
    res.json({ review });
  })
);

router.get(
  '/enquiries',
  validate(z.object({ status: z.enum(['UNREAD', 'REPLIED', 'CLOSED']).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const items = await prisma.enquiry.findMany({ where: req.query.status ? { status: req.query.status } : undefined, orderBy: { createdAt: 'desc' } });
    res.json({ items });
  })
);

router.patch(
  '/enquiries/:id',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ status: z.enum(['UNREAD', 'REPLIED', 'CLOSED']) })),
  asyncHandler(async (req, res) => {
    const enquiry = await prisma.enquiry.update({ where: { id: req.params.id }, data: { status: req.body.status } });
    res.json({ enquiry });
  })
);

router.get(
  '/settings',
  asyncHandler(async (req, res) => res.json(await getSettings()))
);

// See properties.routes.js's emptyToUndefined for why: the settings form always submits every
// field, so a blank input arrives as '' rather than an omitted key.
const emptyToUndefined = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const settingsPatchSchema = z.object({
  platformName: emptyToUndefined(z.string().trim().max(80)),
  supportEmail: emptyToUndefined(z.string().trim().email()),
  supportPhone: emptyToUndefined(z.string().trim().max(20)),
  unlockFeeKes: z.coerce.number().int().positive().optional(),
  platformFeePercent: z.coerce.number().min(0).max(100).optional(),
  referralRewardKes: z.coerce.number().int().min(0).optional(),
  watermarkPhotos: z.boolean().optional(),
  lockAddressUntilPaid: z.boolean().optional(),
  lockPhoneUntilPaid: z.boolean().optional(),
  selfListingPublic: z.boolean().optional(),
  autoApproveListings: z.boolean().optional(),
  referralProgramActive: z.boolean().optional(),
  mpesaBusinessName: emptyToUndefined(z.string().trim().max(80)),
  mpesaPaymentType: z.enum(['paybill', 'till', 'pochi']).optional(),
  mpesaPaymentDestination: emptyToUndefined(z.string().trim().max(20)),
});

router.patch(
  '/settings',
  validate(settingsPatchSchema),
  asyncHandler(async (req, res) => {
    const settings = await updateSettings(req.body);
    await adminService.writeAudit({ actorId: req.user.id, action: 'settings.update', entityType: 'PlatformSetting', metadata: req.body, ip: req.ip });
    res.json(settings);
  })
);

router.get(
  '/audit-logs',
  validate(z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50) }), 'query'),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = req.query;
    const [total, items] = await Promise.all([
      prisma.auditLog.count(),
      prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { firstName: true, lastName: true, email: true } } },
      }),
    ]);
    res.json({ total, items });
  })
);

module.exports = router;
