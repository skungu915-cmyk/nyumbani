// Wraps the existing Express app (unchanged) as a single Netlify Function using the classic
// Lambda-compatible handler format, via serverless-http. This lets the whole backend — routes,
// middleware, services — run on Netlify without being rewritten as many small functions.
//
// KNOWN LIMITATION: Netlify Functions have an ephemeral filesystem, so
// backend/src/services/upload.service.js's disk-backed photo storage does not persist between
// invocations here. Everything else behaves the same as the plain Node/Express deployment.

// A require() failure anywhere in this chain (env validation, Prisma client construction, a
// missing dependency) would otherwise crash the whole module at cold start with whatever generic,
// hard-to-diagnose behavior the platform gives an unhandled load error. Capture it instead and
// turn every subsequent invocation into a fast, readable JSON error — never a silent hang.
let loadError = null;
let handler = null;

function loadApp() {
  // Netlify DB (Neon-backed Postgres) doesn't expose its connection string as a regular listable
  // env var — it's handed out via this SDK call, scoped to the current deploy context/branch.
  // Prisma reads DATABASE_URL from process.env at client-construction time, so this MUST run
  // before requiring backend/src/app (which transitively constructs the Prisma client).
  if (!process.env.DATABASE_URL) {
    const { getConnectionString } = require('@netlify/database');
    process.env.DATABASE_URL = getConnectionString();
  }
  const serverlessHttp = require('serverless-http');
  const app = require('../../backend/src/app');
  return serverlessHttp(app);
}

try {
  handler = loadApp();
} catch (err) {
  loadError = err;
  // eslint-disable-next-line no-console
  console.error('Netlify function failed to initialize:', err);
}

// Guards against any single request hanging past Netlify's own function timeout (which would
// otherwise look identical to the app being completely unreachable) — 20s comfortably fits inside
// Netlify's default synchronous function limit while still being well short of it.
const INVOCATION_TIMEOUT_MS = 20000;

exports.handler = async (event, context) => {
  if (loadError) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Backend failed to initialize', detail: String(loadError && loadError.message) }),
    };
  }

  // Netlify can deliver the path either as the full original URL (including the
  // "/.netlify/functions/api" function-invocation prefix) or already stripped down to the
  // redirect's splat, depending on how the request reached this function. Normalize both cases
  // to the plain "/api/...", "/media/..." or "/health" path the Express app's routes expect.
  const path = (event.path || '/').replace(/^\/\.netlify\/functions\/api/, '') || '/';

  const timeout = new Promise((resolve) =>
    setTimeout(
      () =>
        resolve({
          statusCode: 504,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Request timed out reaching the backend (database connection likely stalled)' }),
        }),
      INVOCATION_TIMEOUT_MS
    )
  );

  return Promise.race([handler({ ...event, path }, context), timeout]);
};
