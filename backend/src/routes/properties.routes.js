const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const asyncHandler = require('../middleware/asyncHandler');
const { requireAuth, optionalAuth, requireRole } = require('../middleware/auth');
const { writeLimiter } = require('../middleware/rateLimit');
const propertyService = require('../services/property.service');
const { photoUpload, videoUpload, processPhoto, processVideo } = require('../services/upload.service');
const { badRequest } = require('../utils/http-errors');

const router = express.Router();

const PROPERTY_TYPES = ['BEDSITTER', 'STUDIO', 'ONE_BED', 'TWO_BED', 'THREE_BED', 'BNB'];

const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  type: z.enum(PROPERTY_TYPES).optional(),
  maxBudget: z.coerce.number().int().positive().optional(),
  area: z.string().trim().max(120).optional(),
  ownerId: z.string().uuid().optional(),
  status: z.enum(['PENDING_REVIEW', 'ACTIVE', 'RENTED', 'SUSPENDED', 'EXPIRED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(24),
});

router.get(
  '/',
  optionalAuth,
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const ctx = req.user ? { userId: req.user.id, role: req.user.role } : null;
    const result = await propertyService.listProperties(req.query, ctx);
    res.json(result);
  })
);

router.get(
  '/:id',
  optionalAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    const ctx = req.user ? { userId: req.user.id, role: req.user.role } : null;
    const property = await propertyService.getPropertyById(req.params.id, ctx);
    res.json({ property });
  })
);

const amenitiesSchema = z.array(z.string().trim().max(40)).max(30).default([]);

// HTML forms submit every field, including ones the user left blank, as an empty string rather
// than omitting the key — that's indistinguishable from "not provided" for an optional field, so
// treat '' as undefined before the real type/format check runs (otherwise e.g. an optional phone
// regex or coerced number would reject a blank field the client-side form never required).
const emptyToUndefined = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const createSchema = z.object({
  title: z.string().trim().min(3).max(140),
  type: z.enum(PROPERTY_TYPES),
  rentAmount: z.coerce.number().int().positive().max(10_000_000),
  bedrooms: z.coerce.number().int().min(0).max(20).optional(),
  bathrooms: z.coerce.number().int().min(0).max(20).optional(),
  parkingSpaces: z.coerce.number().int().min(0).max(20).optional(),
  sizeSqm: emptyToUndefined(z.coerce.number().int().positive()),
  floor: emptyToUndefined(z.string().trim().max(40)),
  area: z.string().trim().min(2).max(120),
  county: emptyToUndefined(z.string().trim().max(60)),
  description: z.string().trim().min(10).max(4000),
  amenities: amenitiesSchema,
  exactAddress: z.string().trim().min(5).max(300),
  ownerName: emptyToUndefined(z.string().trim().max(120)),
  ownerPhone: emptyToUndefined(z.string().trim().regex(/^\+?[0-9]{9,15}$/, 'Enter a valid phone number')),
  geoLat: emptyToUndefined(z.coerce.number().min(-90).max(90)),
  geoLng: emptyToUndefined(z.coerce.number().min(-180).max(180)),
});

// Any authenticated tenant or landlord may self-list (matches the mockup's "+ List Property" being
// open to any visitor); admins create listings through the same endpoint with role ADMIN, which
// auto-activates instead of going to PENDING_REVIEW.
router.post(
  '/',
  requireAuth,
  writeLimiter,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const property = await propertyService.createProperty(req.body, req.user);
    res.status(201).json({ property });
  })
);

const updateSchema = createSchema.partial().extend({
  status: z.enum(['PENDING_REVIEW', 'ACTIVE', 'RENTED', 'SUSPENDED', 'EXPIRED']).optional(),
});

router.put(
  '/:id',
  requireAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const property = await propertyService.updateProperty(req.params.id, req.body, {
      userId: req.user.id,
      role: req.user.role,
    });
    res.json({ property });
  })
);

router.delete(
  '/:id',
  requireAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  asyncHandler(async (req, res) => {
    await propertyService.deleteProperty(req.params.id, { userId: req.user.id, role: req.user.role });
    res.json({ ok: true });
  })
);

router.post(
  '/:id/photos',
  requireAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  photoUpload.array('photos', 10),
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) throw badRequest('No photos uploaded');
    const filenames = [];
    for (const file of req.files) {
      // eslint-disable-next-line no-await-in-loop
      filenames.push(await processPhoto(file.buffer));
    }
    const watermarked = await propertyService.addPhotos(req.params.id, filenames, {
      userId: req.user.id,
      role: req.user.role,
    });
    res.status(201).json({ ok: true, count: filenames.length, watermarkApplied: watermarked });
  })
);

router.post(
  '/:id/video',
  requireAuth,
  validate(z.object({ id: z.string().uuid() }), 'params'),
  videoUpload.single('video'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('No video uploaded');
    const filename = await processVideo(req.file.buffer);
    await propertyService.addVideo(req.params.id, filename, { userId: req.user.id, role: req.user.role });
    res.status(201).json({ ok: true });
  })
);

module.exports = router;
