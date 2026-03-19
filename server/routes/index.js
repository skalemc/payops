// routes/index.js — All resource routes
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, transaction } from '../lib/db.js';
import { requireOperator, requireClient, requireEmployee, scopeToClient } from '../middleware/auth.js';
import { computePayrollRun } from '../services/cpf.service.js';

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// CLIENTS  (operator only)
// ─────────────────────────────────────────────────────────────────────────────
const clientRouter = Router();

clientRouter.get('/', requireOperator, async (req, res) => {
  const rows = await query(
    `SELECT c.*, COUNT(e.id) AS headcount
     FROM clients c
     LEFT JOIN employees e ON e.client_id = c.id AND e.employment_status = 'active'
     WHERE c.operator_id = $1
     GROUP BY c.id
     ORDER BY c.name`,
    [req.user.operatorId], req.dbCtx
  );
  res.json(rows.rows);
});

clientRouter.get('/:clientId', requireOperator, scopeToClient, async (req, res) => {
  const client = await queryOne(
    `SELECT * FROM clients WHERE id = $1 AND operator_id = $2`,
    [req.params.clientId, req.user.operatorId], req.dbCtx
  );
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

const clientSchema = z.object({
  name:            z.string().min(2),
  uen:             z.string().regex(/^\d{9}[A-Z]$/),
  industry:        z.string().optional(),
  contactName:     z.string().optional(),
  contactEmail:    z.string().email().optional(),
  contactPhone:    z.string().optional(),
  payrollDay:      z.number().int().min(1).max(31).default(28),
  airwallexAccountId: z.string().optional(),
  bankName:        z.string().optional(),
});

clientRouter.post('/', requireOperator, async (req, res) => {
  const data = clientSchema.parse(req.body);
  const row = await queryOne(
    `INSERT INTO clients (operator_id, name, uen, industry, contact_name, contact_email,
       contact_phone, payroll_day, airwallex_account_id, bank_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [req.user.operatorId, data.name, data.uen, data.industry, data.contactName,
     data.contactEmail, data.contactPhone, data.payrollDay, data.airwallexAccountId, data.bankName],
    req.dbCtx
  );
  res.status(201).json(row);
});

clientRouter.patch('/:clientId', requireOperator, scopeToClient, async (req, res) => {
  const data = clientSchema.partial().parse(req.body);
  const fields = Object.entries(data)
    .map(([k, _], i) => `${k.replace(/([A-Z])/g, '_$1').toLowerCase()} = $${i + 2}`)
    .join(', ');
  const row = await queryOne(
    `UPDATE clients SET ${fields} WHERE id = $1 AND operator_id = $${Object.keys(data).length + 2} RETURNING *`,
    [req.params.clientId, ...Object.values(data), req.user.operatorId], req.dbCtx
  );
  res.json(row);
});

router.use('/clients', clientRouter);

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEES
// ─────────────────────────────────────────────────────────────────────────────
const empRouter = Router({ mergeParams: true });

empRouter.get('/', requireClient, scopeToClient, async (req, res) => {
  const { status = 'active' } = req.query;
  const rows = await query(
    `SELECT * FROM employees
     WHERE client_id = $1 AND employment_status = $2
     ORDER BY full_name`,
    [req.params.clientId, status], req.dbCtx
  );
  res.json(rows.rows);
});

empRouter.get('/:employeeId', requireEmployee, async (req, res) => {
  const emp = await queryOne(
    `SELECT * FROM employees WHERE id = $1 AND client_id = $2`,
    [req.params.employeeId, req.params.clientId], req.dbCtx
  );
  if (!emp) return res.status(404).json({ error: 'Employee not found' });
  res.json(emp);
});

const empSchema = z.object({
  fullName:        z.string().min(2),
  nricMasked:      z.string(),
  dateOfBirth:     z.string().date(),
  residencyType:   z.enum(['citizen','pr1','pr2','pr3','ep','spass','wp','other']),
  designation:     z.string(),
  department:      z.string().optional(),
  joinDate:        z.string().date(),
  basicSalary:     z.number().int().positive(),   // CENTS
  fixedAllowance:  z.number().int().min(0).default(0),
  workEmail:       z.string().email().optional(),
  bankName:        z.string().optional(),
  portalEnabled:   z.boolean().default(false),
  managerId:       z.string().uuid().optional(),
});

empRouter.post('/', requireClient, scopeToClient, async (req, res) => {
  const data = empSchema.parse(req.body);
  const row = await queryOne(
    `INSERT INTO employees
       (client_id, full_name, nric_masked, date_of_birth, residency_type,
        designation, department, join_date, basic_salary, fixed_allowance,
        work_email, bank_name, portal_enabled, manager_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [req.params.clientId, data.fullName, data.nricMasked, data.dateOfBirth,
     data.residencyType, data.designation, data.department, data.joinDate,
     data.basicSalary, data.fixedAllowance, data.workEmail, data.bankName,
     data.portalEnabled, data.managerId ?? null],
    req.dbCtx
  );
  res.status(201).json(row);
});

empRouter.patch('/:employeeId', requireClient, scopeToClient, async (req, res) => {
  const data = empSchema.partial().parse(req.body);
  // Build dynamic SET clause
  const cols = {
    fullName:'full_name', nricMasked:'nric_masked', dateOfBirth:'date_of_birth',
    residencyType:'residency_type', designation:'designation', department:'department',
    joinDate:'join_date', basicSalary:'basic_salary', fixedAllowance:'fixed_allowance',
    workEmail:'work_email', bankName:'bank_name', portalEnabled:'portal_enabled',
  };
  const sets = []; const vals = [req.params.employeeId];
  Object.entries(data).forEach(([k, v]) => {
    if (cols[k]) { vals.push(v); sets.push(`${cols[k]} = $${vals.length}`); }
  });
  if (!sets.length) return res.status(400).json({ error: 'No valid fields to update' });
  const row = await queryOne(
    `UPDATE employees SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    vals, req.dbCtx
  );
  res.json(row);
});

router.use('/clients/:clientId/employees', empRouter);

// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL PERIODS & RUNS
// ─────────────────────────────────────────────────────────────────────────────
const payrollRouter = Router({ mergeParams: true });

payrollRouter.get('/', requireClient, scopeToClient, async (req, res) => {
  const rows = await query(
    `SELECT pp.*, row_to_json(t) AS totals
     FROM payroll_periods pp
     LEFT JOIN v_payroll_period_totals t ON t.payroll_period_id = pp.id
     WHERE pp.client_id = $1
     ORDER BY pp.period_year DESC, pp.period_month DESC`,
    [req.params.clientId], req.dbCtx
  );
  res.json(rows.rows);
});

payrollRouter.post('/', requireOperator, scopeToClient, async (req, res) => {
  const schema = z.object({
    periodYear:  z.number().int().min(2020),
    periodMonth: z.number().int().min(1).max(12),
    payDate:     z.string().date(),
  });
  const { periodYear, periodMonth, payDate } = schema.parse(req.body);

  // CPF due = 14th of following month
  const cpfDue = new Date(periodYear, periodMonth, 14).toISOString().slice(0,10);

  const row = await queryOne(
    `INSERT INTO payroll_periods (client_id, period_year, period_month, pay_date, cpf_due_date)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.clientId, periodYear, periodMonth, payDate, cpfDue], req.dbCtx
  );
  res.status(201).json(row);
});

// Compute (or re-compute) payroll for a period
payrollRouter.post('/:periodId/compute', requireOperator, scopeToClient, async (req, res) => {
  const { periodId } = req.params;

  const period = await queryOne(
    `SELECT * FROM payroll_periods WHERE id = $1 AND client_id = $2`,
    [periodId, req.params.clientId], req.dbCtx
  );
  if (!period) return res.status(404).json({ error: 'Payroll period not found' });
  if (period.status === 'paid') return res.status(409).json({ error: 'Cannot recompute a paid period' });

  // Fetch active employees with NPL data for this period
  const employees = await query(
    `SELECT e.id, e.full_name AS name, e.residency_type,
            DATE_PART('year', AGE($1::DATE, e.date_of_birth))::INT AS age,
            e.basic_salary, e.fixed_allowance,
            e.cpf_aw_ceiling_used, e.cpf_total_ow_ytd,
            COALESCE(SUM(la.days) FILTER (
              WHERE la.leave_type = 'npl' AND la.status = 'approved'
                AND la.start_date >= $2::DATE AND la.end_date <= $3::DATE
            ), 0)::INT AS npl_days
     FROM employees e
     LEFT JOIN leave_applications la ON la.employee_id = e.id
     WHERE e.client_id = $4 AND e.employment_status = 'active'
     GROUP BY e.id`,
    [
      `${period.period_year}-${String(period.period_month).padStart(2,'0')}-01`,
      `${period.period_year}-${String(period.period_month).padStart(2,'0')}-01`,
      new Date(period.period_year, period.period_month, 0).toISOString().slice(0,10),
      req.params.clientId,
    ], req.dbCtx
  );

  const totalDays = new Date(period.period_year, period.period_month, 0).getDate();

  const empData = employees.rows.map(e => ({
    id:              e.id,
    name:            e.name,
    residencyType:   e.residency_type,
    age:             e.age,
    basicSalary:     e.basic_salary,
    fixedAllowance:  e.fixed_allowance,
    daysWorked:      e.npl_days > 0 ? totalDays - e.npl_days : null,
    totalDaysInMonth: totalDays,
    awCeilingUsedCents: e.cpf_aw_ceiling_used,
    totalOWForYearCents: e.cpf_total_ow_ytd,
  }));

  const run = await computePayrollRun(
    empData,
    `${period.period_year}-${String(period.period_month).padStart(2,'0')}`
  );

  // Upsert line items
  await transaction(async (client) => {
    for (const r of run.results) {
      await client.query(
        `INSERT INTO payroll_line_items
           (payroll_period_id, employee_id, client_id,
            ordinary_wage, ordinary_wage_capped, gross_pay,
            ee_cpf, er_cpf, cpf_remittance, sdl, net_pay,
            ee_rate, er_rate, ow_ceiling, npl_days,
            days_worked, total_days_in_month, cpf_oa, cpf_sa, cpf_ma)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (payroll_period_id, employee_id) DO UPDATE SET
           ordinary_wage = EXCLUDED.ordinary_wage,
           ordinary_wage_capped = EXCLUDED.ordinary_wage_capped,
           gross_pay = EXCLUDED.gross_pay,
           ee_cpf = EXCLUDED.ee_cpf, er_cpf = EXCLUDED.er_cpf,
           cpf_remittance = EXCLUDED.cpf_remittance, sdl = EXCLUDED.sdl,
           net_pay = EXCLUDED.net_pay, ee_rate = EXCLUDED.ee_rate,
           er_rate = EXCLUDED.er_rate, npl_days = EXCLUDED.npl_days,
           computed_at = NOW(), updated_at = NOW()`,
        [period.id, r.employeeId, req.params.clientId,
         r.ordinaryWage, r.ordinaryWageCapped, r.grossPay,
         r.eeCPF, r.erCPF, r.cpfRemittance, r.sdl, r.netPay,
         r.eeRate, r.erRate, r.owCeiling, empData.find(e=>e.id===r.employeeId)?.daysWorked ?? 0,
         empData.find(e=>e.id===r.employeeId)?.daysWorked ?? null,
         totalDays, r.cpfOA, r.cpfSA, r.cpfMA]
      );
    }
    await client.query(
      `UPDATE payroll_periods SET status = 'computed', updated_at = NOW() WHERE id = $1`,
      [period.id]
    );
  });

  res.json({ period: run.period, totals: run.totals, employeeCount: run.results.length });
});

// Approve & lock a payroll period
payrollRouter.post('/:periodId/approve', requireOperator, scopeToClient, async (req, res) => {
  const row = await queryOne(
    `UPDATE payroll_periods
     SET status = 'approved', locked_at = NOW(), locked_by = $1
     WHERE id = $2 AND client_id = $3 AND status = 'computed'
     RETURNING *`,
    [req.user.userId, req.params.periodId, req.params.clientId], req.dbCtx
  );
  if (!row) return res.status(409).json({ error: 'Period must be in computed status to approve' });

  // Lock all line items
  await query(
    `UPDATE payroll_line_items SET is_locked = true
     WHERE payroll_period_id = $1`, [req.params.periodId], req.dbCtx
  );
  res.json(row);
});

payrollRouter.get('/:periodId/lines', requireClient, scopeToClient, async (req, res) => {
  const rows = await query(
    `SELECT pli.*, e.full_name, e.nric_masked, e.residency_type
     FROM payroll_line_items pli
     JOIN employees e ON e.id = pli.employee_id
     WHERE pli.payroll_period_id = $1
     ORDER BY e.full_name`,
    [req.params.periodId], req.dbCtx
  );
  res.json(rows.rows);
});

router.use('/clients/:clientId/payroll', payrollRouter);

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT INSTRUCTIONS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/clients/:clientId/payment-instructions', requireClient, scopeToClient, async (req, res) => {
  const rows = await query(
    `SELECT pi.*, pp.period_year, pp.period_month, pp.pay_date
     FROM payment_instructions pi
     JOIN payroll_periods pp ON pp.id = pi.payroll_period_id
     WHERE pi.client_id = $1
     ORDER BY pp.period_year DESC, pp.period_month DESC, pi.type`,
    [req.params.clientId], req.dbCtx
  );
  res.json(rows.rows);
});

