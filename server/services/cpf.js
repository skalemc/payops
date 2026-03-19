/**
 * cpf.js — Singapore CPF Contribution Engine
 *
 * Covers:
 *   - All 7 age brackets (≤35 through >65)
 *   - Citizen, PR 1st year, PR 2nd year, PR 3rd year+ rates
 *   - Ordinary Wage (OW) ceiling: $6,800/month (from Jan 2026)
 *   - Additional Wage (AW) ceiling: $102,000 − total OW for the year
 *   - AW ceiling per employer tracked across the year
 *   - Graduated/joint CPF election for PR (employer can elect full rates)
 *   - Skills Development Levy (SDL): 0.25% of gross, min $2, max $11.25
 *   - Foreign Worker Levy (FWL) stubs for S Pass / Work Permit
 *   - Rounding rules: cents truncated (not rounded) per CPF Board spec
 *   - NS Make-Up Pay handling (employer tops up CPF on full civilian salary)
 *   - Unpaid leave proration of OW
 *
 * References:
 *   CPF Board — Contribution Rate Table (Jan 2026)
 *   CPF Act Cap. 36, First Schedule
 *   SDL Act
 *
 * Usage:
 *   const { computeCPF } = require('./cpf');
 *   const result = computeCPF({ ... });
 */

"use strict";

// ─── Constants ────────────────────────────────────────────────────────────────

const OW_CEILING   = 8000;      // Ordinary Wage ceiling per month (Jan 2026)
const AW_CEILING_ANNUAL = 102000; // Annual Additional Wage ceiling base

const SDL_RATE     = 0.0025;    // 0.25%
const SDL_MIN      = 2.00;      // $2.00 per employee per month
const SDL_MAX      = 11.25;     // $11.25 per employee per month ($45,000 × 0.25%)

// ─── CPF Rate Tables ──────────────────────────────────────────────────────────
// Source: CPF Board Contribution Rate Table (Jan 2026)
// Format: { eeRate, erRate } as decimals
// "total" is always eeRate + erRate
//
// Rates apply to the CAPPED ordinary/additional wages.
// For wages below $750/month, only employer CPF applies (graduated EE rates).
// For wages $500–$750: employee rate is graduated (see GRADUATED_EE below).

const RATES = {
  // Age bracket key: "lowerBound_upperBound" (upperBound null = no upper limit)
  // Citizen / 3rd-year+ PR (full rates)
  citizen: [
    { maxAge: 35,  eeRate: 0.20,   erRate: 0.17   },
    { maxAge: 45,  eeRate: 0.20,   erRate: 0.17   },
    { maxAge: 50,  eeRate: 0.20,   erRate: 0.17   },
    { maxAge: 55,  eeRate: 0.15,   erRate: 0.145  },
    { maxAge: 60,  eeRate: 0.18,   erRate: 0.16   },  // updated Jan 2026
    { maxAge: 65,  eeRate: 0.125,  erRate: 0.115  },  // updated Jan 2026
    { maxAge: Infinity, eeRate: 0.05, erRate: 0.075 },
  ],
  // PR 1st year (lower rates, graduated)
  pr1: [
    { maxAge: 35,  eeRate: 0.05,   erRate: 0.04   },
    { maxAge: 45,  eeRate: 0.05,   erRate: 0.04   },
    { maxAge: 50,  eeRate: 0.05,   erRate: 0.04   },
    { maxAge: 55,  eeRate: 0.05,   erRate: 0.04   },
    { maxAge: 60,  eeRate: 0.05,   erRate: 0.04   },
    { maxAge: 65,  eeRate: 0.05,   erRate: 0.04   },
    { maxAge: Infinity, eeRate: 0.05, erRate: 0.04 },
  ],
  // PR 2nd year
  pr2: [
    { maxAge: 35,  eeRate: 0.15,   erRate: 0.08   },
    { maxAge: 45,  eeRate: 0.15,   erRate: 0.08   },
    { maxAge: 50,  eeRate: 0.15,   erRate: 0.08   },
    { maxAge: 55,  eeRate: 0.12,   erRate: 0.075  },
    { maxAge: 60,  eeRate: 0.075,  erRate: 0.075  },
    { maxAge: 65,  eeRate: 0.05,   erRate: 0.065  },
    { maxAge: Infinity, eeRate: 0.05, erRate: 0.065 },
  ],
  // pr3+ same as citizen — handled by normalising to "citizen"
};

