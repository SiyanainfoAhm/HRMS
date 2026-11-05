/**
 * Run: npx --yes tsx src/lib/leaveDeductions.test.ts
 * CIRT leave calculation, Ref ADM:Gen:1521 (October 2026, leave period 20.09.2026 - 19.10.2026).
 */
import { computeLeaveCuts, leaveLineError, normalizeLeaveLines, type LeaveLine } from "./leaveDeductions";

function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const run = { runMonth: 10, runYear: 2026, hraPercent: 30, medicalFixed: 3000 };

// Case A: GBasic 76,500; 1 HPL day in Sep 2026 (30 days, DA 63%).
{
  const ctx = { ...run, grossBasic: 76500, daPercent: 63 };
  const c = computeLeaveCuts([{ type: "HPL", month: 9, year: 2026, days: 1, grossBasic: 76500, daPercent: 63, daysInMonth: 30 }], ctx);
  eq(c.basic, 1275, "Case A Basic cut");
  eq(c.da, 803, "Case A DA cut");
  eq(c.hplAdjustment, 2078, "Case A HPL adjustment");
  eq(76500 - c.basic, 75225, "Case A Basic");
  eq(Math.round(76500 * 0.63) - c.da, 47392, "Case A DA");
  eq(c.hra, 0, "HPL leaves HRA");
  eq(c.medical, 0, "HPL leaves Medical");
  eq(22950 - c.hra, 22950, "Case A HRA");
  eq(3000 - c.medical, 3000, "Case A Medical");
}

// Case B: GBasic 43,100; HPL 4 + EOL 2 in Sep (30 days), HPL 1 + EOL 2 in Oct (31 days). DA 63% both months.
{
  const ctx = { ...run, grossBasic: 43100, daPercent: 63 };
  const lines: LeaveLine[] = [
    { type: "HPL", month: 9, year: 2026, days: 4, grossBasic: 43100, daPercent: 63, daysInMonth: 30 },
    { type: "EOL", month: 9, year: 2026, days: 2, grossBasic: 43100, daPercent: 63, daysInMonth: 30 },
    { type: "HPL", month: 10, year: 2026, days: 1 },
    { type: "EOL", month: 10, year: 2026, days: 2 },
  ];
  const c = computeLeaveCuts(lines, ctx);
  eq(43100 - c.basic, 33878, "Case B Basic");
  eq(percentOfDa(43100) - c.da, 21343, "Case B DA");
  eq(12930 - c.hra, 11234, "Case B HRA");
  eq(3000 - c.medical, 2606, "Case B Medical");
  eq(c.hplDays, 5, "HPL days");
  eq(c.eolDays, 4, "EOL days");
  // Each line is calculated on its own month: Sep EOL 2 / 30 vs Oct EOL 2 / 31.
  eq(c.lines[1].basic, 2873, "Sep EOL basic");
  eq(c.lines[3].basic, 2781, "Oct EOL basic");
}

function percentOfDa(b: number) { return Math.round(b * 0.63); }

// DA is derived from the Basic cut at the leave month's rate, not the run month's.
{
  const c = computeLeaveCuts([{ type: "HPL", month: 6, year: 2026, days: 2, grossBasic: 30000, daPercent: 60, daysInMonth: 30 }], { ...run, grossBasic: 30000, daPercent: 63 });
  eq(c.basic, 1000, "Jun HPL basic");
  eq(c.da, 600, "Jun HPL DA at 60%");
}

// No leave: nothing changes.
{
  const c = computeLeaveCuts([], { ...run, grossBasic: 50000, daPercent: 63 });
  eq(c.basic + c.da + c.hra + c.medical, 0, "no leave");
  eq(computeLeaveCuts([{ type: "EOL", month: 10, year: 2026, days: 0 }], { ...run, grossBasic: 50000, daPercent: 63 }).lines.length, 0, "0-day line ignored");
}

// Legacy single-month data becomes one line per type; a stored list wins.
{
  const lines = normalizeLeaveLines({ hplDays: 1, hplReferenceMonth: 9, hplReferenceYear: 2026, eolDays: 0 }, 10, 2026);
  eq(lines.length, 1, "legacy -> one line");
  eq(lines[0].type, "HPL", "legacy type");
  eq(lines[0].month, 9, "legacy month");
  const both = normalizeLeaveLines({ hplDays: 2, eolDays: 3 }, 10, 2026);
  eq(both.length, 2, "legacy HPL + EOL -> two lines");
  eq(both[0].month, 10, "legacy default month is the run month");
  const stored = normalizeLeaveLines({ leaveLines: [{ type: "EOL", month: 9, year: 2026, days: 2 }], hplDays: 9 }, 10, 2026);
  eq(stored.length, 1, "stored list wins over legacy fields");
}

