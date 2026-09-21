const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMsisdn } = require('../src/services/mpesa.service');

test('normalizes 07XXXXXXXX to 2547XXXXXXXX', () => {
  assert.equal(normalizeMsisdn('0712345678'), '254712345678');
});

test('normalizes bare 7XXXXXXXX to 2547XXXXXXXX', () => {
  assert.equal(normalizeMsisdn('712345678'), '254712345678');
});

test('accepts already-normalized 2547XXXXXXXX', () => {
  assert.equal(normalizeMsisdn('254712345678'), '254712345678');
});

test('accepts 01XXXXXXXX Safaricom numbers', () => {
  assert.equal(normalizeMsisdn('0112345678'), '254112345678');
});

test('rejects garbage input', () => {
  assert.throws(() => normalizeMsisdn('not-a-phone'));
});

test('rejects a non-Kenyan-looking number', () => {
  assert.throws(() => normalizeMsisdn('+14155552671'));
});