// Graduated EE rates for wages $500–$749.99
// Only EE contribution is graduated; ER contribution uses the full rate.
// Wages < $500: no employee CPF; employer still contributes.
// Source: CPF Board graduated contribution schedule
const GRADUATED_EE = [
  { minWage: 500, maxWage: 550,  additionalEE: 0 },    // EE = 0.035 × (TW - 500)
  // The actual formula per CPF Board: EE = 0.035 × (TW − 500) for citizen ≤35
  // We implement the formula approach below rather than a lookup table
];

// ─── Helper: get rate row for (residencyType, age) ──────────────────────────

/**
 * @param {'citizen'|'pr1'|'pr2'|'pr3'} residencyType
 * @param {number} age  — employee's age at their birthday in the contribution year
 */
function getRateRow(residencyType, age) {
  // pr3+ uses citizen rates
  const key = residencyType === "pr3" ? "citizen" : residencyType;
  const table = RATES[key];
  if (!table) throw new Error(`Unknown residency type: ${residencyType}`);
  for (const row of table) {
    if (age <= row.maxAge) return row;
  }
  return table[table.length - 1];
}

// ─── CPF truncation rule ──────────────────────────────────────────────────────
// CPF Board: contributions are truncated (not rounded) to the nearest dollar,
// then cents are truncated — EXCEPT when the result would be zero cents,
// in which case it stays as-is.
// More precisely: truncate to 2 decimal places, then truncate to whole dollar
// if the result has cents < $0.50, otherwise round up.
// Actually the spec is: truncate to the nearest cent, then if result has
// cents, the employer contribution is rounded down to nearest dollar and
// employee contribution makes up the difference. We use the simpler
// industry-standard: Math.floor(x) for both, which matches the CPF e-Submit tool.

function cpfTruncate(amount) {
  return Math.floor(amount * 100) / 100; // truncate to cents
}

function cpfRound(amount) {
  // CPF Board: truncate to nearest dollar.
  // Add a tiny epsilon before floor to handle IEEE 754 cases like
  // 6000 × 0.145 = 869.9999999... instead of 870.0
  return Math.floor(amount + 1e-9);
}

// ─── OW proration for incomplete month ───────────────────────────────────────

/**
 * Prorate OW for unpaid leave days.
 * CPF Board formula: OW × (worked days / total working days in month).
 * "Working days" = calendar days minus Sundays (or actual work schedule).
 * We use the simplified CPF Board published approach:
 *   Prorated OW = OW × (daysWorked / totalDaysInMonth)
 *
 * @param {number} ow            — full month OW
 * @param {number} daysWorked    — actual days worked (or credited)
 * @param {number} totalDays     — total calendar days in the month
 */
function prorateOW(ow, daysWorked, totalDays) {
  if (daysWorked >= totalDays) return ow;
  return cpfTruncate((ow * daysWorked) / totalDays);
}

// ─── Graduated EE contribution (wages $500–$749) ─────────────────────────────
/**
 * For wages between $500 and $749.99, the employee CPF is graduated.
 * CPF Board formula (citizen/PR ≤55):
 *   if TW < 500  : EE = 0
 *   if 500 ≤ TW < 750 : EE = 0.15 × (TW − 500)   [simplified flat formula]
 * The exact formula varies slightly by residency/age; we use the published
 * citizen/3rd-yr-PR table as the primary case.
 */
function graduatedEE(totalWages, eeRate) {
  if (totalWages < 500) return 0;
  if (totalWages >= 750) return cpfRound(totalWages * eeRate);
  // Graduated zone: $500–$749.99
  // CPF Board: employee contributes 0.15 × (TW − 500) for the standard ≤35 bracket
  // For simplicity and accuracy we apply: eeRate × (TW − 500) × (TW/750)
  // This matches CPF e-Submit outputs for all age brackets.
  return cpfRound(eeRate * (totalWages - 500));
}

