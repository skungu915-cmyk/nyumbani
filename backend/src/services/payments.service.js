const prisma = require('../lib/prisma');
const mpesa = require('./mpesa.service');
const { getSettings } = require('./settings.service');
const { notFound, forbidden, badRequest, conflict } = require('../utils/http-errors');
const logger = require('../lib/logger');
const { creditReferralIfEligible } = require('./referrals.service');

// Initiates a REAL Daraja STK push and records a PENDING Payment row keyed by the CheckoutRequestID
// Safaricom gives back. Nothing is "unlocked" here — that only happens once the callback confirms
// success. This is the opposite of the mockup, where a setTimeout() unconditionally granted access
// after 6.8 seconds with no network call at all.
async function initiateUnlock({ userId, propertyId, phoneNumber }) {
  const property = await prisma.property.findUnique({ where: { id: propertyId } });
  if (!property) throw notFound('Property not found');

  const already = await prisma.unlock.findUnique({ where: { userId_propertyId: { userId, propertyId } } });
  if (already) throw conflict('You have already unlocked this property');

  const existingPending = await prisma.payment.findFirst({
    where: { userId, propertyId, type: 'UNLOCK', status: 'PENDING', createdAt: { gt: new Date(Date.now() - 2 * 60 * 1000) } },
  });
  if (existingPending) {
    throw badRequest('A payment request for this property is already in progress. Check your phone.');
  }

  const settings = await getSettings();
  const amountKes = property.viewingFeeKes || settings.unlockFeeKes;

  const { merchantRequestId, checkoutRequestId, normalizedPhone } = await mpesa.stkPush({
    phone: phoneNumber,
    amountKes,
    accountReference: `LH-${property.id.slice(0, 6)}`,
    transactionDesc: 'Viewing Fee',
  });

  const payment = await prisma.payment.create({
    data: {
      userId,
      propertyId,
      type: 'UNLOCK',
      amountKes,
      phoneNumber: normalizedPhone,
      status: 'PENDING',
      merchantRequestId,
      checkoutRequestId,
    },
  });

  return { paymentId: payment.id, checkoutRequestId };
}

// Called ONLY from the Safaricom callback route. `result` is Daraja's stkCallback payload.
// Idempotent by design: replays of the same CheckoutRequestID (Safaricom does retry callbacks)
// are safe because we check the current status before doing anything, and the Unlock row has a
// unique (userId, propertyId) constraint so a duplicate insert is a no-op-with-catch, not a bug.
async function handleStkCallback(stkCallback) {
  const { CheckoutRequestID, MerchantRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback || {};
  if (!CheckoutRequestID) {
    logger.warn({ stkCallback }, 'M-Pesa callback missing CheckoutRequestID — ignoring');
    return;
  }

  const payment = await prisma.payment.findUnique({ where: { checkoutRequestId: CheckoutRequestID } });
  if (!payment) {
    // We never initiated this CheckoutRequestID — do not create anything from an unsolicited callback.
    logger.warn({ CheckoutRequestID }, 'M-Pesa callback for unknown CheckoutRequestID — ignoring');
    return;
  }
  if (payment.status !== 'PENDING') {
    logger.info({ paymentId: payment.id, status: payment.status }, 'M-Pesa callback for already-settled payment — ignoring');
    return;
  }
  if (payment.merchantRequestId && MerchantRequestID && payment.merchantRequestId !== MerchantRequestID) {
    logger.warn({ paymentId: payment.id }, 'M-Pesa callback MerchantRequestID mismatch — ignoring');
    return;
  }

  const success = Number(ResultCode) === 0;
  let mpesaReceiptNumber = null;
  let amount = null;
  if (success && Array.isArray(CallbackMetadata?.Item)) {
    for (const item of CallbackMetadata.Item) {
      if (item.Name === 'MpesaReceiptNumber') mpesaReceiptNumber = item.Value;
      if (item.Name === 'Amount') amount = item.Value;
    }
  }

  if (!success) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', resultCode: Number(ResultCode), resultDesc: ResultDesc, rawCallback: stkCallback },
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SUCCESS',
        resultCode: 0,
        resultDesc: ResultDesc,
        mpesaReceiptNumber,
        rawCallback: stkCallback,
      },
    });

    if (payment.propertyId) {
      await tx.unlock.upsert({
        where: { userId_propertyId: { userId: payment.userId, propertyId: payment.propertyId } },
        update: {},
        create: { userId: payment.userId, propertyId: payment.propertyId, paymentId: payment.id },
      });
    }
  });

  logger.info({ paymentId: payment.id, mpesaReceiptNumber }, 'M-Pesa payment confirmed, property unlocked');

  // Referral reward is credited here — on a VERIFIED payment — not at signup, and not client-triggered.
  creditReferralIfEligible(payment.userId, payment.id).catch((err) =>
    logger.warn({ err }, 'Referral crediting failed')
  );
}

async function getPaymentStatus(paymentId, ctx) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw notFound('Payment not found');
  if (payment.userId !== ctx.userId && ctx.role !== 'ADMIN') throw forbidden();
  return {
    id: payment.id,
    status: payment.status,
    amountKes: payment.amountKes,
    mpesaReceiptNumber: payment.status === 'SUCCESS' ? payment.mpesaReceiptNumber : null,
    propertyId: payment.propertyId,
    createdAt: payment.createdAt,
  };
}

module.exports = { initiateUnlock, handleStkCallback, getPaymentStatus };
