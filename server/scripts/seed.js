#!/usr/bin/env node
// scripts/seed.js
// Creates the initial operator account.
// Run ONCE after migrations on a fresh database.
//
// Usage:
//   node --env-file=.env scripts/seed.js
//   node --env-file=.env scripts/seed.js --email your@email.com --name "Your Name"

import pg     from 'pg';
import crypto from 'crypto';

const { Client } = pg;

// Parse CLI args
const args = process.argv.slice(2);
const getArg = key => {
  const i = args.indexOf(key);
  return i !== -1 ? args[i + 1] : null;
};

const OPERATOR_NAME  = getArg('--name')  || 'PayOps Operator';
const OPERATOR_EMAIL = getArg('--email') || 'operator@payops.sg';

async function seed() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  });

  await client.connect();
  console.log('Connected. Seeding…\n');

  try {
    // Create operator
    const { rows: existingOps } = await client.query(
      'SELECT id FROM operators LIMIT 1'
    );

    let operatorId;
    if (existingOps.length > 0) {
      operatorId = existingOps[0].id;
      console.log('  ✓ Operator already exists:', operatorId);
    } else {
      const { rows } = await client.query(
        `INSERT INTO operators (name, email)
         VALUES ($1, $2)
         RETURNING id`,
        ['PayOps Services', OPERATOR_EMAIL]
      );
      operatorId = rows[0].id;
      console.log('  ✓ Operator created:', operatorId);
    }

    // Create operator user
    const { rows: existingUsers } = await client.query(
      'SELECT id FROM operator_users WHERE email = $1',
      [OPERATOR_EMAIL]
    );

    if (existingUsers.length > 0) {
      console.log('  ✓ Operator user already exists:', OPERATOR_EMAIL);
    } else {
      const { rows: userRows } = await client.query(
        `INSERT INTO operator_users (operator_id, email, full_name, role)
         VALUES ($1, $2, $3, 'operator')
         RETURNING id`,
        [operatorId, OPERATOR_EMAIL, OPERATOR_NAME]
      );
      console.log('  ✓ Operator user created:', OPERATOR_EMAIL, '(id:', userRows[0].id + ')');
    }

    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Seed complete.

  Operator login email:  ${OPERATOR_EMAIL}
  Sign-in method:        OTP to this email

  To log in:
    1. Start the API server (node index.js)
    2. POST /api/auth/otp/send  { "email": "${OPERATOR_EMAIL}" }
    3. Check console for OTP (dev) or email (production)
    4. POST /api/auth/otp/verify { "email": "...", "otp": "123456" }
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
  } finally {
    await client.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
