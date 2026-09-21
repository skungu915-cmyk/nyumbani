const crypto = require('crypto');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const {
  hashPassword,
  verifyPassword,
  generateOpaqueToken,
  hashOpaqueToken,
} = require('../utils/passwords');
const {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  refreshTtlMs,
} = require('../utils/tokens');
const { badRequest, unauthorized, conflict } = require('../utils/http-errors');
const { sendVerificationEmail, sendPasswordResetEmail } = require('./email.service');
const logger = require('../lib/logger');

function generateReferralCode() {
  return 'LH-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

async function uniqueReferralCode() {
  for (let i = 0; i < 5; i += 1) {
    const code = generateReferralCode();
    // eslint-disable-next-line no-await-in-loop
    const existing = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!existing) return code;
  }
  return generateReferralCode() + Date.now().toString(36).toUpperCase();
}

async function signup(input, meta) {
  const { email, phone, password, role, firstName, lastName, referralCode, agencyName, yearsExperience, operatingAreas } = input;

  const [existingEmail, existingPhone] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { phone } }),
  ]);
  if (existingEmail || existingPhone) {
    // Deliberately generic — do not reveal *which* field collided (email vs phone enumeration).
    throw conflict('An account with these details already exists');
  }

  let referredByUserId = null;
  if (referralCode) {
    const referrer = await prisma.user.findUnique({ where: { referralCode } });
    if (referrer) referredByUserId = referrer.id;
    // An invalid/unknown referral code is silently ignored rather than erroring — it's not worth
    // blocking signup over, and we never confirm/deny which codes are valid to an anonymous caller.
  }

  const passwordHash = await hashPassword(password);
  const myReferralCode = await uniqueReferralCode();
  const { raw: verifyRaw, hash: verifyHash } = generateOpaqueToken();

  const user = await prisma.user.create({
    data: {
      email,
      phone,
      passwordHash,
      role,
      firstName,
      lastName,
      referralCode: myReferralCode,
      referredByUserId,
      agencyName: role === 'LANDLORD' ? agencyName || null : null,
      yearsExperience: role === 'LANDLORD' ? yearsExperience || null : null,
      operatingAreas: role === 'LANDLORD' ? operatingAreas || null : null,
      emailVerifyTokenHash: verifyHash,
      emailVerifyExpires: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  // Referral REWARD is intentionally NOT created here — a referral only pays out once the referred
  // user completes a real, verified payment (see payments.service.recordSuccessfulUnlock). Crediting
  // it at signup time (as the original mockup did) would let anyone farm rewards with fake signups.

  sendVerificationEmail(user, verifyRaw).catch((err) => logger.warn({ err }, 'Failed to send verification email'));

  const tokens = await issueSession(user, meta);
  return { user, ...tokens };
}

async function issueSession(user, meta) {
  const accessToken = signAccessToken(user);
  const { raw, hash } = generateRefreshToken();
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hash,
      userAgent: meta?.userAgent?.slice(0, 255),
      ip: meta?.ip,
      expiresAt: new Date(Date.now() + refreshTtlMs()),
    },
  });
  return { accessToken, refreshToken: raw };
}

async function login({ identifier, password }, meta) {
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }] },
  });

  // Uniform response for "no such user" and "wrong password" to prevent account enumeration.
  const invalid = () => unauthorized('Invalid email/phone or password');

  if (!user) {
    // Burn roughly the same time as a real bcrypt compare so response timing doesn't leak
    // whether the account exists.
    await verifyPassword(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    throw invalid();
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw unauthorized('Account temporarily locked due to repeated failed attempts. Try again later.');
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const locked = attempts >= env.MAX_FAILED_LOGIN_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: locked ? 0 : attempts,
        lockedUntil: locked ? new Date(Date.now() + env.ACCOUNT_LOCK_MINUTES * 60 * 1000) : null,
      },
    });
    throw invalid();
  }

  if (user.status !== 'active') {
    throw unauthorized('This account has been suspended. Contact support.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });

  const tokens = await issueSession(user, meta);
  return { user, ...tokens };
}

// Refresh-token rotation with reuse detection: every refresh consumes the old token and issues a
// brand-new one. If a token that was already revoked/replaced is presented again, that's a strong
// signal it was stolen and already used by someone else — so we nuke every session for that user.
async function refresh(rawToken, meta) {
  if (!rawToken) throw unauthorized('No refresh token provided');
  const hash = hashRefreshToken(rawToken);
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });

  if (!record) throw unauthorized('Invalid refresh token');

  if (record.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn({ userId: record.userId }, 'Refresh token reuse detected — all sessions revoked');
    throw unauthorized('Session invalidated. Please log in again.');
  }

  if (record.expiresAt < new Date()) throw unauthorized('Refresh token expired');
  if (record.user.status !== 'active') throw unauthorized('Account not active');

  const { raw, hash: newHash } = generateRefreshToken();
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date(), replacedByTokenHash: newHash },
    }),
    prisma.refreshToken.create({
      data: {
        userId: record.userId,
        tokenHash: newHash,
        userAgent: meta?.userAgent?.slice(0, 255),
        ip: meta?.ip,
        expiresAt: new Date(Date.now() + refreshTtlMs()),
      },
    }),
  ]);

  const accessToken = signAccessToken(record.user);
  return { user: record.user, accessToken, refreshToken: raw };
}

async function logout(rawToken) {
  if (!rawToken) return;
  const hash = hashRefreshToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function logoutAll(userId) {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

async function verifyEmail(rawToken) {
  const hash = hashOpaqueToken(rawToken);
  const user = await prisma.user.findFirst({ where: { emailVerifyTokenHash: hash } });
  if (!user || !user.emailVerifyExpires || user.emailVerifyExpires < new Date()) {
    throw badRequest('Invalid or expired verification link');
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { isEmailVerified: true, emailVerifyTokenHash: null, emailVerifyExpires: null },
  });
}

async function requestPasswordReset(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return; // Do not reveal whether the email exists.
  const { raw, hash } = generateOpaqueToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetTokenHash: hash, passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000) },
  });
  sendPasswordResetEmail(user, raw).catch((err) => logger.warn({ err }, 'Failed to send reset email'));
}

async function resetPassword(rawToken, newPassword) {
  const hash = hashOpaqueToken(rawToken);
  const user = await prisma.user.findFirst({ where: { passwordResetTokenHash: hash } });
  if (!user || !user.passwordResetExpires || user.passwordResetExpires < new Date()) {
    throw badRequest('Invalid or expired reset link');
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetTokenHash: null,
      passwordResetExpires: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  // A password reset invalidates every existing session — if an attacker had a stolen refresh
  // token, this cuts it off.
  await logoutAll(user.id);
}

module.exports = {
  signup,
  login,
  refresh,
  logout,
  logoutAll,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  issueSession,
};
