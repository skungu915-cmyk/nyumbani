const prisma = require('../lib/prisma');
const { cleanText } = require('../utils/sanitize');
const { badRequest, notFound, conflict } = require('../utils/http-errors');

// Reviews are moderated: created as PENDING and only ever shown publicly once an admin approves
// them (see admin.routes moderateReview). The mockup showed anonymous, instantly-public reviews
// with no verification at all — a direct spam/defamation vector on a public listing page.
async function submitReview(userId, { propertyId, stars, text }) {
  if (propertyId) {
    const property = await prisma.property.findUnique({ where: { id: propertyId } });
    if (!property) throw notFound('Property not found');
    const existing = await prisma.review.findUnique({ where: { userId_propertyId: { userId, propertyId } } });
    if (existing) throw conflict('You have already reviewed this property');
  } else {
    const existing = await prisma.review.findFirst({ where: { userId, propertyId: null } });
    if (existing) throw conflict('You have already left a platform review');
  }

  const clean = cleanText(text, 2000);
  if (clean.length < 5) throw badRequest('Review text is too short');

  return prisma.review.create({
    data: { userId, propertyId: propertyId || null, stars, text: clean, status: 'PENDING' },
  });
}

async function listApprovedReviews({ propertyId, page = 1, pageSize = 20 }) {
  const where = { status: 'APPROVED', propertyId: propertyId || null };
  const skip = (page - 1) * pageSize;
  const [total, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      include: { user: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      stars: r.stars,
      text: r.text,
      authorName: `${r.user.firstName} ${r.user.lastName.charAt(0)}.`,
      createdAt: r.createdAt,
    })),
  };
}

async function listPendingReviews() {
  const rows = await prisma.review.findMany({
    where: { status: 'PENDING' },
    include: { user: { select: { firstName: true, lastName: true } }, property: { select: { title: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    stars: r.stars,
    text: r.text,
    authorName: `${r.user.firstName} ${r.user.lastName}`,
    propertyTitle: r.property?.title || 'Platform review',
    createdAt: r.createdAt,
  }));
}

async function moderateReview(id, status) {
  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) throw notFound('Review not found');
  return prisma.review.update({ where: { id }, data: { status } });
}

module.exports = { submitReview, listApprovedReviews, listPendingReviews, moderateReview };
