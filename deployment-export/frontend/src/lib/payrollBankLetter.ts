/**
 * Helpers for Run Payroll → Download Bank Letter.
 */

export type BankLetterEmployeeInput = {
  employeeUserId: string;
  employeeCode?: string | null;
  employeeName?: string | null;
  bankAccountNumber?: string | null;
  netPay?: number | null;
  governmentMonthly?: Record<string, unknown> | null;
};

export type BankLetterEmployeePayload = {
  employeeUserId: string;
  employeeCode: string;
  employeeName: string;
  bankAccountNumber: string;
  netPay: number;
};

function firstDefined<T>(...values: Array<T | null | undefined>): T | undefined {
  for (const v of values) {
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Resolve net pay from a canonical payroll row (UI / draft / calculated). */
export function resolveBankLetterNetPay(row: BankLetterEmployeeInput): number | null {
  const gm = asRecord(row.governmentMonthly);
  const raw = firstDefined(
    row.netPay,
    typeof gm?.netSalary === "number" ? gm.netSalary : undefined,
    typeof gm?.net_salary === "number" ? (gm.net_salary as number) : undefined,
  );
  if (raw === undefined || raw === null || raw === ("" as unknown)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function mapRowToBankLetterEmployee(
  row: BankLetterEmployeeInput & Record<string, unknown>,
): BankLetterEmployeePayload {
  const anyRow = row as Record<string, unknown>;
  const code = String(
    firstDefined(row.employeeCode, anyRow.employee_code as string | null | undefined) ?? "",
  ).trim();
  const name = String(
    firstDefined(row.employeeName, anyRow.employee_name as string | null | undefined) ?? "",
  ).trim();
  const account = String(
    firstDefined(
      row.bankAccountNumber,
      anyRow.bank_account_number as string | null | undefined,
    ) ?? "",
  )
    .replace(/\s+/g, "")
    .trim();
  const netPay = resolveBankLetterNetPay(row) ?? 0;

  return {
    employeeUserId: String(row.employeeUserId ?? ""),
    employeeCode: code,
    employeeName: name,
    bankAccountNumber: account,
    netPay,
  };
}

/** Block download when required bank-letter fields are missing. */
export function validateBankLetterEmployees(
  employees: BankLetterEmployeePayload[],
): { ok: true } | { ok: false; message: string } {
  if (employees.length === 0) {
    return { ok: false, message: "Bank letter cannot be generated. No employees were provided." };
  }

  const missingAccount: string[] = [];
  const missingCode: string[] = [];
  const missingName: string[] = [];
  const missingAmount: string[] = [];

  for (const e of employees) {
    const label = e.employeeName || e.employeeCode || e.employeeUserId || "Unknown";
    if (!e.employeeCode) missingCode.push(label);
    if (!e.employeeName) missingName.push(label);
    if (!e.bankAccountNumber) missingAccount.push(label);
    if (!Number.isFinite(e.netPay)) missingAmount.push(label);
  }

  if (missingAccount.length) {
    return {
      ok: false,
      message: `Bank letter cannot be generated. Missing account number for:\n${missingAccount.join(", ")}.`,
    };
  }
  if (missingCode.length) {
    return {
      ok: false,
      message: `Bank letter cannot be generated. Missing employee ID for:\n${missingCode.join(", ")}.`,
    };
  }
  if (missingName.length) {
    return {
      ok: false,
      message: `Bank letter cannot be generated. Missing employee name for:\n${missingName.join(", ")}.`,
    };
  }
  if (missingAmount.length) {
    return {
      ok: false,
      message: `Bank letter cannot be generated. Missing net salary for:\n${missingAmount.join(", ")}.`,
    };
  }

  return { ok: true };
}
