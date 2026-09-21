const pino = require('pino');
const env = require('../config/env');

// Redact anything that could leak a credential or session token into logs.
const logger = pino({
  level: env.isProd ? 'info' : 'debug',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.consumerSecret',
      '*.passkey',
    ],
    censor: '[redacted]',
  },
});

module.exports = logger;
