const { PrismaClient } = require('@prisma/client');
const env = require('../config/env');

// Single shared Prisma client. Prisma parameterizes every query it builds, which is our primary
// SQL-injection defense — raw SQL is never used anywhere in this codebase for user-influenced input.
const prisma = new PrismaClient({
  log: env.isProd ? ['error', 'warn'] : ['error', 'warn'],
});

module.exports = prisma;
