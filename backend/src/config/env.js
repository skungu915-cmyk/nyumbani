const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
const { z } = require('zod');

const isProd = process.env.NODE_ENV === 'production';

// Fail fast at boot if required secrets are missing or obviously placeholder values in production.
// This is deliberately strict: a misconfigured production deploy should refuse to start rather than
// silently run with a weak/default secret.
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  BACKEND_PUBLIC_URL: z.string().url(),
  FRONTEND_ORIGINS: z.string().min(1),
  DATABASE_URL: z.string().min(1),

  JWT_ACCESS_SECRET: z.string().min(isProd ? 32 : 16),
  JWT_REFRESH_SECRET: z.string().min(isProd ? 32 : 16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: z.coerce.boolean().default(isProd),
  CSRF_HEADER_NAME: z.string().default('x-livehere-csrf'),

  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),
  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().min(3).default(5),
  ACCOUNT_LOCK_MINUTES: z.coerce.number().int().min(1).default(15),

  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().optional().default(''),
  MPESA_CONSUMER_SECRET: z.string().optional().default(''),
  MPESA_SHORTCODE: z.string().optional().default('174379'),
  MPESA_PASSKEY: z.string().optional().default(''),
  MPESA_CALLBACK_URL: z.string().optional().default(''),
  MPESA_CALLBACK_IP_ALLOWLIST: z.string().optional().default(''),

  UNLOCK_FEE_KES: z.coerce.number().int().positive().default(1000),
  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(100).default(3),
  REFERRAL_REWARD_KES: z.coerce.number().int().min(0).default(200),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PHONE: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),

  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().optional().default(587),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM: z.string().optional().default('LiveHere Homes <no-reply@example.com>'),

  UPLOAD_DIR: z.string().default('uploads'),
  MAX_PHOTO_MB: z.coerce.number().positive().default(5),
  MAX_PHOTOS_PER_PROPERTY: z.coerce.number().int().positive().default(10),
  MAX_VIDEO_MB: z.coerce.number().positive().default(50),

  // Only used by the optional Netlify deployment's one-time DB bootstrap route (see
  // backend/src/routes/bootstrap.routes.js) — leave unset for the primary Node/Express deployment,
  // which uses `prisma migrate deploy` directly and never mounts that route at all.
  BOOTSTRAP_SECRET: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid/missing environment configuration:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

const DEFAULT_SECRET_MARKERS = ['replace-with', 'changeme', 'change-me'];
if (isProd) {
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const val = env[key].toLowerCase();
    if (DEFAULT_SECRET_MARKERS.some((m) => val.includes(m))) {
      // eslint-disable-next-line no-console
      console.error(`Refusing to start in production with a placeholder ${key}. Generate a real secret.`);
      process.exit(1);
    }
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
    // eslint-disable-next-line no-console
    console.error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
    process.exit(1);
  }
}

env.frontendOrigins = env.FRONTEND_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
env.mpesaCallbackIpAllowlist = env.MPESA_CALLBACK_IP_ALLOWLIST
  ? env.MPESA_CALLBACK_IP_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean)
  : [];
env.isProd = isProd;

module.exports = env;
