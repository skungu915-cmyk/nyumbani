// Wraps the existing Express app (unchanged) as a single Netlify Function using the classic
// Lambda-compatible handler format, via serverless-http. This lets the whole backend — routes,
// middleware, services — run on Netlify without being rewritten as many small functions.
//
// KNOWN LIMITATION: Netlify Functions have an ephemeral filesystem, so
// backend/src/services/upload.service.js's disk-backed photo storage does not persist between
// invocations here. Everything else behaves the same as the plain Node/Express deployment.

// Netlify DB (Neon-backed Postgres) doesn't expose its connection string as a regular listable
// env var — it's handed out via this SDK call, scoped to the current deploy context/branch. Prisma
// reads DATABASE_URL from process.env at client-construction time, so this MUST run before
// requiring backend/src/app (which transitively constructs the Prisma client on first import).
if (!process.env.DATABASE_URL) {
  const { getConnectionString } = require('@netlify/database');
  process.env.DATABASE_URL = getConnectionString();
}

const serverlessHttp = require('serverless-http');
const app = require('../../backend/src/app');

const handler = serverlessHttp(app);

exports.handler = async (event, context) => {
  // Netlify can deliver the path either as the full original URL (including the
  // "/.netlify/functions/api" function-invocation prefix) or already stripped down to the
  // redirect's splat, depending on how the request reached this function. Normalize both cases
  // to the plain "/api/..." or "/media/..." path the Express app's routes expect.
  const path = (event.path || '/').replace(/^\/\.netlify\/functions\/api/, '') || '/';
  return handler({ ...event, path }, context);
};
