// One-time database bootstrap for deployments that can't run `prisma migrate deploy` out-of-band
// (e.g. a serverless deployment whose operator has no network path to the database themselves,
// only the running application does). NOT part of the primary Node/Express deployment path — see
// README.md. This route only exists at all when BOOTSTRAP_SECRET is set; it is unmounted
// otherwise, so a normal deployment following the documented `prisma migrate deploy` flow never
// exposes it.
const express = require('express');
const fs = require('fs');
const path = require('path');
const prisma = require('../lib/prisma');
const env = require('../config/env');
const asyncHandler = require('../middleware/asyncHandler');
const { forbidden } = require('../utils/http-errors');
const logger = require('../lib/logger');

const router = express.Router();

const SCHEMA_MIGRATION_PATH = path.join(__dirname, '..', '..', 'prisma', 'migrations', '20260921193359_init', 'migration.sql');
const SEED_MIGRATION_PATH = path.join(__dirname, '..', '..', 'prisma', 'seed-demo.sql');

function splitStatements(sql) {
  // Safe for this specific codebase's migration files: verified to contain no semicolons inside
  // string literals or dollar-quoted blocks (plain CREATE TABLE/TYPE/INDEX/INSERT statements only).
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function applySql(filePath, { tolerateAlreadyExists }) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = splitStatements(sql);
  const results = [];
  for (const statement of statements) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await prisma.$executeRawUnsafe(statement);
      results.push({ ok: true });
    } catch (err) {
      const alreadyExists = /already exists/i.test(err.message);
      if (tolerateAlreadyExists && alreadyExists) {
        results.push({ ok: true, skipped: 'already exists' });
      } else {
        results.push({ ok: false, error: err.message, statement: statement.slice(0, 80) });
      }
    }
  }
  return results;
}

router.post(
  '/migrate',
  asyncHandler(async (req, res) => {
    if (!env.BOOTSTRAP_SECRET || req.headers['x-bootstrap-secret'] !== env.BOOTSTRAP_SECRET) {
      throw forbidden('Invalid or missing bootstrap secret');
    }

    logger.warn('Running one-time database bootstrap via /api/_bootstrap/migrate');

    const schemaResults = await applySql(SCHEMA_MIGRATION_PATH, { tolerateAlreadyExists: true });
    const seedResults = await applySql(SEED_MIGRATION_PATH, { tolerateAlreadyExists: true });

    const failures = [...schemaResults, ...seedResults].filter((r) => !r.ok);
    res.json({
      ok: failures.length === 0,
      schema: { total: schemaResults.length, failed: schemaResults.filter((r) => !r.ok).length },
      seed: { total: seedResults.length, failed: seedResults.filter((r) => !r.ok).length },
      failures,
    });
  })
);

module.exports = router;
