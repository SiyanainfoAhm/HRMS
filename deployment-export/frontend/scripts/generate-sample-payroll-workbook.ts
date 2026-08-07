/**
 * Local sample workbook generator for Excel formatting acceptance.
 * Run: npx tsx scripts/generate-sample-payroll-workbook.ts
 */
import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx-js-style";
import {
  buildPayrollRunWorkbook,
  aggregatePayrollSummary,
  type PayrollRunExportRow,
} from "../src/lib/payrollRunWorkbook";

const sampleRows: PayrollRunExportRow[] = [
  {
    employeeUserId: "u1",
    employeeName: "Sample Employee A",
    employeeCode: "001",
    bankAccountNumber: "123456789012",
    payDays: 30,
    grossPay: 85000,
    netPay: 72000,
    deductions: 13000,
    payrollMode: "government",
    governmentMonthly: {
      basicPaid: 45000,
      daPaid: 23850,
      hraPaid: 0,
      transportPaid: 3600,
      medicalPaid: 3000,
      spPayPaid: 2000,
      extraWorkAllowancePaid: 500,
      nightAllowancePaid: 800,
      uniformAllowancePaid: 0,
      educationAllowancePaid: 1500,
      encashmentPaid: 0,
      encashmentDaPaid: 0,
      daArrearsPaid: 1200,
      transportArrearsPaid: 0,
      grossArrear: 0,
      totalEarnings: 81450,
      totalDeductions: 9450,
      netSalary: 72000,
      customEarnings: { telephoneAllowance: 500 },
      customDeductions: {},
      deductions: {
        incomeTax: 2500,
        pt: 200,
        lic: 800,
        cpf: 4500,
        daCpf: 500,
        vpf: 0,
        postOffice: 0,
        creditSociety: 0,
        electricity: 450,
        water: 100,
        mess: 400,
        loanRecovery: 0,
        welfare: 0,
        hpl: 0,
        eol: 0,
        other: 0,
        quarterRent: 1000,
      },
      leaveRemarks: "Sample remarks for formatting wrap test — longer text.",
    },
  },
  {
    employeeUserId: "u2",
    employeeName: "Sample Employee B",
    employeeCode: "002",
    bankAccountNumber: "987654321098",
    payDays: 30,
    grossPay: 60000,
    netPay: 51000,
    deductions: 9000,
    payrollMode: "government",
    governmentMonthly: {
      basicPaid: 35000,
      daPaid: 18550,
      hraPaid: 5000,
      transportPaid: 3600,
      medicalPaid: 3000,
      spPayPaid: 0,
      extraWorkAllowancePaid: 0,
      nightAllowancePaid: 0,
      uniformAllowancePaid: 1200,
      educationAllowancePaid: 0,
      encashmentPaid: 0,
      encashmentDaPaid: 0,
      daArrearsPaid: 0,
      transportArrearsPaid: 300,
      grossArrear: 0,
      totalEarnings: 66650,
      totalDeductions: 9000,
      netSalary: 57650,
      deductions: {
        incomeTax: 1500,
        pt: 200,
        lic: 0,
        cpf: 3500,
        daCpf: 400,
        vpf: 500,
        electricity: 200,
        water: 80,
        mess: 350,
        other: 270,
      },
    },
  },
];

const outDir = path.join(process.cwd(), "tmp");
fs.mkdirSync(outDir, { recursive: true });

const summaryOnly = buildPayrollRunWorkbook(sampleRows, {
  month: 9,
  year: 2026,
  status: "Draft",
  exportedBy: "Local Dev",
  includeDetail: false,
  includeSummary: true,
});
const summaryPath = path.join(outDir, "CIRT_Payroll_Summary_Sep_2026_Draft_SAMPLE.xlsx");
XLSX.writeFile(summaryOnly, summaryPath);

const full = buildPayrollRunWorkbook(sampleRows, {
  month: 9,
  year: 2026,
  status: "Draft",
  exportedBy: "Local Dev",
  includeDetail: true,
  includeSummary: true,
});
const fullPath = path.join(outDir, "CIRT_Payroll_Draft_Sep_2026_SAMPLE.xlsx");
XLSX.writeFile(full, fullPath);

const totals = aggregatePayrollSummary(sampleRows);
console.log("Wrote:", summaryPath);
console.log("Wrote:", fullPath);
console.log("Totals check:", totals);
