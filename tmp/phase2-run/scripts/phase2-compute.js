"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const govRunPayrollCompute_1 = require("../src/lib/govRunPayrollCompute");
const root = process.cwd();
const inputPath = `${root}/data/imports/september-2026/.phase2-preview.json`;
const outputPath = `${root}/data/imports/september-2026/.phase2-run-payload.json`;
const preview = JSON.parse((0, node_fs_1.readFileSync)(inputPath, "utf8"));
const rows = preview.preview?.rows ?? [];
const payrollConfig = preview.payrollConfig ?? null;
const payloadRows = rows.map((row) => {
    const gr = row.govRecalc;
    if (!gr || row.payrollMode !== "government") {
        throw new Error(`Government calculation input missing for employee ${row.employeeCode ?? row.employeeUserId}`);
    }
    const result = (0, govRunPayrollCompute_1.runGovernmentPayrollCompute)(gr, {
        daysInMonth: 30,
        payDays: Number(row.payDays ?? 30),
        payrollConfig,
        runYear: 2026,
        runMonth: 9,
        governmentMonthly: null,
        transportSettings: payrollConfig?.transportSettings,
    });
    const gm = result.comp;
    return {
        employeeUserId: row.employeeUserId,
        payDays: result.capped,
        grossPay: gm.totalEarnings,
        netPay: gm.netSalary,
        pfEmployee: 0,
        pfEmployer: 0,
        esicEmployee: 0,
        esicEmployer: 0,
        profTax: gm.deductions?.pt ?? 0,
        deductions: gm.totalDeductions,
        tds: gm.deductions?.incomeTax ?? 0,
        takeHome: gm.netSalary,
        ctc: gm.totalEarnings,
        payrollMode: "government",
        governmentMonthly: gm,
        governmentDeductionDefaults: gr.deductionDefaults,
        governmentEarningPaidOverrides: gr.earningPaidOverrides,
    };
});
(0, node_fs_1.writeFileSync)(outputPath, JSON.stringify({ year: 2026, month: 9, runDay: 30, rows: payloadRows }, null, 2));
const sum = (key) => payloadRows.reduce((n, row) => n + Number(row[key] ?? 0), 0);
process.stdout.write(JSON.stringify({ outputPath, rows: payloadRows.length, gross: sum("grossPay"), deductions: sum("deductions"), net: sum("netPay") }, null, 2));
