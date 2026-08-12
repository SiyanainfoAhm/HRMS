/**
 * Run: npx --yes tsx src/lib/payrollManualOverride.test.ts
 */
import { computeGovernmentMonthlyPayroll } from "./governmentPayroll";
import { computePayrollMasterPreview } from "./payrollMasterCalc";
import { firstDefined, resolveEffectivePayrollValue } from "./effectivePayrollValue";
import { deserializePayrollDraftEmployee } from "./deserializePayrollDraftEmployee";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const emptyDeductions = {
  incomeTax: 0,
  pt: 0,
  lic: 0,
  cpf: 0,
  daCpf: 0,
  vpf: 0,
  pfLoan: 0,
  postOffice: 0,
  creditSociety: 0,
  stdLicenceFee: 0,
  electricity: 0,
  water: 0,
  mess: 0,
  loanRecovery: 0,
  welfare: 0,
  hpl: 0,
  eol: 0,
  vehCharge: 0,
  other: 0,
  quarterRent: 0,
};

function baseCompute(overrides: Record<string, unknown> = {}) {
  return computeGovernmentMonthlyPayroll({
    grossBasic: 100000,
    daPercent: 53,
    hraPercent: 30,
    medicalFixed: 3000,
    payLevel: 10,
    daysInMonth: 30,
    unpaidDays: 0,
    deductionDefaults: { ...emptyDeductions },
    cpfConfig: {
      cpfPercentage: 12,
      cpfBasisFieldKeys: ["basic", "da", "hra", "medical", "transport"],
      cpfCalculationMode: "percentage",
      cpfFixedAmount: 0,
    },
    ...overrides,
  });
}

// --- RUN PAYROLL CPF ---
const calcCpf = baseCompute();
const calculatedCpf = calcCpf.deductions.cpf;
assert(calculatedCpf > 0, "baseline CPF calculated");

// TEST 1 — CPF override 0
const cpf0 = baseCompute({
  cpfManualOverride: true,
  deductionDefaults: { ...emptyDeductions, cpf: 0 },
});
assertEq(cpf0.deductions.cpf, 0, "TEST1 CPF override 0");

// TEST 2 — CPF override 15000
const cpf15k = baseCompute({
  cpfManualOverride: true,
  deductionDefaults: { ...emptyDeductions, cpf: 15000 },
});
assertEq(cpf15k.deductions.cpf, 15000, "TEST2 CPF override 15000");

// TEST 3 — HPL amount survives Mess change (same override flags)
const hplManual = baseCompute({
  hplDays: 2,
  hplDeductionManualOverride: true,
  deductionDefaults: { ...emptyDeductions, hpl: 3500, mess: 100 },
});
assertEq(hplManual.deductions.hpl, 3500, "TEST3 HPL stays 3500 after mess in defaults");
assertEq(hplManual.deductions.mess, 100, "TEST3 mess applied");

// TEST 4 — EOL days stick when CPF overridden
const eolDays = baseCompute({
  eolDays: 1,
  cpfManualOverride: true,
  deductionDefaults: { ...emptyDeductions, cpf: 0 },
});
assertEq(eolDays.eolDays, 1, "TEST4 EOL days remain 1");
assertEq(eolDays.deductions.cpf, 0, "TEST4 CPF still 0");

// TEST 5/6 — draft hydrate keeps CPF 0 + HPL/EOL overrides
const draftRow = deserializePayrollDraftEmployee(
  {
    employeeUserId: "u1",
    rowPayload: {
      governmentMonthly: {
        totalEarnings: 100000,
        totalDeductions: 3500,
        netSalary: 96500,
        basicPaid: 50000,
        deductions: { cpf: 0, hpl: 3500, eol: 1200, mess: 50 },
        hplDays: 2,
        eolDays: 1,
        transportPaid: 0,
      },
      govRecalc: {
        grossBasic: 100000,
        daPercent: 53,
        hraPercent: 30,
        medicalFixed: 3000,
        payLevel: 10,
        hplDays: 2,
        eolDays: 1,
        hplDeductionManualOverride: true,
        eolDeductionManualOverride: true,
        cpfManualOverride: true,
        deductionDefaults: { ...emptyDeductions, cpf: 0, hpl: 3500, eol: 1200, mess: 50 },
        earningPaidOverrides: { transportPaid: 0 },
      },
      payDays: 30,
      grossPay: 100000,
      deductions: 3500,
      netPay: 96500,
    },
  },
  {
    employeeUserId: "u1",
    payrollMode: "government",
    payDays: 30,
    grossPay: 0,
    netPay: 0,
    deductions: 0,
    govRecalc: {
      grossBasic: 100000,
      daPercent: 53,
      hraPercent: 30,
      medicalFixed: 3000,
      payLevel: 10,
      deductionDefaults: { ...emptyDeductions },
    },
  },
);
const draftGm = draftRow.governmentMonthly as { deductions: { cpf: number; hpl: number; eol: number } };
const draftGr = draftRow.govRecalc as {
  cpfManualOverride?: boolean;
  hplDeductionManualOverride?: boolean;
  eolDeductionManualOverride?: boolean;
  deductionDefaults: { cpf: number; hpl: number; eol: number };
  eolDays?: number;
  hplDays?: number;
};
assertEq(draftGm.deductions.cpf, 0, "TEST5 draft CPF 0");
assertEq(draftGr.cpfManualOverride, true, "TEST5 cpfManualOverride restored");
assertEq(draftGr.deductionDefaults.cpf, 0, "TEST5 govRecalc CPF 0");
assertEq(draftGm.deductions.hpl, 3500, "TEST6 draft HPL");
assertEq(draftGm.deductions.eol, 1200, "TEST6 draft EOL");
assertEq(draftGr.hplDeductionManualOverride, true, "TEST6 HPL flag");
assertEq(draftGr.eolDeductionManualOverride, true, "TEST6 EOL flag");
assertEq(draftGr.hplDays, 2, "TEST6 HPL days");
assertEq(draftGr.eolDays, 1, "TEST6 EOL days");

