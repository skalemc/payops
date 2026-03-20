// index.js — PayOps API server
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

import authRouter  from './routes/auth.js';
import apiRouter   from './routes/index.js';

// ─── Auto-migrate on startup ──────────────────────────────────────────────────
async function runMigrations() {
  const { Client } = pg;
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  try {
    await client.connect();
    console.log('Running migrations…');
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // Schema is copied into the server folder during build
    const candidates = [
      join(__dirname, '001_schema.sql'),       // same dir as index.js
      join(__dirname, '../001_schema.sql'),     // repo root fallback
      '/app/001_schema.sql',
    ];
    let schema = null;
    for (const p of candidates) {
      try { schema = readFileSync(p, 'utf8'); console.log('Schema found at:', p); break; }
      catch {}
    }
    if (!schema) throw new Error('001_schema.sql not found in any expected location');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map(r => r.version));
    if (!applied.has('001')) {
      await client.query('BEGIN');
      await client.query(schema);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['001']);
      await client.query('COMMIT');
      console.log('Migration 001 applied ✓');
    } else {
      console.log('Migrations already up to date ✓');
    }
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await client.end();
  }
}

await runMigrations();

// ─── Auto-seed operator account ───────────────────────────────────────────────
async function runSeed() {
  const email = process.env.SEED_EMAIL;
  if (!email) return;
  const { Client } = pg;
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });
  try {
    await client.connect();
    const { rows } = await client.query(
      'SELECT id FROM operator_users WHERE email = $1', [email]
    );
    if (rows.length > 0) {
      console.log('Operator account already exists ✓');
      return;
    }
    const op = await client.query(
      `INSERT INTO operators (name, email) VALUES ('PayOps', $1) RETURNING id`,
      [email]
    );
    await client.query(
      `INSERT INTO operator_users (operator_id, email, full_name, role)
       VALUES ($1, $2, 'Operator', 'operator')`,
      [op.rows[0].id, email]
    );
    console.log('Operator account created ✓', email);
  } catch (e) {
    console.error('Seed error:', e.message);
  } finally {
    await client.end();
  }
}

await runSeed();

const app  = express();
const PORT = process.env.PORT ?? 4000;

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https://api.airwallex.com"],
    },
  },
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ['GET','POST','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ─── Logging ──────────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 900_000),
  max:      Number(process.env.RATE_LIMIT_MAX ?? 100),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, please slow down.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      Number(process.env.RATE_LIMIT_AUTH_MAX ?? 10),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many authentication attempts.' },
  skipSuccessfulRequests: true,
});

app.use('/api', globalLimiter);
app.use('/api/auth', authLimiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api',      apiRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1.0.0', ts: new Date().toISOString() });
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  // Zod validation errors
  if (err.name === 'ZodError') {
    return res.status(400).json({
      error: 'Validation error',
      issues: err.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
    });
  }
  // PostgreSQL unique constraint
  if (err.code === '23505') {
    return res.status(409).json({ error: 'A record with those details already exists.' });
  }
  // PostgreSQL exclusion constraint (overlapping leave)
  if (err.code === '23P01') {
    return res.status(409).json({ error: 'This overlaps an existing leave application.' });
  }
  // Generic
  const status = err.status ?? 500;
  if (process.env.NODE_ENV !== 'production') console.error(err);
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`PayOps API running on port ${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
});

export default app;
