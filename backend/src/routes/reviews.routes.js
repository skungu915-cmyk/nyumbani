const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const reviewsService = require('../services/reviews.service');

const router = express.Router();

router.get(
  '/',
  validate(
    z.object({
      propertyId: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(50).default(20),
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const result = await reviewsService.listApprovedReviews(req.query);
    res.json(result);
  })
);

const submitSchema = z.object({
  propertyId: z.string().uuid().optional(),
  stars: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().min(5).max(2000),
});

router.post(
  '/',
  requireAuth,
  writeLimiter,
  validate(submitSchema),
  asyncHandler(async (req, res) => {
    const review = await reviewsService.submitReview(req.user.id, req.body);
    res.status(201).json({ review: { id: review.id, status: review.status }, message: 'Thanks! Your review is pending moderation.' });
  })
);

module.exports = router;
