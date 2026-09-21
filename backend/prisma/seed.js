const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');

const prisma = new PrismaClient();

function randomPassword() {
  return crypto.randomBytes(12).toString('base64url') + 'Aa1!';
}

function referralCode() {
  return 'LH-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function seedCore() {
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
    console.log(`Admin ${email} already exists — skipping core seed.`);
    return existing;
  }

  const password = process.env.SEED_ADMIN_PASSWORD || randomPassword();
  const passwordHash = await bcrypt.hash(password, Number(process.env.BCRYPT_COST) || 12);

  const admin = await prisma.user.create({
    data: {
      email,
      phone,
      passwordHash,
      role: 'ADMIN',
      firstName: 'Platform',
      lastName: 'Admin',
      isEmailVerified: true,
      referralCode: referralCode(),
    },
  });

  console.log('----------------------------------------------------');
  console.log('Admin account created:');
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log('Store this password somewhere safe now — it will not be shown again.');
  console.log('----------------------------------------------------');
  return admin;
}

// Generates a small solid-colour placeholder JPEG in-process (no network access needed) and runs
// it through the real upload pipeline (processPhoto), so demo listings have an actual photo
// served from /media/properties/... exactly like a real upload would be.
async function placeholderPhoto([r, g, b]) {
  // Lazy-require so `node prisma/seed.js` in a minimal/production install without demo mode
  // enabled never needs upload.service's other dependencies loaded.
  const { processPhoto } = require('../src/services/upload.service');
  const buffer = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r, g, b } } })
    .jpeg()
    .toBuffer();
  return processPhoto(buffer);
}

const DEMO_PASSWORD = 'DemoPass123!';

