/**
 * cpf.test.js — CPF Engine Test Suite
 *
 * Tests every major CPF rule:
 *   1. Standard citizen rates (all 7 age brackets)
 *   2. PR 1st, 2nd, 3rd year rates
 *   3. OW ceiling capping
 *   4. AW ceiling enforcement
 *   5. Graduated EE (wages $500–$749)
 *   6. Below $500 (no EE CPF)
 *   7. OW proration for incomplete month
 *   8. SDL min/max/normal
 *   9. NS Make-Up Pay
 *  10. Employer full-rate election for PR
 *  11. CPF account allocation (OA/SA/MA)
 *  12. Batch payroll run totals
 *  13. Edge cases
 *
 * Run: node cpf.test.js
 */

"use strict";

const {
  computeCPF,
  computePayrollRun,
  allocateCPF,
  calcSDL,
  cpfLiableAW,
  prorateOW,
  formatResult,
  OW_CEILING,
} = require("./cpf");

// ─── Mini test runner ─────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗  ${name}`);
    console.log(`       ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(
    `${msg || "Expected equality"}: got ${a}, expected ${b}`
  );
}

function assertClose(a, b, tol = 0.01, msg) {
  if (Math.abs(a - b) > tol) throw new Error(
    `${msg || "Values not close"}: got ${a}, expected ${b} (±${tol})`
  );
}

function section(name) {
  console.log(`\n── ${name} ─────────────────────────────────────────`);
}

// ─── 1. Standard citizen rates — all age brackets ────────────────────────────

section("1. Citizen rates by age bracket");

test("Citizen ≤35: EE 20%, ER 17%", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:5000 });
  assertEq(r.eeRate, 0.20, "EE rate");
  assertEq(r.erRate, 0.17, "ER rate");
  assertEq(r.eeCPF, 1000, "EE CPF = $1,000");
  assertEq(r.erCPF, 850,  "ER CPF = $850");
  assertEq(r.netPay, 4000, "Net pay = $4,000");
});

test("Citizen 36–45: EE 20%, ER 17%", () => {
  const r = computeCPF({ residencyType:"citizen", age:40, ordinaryWage:5000 });
  assertEq(r.eeRate, 0.20);
  assertEq(r.erRate, 0.17);
});

test("Citizen 46–50: EE 20%, ER 17%", () => {
  const r = computeCPF({ residencyType:"citizen", age:48, ordinaryWage:5000 });
  assertEq(r.eeRate, 0.20);
  assertEq(r.erRate, 0.17);
});

test("Citizen 51–55: EE 15%, ER 14.5%", () => {
  const r = computeCPF({ residencyType:"citizen", age:53, ordinaryWage:5000 });
  assertEq(r.eeRate, 0.15, "EE rate");
  assertEq(r.erRate, 0.145, "ER rate");
  assertEq(r.eeCPF, 750,   "EE CPF = $750");
  assertEq(r.erCPF, 725,   "ER CPF = $725");
});

test("Citizen 56–60: EE 18%, ER 16%", () => {
  const r = computeCPF({ residencyType:"citizen", age:58, ordinaryWage:5000 });
  assertEq(r.eeRate, 0.18);
  assertEq(r.erRate, 0.16);
  assertEq(r.eeCPF, 900);
  assertEq(r.erCPF, 800);
});

test("Citizen 61–65: EE 12.5%, ER 11.5%", () => {
  const r = computeCPF({ residencyType:"citizen", age:63, ordinaryWage:5000 });
  assertEq(r.eeRate, 0.125);
  assertEq(r.erRate, 0.115);
  assertEq(r.eeCPF, 625);
  assertEq(r.erCPF, 575);
});

test("Citizen >65: EE 5%, ER 7.5%", () => {
  const r = computeCPF({ residencyType:"citizen", age:70, ordinaryWage:5000 });
  assertEq(r.eeRate, 0.05);
  assertEq(r.erRate, 0.075);
  assertEq(r.eeCPF, 250);
  assertEq(r.erCPF, 375);
});

// ─── 2. PR rates ──────────────────────────────────────────────────────────────

section("2. PR rates (1st, 2nd, 3rd year)");

test("PR 1st year ≤35: EE 5%, ER 4%", () => {
  const r = computeCPF({ residencyType:"pr1", age:30, ordinaryWage:5000 });
  assertEq(r.eeRate, 0.05);
  assertEq(r.erRate, 0.04);
  assertEq(r.eeCPF, 250);
  assertEq(r.erCPF, 200);
});

test("PR 2nd year ≤35: EE 15%, ER 8%", () => {
  const r = computeCPF({ residencyType:"pr2", age:30, ordinaryWage:5000 });
  assertEq(r.eeRate, 0.15);
  assertEq(r.erRate, 0.08);
  assertEq(r.eeCPF, 750);
  assertEq(r.erCPF, 400);
});

test("PR 3rd year treated as citizen", () => {
  const r3  = computeCPF({ residencyType:"pr3",    age:30, ordinaryWage:5000 });
  const cit = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:5000 });
  assertEq(r3.eeCPF, cit.eeCPF, "PR3 EE CPF = citizen");
  assertEq(r3.erCPF, cit.erCPF, "PR3 ER CPF = citizen");
});

test("PR 2nd year 51–55: EE 12%, ER 7.5%", () => {
  const r = computeCPF({ residencyType:"pr2", age:53, ordinaryWage:5000 });
  assertEq(r.eeRate, 0.12);
  assertEq(r.erRate, 0.075);
});

test("PR1 employer full-rate election uses citizen ER rate", () => {
  const graduated = computeCPF({ residencyType:"pr1", age:30, ordinaryWage:5000, employerElection:"graduated" });
  const full      = computeCPF({ residencyType:"pr1", age:30, ordinaryWage:5000, employerElection:"full" });
  assertEq(full.erRate, 0.17, "ER rate should be citizen 17% when full elected");
  assertEq(full.erCPF, 850,  "ER CPF = $850 at full election");
  assertEq(graduated.erCPF, 200, "Graduated ER CPF = $200");
  // EE rate unchanged
  assertEq(full.eeCPF, graduated.eeCPF, "EE CPF unaffected by employer election");
});

// ─── 3. OW ceiling ───────────────────────────────────────────────────────────

section("3. OW ceiling ($8,000/month)");

test("OW exactly at ceiling: $8,000", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:8000 });
  assertEq(r.owCapped, 8000);
  assertEq(r.eeCPF, 1600);   // 8000 × 0.20
  assertEq(r.erCPF, 1360);   // 8000 × 0.17
});

test("OW above ceiling ($10,000): capped at $8,000", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:10000 });
  assertEq(r.owCapped, 8000, "OW capped at 8000");
  assertEq(r.eeCPF, 1600,   "EE CPF on $8,000 only");
  assertEq(r.erCPF, 1360,   "ER CPF on $8,000 only");
  assertEq(r.grossPay, 10000, "Gross pay is full OW");
  assertEq(r.netPay, 8400,   "Net pay = 10000 − 1600");
});

test("OW below ceiling ($3,500): no cap", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:3500 });
  assertEq(r.owCapped, 3500);
  assertEq(r.eeCPF, 700);
  assertEq(r.erCPF, 595);
});

// ─── 4. AW ceiling ───────────────────────────────────────────────────────────

section("4. AW ceiling ($102,000 − annual OW)");

test("AW fully within ceiling", () => {
  // Annual OW = 12 × 5000 = 60000; AW ceiling = 102000 − 60000 = 42000
  // AW this month = $5,000 — fully liable
  const awLiable = cpfLiableAW(5000, 60000, 0);
  assertEq(awLiable, 5000, "Full AW is CPF-liable");
});

test("AW partially above ceiling", () => {
  // Annual OW = 90000; AW ceiling = 12000; already used 10000
  const awLiable = cpfLiableAW(5000, 90000, 10000);
  assertEq(awLiable, 2000, "Only $2,000 of $5,000 AW is CPF-liable");
});

test("AW fully above ceiling (no liability)", () => {
  const awLiable = cpfLiableAW(5000, 102000, 0);
  assertEq(awLiable, 0, "OW already at annual max — no AW liability");
});

test("AW in computeCPF: bonus partially capped", () => {
  const r = computeCPF({
    residencyType: "citizen", age: 30,
    ordinaryWage: 8000, additionalWage: 5000,
    totalOWForYear: 8000 * 12,  // = 96000
    awCeilingUsed: 4000,        // AW ceiling = 102000 − 96000 = 6000; used 4000 → remaining 2000
  });
  assertEq(r.awLiable, 2000, "AW liable = remaining ceiling $2,000");
  assertEq(r.eeCPF, Math.floor((8000 + 2000) * 0.20), "EE CPF on capped OW+AW");
});

// ─── 5. Graduated EE (wages $500–$749) ───────────────────────────────────────

section("5. Graduated contributions (wages $500–$749)");

test("Wages $600 — graduated EE, full ER", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:600 });
  assert(r.graduated, "Should be flagged graduated");
  assert(r.eeCPF < Math.floor(600 * 0.20), "EE CPF should be less than full rate");
  assert(r.eeCPF > 0, "EE CPF should be > 0");
  assertEq(r.erCPF, Math.floor(600 * 0.17), "ER CPF at full rate");
});

test("Wages $499 — no EE CPF, employer still contributes", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:499 });
  assertEq(r.eeCPF, 0, "No EE CPF below $500");
  assert(r.erCPF > 0, "ER CPF still applies");
  assertEq(r.netPay, 499, "Net pay = full gross (no EE deduction)");
});

test("Wages exactly $750 — full rates apply", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:750 });
  assert(!r.graduated, "Should not be graduated");
  assertEq(r.eeCPF, Math.floor(750 * 0.20), "Full EE CPF");
});

// ─── 6. OW proration ─────────────────────────────────────────────────────────

section("6. OW proration (unpaid leave / mid-month join)");

test("15 days worked out of 31: OW prorated", () => {
  const r = computeCPF({
    residencyType:"citizen", age:30,
    ordinaryWage:6200, daysWorked:15, totalDaysInMonth:31,
  });
  const expectedOW = Math.floor((6200 * 15 / 31) * 100) / 100;
  assertClose(r.ordinaryWage, expectedOW, 0.02, "Prorated OW");
});

test("Full month (no daysWorked): no proration", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:5000 });
  assertEq(r.ordinaryWage, 5000);
});

test("Proration doesn't affect AW", () => {
  const r = computeCPF({
    residencyType:"citizen", age:30,
    ordinaryWage:5000, additionalWage:2000,
    daysWorked:15, totalDaysInMonth:30,
  });
  assertEq(r.additionalWage, 2000, "AW not prorated");
});

// ─── 7. SDL ───────────────────────────────────────────────────────────────────

section("7. Skills Development Levy (SDL)");

test("SDL normal: $5,000 gross → $12.50 → capped at $11.25", () => {
  const sdl = calcSDL(5000);
  assertEq(sdl, 11.25, "SDL capped at $11.25");
});

test("SDL minimum: $500 gross → $1.25 → raised to $2.00", () => {
  const sdl = calcSDL(500);
  assertEq(sdl, 2.00, "SDL minimum $2.00");
});

test("SDL normal range: $1,000 gross → $2.50", () => {
  const sdl = calcSDL(1000);
  assertEq(sdl, 2.50);
});

test("SDL at cap: $4,500 gross → $11.25", () => {
  const sdl = calcSDL(4500);
  assertEq(sdl, 11.25);
});

test("SDL in computeCPF result is correct", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:3000 });
  assertEq(r.sdl, Math.min(11.25, Math.max(2, Math.floor(3000 * 0.0025 * 100)/100)));
});

// ─── 8. NS Make-Up Pay ────────────────────────────────────────────────────────

section("8. NS Make-Up Pay");

test("NS employee: CPF computed on full civilian salary", () => {
  const ns = computeCPF({
    residencyType:"citizen", age:28,
    ordinaryWage:1500,      // NS allowance actually paid
    nsEmployee: true,
    nsMakeUpOW: 5000,       // full civilian salary
  });
  const normal = computeCPF({ residencyType:"citizen", age:28, ordinaryWage:5000 });
  assertEq(ns.eeCPF, normal.eeCPF, "EE CPF on full civilian salary");
  assertEq(ns.erCPF, normal.erCPF, "ER CPF on full civilian salary");
  assertEq(ns.netPay, 1500 - ns.eeCPF, "Net pay based on actual OW paid");
});

// ─── 9. CPF account allocation ────────────────────────────────────────────────

section("9. CPF account allocation (OA / SA / MA)");

test("Age 30 citizen: OA 62.17%, SA 16.21%, MA 21.62%", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:5000 });
  const alloc = allocateCPF(r.cpfRemittance, 30);
  const total = alloc.ordinaryAccount + alloc.specialAccount + alloc.medisaveAccount;
  assertClose(total, r.cpfRemittance, 2, "Allocation sum ≈ total CPF");
  assert(alloc.ordinaryAccount > alloc.specialAccount, "OA > SA at age 30");
  assert(alloc.ordinaryAccount > alloc.medisaveAccount, "OA > MA at age 30");
});

test("Age 63 citizen: MA allocation dominates (83.79%)", () => {
  const r = computeCPF({ residencyType:"citizen", age:63, ordinaryWage:5000 });
  const alloc = allocateCPF(r.cpfRemittance, 63);
  assert(alloc.medisaveAccount > alloc.ordinaryAccount, "MA > OA at age 63");
  assert(alloc.medisaveAccount > alloc.specialAccount, "MA > SA at age 63");
});

// ─── 10. Batch payroll run ────────────────────────────────────────────────────

section("10. Batch computePayrollRun");

const SAMPLE_EMPLOYEES = [
  { id:1, name:"Alice Tan",    residencyType:"citizen", age:32, ordinaryWage:5500, additionalWage:0    },
  { id:2, name:"Bob Lim",      residencyType:"citizen", age:55, ordinaryWage:8000, additionalWage:0    },
  { id:3, name:"Carol Chen",   residencyType:"pr2",     age:29, ordinaryWage:4200, additionalWage:2000 },
  { id:4, name:"David Kumar",  residencyType:"citizen", age:68, ordinaryWage:3000, additionalWage:0    },
  { id:5, name:"Eve Ng",       residencyType:"pr1",     age:38, ordinaryWage:6200, additionalWage:0    },
];

test("Batch run returns result for each employee", () => {
  const run = computePayrollRun(SAMPLE_EMPLOYEES, "2026-03");
  assertEq(run.results.length, 5, "5 results");
  assertEq(run.period, "2026-03");
});

test("Batch totals are sum of individual results", () => {
  const run = computePayrollRun(SAMPLE_EMPLOYEES, "2026-03");
  const sumNet  = run.results.reduce((s,r) => s + r.netPay, 0);
  const sumEE   = run.results.reduce((s,r) => s + r.eeCPF, 0);
  const sumER   = run.results.reduce((s,r) => s + r.erCPF, 0);
  const sumSDL  = run.results.reduce((s,r) => s + r.sdl, 0);
  assertEq(run.totals.netPay,    sumNet,  "Net pay total matches");
  assertEq(run.totals.eeCPF,    sumEE,   "EE CPF total matches");
  assertEq(run.totals.erCPF,    sumER,   "ER CPF total matches");
  assertEq(run.totals.sdl,      sumSDL,  "SDL total matches");
});

test("Batch: OW ceiling applied to Bob (OW $8,000 = ceiling, no cap)", () => {
  const run = computePayrollRun(SAMPLE_EMPLOYEES, "2026-03");
  const bob = run.results.find(r => r.employeeId === 2);
  assertEq(bob.owCapped, 8000, "Bob OW capped at $8,000");
  assertEq(bob.grossPay, 8000, "Bob gross pay still $8,000");
});

test("Batch: Alice net pay = gross − EE CPF", () => {
  const run = computePayrollRun(SAMPLE_EMPLOYEES, "2026-03");
  const alice = run.results.find(r => r.employeeId === 1);
  assertEq(alice.netPay, alice.grossPay - alice.eeCPF);
});

// ─── 11. Edge cases ──────────────────────────────────────────────────────────

section("11. Edge cases");

test("Zero OW: no CPF, no SDL minimum waived", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:0 });
  assertEq(r.eeCPF, 0);
  assertEq(r.erCPF, 0);
  assertEq(r.netPay, 0);
  // SDL min $2 still applies on $0 gross
  assertEq(r.sdl, 2.00, "SDL min $2 even on $0 gross");
});

test("AW-only month (OW=0, AW>0)", () => {
  const r = computeCPF({
    residencyType:"citizen", age:30,
    ordinaryWage:0, additionalWage:5000,
    totalOWForYear:0,
  });
  assert(r.eeCPF > 0, "EE CPF on AW");
  assert(r.erCPF > 0, "ER CPF on AW");
});

test("Invalid residencyType throws", () => {
  let threw = false;
  try { computeCPF({ residencyType:"alien", age:30, ordinaryWage:5000 }); }
  catch (e) { threw = true; }
  assert(threw, "Should throw on invalid residencyType");
});

test("Invalid age throws", () => {
  let threw = false;
  try { computeCPF({ residencyType:"citizen", age:10, ordinaryWage:5000 }); }
  catch (e) { threw = true; }
  assert(threw, "Should throw on age < 16");
});

test("Total employer cost = gross + ER CPF + SDL", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:6000, additionalWage:1000 });
  assertEq(
    r.totalEmployerCost,
    r.grossPay + r.erCPF + r.sdl,
    "Total employer cost formula"
  );
});

test("CPF remittance = EE CPF + ER CPF", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:5000 });
  assertEq(r.cpfRemittance, r.eeCPF + r.erCPF);
});

// ─── 12. Real-world cross-check ───────────────────────────────────────────────

section("12. CPF Board published examples (cross-check)");

// From CPF Board website: Citizen, age 30, OW $3,500, no AW
// EE: $3,500 × 20% = $700   ER: $3,500 × 17% = $595
test("CPF Board example: Citizen 30, OW $3,500", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:3500 });
  assertEq(r.eeCPF, 700,  "EE CPF $700");
  assertEq(r.erCPF, 595,  "ER CPF $595");
  assertEq(r.netPay, 2800, "Net pay $2,800");
});

// Citizen 55, OW $6,000: EE 15% = $900, ER 14.5% = $870
test("CPF Board example: Citizen 55, OW $6,000", () => {
  const r = computeCPF({ residencyType:"citizen", age:55, ordinaryWage:6000 });
  assertEq(r.eeCPF, 900,  "EE CPF $900");
  assertEq(r.erCPF, 870,  "ER CPF $870");
});

// Citizen 30, OW $9,000 (above ceiling): CPF on $8,000 only
// EE: $8,000 × 20% = $1,600   ER: $8,000 × 17% = $1,360
test("CPF Board example: Citizen 30, OW $9,000 (above ceiling)", () => {
  const r = computeCPF({ residencyType:"citizen", age:30, ordinaryWage:9000 });
  assertEq(r.eeCPF, 1600, "EE CPF capped: $1,600");
  assertEq(r.erCPF, 1360, "ER CPF capped: $1,360");
  assertEq(r.netPay, 7400, "Net pay = $9,000 − $1,600");
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log("\n─────────────────────────────────────────────────────────");
console.log(`  Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log("\n  ⚠  Some tests failed — review the engine.");
  process.exit(1);
} else {
  console.log("\n  All tests passed ✓");

  // Print a sample payroll run for visual confirmation
  console.log("\n── Sample payroll run output ─────────────────────────────");
  const run = computePayrollRun(SAMPLE_EMPLOYEES, "2026-03");
  run.results.forEach(r => {
    console.log("\n" + formatResult(r));
  });
  console.log("\n── Totals ────────────────────────────────────────────────");
  const t = run.totals;
  const f = v => `$${v.toLocaleString("en-SG", {minimumFractionDigits:2})}`;
  console.log(`  Gross payroll:      ${f(t.grossPay)}`);
  console.log(`  Employee CPF:       ${f(t.eeCPF)}`);
  console.log(`  Employer CPF:       ${f(t.erCPF)}`);
  console.log(`  CPF Board total:    ${f(t.cpfRemittance)}`);
  console.log(`  SDL:                ${f(t.sdl)}`);
  console.log(`  Net salaries:       ${f(t.netPay)}`);
  console.log(`  Total employer cost:${f(t.totalEmployerCost)}`);
}
