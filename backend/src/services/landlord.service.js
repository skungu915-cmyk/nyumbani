const prisma = require('../lib/prisma');
const { getSettings } = require('./settings.service');
const { notFound, forbidden } = require('../utils/http-errors');

async function assertOwnsProperty(propertyId, ownerId) {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw notFound('Property not found');
  if (property.ownerId !== ownerId) throw forbidden('You do not own this property');
  return property;
}

function monthBounds(offsetMonths = 0) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1);
  const end = new Date(now.getFullYear(), now.getMonth() + offsetMonths + 1, 1);
  return { start, end };
}

async function getDashboard(ownerId) {
  const properties = await prisma.property.findMany({ where: { ownerId } });
  const propertyIds = properties.map((p) => p.id);
  const tenancies = await prisma.tenancy.findMany({ where: { propertyId: { in: propertyIds } } });

  const occupied = tenancies.filter((t) => t.status === 'active' || t.status === 'overdue').length;
  const overdue = tenancies.filter((t) => t.status === 'overdue');
  const arrears = overdue.reduce((s, t) => s + t.rentAmount, 0);

  const { start, end } = monthBounds(0);
  const rentPayments = await prisma.rentPayment.findMany({
    where: { tenancy: { propertyId: { in: propertyIds } }, paidAt: { gte: start, lt: end } },
  });
  const revenueThisMonth = rentPayments.reduce((s, p) => s + p.amountKes, 0);

  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const b = monthBounds(-i);
    // eslint-disable-next-line no-await-in-loop
    const payments = await prisma.rentPayment.findMany({
      where: { tenancy: { propertyId: { in: propertyIds } }, paidAt: { gte: b.start, lt: b.end } },
    });
    months.push({
      label: b.start.toLocaleString('en-KE', { month: 'short' }),
      totalKes: payments.reduce((s, p) => s + p.amountKes, 0),
    });
  }

  return {
    revenueThisMonth,
    totalUnits: properties.length,
    occupied,
    vacant: Math.max(0, properties.length - occupied),
    occupancyRate: properties.length ? Math.round((occupied / properties.length) * 100) : 0,
    arrears,
    overdueCount: overdue.length,
    monthlyRevenue: months,
  };
}

async function listTenancies(ownerId) {
  const properties = await prisma.property.findMany({ where: { ownerId }, select: { id: true } });
  const propertyIds = properties.map((p) => p.id);
  const tenancies = await prisma.tenancy.findMany({
    where: { propertyId: { in: propertyIds } },
    include: { property: { select: { title: true, area: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return tenancies;
}

async function createTenancy(ownerId, input) {
  await assertOwnsProperty(input.propertyId, ownerId);
  const tenancy = await prisma.tenancy.create({
    data: {
      propertyId: input.propertyId,
      tenantName: input.tenantName,
      tenantPhone: input.tenantPhone,
      rentAmount: input.rentAmount,
      leaseEnd: input.leaseEnd ? new Date(input.leaseEnd) : null,
    },
  });
  await prisma.property.update({ where: { id: input.propertyId }, data: { status: 'RENTED' } });
  return tenancy;
}

async function updateTenancyStatus(ownerId, tenancyId, status) {
  const tenancy = await prisma.tenancy.findUnique({ where: { id: tenancyId }, include: { property: true } });
  if (!tenancy) throw notFound('Tenancy not found');
  if (tenancy.property.ownerId !== ownerId) throw forbidden();
  return prisma.tenancy.update({ where: { id: tenancyId }, data: { status } });
}

async function recordRentPayment(ownerId, tenancyId, { amountKes, mpesaCode }) {
  const tenancy = await prisma.tenancy.findUnique({ where: { id: tenancyId }, include: { property: true } });
  if (!tenancy) throw notFound('Tenancy not found');
  if (tenancy.property.ownerId !== ownerId) throw forbidden();
  const payment = await prisma.rentPayment.create({ data: { tenancyId, amountKes, mpesaCode: mpesaCode || null } });
  await prisma.tenancy.update({ where: { id: tenancyId }, data: { status: 'active' } });
  return payment;
}

async function getRevenue(ownerId) {
  const properties = await prisma.property.findMany({ where: { ownerId }, select: { id: true } });
  const propertyIds = properties.map((p) => p.id);
  const payments = await prisma.rentPayment.findMany({ where: { tenancy: { propertyId: { in: propertyIds } } } });
  const allTime = payments.reduce((s, p) => s + p.amountKes, 0);
  const settings = await getSettings();
  const { start, end } = monthBounds(0);
  const thisMonth = payments.filter((p) => p.paidAt >= start && p.paidAt < end).reduce((s, p) => s + p.amountKes, 0);
  const platformFee = Math.round((thisMonth * settings.platformFeePercent) / 100);
  return { allTime, thisMonth, platformFeePercent: settings.platformFeePercent, platformFee, net: thisMonth - platformFee };
}

async function listMaintenance(ownerId) {
  const properties = await prisma.property.findMany({ where: { ownerId }, select: { id: true } });
  return prisma.maintenanceRequest.findMany({
    where: { propertyId: { in: properties.map((p) => p.id) } },
    include: { property: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

async function createMaintenance(ownerId, input) {
  await assertOwnsProperty(input.propertyId, ownerId);
  return prisma.maintenanceRequest.create({
    data: {
      propertyId: input.propertyId,
      createdById: ownerId,
      unitLabel: input.unitLabel || null,
      issue: input.issue,
      priority: input.priority || 'MEDIUM',
    },
  });
}

async function resolveMaintenance(ownerId, id) {
  const req_ = await prisma.maintenanceRequest.findUnique({ where: { id }, include: { property: true } });
  if (!req_) throw notFound('Request not found');
  if (req_.property.ownerId !== ownerId) throw forbidden();
  return prisma.maintenanceRequest.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
}

async function listNotices(landlordId) {
  return prisma.notice.findMany({ where: { landlordId }, orderBy: { createdAt: 'desc' } });
}

async function sendNotice(landlordId, input) {
  return prisma.notice.create({
    data: {
      landlordId,
      recipient: input.recipient,
      subject: input.subject,
      message: input.message,
      channel: input.channel || 'app',
    },
  });
}

module.exports = {
  getDashboard,
  listTenancies,
  createTenancy,
  updateTenancyStatus,
  recordRentPayment,
  getRevenue,
  listMaintenance,
  createMaintenance,
  resolveMaintenance,
  listNotices,
  sendNotice,
};
