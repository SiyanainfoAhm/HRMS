/**
 * Run: npx --yes tsx src/lib/resolveRunPayrollRow.test.ts
 */
import {
  hasUsableGovernmentMonthly,
  isZeroStubPayrollRow,
  resolveRunPayrollRow,
  type RunPayrollRowLike,
} from "./resolveRunPayrollRow";
import {
  DEFAULT_APRIL_2026_ELECTRICITY_TARIFF,
  calculateElectricityBill,
} from "./electricityTariffCalculation";
import { buildPayrollExcelRow } from "./payrollExcelExport";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
function assertEq(a: unknown, b: unknown, msg: string) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function stubApiRow(uid: string): RunPayrollRowLike {
  return {
    employeeUserId: uid,
    payrollMode: "government",
    payDays: 30,
    grossPay: 0,
    netPay: 0,
    deductions: 0,
    governmentMonthly: null,
    govRecalc: {
      grossBasic: 50000,
      daPercent: 53,
      hraPercent: 30,
      medicalFixed: 3000,
      payLevel: 10,
      hplDays: 0,
      eolDays: 0,
      deductionDefaults: {
        incomeTax: 0,
        pt: 200,
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
      },
      electricityApplicable: true,
      cpfConfig: {
        cpfPercentage: 12,
        cpfBasisFieldKeys: ["gross_basic", "da", "hra", "medical", "transport"],
        cpfCalculationMode: "percentage",
        cpfFixedAmount: 0,
      },
    },
  };
}

function testZeroStubDetection() {
  const stub = stubApiRow("u1");
  assert(isZeroStubPayrollRow(stub), "api stub is zero");
  assert(!hasUsableGovernmentMonthly(null), "null gm");
}

function testResolveComputesGovernmentMonthly() {
  const resolved = resolveRunPayrollRow(stubApiRow("u1"), {
    denom: 30,
    runYear: 2026,
    runMonth: 7,
    payrollConfig: null,
    alreadyRun: false,
    draftDirty: false,
  });
  assert(hasUsableGovernmentMonthly(resolved.governmentMonthly), "gm computed");
  assert(Number(resolved.grossPay) > 0, "gross > 0");
  assert(!isZeroStubPayrollRow(resolved), "not stub after resolve");
}

function testDraftOverlayKeepsExplicitZero() {
  const base = stubApiRow("u2");
  const draftStored = {
    employeeUserId: "u2",
    grossPay: 0,
    netPay: 0,
    totalDeductions: 0,
    rowPayload: {
      employeeUserId: "u2",
      payrollMode: "government",
      grossPay: 0,
      netPay: 0,
      deductions: 0,
      governmentMonthly: {
        basicPaid: 0,
        daPaid: 0,
        hraPaid: 0,
        totalEarnings: 0,
        totalDeductions: 0,
        netSalary: 0,
        deductions: { cpf: 0, pt: 0 },
      },
      govRecalc: base.govRecalc,
    },
  };
  const resolved = resolveRunPayrollRow(base, {
    denom: 30,
    runYear: 2026,
    runMonth: 7,
    payrollConfig: null,
    alreadyRun: false,
    draftDirty: false,
    draftStored,
  });
  assertEq(Number((resolved.governmentMonthly as { totalEarnings: number }).totalEarnings), 0, "explicit 0");
  assertEq(Number(resolved.grossPay), 0, "gross 0");
}

function testOnlyExplicitlyEditedRowUsesDirtyCache() {
  const base = stubApiRow("u3");
  const cached: RunPayrollRowLike = {
    ...base,
    employeeUserId: "u3",
    grossPay: 255110,
    netPay: 200000,
    deductions: 55110,
    governmentMonthly: {
      basicPaid: 90000,
      totalEarnings: 255110,
      totalDeductions: 55110,
      netSalary: 200000,
      cacheOnlyMarker: true,
    },
  };
  const unrelated = resolveRunPayrollRow(base, {
    denom: 30,
    runYear: 2026,
    runMonth: 7,
    payrollConfig: null,
    alreadyRun: false,
    draftDirty: true,
    cached,
    cachedPeriodKey: "2026-07",
  });
  assert(
    !("cacheOnlyMarker" in (unrelated.governmentMonthly as Record<string, unknown>)),
    "period dirty flag must not reuse unrelated cached employee row",
  );

  const resolved = resolveRunPayrollRow(base, {
    denom: 30,
    runYear: 2026,
    runMonth: 7,
    payrollConfig: null,
    alreadyRun: false,
    draftDirty: true,
    preserveEdits: true,
    cached,
    cachedPeriodKey: "2026-07",
  });
  assertEq(Number(resolved.grossPay), 255110, "dirty cache");
}

