import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx-js-style";
import { runGovernmentPayrollCompute } from "../src/lib/govRunPayrollCompute";

const dir = "data/imports/september-2026";
const preview = JSON.parse(readFileSync(`${dir}/.phase2-preview.json`, "utf8"));
const saved = JSON.parse(readFileSync(`${dir}/.phase2-export.json`, "utf8"));

type Row = Record<string, unknown>;
const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, "");
const number = (value: unknown) => {
  const parsed = Number(String(value ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
function sheetRows(file: string, sheetName?: string): Row[] {
  const workbook = XLSX.readFile(file, { raw: true });
  const sheet = workbook.Sheets[sheetName ?? workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: "" });
}
function indexed(rows: Row[], key: string) {
  const out = new Map<string, Row>();
  for (const row of rows) {
    const value = normalize(row[key]);
    if (value) out.set(value, row);
  }
  return out;
}

const source = sheetRows(`${dir}/Salary Data as on 15.10.2026.xlsx`, "Employee Payroll");
const foxpro = sheetRows(`${dir}/September Salary 2026 - Foxpro.xlsx`);
const sourceByCode = indexed(source, "Employee Code");
const foxByCpf = indexed(foxpro, "CPFNO");
const payrollConfig = preview.payrollConfig;
const savedByEmployeeId = new Map<string, Row>((saved.governmentMonthly as Row[]).map((row) => [String(row.employee_user_id), row]));

const output: Row[] = [];
const applied: Row[] = [];
const manualReview: Row[] = [];
for (const row of preview.preview.rows as Row[]) {
  const employeeCode = String(row.employeeCode ?? "");
  const input = sourceByCode.get(normalize(employeeCode));
  const cpf = normalize(input?.["CPF No"]);
  const fox = cpf ? foxByCpf.get(cpf) : undefined;
  const govRecalc = structuredClone(row.govRecalc as Record<string, unknown>);
  const current = savedByEmployeeId.get(String(row.employeeUserId)) ?? {};
  const overrides = { ...(govRecalc.earningPaidOverrides as Record<string, number> ?? {}) };
  const changes: string[] = [];

  // These are source-component inputs, not FoxPro net/gross overrides.
  if (input && number(input["Basic Paid"]) > 0 && !Boolean(govRecalc.hasQuarter)) {
    overrides.hraPaid = number(input["HRA Paid"]);
    changes.push("HRA source-paid precision");
  }
  if (fox && number(fox.TUITION) !== 0) {
    overrides.educationAllowancePaid = number(fox.TUITION);
    changes.push("Education Allowance (FoxPro TUITION)");
  }
  if (fox && number(fox.ENCASH_DA) !== 0) {
    overrides.encashmentDaPaid = number(fox.ENCASH_DA);
    changes.push("Encashment (FoxPro ENCASH_DA)");
  }
  govRecalc.earningPaidOverrides = overrides;

  const result = runGovernmentPayrollCompute(govRecalc as never, {
    daysInMonth: 30,
    payDays: number(row.payDays) || 30,
    payrollConfig,
    runYear: 2026,
    runMonth: 9,
    governmentMonthly: null,
    transportSettings: payrollConfig?.transportSettings,
  }).comp;
  output.push({
    employeeCode,
    employeeName: row.employeeName,
    cpfNo: input?.["CPF No"] ?? "",
    identityStatus: cpf && fox ? "CPF verified" : "Manual review",
    currentGross: number(current.total_earnings),
    scenarioGross: result.totalEarnings,
    currentDeductions: number(current.total_deductions),
    scenarioDeductions: result.totalDeductions,
    currentNet: number(current.net_salary),
    scenarioNet: result.netSalary,
    hra: result.hraPaid,
    educationAllowance: result.educationAllowancePaid,
    encashment: result.encashmentDaPaid,
    changes: changes.join("; "),
  });
  if (changes.length) applied.push({ employeeCode, cpfNo: input?.["CPF No"] ?? "", changes: changes.join("; ") });
  if (!cpf || !fox) manualReview.push({ employeeCode, employeeName: row.employeeName, cpfNo: input?.["CPF No"] ?? "", reason: "No CPF-confirmed FoxPro record; no scenario source value applied" });
}

const sum = (key: string) => output.reduce((total, row) => total + number(row[key]), 0);
writeFileSync(`${dir}/.sept-2026-corrected-scenario.json`, JSON.stringify({
  scope: "Non-persisted engine calculation. It applies only CPF-verified source component mappings and never writes payroll rows.",
  rows: output,
  applied,
  manualReview,
  totals: {
    employees: output.length,
    cpfVerified: output.filter((row) => row.identityStatus === "CPF verified").length,
    currentGross: sum("currentGross"), scenarioGross: sum("scenarioGross"),
    currentDeductions: sum("currentDeductions"), scenarioDeductions: sum("scenarioDeductions"),
    currentNet: sum("currentNet"), scenarioNet: sum("scenarioNet"),
  },
}, null, 2));
console.log(JSON.stringify({ employees: output.length, sourceChangesApplied: applied.length, totals: { currentGross: sum("currentGross"), scenarioGross: sum("scenarioGross"), currentNet: sum("currentNet"), scenarioNet: sum("scenarioNet") } }, null, 2));
