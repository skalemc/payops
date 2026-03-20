// lib/db.js — PostgreSQL connection pool
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max:              20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle DB client', err);
  process.exit(1);
});

// ── Query helper with automatic RLS context ──────────────────────────────────
// Every query sets app.current_*_id so RLS policies can use it.
export async function query(sql, params = [], ctx = {}) {
  const client = await pool.connect();
  const sets = [];
  if (ctx.operatorId)  sets.push(`SET LOCAL app.current_operator_id  = '${ctx.operatorId}'`);
  if (ctx.clientId)    sets.push(`SET LOCAL app.current_client_id     = '${ctx.clientId}'`);
  if (ctx.employeeId)  sets.push(`SET LOCAL app.current_employee_id   = '${ctx.employeeId}'`);
  try {
    if (sets.length) {
      await client.query('BEGIN');
      for (const s of sets) await client.query(s);
      const result = await client.query(sql, params);
      await client.query('COMMIT');
      return result;
    }
    return await client.query(sql, params);
  } catch (err) {
    if (sets.length) await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Convenience: single row or null
export async function queryOne(sql, params = [], ctx = {}) {
  const result = await query(sql, params, ctx);
  return result.rows[0] ?? null;
}

// Transaction helper
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
