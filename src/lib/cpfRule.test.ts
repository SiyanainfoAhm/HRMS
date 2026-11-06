/**
 * Run: npx --yes tsx src/lib/cpfRule.test.ts
 * CIRT CPF rule (confirmed against FoxPro October 2026): whenever TR arrears are paid in the month,
 * CPF = 12% of (Basic + DA + HRA + Transport + Medical + TR arrears), rounded UP to the next rupee.
 * Without TR arrears the configured basis and normal rounding apply, as before.
 */
import { percentOfCeil, percentOf } from "./money";
import { runGovernmentPayrollCompute, type GovRecalcPayload } from "./govRunPayrollCompute";

function eq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// Ceiling to the next whole rupee, exact on paise.
eq(percentOfCeil(75698, 12), 9084, "12% of 75,698 = 9,083.76 -> 9,084");
eq(percentOfCeil(75000, 12), 9000, "an exact amount is not bumped");
eq(percentOfCeil(75001, 12), 9001, "9,000.12 -> 9,001");
eq(percentOf(75001, 12), 9000, "normal rounding stays nearest (the old rule)");
eq(percentOfCeil(0, 12), 0, "zero");
eq(percentOfCeil(100, 0), 0, "zero percent");

const ded = {
  incomeTax: 0, pt: 200, lic: 0, cpf: 0, daCpf: 0, vpf: 0, pfLoan: 0, postOffice: 0, creditSociety: 0,
  electricity: 0, water: 0, mess: 0, loanRecovery: 0, welfare: 0, hpl: 0, eol: 0, vehCharge: 0, other: 0, quarterRent: 0,
};
const gr = (extra: Partial<GovRecalcPayload> = {}): GovRecalcPayload => ({
  grossBasic: 41000, daPercent: 63, hraPercent: 30, medicalFixed: 3000, payLevel: 10, deductionDefaults: ded, hasQuarter: true,
  cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic", "da", "hra", "medical", "transport"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 },
  ...extra,
});
const run = (g: GovRecalcPayload, transportArrear = 0, gm: Record<string, unknown> | null = null) =>
  runGovernmentPayrollCompute(g, { daysInMonth: 31, payDays: 31, runYear: 2026, runMonth: 10, payrollConfig: null, governmentMonthly: gm, transportArrear })
    .comp as unknown as Record<string, number> & { deductions: Record<string, number> };

// Quarter holder (HRA 0): Basic 41,000 + DA 25,830 + Transport + Medical 3,000.
const noArrears = run(gr());
const paid = noArrears.basicPaid + noArrears.daPaid + noArrears.hraPaid + noArrears.transportPaid + noArrears.medicalPaid;
eq(noArrears.hraPaid, 0, "a quarter holder is paid no HRA");
eq(noArrears.deductions.cpf, percentOf(paid, 12), "no TR arrears: the configured basis, normal rounding");

// TR arrears paid (passed in: they are added to the row after the calculation).
const withArrears = run(gr(), 324);
eq(withArrears.deductions.cpf, percentOfCeil(paid + 324, 12), "TR arrears 324 are in the basis, rounded UP");

// The same when the arrears are already inside the monthly snapshot (a recompute of a saved row): no difference, nothing counted twice.
const recomputed = run(gr(), 0, { transportArrearsPaid: 324 });
eq(recomputed.deductions.cpf, withArrears.deductions.cpf, "recompute of a row that holds TR arrears gives the same CPF");
const both = run(gr(), 324, { transportArrearsPaid: 324 });
eq(both.deductions.cpf, withArrears.deductions.cpf, "passed in AND in the snapshot: counted once");

// If the company already lists TR arrears in its CPF basis they are not added a second time.
const listed = run(gr({ cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic", "da", "hra", "medical", "transport", "transport_arrears"], cpfCalculationMode: "percentage", cpfFixedAmount: 0 } }), 324);
eq(listed.deductions.cpf, withArrears.deductions.cpf, "transport_arrears already in the basis: not double counted");

// A fixed-amount CPF and a typed CPF are untouched by the rule.
eq(run(gr({ cpfConfig: { cpfPercentage: 12, cpfBasisFieldKeys: ["gross_basic"], cpfCalculationMode: "fixed_amount", cpfFixedAmount: 5000 } }), 324).deductions.cpf, 5000, "fixed amount unchanged");
eq(run(gr({ cpfManualOverride: true, deductionDefaults: { ...ded, cpf: 777 } }), 324).deductions.cpf, 777, "typed CPF unchanged");

console.log("cpfRule.test.ts: all tests passed");
