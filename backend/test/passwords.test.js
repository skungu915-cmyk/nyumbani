const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isStrongPassword, hashPassword, verifyPassword } = require('../src/utils/passwords');

test('rejects short passwords', () => {
  assert.equal(isStrongPassword('Ab1!'), false);
});

test('rejects passwords with fewer than 3 character classes', () => {
  assert.equal(isStrongPassword('alllowercaseletters'), false);
});

test('accepts a password with length + 3 character classes', () => {
  assert.equal(isStrongPassword('Str0ngPass!23'), true);
});

test('hashPassword produces a verifiable, non-reversible hash', async () => {
  const hash = await hashPassword('Str0ngPass!23');
  assert.notEqual(hash, 'Str0ngPass!23');
  assert.equal(await verifyPassword('Str0ngPass!23', hash), true);
  assert.equal(await verifyPassword('WrongPassword!23', hash), false);
});