function testPriorPeriodCacheCannotHydrateNewMonth() {
  const base = stubApiRow("u-period");
  base.payDays = 31;
  const novemberCache: RunPayrollRowLike = {
    ...base,
    govRecalc: { ...base.govRecalc!, eolDays: 1, hplDays: 2, leaveRemarks: "November test", eolReferenceMonth: 11, eolReferenceYear: 2026, hplReferenceMonth: 10, hplReferenceYear: 2026 },
  };
  const december = resolveRunPayrollRow(base, {
    denom: 31,
    runYear: 2026,
    runMonth: 12,
    payrollConfig: null,
    alreadyRun: false,
    draftDirty: false,
    preserveEdits: true,
    cached: novemberCache,
    cachedPeriodKey: "2026-11",
  });
  const leave = december.govRecalc!;
  assertEq(leave.eolDays, 0, "fresh December EOL");
  assertEq(leave.hplDays, 0, "fresh December HPL");
  assertEq(leave.leaveRemarks, "", "fresh December remarks");
  assertEq(leave.eolReferenceMonth, 12, "fresh December EOL reference month");
  assertEq(leave.eolReferenceYear, 2026, "fresh December EOL reference year");
  assertEq(leave.hplReferenceMonth, 12, "fresh December HPL reference month");
  assertEq(leave.hplReferenceYear, 2026, "fresh December HPL reference year");
  assertEq(december.payDays, 31, "December payable days without other adjustments");
  assertEq(december.unpaidLeaveDays, 0, "December has no inherited unpaid leave days");
  assertEq((december.governmentMonthly as { deductions: { eol: number; hpl: number } }).deductions.eol, 0, "no inherited EOL salary adjustment");
  assertEq((december.governmentMonthly as { deductions: { eol: number; hpl: number } }).deductions.hpl, 0, "no inherited HPL salary adjustment");
  const novemberAgain = resolveRunPayrollRow(base, {
    denom: 30,
    runYear: 2026,
    runMonth: 11,
    payrollConfig: null,
    alreadyRun: false,
    draftDirty: false,
    preserveEdits: true,
    cached: novemberCache,
    cachedPeriodKey: "2026-11",
  });
  assertEq(novemberAgain.govRecalc?.eolDays, 1, "switching back retains November EOL");
  assertEq(novemberAgain.govRecalc?.leaveRemarks, "November test", "switching back retains November remarks");
}

function testGeneratedRunKeepsItsSavedLeaveReferences() {
  const row = stubApiRow("u-generated");
  row.govRecalc = { ...row.govRecalc!, eolDays: 1, hplDays: 2, leaveRemarks: "Saved run", eolReferenceMonth: 11, eolReferenceYear: 2026, hplReferenceMonth: 10, hplReferenceYear: 2026 };
  row.governmentMonthly = { basicPaid: 50000, totalEarnings: 100000, totalDeductions: 0, netSalary: 100000, deductions: { eol: 1200, hpl: 500 } };
  const resolved = resolveRunPayrollRow(row, {
    denom: 31,
    runYear: 2026,
    runMonth: 12,
    payrollConfig: null,
    alreadyRun: true,
    draftDirty: false,
  });
  assertEq(resolved.govRecalc?.eolReferenceMonth, 11, "generated EOL reference is preserved");
  assertEq(resolved.govRecalc?.hplReferenceMonth, 10, "generated HPL reference is preserved");
  assertEq(resolved.govRecalc?.leaveRemarks, "Saved run", "generated remarks are preserved");
}