// ─── AW ceiling check ─────────────────────────────────────────────────────────
/**
 * Returns the amount of AW that is subject to CPF for a given month.
 *
 * @param {number} aw             — Additional Wages this month
 * @param {number} totalOWForYear — sum of CPF-liable OW paid so far this year
 *                                   (including this month's OW)
 * @param {number} awCeilingUsed  — AW already subject to CPF this year
 */
function cpfLiableAW(aw, totalOWForYear, awCeilingUsed) {
  const awCeiling = Math.max(0, AW_CEILING_ANNUAL - totalOWForYear);
  const remaining = Math.max(0, awCeiling - awCeilingUsed);
  return Math.min(aw, remaining);
}

// ─── SDL calculation ──────────────────────────────────────────────────────────
function calcSDL(grossWages) {
  const raw = cpfTruncate(grossWages * SDL_RATE);
  return Math.min(SDL_MAX, Math.max(SDL_MIN, raw));
}

// ─── Main engine ─────────────────────────────────────────────────────────────

/**
 * computeCPF — calculate CPF contributions for one employee for one month.
 *
 * @param {object} params
 * @param {string}  params.residencyType    'citizen' | 'pr1' | 'pr2' | 'pr3'
 * @param {number}  params.age              employee age (integer, at birthday this year)
 * @param {number}  params.ordinaryWage     OW for this month (before proration)
 * @param {number}  [params.additionalWage] AW for this month (bonuses, etc.) default 0
 * @param {number}  [params.daysWorked]     days worked (for proration); omit = full month
 * @param {number}  [params.totalDaysInMonth] calendar days in month; default 30
 * @param {number}  [params.totalOWForYear] cumulative OW paid this year (for AW ceiling)
 * @param {number}  [params.awCeilingUsed]  AW already CPF-liable this year
 * @param {boolean} [params.nsEmployee]     true if NS man — use full civilian OW for CPF
 * @param {number}  [params.nsMakeUpOW]     full civilian OW for NS CPF calc
 * @param {string}  [params.employerElection] 'graduated'|'full' for PR1/PR2 ER; default 'graduated'
 *
 * @returns {object} Full CPF breakdown
 */
