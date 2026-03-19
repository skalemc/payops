#!/usr/bin/env node
// scripts/migrate.js
// Applies 001_schema.sql to the database.
// Run ONCE on a fresh database, or when you have new migration files.
//
// Usage:
//   DATABASE_URL=postgresql://... node scripts/migrate.js
//   # Or with .env:
//   node --env-file=.env scripts/migrate.js

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath }  from 'url';
import pg from 'pg';

const { Client } = pg;
const __dir = dirname(fileURLToPath(import.meta.url));

const MIGRATIONS = [
  '../001_schema.sql',
];

async function migrate() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  });

  console.log('Connecting to database…');
  await client.connect();

  try {
    // Check which migrations have already been applied
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows: applied } = await client.query(
      'SELECT version FROM schema_migrations'
    );
    const appliedSet = new Set(applied.map(r => r.version));

    for (const file of MIGRATIONS) {
      const version = file.replace('../', '').replace('.sql', '');
      if (appliedSet.has(version)) {
        console.log(`  ✓ ${version} — already applied`);
        continue;
      }

      console.log(`  → Applying ${version}…`);
      const sql = readFileSync(join(__dir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version]
        );
        await client.query('COMMIT');
        console.log(`  ✓ ${version} — applied`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('\nMigrations complete.');
  } finally {
    await client.end();
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