function testDraftElectricityUnitsRecalculateInsteadOfRestoringStaleBill() {
  const base = stubApiRow("u-electricity");
  const tariff = {
    ...DEFAULT_APRIL_2026_ELECTRICITY_TARIFF,
    slabs: DEFAULT_APRIL_2026_ELECTRICITY_TARIFF.slabs.map((slab) => ({
      ...slab,
      fuelChargePerUnit: 0.5,
    })),
  };
  const electricityTotals = new Map<number, number[]>();
  for (const units of [0, 10, 11, 10, 40, 80, 301]) {
    const expected = calculateElectricityBill({
      units,
      tariff,
      applicable: true,
      mode: "unit_based",
    }).total;
    const draftStored = {
      employeeUserId: "u-electricity",
      rowPayload: {
        employeeUserId: "u-electricity",
        payrollMode: "government",
        // Deliberately stale values that must not survive draft hydration.
        governmentMonthly: {
          totalEarnings: 999999,
          totalDeductions: 1,
          netSalary: 999998,
          // Missing bill at 11 units models the live defect; other rows carry
          // a stale cached amount that must be replaced by the effective tariff.
          deductions: units === 11 ? {} : { electricity: units === 10 ? 0 : units === 40 || units === 80 ? 49 : 1 },
        },
        govRecalc: {
          ...base.govRecalc,
          deductionDefaults: {
            ...base.govRecalc!.deductionDefaults,
            electricity: 777,
          },
          // Reproduce a typical draft with an unrelated frozen deduction.
          // It must not replace the electricity result calculated from units.
          deductionPaidOverrides: { cpf: 1234 },
          electricityUnitsConsumed: units,
          // A stale saved context must not override fresh Payroll Master
          // applicability or the current preview tariff.
          electricityApplicable: false,
          electricityTariff: { slabs: [], sthirAakar: 0 },
          electricityMode: units === 10 ? "manual_fixed" : "unit_based",
          electricityManualOverride: false,
        },
      },
    };
    const resolved = resolveRunPayrollRow(base, {
      denom: 30,
      runYear: 2026,
      runMonth: 7,
      payrollConfig: { electricityTariff: tariff },
      alreadyRun: false,
      draftDirty: false,
      draftStored,
    });
    const gm = resolved.governmentMonthly as {
      deductions: { electricity: number };
      totalEarnings: number;
      totalDeductions: number;
      netSalary: number;
    };
    assertEq(gm.deductions.electricity, expected, `draft electricity at ${units} units`);
    assertEq(gm.netSalary, Math.round(gm.totalEarnings - gm.totalDeductions), `draft net at ${units} units`);
    electricityTotals.set(units, [...(electricityTotals.get(units) ?? []), gm.deductions.electricity]);
  }
  assert(electricityTotals.get(11)![0] !== electricityTotals.get(10)![0], "11 units changes the deduction");
  assertEq(electricityTotals.get(10)![1], electricityTotals.get(10)![0], "changing back to 10 restores the deduction");
  assertEq(electricityTotals.get(40)![0], calculateElectricityBill({ units: 40, tariff, applicable: true, mode: "unit_based" }).total, "40 units uses tariff result despite prior ₹49 value");
  assertEq(electricityTotals.get(80)![0], calculateElectricityBill({ units: 80, tariff, applicable: true, mode: "unit_based" }).total, "80 units replaces prior calculated ₹49 value");
  assert(electricityTotals.get(80)![0] !== 49, "nonzero previous calculated bill is not treated as manual override");

  const intentionalZero = resolveRunPayrollRow(base, {
    denom: 30,
    runYear: 2026,
    runMonth: 7,
    payrollConfig: { electricityTariff: tariff },
    alreadyRun: false,
    draftDirty: false,
    draftStored: {
      employeeUserId: "u-electricity",
      rowPayload: {
        ...base,
        governmentMonthly: { deductions: { electricity: 0 } },
        govRecalc: {
          ...base.govRecalc!,
          electricityUnitsConsumed: 10,
          electricityMode: "unit_based",
          electricityManualOverride: true,
          deductionDefaults: { ...base.govRecalc!.deductionDefaults, electricity: 0 },
          deductionPaidOverrides: { electricity: 0 },
        },
      },
    },
  });
  assertEq((intentionalZero.governmentMonthly as { deductions: { electricity: number } }).deductions.electricity, 0, "intentional zero electricity override survives tariff recalculation");
}

