/**
 * Canonical payroll draft employee deserialization for Run Payroll.
 * Accepts snake_case payloads (apiProxy deep-transform on save) and camelCase.
 */

export function firstDefined<T>(...values: Array<T | null | undefined>): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function snakeToCamelKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Deep-convert object keys from snake_case to camelCase (arrays preserved). */
export function keysToCamelDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(keysToCamelDeep);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[snakeToCamelKey(k)] = keysToCamelDeep(v);
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return isPlainObject(v) ? v : null;
}

function numOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export type DraftEmployeeApiRow = {
  id?: string;
  payrollDraftId?: string;
  employeeUserId?: string;
  employee_user_id?: string;
  employeeCode?: string | null;
  employee_code?: string | null;
  payrollMasterId?: string | null;
  payroll_master_id?: string | null;
  payDays?: number | null;
  pay_days?: number | null;
  grossPay?: number | null;
  gross_pay?: number | null;
  totalEarnings?: number | null;
  total_earnings?: number | null;
  totalDeductions?: number | null;
  total_deductions?: number | null;
  totalArrears?: number | null;
  total_arrears?: number | null;
  netPay?: number | null;
  net_pay?: number | null;
  remarks?: string | null;
  rowPayload?: unknown;
  row_payload?: unknown;
};

/** Normalize draft API / stored map entry into a DraftEmployeeApiRow. */
export function normalizeDraftEmployeeApiRow(
  emp: DraftEmployeeApiRow | Record<string, unknown> | null | undefined,
  fallbackUserId?: string,
): DraftEmployeeApiRow | null {
  if (!emp || typeof emp !== "object") return null;
  const anyEmp = emp as Record<string, unknown>;
  const meta = asRecord(anyEmp.__draftMeta);
  if (meta) {
    const uid = String(firstDefined(meta.employeeUserId, fallbackUserId) ?? "");
    if (!uid) return null;
    return {
      employeeUserId: uid,
      employeeCode: (meta.employeeCode as string | null | undefined) ?? null,
      payrollMasterId: (meta.payrollMasterId as string | null | undefined) ?? null,
      payDays: numOrUndef(meta.payDays) ?? null,
      grossPay: numOrUndef(meta.grossPay) ?? null,
      totalEarnings: numOrUndef(meta.totalEarnings) ?? null,
      totalDeductions: numOrUndef(meta.totalDeductions) ?? null,
      totalArrears: numOrUndef(meta.totalArrears) ?? null,
      netPay: numOrUndef(meta.netPay) ?? null,
      remarks: typeof meta.remarks === "string" ? meta.remarks : null,
      rowPayload: meta.rowPayload ?? (() => {
        const { __draftMeta: _drop, ...rest } = anyEmp;
        return rest;
      })(),
    };
  }
  const uid = String(
    firstDefined(anyEmp.employeeUserId, anyEmp.employee_user_id, fallbackUserId) ?? "",
  );
  const payload = firstDefined(anyEmp.rowPayload, anyEmp.row_payload);
  if (!uid) return null;
  if (payload !== undefined) {
    return {
      ...(emp as DraftEmployeeApiRow),
      employeeUserId: uid,
      rowPayload: payload,
    };
  }
  // Stored value is raw row_payload only.
  return {
    employeeUserId: uid,
    rowPayload: emp,
  };
}