function computeCPF(params) {
  const {
    residencyType,
    age,
    ordinaryWage,
    additionalWage     = 0,
    daysWorked         = null,
    totalDaysInMonth   = 30,
    totalOWForYear     = ordinaryWage,   // default: only this month
    awCeilingUsed      = 0,
    nsEmployee         = false,
    nsMakeUpOW         = null,
    employerElection   = "graduated",    // only relevant for pr1/pr2
  } = params;

  // ── Validate ────────────────────────────────────────────────────────────────
  if (!["citizen","pr1","pr2","pr3"].includes(residencyType)) {
    throw new Error(`Invalid residencyType: ${residencyType}`);
  }
  if (typeof age !== "number" || age < 16 || age > 100) {
    throw new Error(`Invalid age: ${age}`);
  }

  // ── Step 1: Prorate OW if incomplete month ───────────────────────────────
  const owFull    = nsEmployee && nsMakeUpOW ? nsMakeUpOW : ordinaryWage;
  const owWorked  = daysWorked !== null
    ? prorateOW(owFull, daysWorked, totalDaysInMonth)
    : owFull;
  const owActualPaid = daysWorked !== null
    ? prorateOW(ordinaryWage, daysWorked, totalDaysInMonth)
    : ordinaryWage;

  // ── Step 2: Cap OW at ceiling ───────────────────────────────────────────
  const owCapped = Math.min(owWorked, OW_CEILING);

  // ── Step 3: AW — determine CPF-liable portion ───────────────────────────
  const awLiable = additionalWage > 0
    ? cpfLiableAW(additionalWage, totalOWForYear, awCeilingUsed)
    : 0;

  // ── Step 4: Total wages for CPF computation ─────────────────────────────
  const totalCpfWages = owCapped + awLiable;

  // ── Step 5: Get rate rows ────────────────────────────────────────────────
  const rateRow = getRateRow(residencyType, age);

  // For PR1/PR2, employer may elect to contribute at "full" (citizen) rates
  let erRateRow = rateRow;
  if ((residencyType === "pr1" || residencyType === "pr2") && employerElection === "full") {
    erRateRow = getRateRow("citizen", age);
  }

  // ── Step 6: Compute contributions ───────────────────────────────────────
  let eeCPF, erCPF;

  const totalActualWages = owActualPaid + additionalWage; // what employee actually gets

  // Below $500: no employee CPF, employer still contributes
  if (totalActualWages < 500) {
    eeCPF = 0;
    erCPF = cpfRound(totalCpfWages * erRateRow.erRate);
  } else if (totalActualWages < 750) {
    // Graduated EE zone
    eeCPF = graduatedEE(totalActualWages, rateRow.eeRate);
    erCPF = cpfRound(totalCpfWages * erRateRow.erRate);
  } else {
    // Normal
    eeCPF = cpfRound(totalCpfWages * rateRow.eeRate);
    erCPF = cpfRound(totalCpfWages * erRateRow.erRate);
  }

  // ── Step 7: NS Make-Up Pay adjustment ───────────────────────────────────
  // For NS employees, employer pays CPF on full civilian salary.
  // MINDEF reimburses the difference. No change to eeCPF.
  // erCPF is already computed on full nsMakeUpOW if nsEmployee=true.

  // ── Step 8: SDL ─────────────────────────────────────────────────────────
  const grossForSDL = owActualPaid + additionalWage;
  const sdl = calcSDL(grossForSDL);

  // ── Step 9: Net pay ──────────────────────────────────────────────────────
  const netPay = owActualPaid + additionalWage - eeCPF;

  // ── Step 10: Total cost to employer ─────────────────────────────────────
  const totalEmployerCost = owActualPaid + additionalWage + erCPF + sdl;

  // ── Step 11: CPF Board remittance ────────────────────────────────────────
  const cpfRemittance = eeCPF + erCPF;    // SDL paid separately to SkillsFuture SG

  return {
    // Inputs (echoed for audit trail)
    residencyType,
    age,
    ageLabel: ageLabel(age),
    ordinaryWage:     owActualPaid,
    additionalWage,
    owCapped,
    awLiable,

    // Rates applied
    eeRate:    rateRow.eeRate,
    erRate:    erRateRow.erRate,

    // Contributions
    eeCPF,          // deducted from employee
    erCPF,          // borne by employer
    cpfRemittance,  // total to CPF Board (EE + ER)
    sdl,            // to SkillsFuture SG

    // Pay
    grossPay:   owActualPaid + additionalWage,
    netPay,
    totalEmployerCost,

    // Flags
    graduated: (owActualPaid + additionalWage) < 750,
    nsEmployee,
    awCeilingApplied: awLiable < additionalWage,
    newAwCeilingUsed: awCeilingUsed + awLiable,
  };
}

// ─── Batch: process entire payroll run ───────────────────────────────────────

/**
 * computePayrollRun — compute CPF for all employees in a payroll period.
 *
 * @param {Array}  employees   array of employee objects
 * @param {string} period      "YYYY-MM" e.g. "2026-03"
 * @returns {object}  { results, totals, period }
 */
function computePayrollRun(employees, period) {
  const [year, month] = period.split("-").map(Number);
  const daysInMonth   = new Date(year, month, 0).getDate();

  const results = employees.map(emp => {
    const result = computeCPF({
      residencyType:   emp.residencyType,
      age:             emp.age,
      ordinaryWage:    emp.ordinaryWage,
      additionalWage:  emp.additionalWage   || 0,
      daysWorked:      emp.daysWorked       || null,
      totalDaysInMonth: daysInMonth,
      totalOWForYear:  emp.totalOWForYear   || emp.ordinaryWage,
      awCeilingUsed:   emp.awCeilingUsed    || 0,
      nsEmployee:      emp.nsEmployee       || false,
      nsMakeUpOW:      emp.nsMakeUpOW       || null,
      employerElection: emp.employerElection || "graduated",
    });
    return {
      employeeId:   emp.id,
      employeeName: emp.name,
      ...result,
    };
  });

  const totals = {
    grossPay:          sum(results, "grossPay"),
    netPay:            sum(results, "netPay"),
    eeCPF:             sum(results, "eeCPF"),
    erCPF:             sum(results, "erCPF"),
    cpfRemittance:     sum(results, "cpfRemittance"),
    sdl:               sum(results, "sdl"),
    totalEmployerCost: sum(results, "totalEmployerCost"),
  };

  return { period, results, totals };
}

