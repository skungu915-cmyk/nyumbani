const prisma = require('../lib/prisma');
const { notFound, forbidden, badRequest } = require('../utils/http-errors');
const { getSettings } = require('./settings.service');
const env = require('../config/env');

// ── THE security boundary for this whole app ────────────────────────────────────────────────
// A Property row always contains exactAddress / ownerName / ownerPhone / geoLat / geoLng in the
// database. Those fields are stripped from the JSON representation UNLESS the caller is:
//   1) the property's owner,
//   2) an admin, or
//   3) a user with a verified Unlock row for that property (i.e. they completed a real M-Pesa
//      payment, confirmed server-side by the Daraja callback — see payments.service).
// This function is the ONLY place that decides that, and every route that returns a property MUST
// go through it. Unlike the original static mockup, the raw contact fields are never even sent to
// the browser for a caller who hasn't paid — there is no client-side flag to flip.
function isRestrictedVisible(property, ctx) {
  if (!ctx) return false;
  if (ctx.role === 'ADMIN') return true;
  if (ctx.userId && ctx.userId === property.ownerId) return true;
  if (ctx.unlockedPropertyIds && ctx.unlockedPropertyIds.has(property.id)) return true;
  return false;
}

function baseShape(property) {
  return {
    id: property.id,
    ownerId: property.ownerId,
    title: property.title,
    type: property.type,
    rentAmount: property.rentAmount,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    parkingSpaces: property.parkingSpaces,
    sizeSqm: property.sizeSqm,
    floor: property.floor,
    area: property.area,
    county: property.county,
    description: property.description,
    amenities: property.amenities,
    status: property.status,
    viewingFeeKes: property.viewingFeeKes,
    isSelfListed: property.isSelfListed,
    views: property.views,
    createdAt: property.createdAt,
    updatedAt: property.updatedAt,
    photos: (property.photos || [])
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ id: p.id, url: `/media/properties/${p.filename}`, isPrimary: p.isPrimary })),
    videos: (property.videos || []).map((v) => ({ id: v.id, url: `/media/properties/${v.filename}` })),
  };
}

function serializeProperty(property, ctx) {
  const out = baseShape(property);
  const unlocked = isRestrictedVisible(property, ctx);
  out.isUnlocked = unlocked;
  out.isOwner = !!(ctx && ctx.userId === property.ownerId);
  if (unlocked) {
    out.exactAddress = property.exactAddress;
    out.ownerName = property.ownerName;
    out.ownerPhone = property.ownerPhone;
    out.geoLat = property.geoLat;
    out.geoLng = property.geoLng;
  } else {
    // Explicitly present-but-redacted rather than simply omitted, so the frontend can render a
    // consistent "locked" UI without needing to special-case a missing key.
    out.exactAddress = null;
    out.ownerName = null;
    out.ownerPhone = null;
    out.geoLat = null;
    out.geoLng = null;
  }
  return out;
}

async function getUnlockedPropertyIds(userId, propertyIds) {
  if (!userId || propertyIds.length === 0) return new Set();
  const rows = await prisma.unlock.findMany({
    where: { userId, propertyId: { in: propertyIds } },
    select: { propertyId: true },
  });
  return new Set(rows.map((r) => r.propertyId));
}

const PUBLIC_STATUSES = ['ACTIVE'];

