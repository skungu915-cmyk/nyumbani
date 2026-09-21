const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { getReferralSummary } = require('../services/referrals.service');

const router = express.Router();

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const summary = await getReferralSummary(req.user.id);
    res.json(summary);
  })
);

module.exports = router;
