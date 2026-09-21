const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const env = require('../config/env');

async function hashPassword(plain) {
  return bcrypt.hash(plain, env.BCRYPT_COST);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// A single-use random token (e.g. email verification, password reset) is generated with a
// cryptographically strong RNG, returned to the caller once, and only its SHA-256 hash is
// persisted — same principle as a password: the DB never holds a usable secret.
function generateOpaqueToken() {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function hashOpaqueToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Minimal but real password policy: length + character-class diversity. Deliberately does not
// require a specific special character set (which pushes users toward predictable substitutions)
// but does require enough entropy to resist common wordlist attacks.
function isStrongPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10 || pw.length > 128) return false;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes += 1;
  if (/[A-Z]/.test(pw)) classes += 1;
  if (/[0-9]/.test(pw)) classes += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) classes += 1;
  return classes >= 3;
}

module.exports = { hashPassword, verifyPassword, generateOpaqueToken, hashOpaqueToken, isStrongPassword };