// Recompute after draft hydrate with Mess change — CPF/HPL/EOL stick
const afterMess = computeGovernmentMonthlyPayroll({
  grossBasic: 100000,
  daPercent: 53,
  hraPercent: 30,
  medicalFixed: 3000,
  payLevel: 10,
  daysInMonth: 30,
  unpaidDays: 0,
  hplDays: draftGr.hplDays,
  eolDays: draftGr.eolDays,
  cpfManualOverride: true,
  hplDeductionManualOverride: true,
  eolDeductionManualOverride: true,
  deductionDefaults: {
    ...emptyDeductions,
    cpf: 0,
    hpl: 3500,
    eol: 1200,
    mess: 100,
  },
  earningPaidOverrides: { transportPaid: 0 },
  cpfConfig: {
    cpfPercentage: 12,
    cpfBasisFieldKeys: ["basic", "da", "hra", "medical", "transport"],
    cpfCalculationMode: "percentage",
    cpfFixedAmount: 0,
  },
});
assertEq(afterMess.deductions.cpf, 0, "TEST5b CPF survives mess recompute");
assertEq(afterMess.deductions.hpl, 3500, "TEST6b HPL survives mess recompute");
assertEq(afterMess.deductions.eol, 1200, "TEST6b EOL survives mess recompute");
assertEq(afterMess.transportPaid, 0, "TEST10 transport paid 0 from override");

// TEST 7 — Reset to calculation clears override (no flag → calculated CPF)
const resetCpf = baseCompute({
  cpfManualOverride: false,
  deductionDefaults: { ...emptyDeductions, cpf: 0 },
});
assert(resetCpf.deductions.cpf > 0, "TEST7 reset restores calculated CPF");
assertEq(resetCpf.deductions.cpf, calculatedCpf, "TEST7 matches baseline calc");

// TEST 8 — finalization uses manual override values (effective snapshot)
assertEq(
  resolveEffectivePayrollValue(0, calculatedCpf),
  0,
  "TEST8 finalize prefers manual 0",
);

// --- TRANSPORT MASTER ---
const slab = computePayrollMasterPreview({
  payLevel: "8",
  grossBasicPay: "83600",
  daPercent: "60",
  hraPercent: "30",
  medical: "3000",
});
assertEq(slab.transportTotal, 5760, "TEST9 slab default 5760");

const zeroTransport = computePayrollMasterPreview({
  payLevel: "8",
  grossBasicPay: "83600",
  daPercent: "60",
  hraPercent: "30",
  medical: "3000",
  transportTotal: "0",
});
assertEq(zeroTransport.transportTotal, 0, "TEST9 transport explicit 0");

const customTransport = computePayrollMasterPreview({
  payLevel: "8",
  grossBasicPay: "83600",
  daPercent: "60",
  transportTotal: "500",
});
assertEq(customTransport.transportTotal, 500, "TEST12 transport 500");

const noOverride = computePayrollMasterPreview({
  payLevel: "8",
  grossBasicPay: "83600",
  daPercent: "60",
});
assertEq(noOverride.transportTotal, 5760, "TEST13 default slab when no override");

// TEST 11 — run month can override master 0 → 1000
const runTransport = baseCompute({
  earningPaidOverrides: { transportPaid: 1000 },
});
assertEq(runTransport.transportPaid, 1000, "TEST11 run transport override 1000");
assertEq(runTransport.transportActual > 0, true, "TEST11 actual still slab-based");

assertEq(firstDefined(0, 5), 0, "firstDefined keeps 0");
assertEq(resolveEffectivePayrollValue(undefined, null, 0, 5760), 0, "priority keeps 0");

console.log("payrollManualOverride.test.ts: all tests passed");
