const prisma = require('../lib/prisma');
const { hashPassword } = require('../utils/passwords');
const { notFound, conflict } = require('../utils/http-errors');
const { toPublicUser } = require('./user.service');

async function writeAudit({ actorId, action, entityType, entityId, metadata, ip }) {
  await prisma.auditLog.create({
    data: { actorId: actorId || null, action, entityType, entityId: entityId || null, metadata: metadata || undefined, ip },
  });
}

function monthBounds(offsetMonths = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 1);
  return { start, end };
}

async function getOverview() {
  const { start, end } = monthBounds(0);
  const [monthPayments, allPayments, activeListings, pendingListings] = await Promise.all([
    prisma.payment.findMany({ where: { status: 'SUCCESS', createdAt: { gte: start, lt: end } } }),
    prisma.payment.findMany({ where: { createdAt: { gte: start, lt: end } } }),
    prisma.property.count({ where: { status: 'ACTIVE' } }),
    prisma.property.count({ where: { status: 'PENDING_REVIEW' } }),
  ]);
  const monthRevenue = monthPayments.reduce((s, p) => s + p.amountKes, 0);
  const settled = allPayments.filter((p) => p.status === 'SUCCESS' || p.status === 'FAILED');
  const successRate = settled.length ? Math.round((monthPayments.length / settled.length) * 100) : 0;

  const recentTx = await prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { property: { select: { title: true } } },
  });

  return {
    monthRevenue,
    paymentCount: monthPayments.length,
    activeListings,
    pendingListings,
    paymentSuccessRate: successRate,
    recentTransactions: recentTx.map(serializeTx),
  };
}

function serializeTx(p) {
  return {
    id: p.id,
    ref: p.id.slice(0, 8).toUpperCase(),
    phone: p.phoneNumber.replace(/(\d{6})\d{3}(\d+)/, '$1***$2'),
    property: p.property?.title || '—',
    amountKes: p.amountKes,
    mpesaReceiptNumber: p.mpesaReceiptNumber,
    status: p.status,
    createdAt: p.createdAt,
  };
}

async function listTransactions({ q, status, page = 1, pageSize = 20 }) {
  const where = {};
  if (status) where.status = status;
  if (q) {
    where.OR = [
      { phoneNumber: { contains: q } },
      { mpesaReceiptNumber: { contains: q, mode: 'insensitive' } },
      { property: { title: { contains: q, mode: 'insensitive' } } },
    ];
  }
  const skip = (page - 1) * pageSize;
  const [total, rows] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: { property: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);
  return { total, items: rows.map(serializeTx) };
}

// Manual reconciliation for edge cases (e.g. tenant paid but the callback never arrived and the
// STK query confirms success on Safaricom's side). Deliberately narrow: it can only move a PENDING
// payment to SUCCESS, never fabricate a brand-new payment, and it is fully audited.
async function markTransactionPaid(paymentId, actor, reason) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw notFound('Payment not found');
  if (payment.status !== 'PENDING') throw conflict('Only pending payments can be manually marked paid');

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: 'SUCCESS', resultCode: 0, resultDesc: `Manually confirmed by admin: ${reason}` },
    });
    if (payment.propertyId) {
      await tx.unlock.upsert({
        where: { userId_propertyId: { userId: payment.userId, propertyId: payment.propertyId } },
        update: {},
        create: { userId: payment.userId, propertyId: payment.propertyId, paymentId: payment.id },
      });
    }
  });

  await writeAudit({
    actorId: actor.id,
    action: 'payment.manual_confirm',
    entityType: 'Payment',
    entityId: paymentId,
    metadata: { reason },
  });
}

async function listLandlords() {
  const landlords = await prisma.user.findMany({
    where: { role: 'LANDLORD' },
    include: { properties: { select: { id: true } } },
  });
  const settings = await prisma.platformSetting.findUnique({ where: { id: 'singleton' } });
  const feePercent = settings?.platformFeePercent ?? 3;

  const results = [];
  for (const landlord of landlords) {
    const propertyIds = landlord.properties.map((p) => p.id);
    // eslint-disable-next-line no-await-in-loop
    const payments = await prisma.rentPayment.findMany({ where: { tenancy: { propertyId: { in: propertyIds } } } });
    const revenue = payments.reduce((s, p) => s + p.amountKes, 0);
    results.push({
      id: landlord.id,
      name: `${landlord.firstName} ${landlord.lastName}`,
      phone: landlord.phone,
      units: propertyIds.length,
      revenue,
      platformFeeDue: Math.round((revenue * feePercent) / 100),
      status: landlord.status,
    });
  }
  return results;
}

async function listUsers({ q, role, page = 1, pageSize = 20 }) {
  const where = {};
  if (role) where.role = role;
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
    ];
  }
  const skip = (page - 1) * pageSize;
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: pageSize }),
  ]);
  return { total, items: rows.map(toPublicUser) };
}

async function setUserStatus(userId, status, actor) {
  const user = await prisma.user.update({ where: { id: userId }, data: { status } });
  await writeAudit({ actorId: actor.id, action: `user.${status}`, entityType: 'User', entityId: userId });
  return toPublicUser(user);
}

async function createStaffUser(input, actor) {
  const [existingEmail, existingPhone] = await Promise.all([
    prisma.user.findUnique({ where: { email: input.email } }),
    prisma.user.findUnique({ where: { phone: input.phone } }),
  ]);
  if (existingEmail || existingPhone) throw conflict('A user with these details already exists');

  const passwordHash = await hashPassword(input.password);
  const crypto = require('crypto');
  const referralCode = 'LH-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const user = await prisma.user.create({
    data: {
      email: input.email,
      phone: input.phone,
      passwordHash,
      role: input.role,
      firstName: input.firstName,
      lastName: input.lastName,
      referralCode,
      isEmailVerified: true,
    },
  });
  await writeAudit({ actorId: actor.id, action: 'user.create_staff', entityType: 'User', entityId: user.id, metadata: { role: input.role } });
  return toPublicUser(user);
}

module.exports = {
  getOverview,
  listTransactions,
  markTransactionPaid,
  listLandlords,
  listUsers,
  setUserStatus,
  createStaffUser,
  writeAudit,
};
