const prisma = require('../lib/prisma');
const env = require('../config/env');

// Admin-editable, non-secret platform settings, persisted as a singleton row. Falls back to env
// defaults on first run (see prisma/seed.js which creates the row) so callers never need a null check.
async function getSettings() {
  const settings = await prisma.platformSetting.findUnique({ where: { id: 'singleton' } });
  if (settings) return settings;
  return prisma.platformSetting.create({
    data: {
      unlockFeeKes: env.UNLOCK_FEE_KES,
      platformFeePercent: env.PLATFORM_FEE_PERCENT,
      referralRewardKes: env.REFERRAL_REWARD_KES,
      mpesaPaymentDestination: env.MPESA_SHORTCODE,
    },
  });
}

const PUBLIC_SETTING_FIELDS = [
  'platformName',
  'supportEmail',
  'supportPhone',
  'unlockFeeKes',
  'referralRewardKes',
  'watermarkPhotos',
  'selfListingPublic',
  'referralProgramActive',
  'mpesaBusinessName',
];

function toPublicSettings(settings) {
  const out = {};
  for (const key of PUBLIC_SETTING_FIELDS) out[key] = settings[key];
  return out;
}

async function updateSettings(patch) {
  await getSettings();
  return prisma.platformSetting.update({ where: { id: 'singleton' }, data: patch });
}

module.exports = { getSettings, toPublicSettings, updateSettings };
