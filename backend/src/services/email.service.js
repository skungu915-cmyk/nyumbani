const nodemailer = require('nodemailer');
const env = require('../config/env');
const logger = require('../lib/logger');

let transporter = null;
function getTransporter() {
  if (!env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

// If SMTP isn't configured (e.g. local dev), we log the email instead of failing signup/reset
// flows outright. In production, set SMTP_* so real emails go out.
async function sendMail({ to, subject, text, html }) {
  const t = getTransporter();
  if (!t) {
    logger.info({ to, subject, text }, 'SMTP not configured — logging email instead of sending');
    return;
  }
  await t.sendMail({ from: env.SMTP_FROM, to, subject, text, html });
}

async function sendVerificationEmail(user, rawToken) {
  const link = `${env.frontendOrigins[0] || ''}/verify-email?token=${rawToken}`;
  await sendMail({
    to: user.email,
    subject: 'Verify your LiveHere Homes account',
    text: `Hi ${user.firstName}, verify your email: ${link}\nThis link expires in 24 hours.`,
  });
}

async function sendPasswordResetEmail(user, rawToken) {
  const link = `${env.frontendOrigins[0] || ''}/reset-password?token=${rawToken}`;
  await sendMail({
    to: user.email,
    subject: 'Reset your LiveHere Homes password',
    text: `Hi ${user.firstName}, reset your password: ${link}\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
  });
}

module.exports = { sendMail, sendVerificationEmail, sendPasswordResetEmail };
