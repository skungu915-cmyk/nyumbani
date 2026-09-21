const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { optionalAuth } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const prisma = require('../lib/prisma');
const { cleanText } = require('../utils/sanitize');

const router = express.Router();

const enquirySchema = z.object({
  name: z.string().trim().min(1).max(120),
  contact: z.string().trim().min(3).max(120),
  propertyId: z.string().uuid().optional(),
  subject: z.string().trim().min(2).max(160),
  message: z.string().trim().min(5).max(3000),
});

// Public contact form — persisted for real (the mockup only fired a toast and discarded the
// message). optionalAuth so we can attribute it to a logged-in user without requiring login.
router.post(
  '/',
  optionalAuth,
  writeLimiter,
  validate(enquirySchema),
  asyncHandler(async (req, res) => {
    const { name, contact, propertyId, subject, message } = req.body;
    await prisma.enquiry.create({
      data: {
        userId: req.user?.id || null,
        name: cleanText(name, 120),
        contact: cleanText(contact, 120),
        propertyId: propertyId || null,
        subject: cleanText(subject, 160),
        message: cleanText(message, 3000),
      },
    });
    res.status(201).json({ ok: true, message: "Thanks — we'll get back to you shortly." });
  })
);

module.exports = router;
