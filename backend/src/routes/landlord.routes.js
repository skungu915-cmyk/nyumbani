const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, requireRole } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const landlordService = require('../services/landlord.service');

const router = express.Router();

// Every route here is scoped to req.user.id server-side — a landlord can never pass someone else's
// ID to see or modify another landlord's portfolio (no landlordId is ever accepted from the client).
router.use(requireAuth, requireRole('LANDLORD', 'ADMIN'));

router.get('/dashboard', asyncHandler(async (req, res) => res.json(await landlordService.getDashboard(req.user.id))));

router.get('/tenants', asyncHandler(async (req, res) => res.json({ items: await landlordService.listTenancies(req.user.id) })));

router.post(
  '/tenants',
  writeLimiter,
  validate(
    z.object({
      propertyId: z.string().uuid(),
      tenantName: z.string().trim().min(1).max(120),
      tenantPhone: z.string().trim().min(9).max(15),
      rentAmount: z.coerce.number().int().positive(),
      leaseEnd: z.string().datetime().optional(),
    })
  ),
  asyncHandler(async (req, res) => res.status(201).json(await landlordService.createTenancy(req.user.id, req.body)))
);

router.patch(
  '/tenants/:id/status',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ status: z.enum(['active', 'overdue', 'ended']) })),
  asyncHandler(async (req, res) =>
    res.json(await landlordService.updateTenancyStatus(req.user.id, req.params.id, req.body.status))
  )
);

router.post(
  '/tenants/:id/payments',
  writeLimiter,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(z.object({ amountKes: z.coerce.number().int().positive(), mpesaCode: z.string().trim().max(20).optional() })),
  asyncHandler(async (req, res) =>
    res.status(201).json(await landlordService.recordRentPayment(req.user.id, req.params.id, req.body))
  )
);

router.get('/revenue', asyncHandler(async (req, res) => res.json(await landlordService.getRevenue(req.user.id))));

router.get('/maintenance', asyncHandler(async (req, res) => res.json({ items: await landlordService.listMaintenance(req.user.id) })));

router.post(
  '/maintenance',
  writeLimiter,
  validate(
    z.object({
      propertyId: z.string().uuid(),
      unitLabel: z.string().trim().max(40).optional(),
      issue: z.string().trim().min(3).max(500),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    })
  ),
  asyncHandler(async (req, res) => res.status(201).json(await landlordService.createMaintenance(req.user.id, req.body)))
);

router.patch(
  '/maintenance/:id/resolve',
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => res.json(await landlordService.resolveMaintenance(req.user.id, req.params.id)))
);

router.get('/notices', asyncHandler(async (req, res) => res.json({ items: await landlordService.listNotices(req.user.id) })));

router.post(
  '/notices',
  writeLimiter,
  validate(
    z.object({
      recipient: z.string().trim().min(1).max(120),
      subject: z.string().trim().min(1).max(160),
      message: z.string().trim().min(1).max(2000),
      channel: z.enum(['app', 'sms', 'whatsapp', 'email']).optional(),
    })
  ),
  asyncHandler(async (req, res) => res.status(201).json(await landlordService.sendNotice(req.user.id, req.body)))
);

module.exports = router;