function testSavedUnitBillOutranksMasterManualFixedDefaultAcrossReloadAndExport() {
  const tariff = {
    id: "tariff-2026-10-fixture",
    effectiveFrom: "2026-10-01",
    sthirAakar: 130,
    vahanAakarPerUnit: 0,
    fuelCharge: 100.7,
    dutyPercentage: 16,
    slabs: [{ fromUnit: 0, toUnit: 100, ratePerUnit: 4.77625, sortOrder: 1 }],
  };
  const expectedBill = calculateElectricityBill({ units: 80, tariff, applicable: true, mode: "unit_based" });
  assertEq(expectedBill.subtotal, 612.8, "fixture tariff subtotal");
  assertEq(expectedBill.dutyAmount, 98.05, "fixture tariff duty rounds to paisa");
  assertEq(expectedBill.totalExact, 710.85, "fixture tariff exact total");
  assertEq(expectedBill.total, 711, "configured tariff rounds final deduction to ₹711");

  const masterRow = stubApiRow("subhash");
  masterRow.govRecalc = {
    ...masterRow.govRecalc!,
    electricityUnitsConsumed: 0,
    electricityMode: "manual_fixed",
    deductionDefaults: { ...masterRow.govRecalc!.deductionDefaults, electricity: 49 },
  };
  const savedDraft = {
    employeeUserId: "subhash",
    rowPayload: {
      employeeUserId: "subhash",
      payrollMode: "government",
      quarterContextVersion: 1,
      governmentMonthly: {
        electricityUnitsConsumed: 80,
        electricityMode: "unit_based",
        electricityTariffId: tariff.id,
        electricityBill: expectedBill,
        electricityTotal: 711,
        hasQuarter: true,
        quarterRent: 400,
        totalEarnings: 100000,
        totalDeductions: 13361,
        netSalary: 86639,
        deductions: { electricity: 49, mess: 650, creditSociety: 11750, quarterRent: 400 },
      },
      govRecalc: {
        ...masterRow.govRecalc,
        hasQuarter: true,
        quarterRent: 400,
        electricityUnitsConsumed: 80,
        electricityMode: "unit_based",
        electricityManualOverride: false,
        electricityTariff: tariff,
        // Simulate a stale, unapproved cached value from an older draft.
        deductionPaidOverrides: { electricity: 49, mess: 650, creditSociety: 11750, quarterRent: 400 },
      },
    },
  };
  const config = { electricityTariff: tariff };
  const firstLoad = resolveRunPayrollRow(masterRow, {
    denom: 30, runYear: 2026, runMonth: 10, payrollConfig: config,
    alreadyRun: false, draftDirty: false, draftStored: savedDraft,
  });
  const gm = firstLoad.governmentMonthly as Record<string, unknown>;
  const ded = gm.deductions as Record<string, number>;
  assertEq(ded.electricity, 711, "saved unit-based October bill beats Master fixed ₹49");
  assertEq((gm.electricityBill as { total: number }).total, 711, "display breakdown and deduction agree");
  assertEq(Number(gm.totalDeductions), Object.values(ded).reduce((sum, value) => sum + Number(value || 0), 0), "deduction total includes Electricity once");
  assertEq(Number(gm.netSalary), Number(gm.totalEarnings) - Number(gm.totalDeductions), "net salary matches total deductions");
  assertEq(ded.mess, 650, "Mess preserved");
  assertEq(ded.creditSociety, 11750, "Credit Society preserved");
  assertEq(ded.quarterRent, 400, "Quarter Rent preserved");

  const excelRow = buildPayrollExcelRow({
    payroll_mode: "government", employee_user_id: "subhash", gross_pay: Number(gm.totalEarnings),
    deductions: Number(gm.totalDeductions), net_pay: Number(gm.netSalary),
  }, "Subhash Duryodhan Katkar", { kind: "row", row: {
    electricity_amount: ded.electricity,
    electricity_units_consumed: Number(gm.electricityUnitsConsumed),
    total_deductions: Number(gm.totalDeductions),
    net_salary: Number(gm.netSalary),
  } });
  assertEq(excelRow.Electricity, 711, "Excel uses saved/reconciled bill amount");
  assertEq(excelRow.ElectricityUnits, 80, "Excel uses saved units");

  const otherEmployee = stubApiRow("other");
  otherEmployee.govRecalc = { ...otherEmployee.govRecalc!, electricityMode: "manual_fixed", deductionDefaults: { ...otherEmployee.govRecalc!.deductionDefaults, electricity: 49 } };
  const switchedEmployee = resolveRunPayrollRow(otherEmployee, {
    denom: 30, runYear: 2026, runMonth: 10, payrollConfig: config,
    alreadyRun: false, draftDirty: false,
  });
  assertEq((switchedEmployee.govRecalc as { electricityMode: string }).electricityMode, "manual_fixed", "switching employees does not leak draft mode");
  const switchedMonth = resolveRunPayrollRow(masterRow, {
    denom: 30, runYear: 2026, runMonth: 11, payrollConfig: config,
    alreadyRun: false, draftDirty: false,
  });
  assertEq((switchedMonth.govRecalc as { electricityMode: string }).electricityMode, "manual_fixed", "switching months uses that month's Master seed absent a draft");
  const repeatedLoad = resolveRunPayrollRow(masterRow, {
    denom: 30, runYear: 2026, runMonth: 10, payrollConfig: config,
    alreadyRun: false, draftDirty: false, draftStored: savedDraft,
  });
  assertEq((repeatedLoad.governmentMonthly as { deductions: { electricity: number } }).deductions.electricity, 711, "repeated reload remains stable");
}

