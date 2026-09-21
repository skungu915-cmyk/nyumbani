const { HttpError } = require('../utils/http-errors');
const logger = require('../lib/logger');
const env = require('../config/env');

// Centralized error handler — the ONLY place that turns an error into an HTTP response.
// Deliberately never leaks stack traces, SQL text, or internal error messages to the client in
// production; those go to the server log only.
function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    if (err.status >= 500) {
      logger.error({ err, path: req.path }, 'Server error');
    }
    return res.status(err.status).json({ error: err.message, details: err.details });
  }

  // Prisma known errors (e.g. unique constraint) get a generic 409/400 without leaking schema info.
  if (err && err.code && typeof err.code === 'string' && err.code.startsWith('P2')) {
    logger.warn({ err: err.message, code: err.code }, 'Prisma error');
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A record with these details already exists' });
    }
    return res.status(400).json({ error: 'Invalid request' });
  }

  logger.error({ err, path: req.path }, 'Unhandled error');
  const body = { error: 'Something went wrong. Please try again.' };
  if (!env.isProd) body.debug = err.message;
  res.status(500).json(body);
}

module.exports = { notFoundHandler, errorHandler };