// Generate payment instructions for an approved payroll period
router.post('/clients/:clientId/payroll/:periodId/generate-pi', requireOperator, scopeToClient, async (req, res) => {
  const { clientId, periodId } = req.params;
  const client = await queryOne(`SELECT * FROM clients WHERE id = $1`, [clientId], req.dbCtx);
  const period = await queryOne(
    `SELECT * FROM payroll_periods WHERE id = $1`, [periodId], req.dbCtx
  );
  if (period.status !== 'approved') return res.status(409).json({ error: 'Period must be approved first' });

  const totals = await queryOne(
    `SELECT * FROM v_payroll_period_totals WHERE payroll_period_id = $1`, [periodId], req.dbCtx
  );

  const periodStr = `${period.period_year}${String(period.period_month).padStart(2,'0')}`;
  const uen = client.uen.replace(/[^A-Z0-9]/gi,'').toUpperCase();

  await transaction(async (db) => {
    // Salary PI
    const salRef = `PI-SAL-${periodStr}-${uen}`;
    const awUrl = `https://www.airwallex.com/app/payments/batch-pay?ref=${salRef}&currency=SGD&total=${(totals.total_net/100).toFixed(2)}`;
    await db.query(
      `INSERT INTO payment_instructions
         (payroll_period_id, client_id, type, reference_number,
          total_amount, payment_status, airwallex_url, payee, due_date)
       VALUES ($1,$2,'salary',$3,$4,'pending',$5,'employees',$6)
       ON CONFLICT (reference_number) DO NOTHING`,
      [periodId, clientId, salRef, totals.total_net, awUrl, period.pay_date]
    );

    // CPF PI
    const cpfRef = `PI-CPF-${periodStr}-${uen}`;
    const cpfTotal = totals.total_cpf_remittance + totals.total_sdl;
    const cpfRefNo = `CPF/${uen}/${periodStr}`;
    const cpfUrl  = `https://www.airwallex.com/app/payments/pay?ref=${cpfRef}&payee=CPF+Board&uen=T08GB0002B&currency=SGD&amount=${(cpfTotal/100).toFixed(2)}&ref_note=${encodeURIComponent(cpfRefNo)}`;
    await db.query(
      `INSERT INTO payment_instructions
         (payroll_period_id, client_id, type, reference_number,
          total_amount, payment_status, airwallex_url, payee, payee_uen, due_date)
       VALUES ($1,$2,'cpf',$3,$4,'pending',$5,'CPF Board','T08GB0002B',$6)
       ON CONFLICT (reference_number) DO NOTHING`,
      [periodId, clientId, cpfRef, cpfTotal, cpfUrl, period.cpf_due_date]
    );
  });

  res.json({ message: 'Payment instructions generated', periodId });
});