async function listProperties({ q, type, maxBudget, area, ownerId, status, page = 1, pageSize = 24 }, ctx) {
  const where = {};

  if (ownerId) {
    // Only the owner themself or an admin may list non-public-status properties by owner.
    if (!ctx || (ctx.userId !== ownerId && ctx.role !== 'ADMIN')) {
      where.status = { in: PUBLIC_STATUSES };
    } else if (status) {
      where.status = status;
    }
    // else: owner/admin viewing their own portfolio sees every status, including
    // PENDING_REVIEW/SUSPENDED — deliberately unrestricted so a landlord can see a listing they
    // just submitted before it's approved.
    where.ownerId = ownerId;
  } else if (ctx && ctx.role === 'ADMIN') {
    // Admin's moderation queue: unrestricted by default so PENDING_REVIEW listings are visible;
    // an explicit ?status= narrows it, same as everywhere else.
    if (status) where.status = status;
  } else {
    where.status = { in: PUBLIC_STATUSES };
  }

  if (type) where.type = type;
  if (area) where.area = { contains: area, mode: 'insensitive' };
  if (maxBudget) where.rentAmount = { lte: maxBudget };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: 'insensitive' } },
      { area: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
  }

  const skip = (Math.max(1, page) - 1) * pageSize;
  const [total, rows] = await Promise.all([
    prisma.property.count({ where }),
    prisma.property.findMany({
      where,
      include: { photos: true, videos: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  const unlocked = ctx?.userId ? await getUnlockedPropertyIds(ctx.userId, rows.map((r) => r.id)) : new Set();
  const items = rows.map((p) => serializeProperty(p, { ...ctx, unlockedPropertyIds: unlocked }));
  return { items, total, page, pageSize };
}

async function getPropertyById(id, ctx) {
  const property = await prisma.property.findUnique({ where: { id }, include: { photos: true, videos: true } });
  if (!property) throw notFound('Property not found');

  const isOwnerOrAdmin = ctx && (ctx.userId === property.ownerId || ctx.role === 'ADMIN');
  if (!PUBLIC_STATUSES.includes(property.status) && !isOwnerOrAdmin) {
    throw notFound('Property not found');
  }

  if (!isOwnerOrAdmin) {
    await prisma.property.update({ where: { id }, data: { views: { increment: 1 } } }).catch(() => {});
  }

  const unlocked = ctx?.userId ? await getUnlockedPropertyIds(ctx.userId, [id]) : new Set();
  return serializeProperty(property, { ...ctx, unlockedPropertyIds: unlocked });
}

async function createProperty(input, owner) {
  const settings = await getSettings();
  const status = settings.autoApproveListings ? 'ACTIVE' : 'PENDING_REVIEW';

  const property = await prisma.property.create({
    data: {
      ownerId: owner.id,
      title: input.title,
      type: input.type,
      rentAmount: input.rentAmount,
      bedrooms: input.bedrooms ?? 0,
      bathrooms: input.bathrooms ?? 1,
      parkingSpaces: input.parkingSpaces ?? 0,
      sizeSqm: input.sizeSqm ?? null,
      floor: input.floor ?? null,
      area: input.area,
      county: input.county || 'Nairobi',
      description: input.description,
      amenities: input.amenities ?? [],
      viewingFeeKes: settings.unlockFeeKes,
      isSelfListed: owner.role !== 'ADMIN',
      status,
      exactAddress: input.exactAddress,
      ownerName: input.ownerName || `${owner.firstName} ${owner.lastName}`,
      ownerPhone: input.ownerPhone || owner.phone,
      geoLat: input.geoLat ?? null,
      geoLng: input.geoLng ?? null,
    },
    include: { photos: true, videos: true },
  });
  return serializeProperty(property, { userId: owner.id, role: owner.role });
}

async function assertOwnerOrAdmin(propertyId, ctx) {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw notFound('Property not found');
  if (property.ownerId !== ctx.userId && ctx.role !== 'ADMIN') {
    throw forbidden('You do not have permission to modify this property');
  }
  return property;
}

async function updateProperty(id, patch, ctx) {
  await assertOwnerOrAdmin(id, ctx);

  const data = {};
  const editable = [
    'title', 'type', 'rentAmount', 'bedrooms', 'bathrooms', 'parkingSpaces', 'sizeSqm', 'floor',
    'area', 'county', 'description', 'amenities', 'exactAddress', 'ownerName', 'ownerPhone',
    'geoLat', 'geoLng',
  ];
  for (const key of editable) if (patch[key] !== undefined) data[key] = patch[key];

  // Only admins may directly flip status (approve/suspend); landlords request review implicitly.
  if (patch.status !== undefined) {
    if (ctx.role !== 'ADMIN') throw forbidden('Only an admin can change listing status');
    data.status = patch.status;
  }

  const property = await prisma.property.update({ where: { id }, data, include: { photos: true, videos: true } });
  return serializeProperty(property, ctx);
}

async function deleteProperty(id, ctx) {
  await assertOwnerOrAdmin(id, ctx);
  await prisma.property.delete({ where: { id } });
}

async function addPhotos(id, filenames, ctx) {
  await assertOwnerOrAdmin(id, ctx);
  const settings = await getSettings();
  const existingCount = await prisma.propertyPhoto.count({ where: { propertyId: id } });
  if (existingCount + filenames.length > env.MAX_PHOTOS_PER_PROPERTY) {
    throw badRequest(`A property may have at most ${env.MAX_PHOTOS_PER_PROPERTY} photos`);
  }
  await prisma.propertyPhoto.createMany({
    data: filenames.map((filename, i) => ({
      propertyId: id,
      filename,
      isPrimary: existingCount === 0 && i === 0,
      order: existingCount + i,
    })),
  });
  return settings.watermarkPhotos;
}

async function addVideo(id, filename, ctx) {
  await assertOwnerOrAdmin(id, ctx);
  await prisma.propertyVideo.create({ data: { propertyId: id, filename } });
}

module.exports = {
  listProperties,
  getPropertyById,
  createProperty,
  updateProperty,
  deleteProperty,
  addPhotos,
  addVideo,
  serializeProperty,
  assertOwnerOrAdmin,
  getUnlockedPropertyIds,
};
