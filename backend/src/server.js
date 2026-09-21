const env = require('./config/env');
const logger = require('./lib/logger');
const app = require('./app');
const prisma = require('./lib/prisma');

const server = app.listen(env.PORT, () => {
  logger.info(`LiveHere Homes API listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force-exit if graceful shutdown hangs.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
