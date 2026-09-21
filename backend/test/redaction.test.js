const { test } = require('node:test');
const assert = require('node:assert/strict');
const { serializeProperty } = require('../src/services/property.service');

// This is the single most important test in the codebase: it locks in the fix for the mockup's
// core flaw, where exactAddress/ownerName/ownerPhone shipped to every browser regardless of
// payment status. If this test ever fails, contact details are leaking to unpaid viewers.

const sampleProperty = {
  id: 'prop-1',
  ownerId: 'owner-1',
  title: 'Test Property',
  type: 'TWO_BED',
  rentAmount: 45000,
  bedrooms: 2,
  bathrooms: 2,
  parkingSpaces: 1,
  sizeSqm: null,
  floor: null,
  area: 'Westlands',
  county: 'Nairobi',
  description: 'A test property',
  amenities: ['WiFi'],
  status: 'ACTIVE',
  viewingFeeKes: 1000,
  isSelfListed: true,
  views: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  photos: [],
  videos: [],
  exactAddress: 'Secret Street 123',
  ownerName: 'Secret Owner',
  ownerPhone: '+254700000000',
  geoLat: -1.28,
  geoLng: 36.8,
};

test('anonymous caller never receives restricted fields', () => {
  const out = serializeProperty(sampleProperty, null);
  assert.equal(out.exactAddress, null);
  assert.equal(out.ownerName, null);
  assert.equal(out.ownerPhone, null);
  assert.equal(out.geoLat, null);
  assert.equal(out.geoLng, null);
  assert.equal(out.isUnlocked, false);
});

test('logged-in caller with no unlock record never receives restricted fields', () => {
  const out = serializeProperty(sampleProperty, { userId: 'some-other-user', role: 'TENANT', unlockedPropertyIds: new Set() });
  assert.equal(out.exactAddress, null);
  assert.equal(out.ownerPhone, null);
  assert.equal(out.isUnlocked, false);
});

test('caller with a verified unlock record receives restricted fields', () => {
  const out = serializeProperty(sampleProperty, {
    userId: 'payer-1',
    role: 'TENANT',
    unlockedPropertyIds: new Set(['prop-1']),
  });
  assert.equal(out.exactAddress, 'Secret Street 123');
  assert.equal(out.ownerPhone, '+254700000000');
  assert.equal(out.isUnlocked, true);
});

test('an unlock record for a DIFFERENT property does not unlock this one', () => {
  const out = serializeProperty(sampleProperty, {
    userId: 'payer-1',
    role: 'TENANT',
    unlockedPropertyIds: new Set(['some-other-property']),
  });
  assert.equal(out.exactAddress, null);
  assert.equal(out.isUnlocked, false);
});

test('the property owner always sees their own restricted fields', () => {
  const out = serializeProperty(sampleProperty, { userId: 'owner-1', role: 'LANDLORD', unlockedPropertyIds: new Set() });
  assert.equal(out.exactAddress, 'Secret Street 123');
  assert.equal(out.isOwner, true);
});

test('an admin always sees restricted fields, even without an unlock record', () => {
  const out = serializeProperty(sampleProperty, { userId: 'admin-1', role: 'ADMIN', unlockedPropertyIds: new Set() });
  assert.equal(out.exactAddress, 'Secret Street 123');
});

test('a landlord viewing someone else\'s property does not see restricted fields', () => {
  const out = serializeProperty(sampleProperty, { userId: 'other-landlord', role: 'LANDLORD', unlockedPropertyIds: new Set() });
  assert.equal(out.exactAddress, null);
  assert.equal(out.isOwner, false);
});