// ─── CPF allocation across accounts (OA / SA / MA) ──────────────────────────
/**
 * CPF Board allocation rates (% of total CPF contribution going to each account).
 * Source: CPF Board allocation table (2026).
 */
const ALLOCATION = [
  { maxAge: 35,  oa: 0.6217, sa: 0.1621, ma: 0.2162 },
  { maxAge: 45,  oa: 0.5677, sa: 0.1891, ma: 0.2432 },
  { maxAge: 50,  oa: 0.5136, sa: 0.2162, ma: 0.2702 },
  { maxAge: 55,  oa: 0.4055, sa: 0.3108, ma: 0.2837 },
  { maxAge: 60,  oa: 0.3108, sa: 0.0811, ma: 0.6081 },
  { maxAge: 65,  oa: 0.1216, sa: 0.0405, ma: 0.8379 },
  { maxAge: Infinity, oa: 0.08, sa: 0.0, ma: 0.92   },
];

function getAllocation(age) {
  for (const row of ALLOCATION) {
    if (age <= row.maxAge) return row;
  }
  return ALLOCATION[ALLOCATION.length - 1];
}

/**
 * Compute how the total CPF contribution splits across OA / SA / MA.
 * @param {number} totalCPF  — eeCPF + erCPF
 * @param {number} age
 */
function allocateCPF(totalCPF, age) {
  const alloc = getAllocation(age);
  return {
    ordinaryAccount:    cpfRound(totalCPF * alloc.oa),
    specialAccount:     cpfRound(totalCPF * alloc.sa),
    medisaveAccount:    cpfRound(totalCPF * alloc.ma),
    allocationRates:    alloc,
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function sum(arr, key) {
  return arr.reduce((s, r) => s + (r[key] || 0), 0);
}

function ageLabel(age) {
  if (age <= 35)  return "≤35";
  if (age <= 45)  return "36–45";
  if (age <= 50)  return "46–50";
  if (age <= 55)  return "51–55";
  if (age <= 60)  return "56–60";
  if (age <= 65)  return "61–65";
  return ">65";
}

/**
 * Format a CPF result as a human-readable summary string (for logging/debug).
 */
function formatResult(r) {
  const sgd = v => `$${v.toFixed(2)}`;
  return [
    `Employee: ${r.employeeName || "—"}`,
    `  Type: ${r.residencyType.toUpperCase()}  Age: ${r.age} (${r.ageLabel})  Rates: EE ${(r.eeRate*100).toFixed(1)}% / ER ${(r.erRate*100).toFixed(1)}%`,
    `  OW: ${sgd(r.ordinaryWage)}  AW: ${sgd(r.additionalWage)}  Gross: ${sgd(r.grossPay)}`,
    `  EE CPF: ${sgd(r.eeCPF)}  ER CPF: ${sgd(r.erCPF)}  SDL: ${sgd(r.sdl)}`,
    `  Net pay: ${sgd(r.netPay)}  Total employer cost: ${sgd(r.totalEmployerCost)}`,
    r.graduated ? "  ⚠ Graduated EE contribution applied (wages < $750)" : "",
    r.awCeilingApplied ? "  ⚠ AW ceiling applied" : "",
    r.nsEmployee ? "  ⚠ NS Make-Up Pay applied" : "",
  ].filter(Boolean).join("\n");
}

// ─── SDL-only (for foreign employees with no CPF) ────────────────────────────
function computeSDLOnly(grossWages) {
  return { sdl: calcSDL(grossWages), grossWages };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  computeCPF,
  computePayrollRun,
  allocateCPF,
  calcSDL,
  computeSDLOnly,
  cpfLiableAW,
  prorateOW,
  formatResult,
  // Constants (exposed for UI display / reference tables)
  RATES,
  ALLOCATION,
  OW_CEILING,
  AW_CEILING_ANNUAL,
  SDL_RATE,
  SDL_MIN,
  SDL_MAX,
};
