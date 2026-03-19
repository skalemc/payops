// services/cpf.service.js — CPF calculation service
// Wraps the core engine with DB-backed rate table lookups
// so historical payroll runs use the correct rates for that period.

import { queryOne } from '../lib/db.js';

const OW_CEILING_DEFAULT = 8_000_00;   // cents — S$8,000/month from Jan 2026

// ── Rate lookup ──────────────────────────────────────────────────────────────
async function getRates(residencyType, age, asOfDate = new Date()) {
  const row = await queryOne(
    `SELECT ee_rate, er_rate, ow_ceiling, aw_ceiling_annual,
            sdl_rate, sdl_min_cents, sdl_max_cents,
            oa_rate, sa_rate, ma_rate
     FROM cpf_rate_snapshots
     WHERE residency_type = $1
       AND age_min <= $2
       AND (age_max IS NULL OR age_max >= $2)
       AND effective_from <= $3
       AND (effective_to IS NULL OR effective_to > $3)
     ORDER BY effective_from DESC
     LIMIT 1`,
    [residencyType === 'pr3' ? 'citizen' : residencyType, age, asOfDate]
  );
  if (!row) throw new Error(`No CPF rate found for ${residencyType} age ${age}`);
  return row;
}

// ── Core calculation ─────────────────────────────────────────────────────────
function cpfFloor(n) { return Math.floor(n + 1e-9); }

function calcSDL(grossCents, rateCfg) {
  const raw = cpfFloor(grossCents * Number(rateCfg.sdl_rate));
  return Math.min(rateCfg.sdl_max_cents, Math.max(rateCfg.sdl_min_cents, raw));
}

// ── Main exported function ───────────────────────────────────────────────────
/**
 * computeEmployeeCPF
 * All monetary inputs and outputs are in INTEGER CENTS.
 */
export async function computeEmployeeCPF({
  residencyType,
  age,
  ordinaryWageCents,
  additionalWageCents  = 0,
  daysWorked           = null,
  totalDaysInMonth     = 31,
  totalOWForYearCents  = null,
  awCeilingUsedCents   = 0,
  asOfDate             = new Date(),
}) {
  const rates = await getRates(residencyType, age, asOfDate);
  const owCeiling   = rates.ow_ceiling;
  const awCeilingAnnual = rates.aw_ceiling_annual;

  // 1. Prorate OW for unpaid leave / partial month
  const owWorked = daysWorked !== null
    ? Math.floor(ordinaryWageCents * daysWorked / totalDaysInMonth)
    : ordinaryWageCents;

  // 2. Cap OW
  const owCapped = Math.min(owWorked, owCeiling);

  // 3. AW ceiling
  const annualOW  = totalOWForYearCents ?? owWorked;
  const awCeiling = Math.max(0, awCeilingAnnual - annualOW);
  const awLiable  = Math.min(additionalWageCents, Math.max(0, awCeiling - awCeilingUsedCents));

  // 4. CPF base
  const cpfBase = owCapped + awLiable;
  const gross   = owWorked + additionalWageCents;

  // 5. EE / ER contributions
  let eeCPF, erCPF;
  const eeRate = Number(rates.ee_rate);
  const erRate = Number(rates.er_rate);

  if (gross < 50_000)         { eeCPF = 0; erCPF = cpfFloor(cpfBase * erRate); }
  else if (gross < 75_000)    { eeCPF = cpfFloor(eeRate * (gross - 50_000)); erCPF = cpfFloor(cpfBase * erRate); }
  else                        { eeCPF = cpfFloor(cpfBase * eeRate); erCPF = cpfFloor(cpfBase * erRate); }

  // 6. SDL
  const sdl = calcSDL(gross, rates);

  // 7. CPF allocation (OA/SA/MA)
  let cpfOA = null, cpfSA = null, cpfMA = null;
  if (rates.oa_rate) {
    const total = eeCPF + erCPF;
    cpfOA = cpfFloor(total * Number(rates.oa_rate));
    cpfSA = cpfFloor(total * Number(rates.sa_rate));
    cpfMA = total - cpfOA - cpfSA;  // MA gets the remainder (avoids rounding loss)
  }

  return {
    // Wages (cents)
    ordinaryWage:     owWorked,
    ordinaryWageCapped: owCapped,
    additionalWage:   additionalWageCents,
    awLiable,
    grossPay:         gross,

    // CPF (cents)
    eeCPF, erCPF,
    cpfRemittance:    eeCPF + erCPF,
    sdl,
    cpfOA, cpfSA, cpfMA,

    // Net
    netPay: gross - eeCPF,

    // Metadata
    eeRate, erRate,
    owCeiling,
    graduated:  gross < 75_000,
    owCeiled:   ordinaryWageCents > owCeiling,
    awCeilingApplied: awLiable < additionalWageCents,
    newAwCeilingUsed: awCeilingUsedCents + awLiable,
  };
}

// ── Batch payroll run ────────────────────────────────────────────────────────
export async function computePayrollRun(employees, payPeriod) {
  const [year, month] = payPeriod.split('-').map(Number);
  const totalDays = new Date(year, month, 0).getDate();
  const asOfDate  = new Date(year, month - 1, 1);

  const results = await Promise.all(employees.map(async emp => {
    const result = await computeEmployeeCPF({
      residencyType:       emp.residencyType,
      age:                 emp.age,
      ordinaryWageCents:   emp.basicSalary + (emp.fixedAllowance ?? 0),
      additionalWageCents: emp.additionalWage ?? 0,
      daysWorked:          emp.daysWorked ?? null,
      totalDaysInMonth:    totalDays,
      totalOWForYearCents: emp.totalOWForYearCents ?? null,
      awCeilingUsedCents:  emp.awCeilingUsedCents ?? 0,
      asOfDate,
    });
    return { employeeId: emp.id, name: emp.name, ...result };
  }));

  const totals = results.reduce((acc, r) => {
    acc.grossPay      += r.grossPay;
    acc.netPay        += r.netPay;
    acc.eeCPF         += r.eeCPF;
    acc.erCPF         += r.erCPF;
    acc.cpfRemittance += r.cpfRemittance;
    acc.sdl           += r.sdl;
    return acc;
  }, { grossPay:0, netPay:0, eeCPF:0, erCPF:0, cpfRemittance:0, sdl:0 });

  return { period: payPeriod, results, totals };
}
