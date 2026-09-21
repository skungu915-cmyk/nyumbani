const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

function randomPassword() {
  return crypto.randomBytes(12).toString('base64url') + 'Aa1!';
}

async function main() {
  await prisma.platformSetting.upsert({
    where: { id: 'singleton' },
    update: {},
    create: {
      unlockFeeKes: Number(process.env.UNLOCK_FEE_KES) || 1000,
      platformFeePercent: Number(process.env.PLATFORM_FEE_PERCENT) || 3,
      referralRewardKes: Number(process.env.REFERRAL_REWARD_KES) || 200,
      mpesaPaymentDestination: process.env.MPESA_SHORTCODE || '174379',
    },
  });
  console.log('Platform settings ready.');

  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const phone = process.env.SEED_ADMIN_PHONE || '+254700000000';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists — skipping.`);
    return;
  }

  const password = process.env.SEED_ADMIN_PASSWORD || randomPassword();
  const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_COST) || 12);
  const referralCode = 'LH-' + crypto.randomBytes(3).toString('hex').toUpperCase();

  await prisma.user.create({
    data: {
      email,
      phone,
      passwordHash,
      role: 'ADMIN',
      firstName: 'Platform',
      lastName: 'Admin',
      isEmailVerified: true,
      referralCode,
    },
  });

  console.log('----------------------------------------------------');
  console.log('Admin account created:');
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log('Store this password somewhere safe now — it will not be shown again.');
  console.log('----------------------------------------------------');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