async function seedDemoData(adminId) {
  const existingLandlord = await prisma.user.findUnique({ where: { email: 'demo.landlord@example.com' } });
  if (existingLandlord) {
    console.log('Demo data already present — skipping.');
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, Number(process.env.BCRYPT_COST) || 12);

  const landlord = await prisma.user.create({
    data: {
      email: 'demo.landlord@example.com',
      phone: '+254711000001',
      passwordHash,
      role: 'LANDLORD',
      firstName: 'Grace',
      lastName: 'Achieng',
      isEmailVerified: true,
      referralCode: referralCode(),
      mpesaPayoutNumber: '+254711000001',
    },
  });

  const tenant = await prisma.user.create({
    data: {
      email: 'demo.tenant@example.com',
      phone: '+254711000002',
      passwordHash,
      role: 'TENANT',
      firstName: 'Wanjiru',
      lastName: 'Kamau',
      isEmailVerified: true,
      referralCode: referralCode(),
    },
  });

  const propertiesData = [
    {
      title: 'Modern 2 Bedroom Apartment',
      type: 'TWO_BED',
      rentAmount: 45000,
      bedrooms: 2,
      bathrooms: 2,
      parkingSpaces: 1,
      area: 'Westlands, Nairobi',
      description:
        'Stylish, light-filled 2-bedroom apartment in a secure Westlands compound. Walking distance to Sarit Centre and top schools. 24hr water, backup generator, allocated parking, and fibre-ready.',
      amenities: ['WiFi', 'Parking', 'Security', 'CCTV', 'Water 24hr', 'Generator'],
      exactAddress: 'Apt 4C, Acacia Court, Church Road, Westlands',
      ownerName: 'Grace Achieng',
      ownerPhone: '+254711000001',
      status: 'ACTIVE',
      color: [3, 171, 162],
    },
    {
      title: 'Cosy Studio near Yaya Centre',
      type: 'STUDIO',
      rentAmount: 22000,
      bedrooms: 0,
      bathrooms: 1,
      parkingSpaces: 0,
      area: 'Kilimani, Nairobi',
      description:
        'Clean, well-maintained studio in a quiet Kilimani compound. Perfect for young professionals. Near Yaya Centre and Kilimani police station. Security guard on-site 24/7.',
      amenities: ['Security', 'Water 24hr', 'Furnished'],
      exactAddress: 'Studio 12, Kilimani Heights, Wood Avenue, Kilimani',
      ownerName: 'Grace Achieng',
      ownerPhone: '+254711000001',
      status: 'ACTIVE',
      color: [252, 184, 55],
    },
    {
      title: 'Spacious 3 Bedroom Family Home',
      type: 'THREE_BED',
      rentAmount: 85000,
      bedrooms: 3,
      bathrooms: 3,
      parkingSpaces: 2,
      area: 'Karen, Nairobi',
      description:
        'Beautiful family home in a gated Karen estate with a private garden. Close to top international schools and the Karen shopping centre. Borehole water and a DSQ included.',
      amenities: ['Parking', 'Security', 'Borehole', 'DSQ', 'Furnished'],
      exactAddress: 'Plot 22, Marula Lane, Karen',
      ownerName: 'Grace Achieng',
      ownerPhone: '+254711000001',
      status: 'PENDING_REVIEW', // deliberately left pending, to demo the admin moderation queue
      color: [55, 151, 225],
    },
  ];

  const created = [];
  for (const p of propertiesData) {
    const { color, ...data } = p;
    // eslint-disable-next-line no-await-in-loop
    const property = await prisma.property.create({
      data: {
        ownerId: landlord.id,
        isSelfListed: true,
        viewingFeeKes: 1000,
        county: 'Nairobi',
        ...data,
      },
    });
    // Skip generating/writing a local photo file when seeding a database that a serverless
    // deployment (no persistent local disk) will actually serve from — e.g. seeding a Netlify DB
    // directly from a different machine. The frontend already falls back to a placeholder image
    // for a photo-less listing, so this keeps the demo looking correct either way.
    // eslint-disable-next-line no-await-in-loop
    const filename = process.env.SEED_SKIP_PHOTOS === 'true' ? null : await placeholderPhoto(color).catch(() => null);
    if (filename) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.propertyPhoto.create({ data: { propertyId: property.id, filename, isPrimary: true } });
    }
    created.push(property);
  }

  // Give the demo tenant a genuine, fully-modelled unlock on the first property (fabricated
  // Payment/Unlock rows, inserted directly here in the seed script — NOT reachable through any
  // application code path — so the pay-gate vs. unlocked-contact UI can both be demoed without
  // needing real M-Pesa sandbox credentials configured).
  const unlockedProperty = created[0];
  const payment = await prisma.payment.create({
    data: {
      userId: tenant.id,
      propertyId: unlockedProperty.id,
      type: 'UNLOCK',
      amountKes: unlockedProperty.viewingFeeKes,
      phoneNumber: '254711000002',
      status: 'SUCCESS',
      checkoutRequestId: `seed-demo-${crypto.randomUUID()}`,
      mpesaReceiptNumber: 'DEMO1SEED2X',
      resultCode: 0,
      resultDesc: 'Seeded demo payment — not a real M-Pesa transaction',
    },
  });
  await prisma.unlock.create({
    data: { userId: tenant.id, propertyId: unlockedProperty.id, paymentId: payment.id },
  });

  await prisma.review.createMany({
    data: [
      { userId: tenant.id, propertyId: unlockedProperty.id, stars: 5, text: 'Exactly as described — Grace was responsive and the apartment is spotless. Highly recommend!', status: 'APPROVED' },
      { userId: tenant.id, propertyId: null, stars: 5, text: 'Found my place in two days. Paying to unlock the contact was worth it — no time wasted on fake listings.', status: 'APPROVED' },
    ],
  });

  console.log('----------------------------------------------------');
  console.log('Demo data created:');
  console.log(`  Landlord login:  demo.landlord@example.com / ${DEMO_PASSWORD}`);
  console.log(`  Tenant login:    demo.tenant@example.com / ${DEMO_PASSWORD}`);
  console.log(`  ${created.length} demo properties (2 active, 1 pending review for the admin queue)`);
  console.log('  Tenant already has one property unlocked — log in as the tenant and open');
  console.log(`  "${unlockedProperty.title}" to see the unlocked-contact view immediately.`);
  console.log('----------------------------------------------------');
}

async function main() {
  const admin = await seedCore();
  if (process.env.SEED_DEMO_DATA === 'true') {
    await seedDemoData(admin?.id);
  } else {
    console.log('Set SEED_DEMO_DATA=true to also seed demo listings/accounts for local testing.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
