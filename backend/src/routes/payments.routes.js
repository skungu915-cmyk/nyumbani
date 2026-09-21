const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { paymentLimiter } = require('../middleware/rateLimit');
const paymentsService = require('../services/payments.service');
const logger = require('../lib/logger');
const env = require('../config/env');

const router = express.Router();

const initiateSchema = z.object({
  propertyId: z.string().uuid(),
  phoneNumber: z.string().trim().min(9).max(15),
});

router.post(
  '/unlock',
  requireAuth,
  paymentLimiter,
  validate(initiateSchema),
  asyncHandler(async (req, res) => {
    const result = await paymentsService.initiateUnlock({
      userId: req.user.id,
      propertyId: req.body.propertyId,
      phoneNumber: req.body.phoneNumber,
    });
    res.status(202).json(result);
  })
);

router.get(
  '/:id/status',
  requireAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const payment = await paymentsService.getPaymentStatus(req.params.id, { userId: req.user.id, role: req.user.role });
    res.json({ payment });
  })
);

// ── Safaricom Daraja callback ────────────────────────────────────────────────────────────────
// This endpoint is unauthenticated by necessity — Safaricom's servers call it directly, they can't
// present our JWT. Its security instead comes from:
//   1) Optional IP allowlist (Safaricom publishes the source IP ranges for Daraja callbacks).
//   2) The payload must reference a CheckoutRequestID *we* generated via a prior /unlock call and
//      that is still PENDING — an attacker who doesn't know a live, unsettled CheckoutRequestID
//      (an unguessable Safaricom-issued value) cannot forge a state change through this endpoint.
//   3) Idempotent handling — replays or out-of-order callbacks can never double-credit anything.
// We always respond 200 to Safaricom (it retries aggressively on non-200), even if our internal
// processing hits an unexpected error, logging the failure for manual investigation instead.
function checkCallbackSource(req, res, next) {
  if (env.mpesaCallbackIpAllowlist.length === 0) return next();
  const ip = req.ip;
  if (env.mpesaCallbackIpAllowlist.includes(ip)) return next();
  logger.warn({ ip }, 'Rejected M-Pesa callback from IP outside allowlist');
  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' }); // ack without processing
}

router.post(
  '/mpesa/callback',
  checkCallbackSource,
  express.json({ limit: '256kb' }),
  asyncHandler(async (req, res) => {
    try {
      const stkCallback = req.body?.Body?.stkCallback;
      await paymentsService.handleStkCallback(stkCallback);
    } catch (err) {
      logger.error({ err, body: req.body }, 'Error processing M-Pesa callback');
    }
    // Daraja requires this exact acknowledgement shape regardless of our internal outcome.
    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  })
);

module.exports = router;
