const prisma = require('../lib/prisma');
const { getSettings } = require('./settings.service');

// Credits the referrer the moment their referral's FIRST successful payment clears — never at
// signup (which the original mockup did, and which is trivially farmable with throwaway accounts).
// Idempotent: Referral.referredUserId is unique, so a second payment by the same referred user
// never creates a second reward.
async function creditReferralIfEligible(referredUserId, triggeringPaymentId) {
  const settings = await getSettings();
  if (!settings.referralProgramActive) return;

  const referredUser = await prisma.user.findUnique({ where: { id: referredUserId } });
  if (!referredUser || !referredUser.referredByUserId) return;

  const existing = await prisma.referral.findUnique({ where: { referredUserId } });
  if (existing) return;

  await prisma.referral.create({
    data: {
      referrerUserId: referredUser.referredByUserId,
      referredUserId,
      rewardKes: settings.referralRewardKes,
      status: 'PAID',
      triggeringPaymentId,
      paidAt: new Date(),
    },
  });
}

async function getReferralSummary(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const referrals = await prisma.referral.findMany({ where: { referrerUserId: userId } });
  const earned = referrals.filter((r) => r.status === 'PAID').reduce((s, r) => s + r.rewardKes, 0);
  const pending = referrals.filter((r) => r.status === 'PENDING').reduce((s, r) => s + r.rewardKes, 0);
  return {
    code: user.referralCode,
    count: referrals.length,
    earnedKes: earned,
    pendingKes: pending,
  };
}

module.exports = { creditReferralIfEligible, getReferralSummary };