// Save Draft is blocked for empty / 0 / too many days; a duplicate line is not an error.
eq(leaveLineError({ month: 9, year: 2026, days: 0 }), "Enter days (1–30)", "0 days is an error");
eq(leaveLineError({ month: 9, year: 2026, days: NaN }), "Enter days (1–30)", "empty days is an error");
eq(leaveLineError({ month: 9, year: 2026, days: 31 }), "At most 30 days in Sep 2026", "more than the month has");
eq(leaveLineError({ month: 10, year: 2026, days: 31 }), null, "31 days in October is fine");
eq(leaveLineError({ month: 2, year: 2028, days: 29 }), null, "leap February");
eq(leaveLineError({ month: 9, year: 2026, days: 1 }), null, "1 day is fine");

// Through the real Run Payroll compute (what the screen and the draft use): spec cases and no-leave.
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";
{
  const ded = { incomeTax: 0, pt: 0, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0, stdLicenceFee: 0, electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0, vehCharge: 0, other: 0, quarterRent: 0 };
  const gr = (grossBasic: number, extra: Partial<GovRecalcPayload> = {}): GovRecalcPayload => ({
    grossBasic, daPercent: 63, hraPercent: 30, medicalFixed: 3000, payLevel: 1, deductionDefaults: ded,
    cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 },
    ...extra,
  });
  const go = (g: GovRecalcPayload) => runGovernmentPayrollCompute(g, { daysInMonth: 31, payDays: 31, runYear: 2026, runMonth: 10, payrollConfig: null, governmentMonthly: null }).comp as unknown as Record<string, number>;
  const sep = { grossBasic: 0, daPercent: 63, daysInMonth: 30 };

  const none = go(gr(76500));
  eq(none.basicPaid, 76500, "no leave: Basic unchanged");
  eq(none.daPaid, 48195, "no leave: DA unchanged");
  eq(none.hplAdjustment, 0, "no leave: no HPL adjustment");

  const caseA = go(gr(76500, { leaveLines: [{ type: "HPL", month: 9, year: 2026, days: 1, ...sep, grossBasic: 76500 }], hplDays: 1 }));
  eq(caseA.basicPaid, 75225, "Case A Basic");
  eq(caseA.daPaid, 47392, "Case A DA");
  eq(caseA.hraPaid, 22950, "Case A HRA");
  eq(caseA.medicalPaid, 3000, "Case A Medical");
  eq(caseA.hplAdjustment, 2078, "Case A HPL adjustment");
  eq(caseA.hplDays, 1, "Case A HPL days");

  const caseB = go(gr(43100, {
    leaveLines: [
      { type: "HPL", month: 9, year: 2026, days: 4, ...sep, grossBasic: 43100 },
      { type: "EOL", month: 9, year: 2026, days: 2, ...sep, grossBasic: 43100 },
      { type: "HPL", month: 10, year: 2026, days: 1 },
      { type: "EOL", month: 10, year: 2026, days: 2 },
    ],
  }));
  eq(caseB.basicPaid, 33878, "Case B Basic");
  eq(caseB.daPaid, 21343, "Case B DA");
  eq(caseB.hraPaid, 11234, "Case B HRA");
  eq(caseB.medicalPaid, 2606, "Case B Medical");
  eq(caseB.hplDays + caseB.eolDays, 9, "Case B leave days");

  // Old single-month data (no leaveLines): 1 HPL day with reference Sep 2026 gives the same lines.
  const legacy = go(gr(76500, { hplDays: 1, hplReferenceMonth: 9, hplReferenceYear: 2026, hplReferenceSalary: { basic: 76500, da: 45900, hra: 22950, medical: 3000 }, hplReferenceDaysInMonth: 30 }));
  eq(legacy.basicPaid, 75225, "legacy single-month row: Basic");
  eq(legacy.daPaid, 47392, "legacy single-month row: DA at the 63% in force (not the stored 60%)");

  // Leave lines do not touch an EOL-free HPL row's HRA / Medical; quarter holders (HRA paid 0) never go negative.
  const quarter = go(gr(43100, { hasQuarter: true, leaveLines: [{ type: "EOL", month: 10, year: 2026, days: 2 }] }));
  eq(quarter.hraPaid, 0, "quarter holder HRA stays 0, never negative");

  // A typed (manual) HPL deduction wins and skips the earnings cut.
  const manual = go(gr(76500, { leaveLines: [{ type: "HPL", month: 9, year: 2026, days: 1, ...sep, grossBasic: 76500 }], hplDeductionManualOverride: true, deductionDefaults: { ...ded, hpl: 500 } }));
  eq(manual.basicPaid, 76500, "manual HPL: Basic not cut");
  eq((manual as unknown as { deductions: Record<string, number> }).deductions.hpl, 500, "manual HPL: typed deduction used");
}

console.log("leaveDeductions.test.ts: all tests passed");