/** Drop null/undefined so calculated fallbacks are not overwritten. Keep 0. */
function definedEntries(source: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/**
 * Convert a draft API employee (+ optional calculated preview row) into the
 * camelCase Run Payroll editable-row shape. Uses row_payload as the snapshot.
 */
export function deserializePayrollDraftEmployee(
  draftEmployee: DraftEmployeeApiRow,
  calculatedEmployee?: Record<string, unknown> | null,
): Record<string, unknown> {
  const calc = calculatedEmployee ?? {};
  const rawPayload = draftEmployee.rowPayload ?? draftEmployee.row_payload ?? {};
  const payload = (keysToCamelDeep(rawPayload) as Record<string, unknown>) ?? {};

  const gmRaw = firstDefined(payload.governmentMonthly, payload.government_monthly);
  const gm = asRecord(keysToCamelDeep(gmRaw) ?? gmRaw) ?? {};

  const grRaw = firstDefined(payload.govRecalc, payload.gov_recalc);
  const govRecalcFromPayload = asRecord(keysToCamelDeep(grRaw) ?? grRaw);

  const employeeUserId = String(
    firstDefined(
      draftEmployee.employeeUserId,
      draftEmployee.employee_user_id,
      payload.employeeUserId,
      calc.employeeUserId,
    ) ?? "",
  );

  const payDays = firstDefined(
    numOrUndef(draftEmployee.payDays),
    numOrUndef(draftEmployee.pay_days),
    numOrUndef(payload.payDays),
    numOrUndef(calc.payDays),
  );

  const grossPay = firstDefined(
    numOrUndef(draftEmployee.grossPay),
    numOrUndef(draftEmployee.gross_pay),
    numOrUndef(gm.totalEarnings),
    numOrUndef(payload.grossPay),
    numOrUndef(calc.grossPay),
  );

  const totalEarnings = firstDefined(
    numOrUndef(draftEmployee.totalEarnings),
    numOrUndef(draftEmployee.total_earnings),
    numOrUndef(gm.totalEarnings),
    grossPay,
  );

  const totalDeductions = firstDefined(
    numOrUndef(draftEmployee.totalDeductions),
    numOrUndef(draftEmployee.total_deductions),
    numOrUndef(gm.totalDeductions),
    numOrUndef(payload.deductions),
    numOrUndef(calc.deductions),
  );

  const netPay = firstDefined(
    numOrUndef(draftEmployee.netPay),
    numOrUndef(draftEmployee.net_pay),
    numOrUndef(gm.netSalary),
    numOrUndef(payload.netPay),
    numOrUndef(calc.netPay),
  );

  const remarks = firstDefined(
    draftEmployee.remarks,
    typeof gm.leaveRemarks === "string" ? gm.leaveRemarks : undefined,
    typeof govRecalcFromPayload?.leaveRemarks === "string"
      ? (govRecalcFromPayload.leaveRemarks as string)
      : undefined,
  );

  const calcGm = asRecord(calc.governmentMonthly) ?? {};
  const calcDed = asRecord(calcGm.deductions) ?? {};
  const savedDed = asRecord(gm.deductions);
  const calcGovRecalc = asRecord(calc.govRecalc);
  const govRecalcFromDraft = govRecalcFromPayload ? definedEntries(govRecalcFromPayload) : {};
  const draftPaidOverrides = asRecord(
    (govRecalcFromDraft as Record<string, unknown>).deductionPaidOverrides,
  );
  const masterDedDefaults = asRecord(calcGovRecalc?.deductionDefaults) ?? {};

  // Build paid overrides: explicit map wins; legacy drafts without the map only keep
  // flagged statutory overrides (CPF / electricity / quarter rent / HPL / EOL).
  const paidOverrides: Record<string, number> = {};
  if (draftPaidOverrides && Object.keys(draftPaidOverrides).length > 0) {
    for (const [k, v] of Object.entries(draftPaidOverrides)) {
      const n = numOrUndef(v);
      if (n !== undefined) paidOverrides[k] = n;
    }
  } else {
    const draftFlags = {
      cpf: Boolean(
        (govRecalcFromDraft as Record<string, unknown>).cpfManualOverride ??
          calcGovRecalc?.cpfManualOverride,
      ),
      electricity: Boolean(
        (govRecalcFromDraft as Record<string, unknown>).electricityManualOverride ??
          calcGovRecalc?.electricityManualOverride,
      ),
      quarterRent: Boolean(
        (govRecalcFromDraft as Record<string, unknown>).quarterRentManualOverride ??
          calcGovRecalc?.quarterRentManualOverride,
      ),
      hpl: Boolean(
        (govRecalcFromDraft as Record<string, unknown>).hplDeductionManualOverride ??
          calcGovRecalc?.hplDeductionManualOverride,
      ),
      eol: Boolean(
        (govRecalcFromDraft as Record<string, unknown>).eolDeductionManualOverride ??
          calcGovRecalc?.eolDeductionManualOverride,
      ),
    };
    if (savedDed) {
      if (draftFlags.cpf && Object.prototype.hasOwnProperty.call(savedDed, "cpf")) {
        paidOverrides.cpf = numOrUndef(savedDed.cpf) ?? 0;
      }
      if (draftFlags.electricity && Object.prototype.hasOwnProperty.call(savedDed, "electricity")) {
        paidOverrides.electricity = numOrUndef(savedDed.electricity) ?? 0;
      }
      if (draftFlags.quarterRent && Object.prototype.hasOwnProperty.call(savedDed, "quarterRent")) {
        paidOverrides.quarterRent = numOrUndef(savedDed.quarterRent) ?? 0;
      }
      if (draftFlags.hpl && Object.prototype.hasOwnProperty.call(savedDed, "hpl")) {
        paidOverrides.hpl = numOrUndef(savedDed.hpl) ?? 0;
      }
      if (draftFlags.eol && Object.prototype.hasOwnProperty.call(savedDed, "eol")) {
        paidOverrides.eol = numOrUndef(savedDed.eol) ?? 0;
      }
    }
  }

  const effectiveDed: Record<string, number> = {};
  const hasMasterDedContext = Object.keys(masterDedDefaults).length > 0;
  const hasPaidOverrideMap = Boolean(draftPaidOverrides && Object.keys(draftPaidOverrides).length > 0);

  if (hasPaidOverrideMap) {
    // New drafts: Master baseline + only explicit monthly paid overrides.
    for (const [k, v] of Object.entries({ ...calcDed, ...masterDedDefaults })) {
      const n = numOrUndef(v);
      if (n !== undefined) effectiveDed[k] = n;
    }
    for (const [k, v] of Object.entries(paidOverrides)) {
      effectiveDed[k] = v;
    }
  } else if (savedDed && Object.keys(definedEntries(savedDed)).length > 0) {
    // Legacy / exact draft reload: restore saved sheet deductions as-is (incl. explicit 0).
    // Master only fills keys the draft never stored. Do not auto-recalculate on load.
    for (const [k, v] of Object.entries({ ...masterDedDefaults, ...calcDed, ...definedEntries(savedDed) })) {
      const n = numOrUndef(v);
      if (n !== undefined) effectiveDed[k] = n;
    }
    // Flagged statutory overrides from draft flags still win (already in paidOverrides).
    for (const [k, v] of Object.entries(paidOverrides)) {
      effectiveDed[k] = v;
    }
  } else if (hasMasterDedContext) {
    for (const [k, v] of Object.entries({ ...calcDed, ...masterDedDefaults })) {
      const n = numOrUndef(v);
      if (n !== undefined) effectiveDed[k] = n;
    }
    for (const [k, v] of Object.entries(paidOverrides)) {
      effectiveDed[k] = v;
    }
  } else {
    for (const [k, v] of Object.entries(calcDed)) {
      const n = numOrUndef(v);
      if (n !== undefined) effectiveDed[k] = n;
    }
  }

  const governmentMonthly: Record<string, unknown> = {
    ...calcGm,
    ...definedEntries(gm),
    deductions: effectiveDed,
  };
  if (totalEarnings !== undefined) governmentMonthly.totalEarnings = totalEarnings;
  // Totals re-derived below after deductions are Master-correct.
  if (typeof remarks === "string") governmentMonthly.leaveRemarks = remarks;

  const govRecalc: Record<string, unknown> = {
    ...(calcGovRecalc ?? {}),
    ...govRecalcFromDraft,
  };
  if (govRecalc.electricityUnitsConsumed === undefined && gm.electricityUnitsConsumed !== undefined) {
    govRecalc.electricityUnitsConsumed = gm.electricityUnitsConsumed;
  }
  if (govRecalc.nightHours === undefined && gm.nightHours !== undefined) {
    govRecalc.nightHours = gm.nightHours;
  }
  if (govRecalc.leaveRemarks === undefined && typeof remarks === "string") {
    govRecalc.leaveRemarks = remarks;
  }
  for (const key of [
    "hplDays",
    "eolDays",
    "eolReferenceMonth",
    "eolReferenceYear",
    "hplReferenceMonth",
    "hplReferenceYear",
  ] as const) {
    if (govRecalc[key] === undefined && gm[key] !== undefined) {
      govRecalc[key] = gm[key];
    }
  }

  // Master deductionDefaults are authoritative; only paid overrides replace them.
  const dedDefaults: Record<string, unknown> = {
    ...masterDedDefaults,
    ...paidOverrides,
  };
  const earningOverrides: Record<string, unknown> = {
    ...(asRecord(calcGovRecalc?.earningPaidOverrides) ?? {}),
    ...(asRecord(govRecalc.earningPaidOverrides) ?? {}),
  };

  if (Object.prototype.hasOwnProperty.call(paidOverrides, "cpf")) {
    govRecalc.cpfManualOverride = true;
  }
  if (Object.prototype.hasOwnProperty.call(paidOverrides, "hpl")) {
    govRecalc.hplDeductionManualOverride = true;
  }
  if (Object.prototype.hasOwnProperty.call(paidOverrides, "eol")) {
    govRecalc.eolDeductionManualOverride = true;
  }
  if (Object.prototype.hasOwnProperty.call(paidOverrides, "electricity")) {
    govRecalc.electricityManualOverride = true;
  }
  if (Object.prototype.hasOwnProperty.call(paidOverrides, "quarterRent")) {
    govRecalc.quarterRentManualOverride = true;
    govRecalc.quarterRent = paidOverrides.quarterRent;
  }

  if (
    Object.prototype.hasOwnProperty.call(gm, "transportPaid") ||
    Object.prototype.hasOwnProperty.call(gm, "transport_paid")
  ) {
    const tp = numOrUndef(gm.transportPaid ?? gm.transport_paid);
    if (tp !== undefined && !Object.prototype.hasOwnProperty.call(earningOverrides, "transportPaid")) {
      earningOverrides.transportPaid = tp;
    }
  }

  govRecalc.deductionDefaults = dedDefaults;
  if (Object.keys(paidOverrides).length > 0) {
    govRecalc.deductionPaidOverrides = paidOverrides;
  }
  if (Object.keys(earningOverrides).length > 0) {
    govRecalc.earningPaidOverrides = earningOverrides;
  }

  // Recompute deduction/net totals from effective deductions when we have component amounts.
  const sumDed = Object.values(effectiveDed).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
  const earnForNet =
    firstDefined(numOrUndef(governmentMonthly.totalEarnings), totalEarnings, numOrUndef(calcGm.totalEarnings)) ?? 0;
  const resolvedTotalDeductions =
    Object.keys(effectiveDed).length > 0
      ? Math.round(sumDed)
      : Math.round(
          firstDefined(totalDeductions, numOrUndef(gm.totalDeductions), numOrUndef(calcGm.totalDeductions)) ?? 0,
        );
  const resolvedNetPay =
    Object.keys(effectiveDed).length > 0
      ? Math.round(earnForNet - sumDed)
      : Math.round(
          firstDefined(netPay, numOrUndef(gm.netSalary), numOrUndef(calcGm.netSalary), earnForNet - resolvedTotalDeductions) ??
            earnForNet - resolvedTotalDeductions,
        );
  governmentMonthly.totalDeductions = resolvedTotalDeductions;
  governmentMonthly.netSalary = resolvedNetPay;

  const incentive = firstDefined(numOrUndef(payload.incentive), numOrUndef(calc.incentive)) ?? 0;
  const prBonus = firstDefined(numOrUndef(payload.prBonus), numOrUndef(calc.prBonus)) ?? 0;
  const reimbursement =
    firstDefined(numOrUndef(payload.reimbursement), numOrUndef(calc.reimbursement)) ?? 0;

  const resolvedNet = netPay ?? 0;
  const takeHome = firstDefined(
    numOrUndef(payload.takeHome),
    numOrUndef(calc.takeHome),
    Math.round(resolvedNet) + Math.round(incentive) + Math.round(prBonus) + Math.round(reimbursement),
  );

  const {
    draftMeta: _draftMeta,
    governmentMonthly: _payloadGm,
    govRecalc: _payloadGr,
    government_monthly: _snakeGm,
    gov_recalc: _snakeGr,
    ...payloadRest
  } = payload as Record<string, unknown>;

  return {
    ...calc,
    ...definedEntries(payloadRest),
    employeeUserId,
    employeeName: firstDefined(payload.employeeName, calc.employeeName) ?? null,
    employeeCode: firstDefined(
      draftEmployee.employeeCode,
      draftEmployee.employee_code,
      payload.employeeCode,
      calc.employeeCode,
    ),
    payrollMasterId: firstDefined(
      draftEmployee.payrollMasterId,
      draftEmployee.payroll_master_id,
      payload.payrollMasterId,
      calc.payrollMasterId,
    ),
    payrollMode: firstDefined(payload.payrollMode, calc.payrollMode) ?? "government",
    bankAccountNumber: firstDefined(payload.bankAccountNumber, calc.bankAccountNumber) ?? null,
    bankName: firstDefined(payload.bankName, calc.bankName) ?? null,
    bankIfsc: firstDefined(payload.bankIfsc, calc.bankIfsc) ?? null,
    payDays: payDays ?? 0,
    rawPayDays: firstDefined(numOrUndef(payload.rawPayDays), numOrUndef(calc.rawPayDays), payDays),
    grossBasic: firstDefined(numOrUndef(payload.grossBasic), numOrUndef(govRecalc.grossBasic), numOrUndef(calc.grossBasic)),
    grossMonthly: firstDefined(
      numOrUndef(payload.grossMonthly),
      numOrUndef(govRecalc.grossBasic),
      numOrUndef(payload.grossBasic),
      numOrUndef(calc.grossMonthly),
    ),
    grossPay: grossPay ?? 0,
    deductions: resolvedTotalDeductions,
    netPay: firstDefined(numOrUndef(draftEmployee.netPay), numOrUndef(draftEmployee.net_pay), resolvedNetPay) ?? resolvedNetPay,
    takeHome: firstDefined(
      numOrUndef(payload.takeHome),
      numOrUndef(calc.takeHome),
      Math.round(
        (firstDefined(numOrUndef(draftEmployee.netPay), numOrUndef(draftEmployee.net_pay), resolvedNetPay) ??
          resolvedNetPay) +
          Math.round(incentive) +
          Math.round(prBonus) +
          Math.round(reimbursement),
      ),
    ),
    ctc: firstDefined(numOrUndef(payload.ctc), numOrUndef(calc.ctc)) ?? 0,
    ctcBase: firstDefined(numOrUndef(payload.ctcBase), numOrUndef(calc.ctcBase), numOrUndef(payload.ctc)),
    incentive,
    prBonus,
    reimbursement,
    tds: firstDefined(
      numOrUndef(payload.tds),
      numOrUndef(asRecord(governmentMonthly.deductions)?.incomeTax),
      numOrUndef(calc.tds),
    ) ?? 0,
    profTax: firstDefined(
      numOrUndef(payload.profTax),
      numOrUndef(asRecord(governmentMonthly.deductions)?.pt),
      numOrUndef(calc.profTax),
    ) ?? 0,
    pfEmployee: firstDefined(numOrUndef(payload.pfEmployee), numOrUndef(calc.pfEmployee)) ?? 0,
    pfEmployer: firstDefined(numOrUndef(payload.pfEmployer), numOrUndef(calc.pfEmployer)) ?? 0,
    esicEmployee: firstDefined(numOrUndef(payload.esicEmployee), numOrUndef(calc.esicEmployee)) ?? 0,
    esicEmployer: firstDefined(numOrUndef(payload.esicEmployer), numOrUndef(calc.esicEmployer)) ?? 0,
    daArrear: firstDefined(numOrUndef(payload.daArrear), numOrUndef(gm.daArrearsPaid), numOrUndef(calc.daArrear)),
    transportArrear: firstDefined(
      numOrUndef(payload.transportArrear),
      numOrUndef(gm.transportArrearsPaid),
      numOrUndef(calc.transportArrear),
    ),
    grossArrear: firstDefined(numOrUndef(payload.grossArrear), numOrUndef(gm.grossArrear), numOrUndef(calc.grossArrear)),
    cpfArrear: firstDefined(numOrUndef(payload.cpfArrear), numOrUndef(gm.cpfArrear), numOrUndef(calc.cpfArrear)),
    netArrear: firstDefined(numOrUndef(payload.netArrear), numOrUndef(gm.netArrear), numOrUndef(calc.netArrear)),
    arrearLineIds: firstDefined(payload.arrearLineIds, calc.arrearLineIds),
    arrearLines: firstDefined(payload.arrearLines, calc.arrearLines),
    customFieldValues: firstDefined(payload.customFieldValues, calc.customFieldValues),
    governmentMonthly,
    govRecalc,
    hasQuarter: firstDefined(payload.hasQuarter, gm.hasQuarter, calc.hasQuarter),
    quarterId: firstDefined(payload.quarterId, calc.quarterId),
    quarterName: firstDefined(payload.quarterName, calc.quarterName),
    quarterType: firstDefined(payload.quarterType, calc.quarterType),
    quarterRent: firstDefined(numOrUndef(payload.quarterRent), numOrUndef(gm.quarterRent), numOrUndef(calc.quarterRent)),
  };
}

/** Sum header totals from the same resolved rows the UI renders. */
export function sumResolvedPayrollTotals(rows: Array<Record<string, unknown>>) {
  let gross = 0;
  let deductions = 0;
  let arrears = 0;
  let net = 0;
  for (const r of rows) {
    const gm = asRecord(r.governmentMonthly);
    const gEarn = firstDefined(numOrUndef(gm?.totalEarnings), numOrUndef(r.grossPay)) ?? 0;
    const gDed = firstDefined(numOrUndef(gm?.totalDeductions), numOrUndef(r.deductions)) ?? 0;
    const gNet = firstDefined(numOrUndef(gm?.netSalary), numOrUndef(r.netPay), numOrUndef(r.takeHome)) ?? 0;
    const daArr = firstDefined(numOrUndef(r.daArrear), numOrUndef(gm?.daArrearsPaid)) ?? 0;
    const trArr = firstDefined(numOrUndef(r.transportArrear), numOrUndef(gm?.transportArrearsPaid)) ?? 0;
    const grossArr = firstDefined(numOrUndef(r.grossArrear), numOrUndef(gm?.grossArrear)) ?? 0;
    gross += gEarn;
    deductions += gDed;
    net += gNet;
    arrears += daArr + trArr + grossArr;
  }
  return {
    employees: rows.length,
    gross: Math.round(gross),
    deductions: Math.round(deductions),
    arrears: Math.round(arrears),
    net: Math.round(net),
  };
}
