const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const pinoHttp = require('pino-http');

const env = require('./config/env');
const logger = require('./lib/logger');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const propertyRoutes = require('./routes/properties.routes');
const paymentRoutes = require('./routes/payments.routes');
const reviewRoutes = require('./routes/reviews.routes');
const referralRoutes = require('./routes/referrals.routes');
const enquiryRoutes = require('./routes/enquiries.routes');
const landlordRoutes = require('./routes/landlord.routes');
const adminRoutes = require('./routes/admin.routes');
const publicRoutes = require('./routes/public.routes');

const app = express();

// We're behind a reverse proxy (nginx/load balancer) in any real deployment; trust exactly one hop
// so req.ip / req.secure reflect the real client without letting a spoofed X-Forwarded-For through
// from further upstream.
app.set('trust proxy', 1);

app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/health' } }));

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // Frontend JS uses addEventListener, not inline handlers, so no 'unsafe-inline' is needed.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", ...env.frontendOrigins],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"], // clickjacking protection — nothing may iframe this app
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: env.isProd ? { maxAge: 15552000, includeSubDomains: true, preload: true } : false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      // Allow same-origin/non-browser requests (no Origin header) and configured frontend origins only.
      if (!origin || env.frontendOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', env.CSRF_HEADER_NAME],
  })
);

app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(apiLimiter);

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Publicly servable, already-validated/re-encoded property media. Never serves anything else from
// disk — the upload service is the only writer to this directory, and filenames are server-generated
// UUIDs (no user-controlled path segments reach the filesystem).
app.use(
  '/media',
  express.static(path.join(__dirname, '..', env.UPLOAD_DIR), {
    dotfiles: 'deny',
    index: false,
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    },
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/enquiries', enquiryRoutes);
app.use('/api/landlord', landlordRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);

// Only mounted when BOOTSTRAP_SECRET is configured — see backend/src/routes/bootstrap.routes.js.
// The primary Node/Express deployment never sets that var, so this route doesn't exist there.
if (env.BOOTSTRAP_SECRET) {
  app.use('/api/_bootstrap', require('./routes/bootstrap.routes'));
}

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
