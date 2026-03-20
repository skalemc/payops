import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

import authRouter from './routes/auth.js';
import apiRouter  from './routes/index.js';

// ── Auto-migrate ──────────────────────────────────────────────────────────────
async function runMigrations() {
  const { Client } = pg;
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    console.log('Running migrations...');
    const __dir = dirname(fileURLToPath(import.meta.url));
    let schema;
    for (const p of [join(__dir, '001_schema.sql'), join(__dir, '../001_schema.sql')]) {
      try { schema = readFileSync(p, 'utf8'); break; } catch {}
    }
    if (!schema) { console.error('Schema file not found'); return; }
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    if (!rows.find(r => r.version === '001')) {
      await client.query(schema);
      await client.query(`INSERT INTO schema_migrations (version) VALUES ('001') ON CONFLICT DO NOTHING`);
      console.log('Migration 001 applied ✓');
    } else {
      console.log('DB already up to date ✓');
    }
  } catch (e) {
    console.error('Migration error:', e.message);
  } finally {
    await client.end();
  }
}

// ── Auto-seed ─────────────────────────────────────────────────────────────────
async function runSeed() {
  const email = process.env.SEED_EMAIL;
  if (!email) return;
  const { Client } = pg;
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      'SELECT id FROM operator_users WHERE email = $1', [email]);
    if (rows.length) { console.log('Operator exists ✓'); return; }
    const op = await client.query(
      `INSERT INTO operators (name, email) VALUES ('PayOps', $1) RETURNING id`, [email]);
    await client.query(
      `INSERT INTO operator_users (operator_id, email, full_name, role) VALUES ($1, $2, 'Operator', 'operator')`,
      [op.rows[0].id, email]);
    console.log('Operator created ✓', email);
  } catch (e) {
    console.error('Seed error:', e.message);
  } finally {
    await client.end();
  }
}

await runMigrations();
await runSeed();

// ── App ───────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT ?? 8080;

app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined'));

const limiter = rateLimit({
  windowMs: 900000, max: 200,
  standardHeaders: true, legacyHeaders: false,
});
app.use('/api', limiter);

app.use('/api/auth', authRouter);
app.use('/api',      apiRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err.message);
  if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation error', issues: err.errors });
  if (err.code === '23505') return res.status(409).json({ error: 'Already exists' });
  res.status(err.status ?? 500).json({ error: err.message ?? 'Server error' });
});

app.listen(PORT, () => console.log(`PayOps API on port ${PORT}`));

export default app;