function testManyEmployeesResolveWithoutPageBias() {
  const rows = Array.from({ length: 83 }, (_, i) => stubApiRow(`u${i + 1}`));
  const page = rows.slice(0, 25);
  const map = new Map<string, RunPayrollRowLike>();
  for (const r of page) {
    map.set(r.employeeUserId, resolveRunPayrollRow(r, {
      denom: 30,
      runYear: 2026,
      runMonth: 7,
      payrollConfig: null,
      alreadyRun: false,
      draftDirty: false,
    }));
  }
  assertEq(map.size, 25, "page only in map so far");
  for (const r of rows) {
    map.set(
      r.employeeUserId,
      resolveRunPayrollRow(r, {
        denom: 30,
        runYear: 2026,
        runMonth: 7,
        payrollConfig: null,
        alreadyRun: false,
        draftDirty: false,
        cached: map.get(r.employeeUserId),
      cachedPeriodKey: "2026-07",
      }),
    );
  }
  assertEq(map.size, 83, "full set");
  let zeros = 0;
  for (const row of map.values()) {
    if (isZeroStubPayrollRow(row)) zeros += 1;
  }
  assertEq(zeros, 0, "no stubs after full resolve");
}

function testDraftQuarterContextOverridesStaleQuarterHraAndRent() {
  const base = stubApiRow("u-quarter");
  base.hasQuarter = true;
  base.quarterAssigned = true;
  base.quarterId = "quarter-1";
  base.quarterName = "Q-1";
  base.quarterType = "Type-A";
  base.quarterRent = 138;
  base.govRecalc = { ...base.govRecalc!, hasQuarter: true, quarterRent: 138 };
  const assigned = resolveRunPayrollRow(base, {
    denom: 30, runYear: 2026, runMonth: 10, payrollConfig: null,
    alreadyRun: false, draftDirty: false,
    draftStored: {
      employeeUserId: "u-quarter",
      rowPayload: {
        ...base,
        hasQuarter: false,
        quarterId: null,
        quarterRent: 0,
        governmentMonthly: {
          basicPaid: 50000, hraActual: 15000, hraPaid: 15000,
          totalEarnings: 65000, totalDeductions: 0, netSalary: 65000,
          quarterRent: 0, deductions: { pt: 200, quarterRent: 0 },
        },
        govRecalc: { ...base.govRecalc, hasQuarter: false, quarterRent: 0, earningPaidOverrides: { hraPaid: 15000 } },
      },
    },
  });
  const assignedGm = assigned.governmentMonthly as Record<string, unknown>;
  const assignedDed = assignedGm.deductions as Record<string, number>;
  assertEq(assigned.hasQuarter, true, "assigned context wins over stale draft flag");
  assertEq(assignedGm.hraPaid, 0, "assigned quarter suppresses stale draft HRA");
  assertEq(assignedDed.quarterRent, 138, "assigned period rent replaces stale draft rent");

  const oldPreview = stubApiRow("u-quarter");
  oldPreview.hasQuarter = false;
  oldPreview.quarterRent = 0;
  oldPreview.govRecalc = { ...oldPreview.govRecalc!, hasQuarter: false, quarterRent: 0 };
  const savedByServer = resolveRunPayrollRow(oldPreview, {
    denom: 30, runYear: 2026, runMonth: 10, payrollConfig: null,
    alreadyRun: false, draftDirty: false,
    draftStored: {
      employeeUserId: "u-quarter",
      rowPayload: {
        ...base,
        quarterContextVersion: 1,
        governmentMonthly: assignedGm,
      },
    },
  });
  assertEq(savedByServer.hasQuarter, true, "server-synced period context wins over an older preview response");
  assertEq((savedByServer.governmentMonthly as Record<string, unknown>).hraPaid, 0, "older preview cannot restore HRA after server save");

  const unassignedBase = stubApiRow("u-unassigned");
  unassignedBase.hasQuarter = false;
  unassignedBase.quarterRent = 0;
  unassignedBase.govRecalc = { ...unassignedBase.govRecalc!, hasQuarter: false, quarterRent: 0 };
  const unassigned = resolveRunPayrollRow(unassignedBase, {
    denom: 30, runYear: 2026, runMonth: 10, payrollConfig: null,
    alreadyRun: false, draftDirty: false,
    draftStored: {
      employeeUserId: "u-unassigned",
      rowPayload: {
        ...unassignedBase,
        hasQuarter: true,
        quarterRent: 500,
        governmentMonthly: {
          basicPaid: 50000, hraActual: 0, hraPaid: 0,
          totalEarnings: 50000, totalDeductions: 700, netSalary: 49300,
          quarterRent: 500, deductions: { pt: 200, quarterRent: 500 },
        },
        govRecalc: { ...unassignedBase.govRecalc, hasQuarter: true, quarterRent: 500, earningPaidOverrides: { hraPaid: 0 } },
      },
    },
  });
  const unassignedGm = unassigned.governmentMonthly as Record<string, unknown>;
  const unassignedDed = unassignedGm.deductions as Record<string, number>;
  assertEq(unassigned.hasQuarter, false, "unassigned period clears stale draft flag");
  assert(Number(unassignedGm.hraPaid) > 0, "unassigned period restores normal HRA");
  assertEq(unassignedDed.quarterRent, 0, "unassigned period removes stale rent");
}

const tests = [
  testZeroStubDetection,
  testResolveComputesGovernmentMonthly,
  testDraftOverlayKeepsExplicitZero,
  testOnlyExplicitlyEditedRowUsesDirtyCache,
  testPriorPeriodCacheCannotHydrateNewMonth,
  testGeneratedRunKeepsItsSavedLeaveReferences,
  testDraftElectricityUnitsRecalculateInsteadOfRestoringStaleBill,
  testSavedUnitBillOutranksMasterManualFixedDefaultAcrossReloadAndExport,
  testDraftQuarterContextOverridesStaleQuarterHraAndRent,
  testManyEmployeesResolveWithoutPageBias,
];

let failed = 0;
for (const t of tests) {
  try {
    t();
    console.log(`ok - ${t.name}`);
  } catch (e) {
    failed += 1;
    console.error(`FAIL - ${t.name}:`, e);
  }
}
if (failed) process.exit(1);
console.log(`\n${tests.length} passed`);