// Mark PI as paid
router.post('/payment-instructions/:piId/mark-paid', requireOperator, async (req, res) => {
  const row = await queryOne(
    `UPDATE payment_instructions
     SET payment_status = 'confirmed', paid_at = NOW(), paid_by = $1
     WHERE id = $2 RETURNING *`,
    [req.user.userId, req.params.piId], req.dbCtx
  );
  res.json(row);
});

// ─────────────────────────────────────────────────────────────────────────────
// LEAVE
// ─────────────────────────────────────────────────────────────────────────────
const leaveRouter = Router({ mergeParams: true });

leaveRouter.get('/', requireEmployee, async (req, res) => {
  const { status } = req.query;
  const rows = await query(
    `SELECT la.*, e.full_name AS employee_name
     FROM leave_applications la
     JOIN employees e ON e.id = la.employee_id
     WHERE la.client_id = $1 ${status ? 'AND la.status = $2' : ''}
     ORDER BY la.created_at DESC`,
    status ? [req.params.clientId, status] : [req.params.clientId], req.dbCtx
  );
  res.json(rows.rows);
});

leaveRouter.post('/', requireEmployee, async (req, res) => {
  const schema = z.object({
    employeeId: z.string().uuid().optional(),
    leaveType:  z.enum(['annual','medical','hospitalisation','maternity','paternity','childcare','npl','other']),
    startDate:  z.string().date(),
    endDate:    z.string().date(),
    days:       z.number().int().min(1),
    reason:     z.string().optional(),
  });
  const data = schema.parse(req.body);
  const empId = data.employeeId ?? req.user.employeeId;

  const row = await queryOne(
    `INSERT INTO leave_applications
       (employee_id, client_id, leave_type, start_date, end_date, days,
        reason, submitted_by, affects_payroll)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [empId, req.params.clientId, data.leaveType, data.startDate, data.endDate,
     data.days, data.reason, req.user.userType === 'employee' ? 'employee' : 'admin',
     data.leaveType === 'npl'],
    req.dbCtx
  );
  res.status(201).json(row);
});

leaveRouter.post('/:leaveId/approve', requireClient, async (req, res) => {
  const col  = req.user.userType === 'operator_user' ? 'operator_approved_by' : 'manager_id';
  const tCol = req.user.userType === 'operator_user' ? 'operator_approved_at' : 'manager_approved_at';
  const row = await queryOne(
    `UPDATE leave_applications
     SET status = 'approved', ${col} = $1, ${tCol} = NOW()
     WHERE id = $2 AND client_id = $3 AND status = 'pending'
     RETURNING *`,
    [req.user.userId, req.params.leaveId, req.params.clientId], req.dbCtx
  );
  if (!row) return res.status(404).json({ error: 'Leave application not found or not pending' });
  res.json(row);
});

leaveRouter.post('/:leaveId/reject', requireClient, async (req, res) => {
  const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
  const row = await queryOne(
    `UPDATE leave_applications
     SET status = 'rejected', rejection_reason = $1
     WHERE id = $2 AND client_id = $3 RETURNING *`,
    [reason ?? 'Rejected', req.params.leaveId, req.params.clientId], req.dbCtx
  );
  res.json(row);
});

// Employee leave balances (view-backed)
leaveRouter.get('/balances/:employeeId', requireEmployee, async (req, res) => {
  const rows = await query(
    `SELECT * FROM v_leave_balances
     WHERE employee_id = $1 AND leave_year = EXTRACT(YEAR FROM NOW())`,
    [req.params.employeeId], req.dbCtx
  );
  res.json(rows.rows);
});

router.use('/clients/:clientId/leave', leaveRouter);

// ─────────────────────────────────────────────────────────────────────────────
// EXPENSE CLAIMS
// ─────────────────────────────────────────────────────────────────────────────
const claimsRouter = Router({ mergeParams: true });

claimsRouter.get('/', requireEmployee, async (req, res) => {
  const { status } = req.query;
  const isEmployee = req.user.userType === 'employee';
  const rows = await query(
    `SELECT ec.*, cc.name AS category_name, e.full_name AS employee_name
     FROM expense_claims ec
     JOIN claim_categories cc ON cc.id = ec.category_id
     JOIN employees e ON e.id = ec.employee_id
     WHERE ec.client_id = $1
       ${isEmployee ? 'AND ec.employee_id = $2' : ''}
       ${status ? `AND ec.status = '${status}'` : ''}
     ORDER BY ec.created_at DESC`,
    isEmployee ? [req.params.clientId, req.user.employeeId] : [req.params.clientId],
    req.dbCtx
  );
  res.json(rows.rows);
});

claimsRouter.post('/', requireEmployee, async (req, res) => {
  const schema = z.object({
    employeeId:  z.string().uuid().optional(),
    categoryId:  z.string().uuid(),
    description: z.string().min(3),
    amount:      z.number().int().positive(),   // CENTS
    expenseDate: z.string().date(),
    receiptRef:  z.string().optional(),
  });
  const data = schema.parse(req.body);
  const empId = data.employeeId ?? req.user.employeeId;

  const row = await queryOne(
    `INSERT INTO expense_claims
       (employee_id, client_id, category_id, description, amount,
        expense_date, receipt_ref, submitted_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [empId, req.params.clientId, data.categoryId, data.description, data.amount,
     data.expenseDate, data.receiptRef, req.user.userType === 'employee' ? 'employee' : 'admin'],
    req.dbCtx
  );
  res.status(201).json(row);
});

claimsRouter.post('/:claimId/approve', requireClient, async (req, res) => {
  const newStatus = req.user.userType === 'operator_user' ? 'operator_approved' : 'manager_approved';
  const row = await queryOne(
    `UPDATE expense_claims
     SET status = $1,
         ${req.user.userType === 'operator_user' ? 'operator_approved_by = $2, operator_approved_at = NOW()' : 'manager_id = $2, manager_approved_at = NOW()'}
     WHERE id = $3 AND client_id = $4
     RETURNING *`,
    [newStatus, req.user.userId, req.params.claimId, req.params.clientId], req.dbCtx
  );
  res.json(row);
});

claimsRouter.post('/:claimId/reject', requireClient, async (req, res) => {
  const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
  const row = await queryOne(
    `UPDATE expense_claims SET status = 'rejected', rejection_reason = $1
     WHERE id = $2 AND client_id = $3 RETURNING *`,
    [reason ?? 'Rejected', req.params.claimId, req.params.clientId], req.dbCtx
  );
  res.json(row);
});

// Lock approved claims to a payroll period
claimsRouter.post('/lock-to-payroll', requireOperator, async (req, res) => {
  const { claimIds, payrollPeriodId } = z.object({
    claimIds: z.array(z.string().uuid()).min(1),
    payrollPeriodId: z.string().uuid(),
  }).parse(req.body);

  const rows = await query(
    `UPDATE expense_claims
     SET status = 'paid', payroll_period_id = $1
     WHERE id = ANY($2::UUID[]) AND client_id = $3 AND status = 'operator_approved'
     RETURNING *`,
    [payrollPeriodId, claimIds, req.params.clientId], req.dbCtx
  );
  res.json({ locked: rows.rows.length, claims: rows.rows });
});

router.use('/clients/:clientId/claims', claimsRouter);

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEE SELF-SERVICE (portal)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', requireEmployee, async (req, res) => {
  if (req.user.userType !== 'employee') {
    return res.status(403).json({ error: 'Employee portal only' });
  }
  const emp = await queryOne(
    `SELECT e.*, c.name AS company_name, c.uen AS company_uen
     FROM employees e JOIN clients c ON c.id = e.client_id
     WHERE e.id = $1`, [req.user.employeeId], req.dbCtx
  );
  res.json(emp);
});

router.get('/me/payslips', requireEmployee, async (req, res) => {
  const rows = await query(
    `SELECT d.*, pp.period_year, pp.period_month, pp.pay_date,
            pli.gross_pay, pli.net_pay, pli.ee_cpf, pli.er_cpf, pli.sdl
     FROM documents d
     JOIN payroll_periods pp ON pp.id = d.payroll_period_id
     LEFT JOIN payroll_line_items pli
       ON pli.payroll_period_id = pp.id AND pli.employee_id = d.employee_id
     WHERE d.employee_id = $1 AND d.type = 'payslip' AND d.is_employee_visible = true
     ORDER BY pp.period_year DESC, pp.period_month DESC`,
    [req.user.employeeId], req.dbCtx
  );
  res.json(rows.rows);
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG  (operator only)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/clients/:clientId/audit-log', requireOperator, scopeToClient, async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const rows = await query(
    `SELECT * FROM audit_log WHERE client_id = $1
     ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [req.params.clientId, limit, offset], req.dbCtx
  );
  res.json(rows.rows);
});

export default router;
