-- Seeds the Netlify DB demo deployment with an admin account, platform settings, a demo landlord,
-- a demo tenant, and three demo properties (matching backend/prisma/seed.js's SEED_DEMO_DATA=true
-- output) — since this deployment has no shared filesystem to run that script's own node process
-- against, this reaches the same end state via Netlify's native SQL migration runner instead.
-- Passwords below are pre-computed bcrypt hashes (cost 12) of the documented demo passwords —
-- see README.md "Netlify demo deployment" for the actual credentials.
-- Idempotent: every insert is ON CONFLICT DO NOTHING, safe to apply more than once.

INSERT INTO "PlatformSetting" ("id", "unlockFeeKes", "platformFeePercent", "referralRewardKes", "mpesaPaymentDestination", "updatedAt")
VALUES ('singleton', 1000, 3, 200, '174379', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Admin — email admin@example.com / password AdminDemo123!
INSERT INTO "User" ("id", "email", "phone", "passwordHash", "role", "firstName", "lastName", "isEmailVerified", "referralCode", "createdAt", "updatedAt")
VALUES ('eb16fc09-e85e-45b3-ad7f-e803d622c35a', 'admin@example.com', '+254700000000', '$2a$12$afCYAoavPXHQQxFU5aFK9OwhjwI.GZCRX3ZOZPC2yH20Uz/lC1yzi', 'ADMIN', 'Platform', 'Admin', true, 'LH-ADM001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Demo landlord — demo.landlord@example.com / DemoPass123!
INSERT INTO "User" ("id", "email", "phone", "passwordHash", "role", "firstName", "lastName", "isEmailVerified", "referralCode", "mpesaPayoutNumber", "createdAt", "updatedAt")
VALUES ('d6832322-3088-47ea-ac21-0813be77878d', 'demo.landlord@example.com', '+254711000001', '$2a$12$bk241hi8Y50YkHytnxeJZOglL8O7BG6iTaobDSo26MwOsuf34BUKK', 'LANDLORD', 'Grace', 'Achieng', true, 'LH-LL0001', '+254711000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Demo tenant — demo.tenant@example.com / DemoPass123!
INSERT INTO "User" ("id", "email", "phone", "passwordHash", "role", "firstName", "lastName", "isEmailVerified", "referralCode", "createdAt", "updatedAt")
VALUES ('f895815e-2fb0-45a1-8dec-d2cdce9c5e89', 'demo.tenant@example.com', '+254711000002', '$2a$12$bk241hi8Y50YkHytnxeJZOglL8O7BG6iTaobDSo26MwOsuf34BUKK', 'TENANT', 'Wanjiru', 'Kamau', true, 'LH-TN0001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Property" ("id", "ownerId", "title", "type", "rentAmount", "bedrooms", "bathrooms", "parkingSpaces", "area", "county", "description", "amenities", "status", "viewingFeeKes", "isSelfListed", "exactAddress", "ownerName", "ownerPhone", "createdAt", "updatedAt")
VALUES ('b1eac1bf-29f1-48d1-a14c-2361162964af', 'd6832322-3088-47ea-ac21-0813be77878d', 'Modern 2 Bedroom Apartment', 'TWO_BED', 45000, 2, 2, 1, 'Westlands, Nairobi', 'Nairobi',
  'Stylish, light-filled 2-bedroom apartment in a secure Westlands compound. Walking distance to Sarit Centre and top schools. 24hr water, backup generator, allocated parking, and fibre-ready.',
  ARRAY['WiFi','Parking','Security','CCTV','Water 24hr','Generator'], 'ACTIVE', 1000, true,
  'Apt 4C, Acacia Court, Church Road, Westlands', 'Grace Achieng', '+254711000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Property" ("id", "ownerId", "title", "type", "rentAmount", "bedrooms", "bathrooms", "parkingSpaces", "area", "county", "description", "amenities", "status", "viewingFeeKes", "isSelfListed", "exactAddress", "ownerName", "ownerPhone", "createdAt", "updatedAt")
VALUES ('8947059a-ffec-4c7b-b3dc-573ac02446ac', 'd6832322-3088-47ea-ac21-0813be77878d', 'Cosy Studio near Yaya Centre', 'STUDIO', 22000, 0, 1, 0, 'Kilimani, Nairobi', 'Nairobi',
  'Clean, well-maintained studio in a quiet Kilimani compound. Perfect for young professionals. Near Yaya Centre and Kilimani police station. Security guard on-site 24/7.',
  ARRAY['Security','Water 24hr','Furnished'], 'ACTIVE', 1000, true,
  'Studio 12, Kilimani Heights, Wood Avenue, Kilimani', 'Grace Achieng', '+254711000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Property" ("id", "ownerId", "title", "type", "rentAmount", "bedrooms", "bathrooms", "parkingSpaces", "area", "county", "description", "amenities", "status", "viewingFeeKes", "isSelfListed", "exactAddress", "ownerName", "ownerPhone", "createdAt", "updatedAt")
VALUES ('0cb6ca10-81fa-4bb3-b761-0e07bfe82971', 'd6832322-3088-47ea-ac21-0813be77878d', 'Spacious 3 Bedroom Family Home', 'THREE_BED', 85000, 3, 3, 2, 'Karen, Nairobi', 'Nairobi',
  'Beautiful family home in a gated Karen estate with a private garden. Close to top international schools and the Karen shopping centre. Borehole water and a DSQ included.',
  ARRAY['Parking','Security','Borehole','DSQ','Furnished'], 'PENDING_REVIEW', 1000, true,
  'Plot 22, Marula Lane, Karen', 'Grace Achieng', '+254711000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Fabricated SUCCESS payment + Unlock so the demo tenant can see the unlocked-contact view
-- immediately, without needing real M-Pesa sandbox credentials configured.
INSERT INTO "Payment" ("id", "userId", "propertyId", "type", "amountKes", "phoneNumber", "status", "checkoutRequestId", "mpesaReceiptNumber", "resultCode", "resultDesc", "createdAt", "updatedAt")
VALUES ('ef244e57-cf35-4415-9a5a-802ef17b9c7f', 'f895815e-2fb0-45a1-8dec-d2cdce9c5e89', 'b1eac1bf-29f1-48d1-a14c-2361162964af', 'UNLOCK', 1000, '254711000002', 'SUCCESS', 'seed-demo-netlify-001', 'DEMO1SEED2X', 0, 'Seeded demo payment — not a real M-Pesa transaction', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Unlock" ("id", "userId", "propertyId", "paymentId", "createdAt")
VALUES ('31d1acf4-07ae-4042-94f1-7e9ad432e6ae', 'f895815e-2fb0-45a1-8dec-d2cdce9c5e89', 'b1eac1bf-29f1-48d1-a14c-2361162964af', 'ef244e57-cf35-4415-9a5a-802ef17b9c7f', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Review" ("id", "userId", "propertyId", "stars", "text", "status", "createdAt")
VALUES ('2832d56b-5ab1-4308-99dd-ab9859b3c054', 'f895815e-2fb0-45a1-8dec-d2cdce9c5e89', 'b1eac1bf-29f1-48d1-a14c-2361162964af', 5, 'Exactly as described — Grace was responsive and the apartment is spotless. Highly recommend!', 'APPROVED', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Review" ("id", "userId", "propertyId", "stars", "text", "status", "createdAt")
VALUES ('0ab2a751-8271-4f66-bde1-ecfa4ba8ff82', 'f895815e-2fb0-45a1-8dec-d2cdce9c5e89', NULL, 5, 'Found my place in two days. Paying to unlock the contact was worth it — no time wasted on fake listings.', 'APPROVED', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
