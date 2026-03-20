// routes/auth.js — OTP send + verify for all three user types
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, queryOne } from '../lib/db.js';
import { issueToken } from '../middleware/auth.js';

const router = Router();

// Crypto-secure 6-digit OTP
function generateOTP() {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

// Simple email send (swap for real provider in production)
async function sendOTPEmail(email, otp, userType) {
  // In production: use nodemailer with Sendgrid/SES
if (process.env.NODE_ENV !== 'production' || process.env.FORCE_LOG_OTP === 'true') {
    console.log(`[OTP] ${email}: ${otp}`);
    return;
}
```

Commit → Railway redeploys → send the OTP request in Hoppscotch again → check Railway Deploy Logs immediately for a line like:
```
[OTP] your@email.com: 123456
  // TODO: nodemailer send
}

// ── POST /auth/otp/send ──────────────────────────────────────────────────────
router.post('/otp/send', async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid email' });

  const { email } = parsed.data;
  const emailLower = email.toLowerCase().trim();

  // Determine user type by looking up email across all user tables
  let userType = null;
  let userId   = null;

  const opUser = await queryOne(
    `SELECT id FROM operator_users WHERE email = $1 AND is_active = true`, [emailLower]
  );
  if (opUser) { userType = 'operator_user'; userId = opUser.id; }

  if (!userType) {
    const clUser = await queryOne(
      `SELECT id FROM client_users WHERE email = $1 AND is_active = true`, [emailLower]
    );
    if (clUser) { userType = 'client_user'; userId = clUser.id; }
  }

  if (!userType) {
    const emp = await queryOne(
      `SELECT id FROM employees WHERE work_email = $1
       AND employment_status = 'active' AND portal_enabled = true`, [emailLower]
    );
    if (emp) { userType = 'employee'; userId = emp.id; }
  }

  // Always respond 200 (don't reveal whether email exists)
  if (!userType) {
    return res.json({ message: 'If that email is registered, a code has been sent.' });
  }

  // Rate-limit: max 3 OTPs per email per 10 minutes
  const recentCount = await queryOne(
    `SELECT COUNT(*) AS cnt FROM auth_otps
     WHERE email = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
    [emailLower]
  );
  if (Number(recentCount.cnt) >= 3) {
    return res.status(429).json({ error: 'Too many OTP requests. Please wait 10 minutes.' });
  }

  const otp      = generateOTP();
  const otpHash  = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + (Number(process.env.OTP_EXPIRY_MINUTES ?? 10)) * 60_000);

  await query(
    `INSERT INTO auth_otps (email, otp_hash, user_type, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [emailLower, otpHash, userType, expiresAt]
  );

  await sendOTPEmail(emailLower, otp, userType);

  res.json({ message: 'If that email is registered, a code has been sent.', userType });
});

// ── POST /auth/otp/verify ────────────────────────────────────────────────────
router.post('/otp/verify', async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    otp:   z.string().length(6).regex(/^\d{6}$/),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const { email, otp } = parsed.data;
  const emailLower = email.toLowerCase().trim();
  const maxAttempts = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);

  // Find most recent unused, unexpired OTP for this email
  const otpRow = await queryOne(
    `SELECT id, otp_hash, user_type, attempts, expires_at
     FROM auth_otps
     WHERE email = $1 AND used_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [emailLower]
  );

  if (!otpRow) {
    return res.status(401).json({ error: 'Invalid or expired code.' });
  }

  // Increment attempt counter
  await query(
    `UPDATE auth_otps SET attempts = attempts + 1 WHERE id = $1`, [otpRow.id]
  );

  if (otpRow.attempts >= maxAttempts) {
    await query(`UPDATE auth_otps SET used_at = NOW() WHERE id = $1`, [otpRow.id]);
    return res.status(429).json({ error: 'Too many failed attempts. Request a new code.' });
  }

  const valid = await bcrypt.compare(otp, otpRow.otp_hash);
  if (!valid) {
    const remaining = maxAttempts - otpRow.attempts - 1;
    return res.status(401).json({ error: `Incorrect code. ${remaining} attempt(s) remaining.` });
  }

  // Mark OTP as used
  await query(`UPDATE auth_otps SET used_at = NOW() WHERE id = $1`, [otpRow.id]);

  // Build JWT payload based on user type
  let tokenPayload = { userType: otpRow.user_type };

  if (otpRow.user_type === 'operator_user') {
    const user = await queryOne(
      `SELECT id, operator_id, full_name, role FROM operator_users WHERE email = $1`, [emailLower]
    );
    Object.assign(tokenPayload, { userId: user.id, operatorId: user.operator_id,
      name: user.full_name, role: user.role });
  } else if (otpRow.user_type === 'client_user') {
    const user = await queryOne(
      `SELECT cu.id, cu.client_id, cu.full_name, cu.role, c.operator_id
       FROM client_users cu JOIN clients c ON c.id = cu.client_id
       WHERE cu.email = $1`, [emailLower]
    );
    Object.assign(tokenPayload, { userId: user.id, clientId: user.client_id,
      operatorId: user.operator_id, name: user.full_name, role: user.role });
  } else {
    const emp = await queryOne(
      `SELECT e.id, e.client_id, e.full_name, e.designation, c.operator_id
       FROM employees e JOIN clients c ON c.id = e.client_id
       WHERE e.work_email = $1`, [emailLower]
    );
    Object.assign(tokenPayload, { userId: emp.id, employeeId: emp.id,
      clientId: emp.client_id, operatorId: emp.operator_id,
      name: emp.full_name, designation: emp.designation });
  }

  const token = issueToken(tokenPayload);

  // Log login to audit
  await query(
    `UPDATE ${otpRow.user_type === 'employee' ? 'employees' : otpRow.user_type === 'client_user' ? 'client_users' : 'operator_users'}
     SET ${otpRow.user_type === 'employee' ? 'portal_last_login' : 'last_login_at'} = NOW()
     WHERE ${otpRow.user_type === 'employee' ? 'work_email' : 'email'} = $1`,
    [emailLower]
  );

  res.json({ token, user: tokenPayload });
});

export default router;
