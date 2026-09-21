const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const prisma = require('../lib/prisma');
const { getSettings, toPublicSettings } = require('../services/settings.service');

const router = express.Router();

// Non-secret platform config the frontend needs to render (fee amounts, feature toggles).
// M-Pesa API credentials are deliberately never part of this response — see settings.service.
router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    res.json(toPublicSettings(settings));
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const [activeListings, verifiedTenants] = await Promise.all([
      prisma.property.count({ where: { status: 'ACTIVE' } }),
      prisma.user.count({ where: { role: 'TENANT' } }),
    ]);
    res.json({ activeListings, verifiedTenants });
  })
);

module.exports = router;
