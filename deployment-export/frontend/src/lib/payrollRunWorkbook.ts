import * as XLSX from "xlsx-js-style";
import {
  buildPayrollExcelHeaders,
  buildPayrollExcelRow,
  collectDynamicPayrollExcelColumns,
  payrollExcelAmountColumnIndices,
  type GovernmentMonthlyRow,
} from "@/lib/payrollExcelExport";
import type { GovernmentMonthlyComputed } from "@/lib/governmentPayroll";
import {
  applyBodyCellStyle,
  applyColumnHeaderStyle,
  applyCurrencyCellStyle,
  applyFinalNetCurrencyStyle,
  applyFinalNetRowStyle,
  applyIntegerCellStyle,
  applyMetaStyle,
  applyReportTitleStyle,
  applySectionHeaderStyle,
  applyStatusBannerStyle,
  applyTotalCurrencyStyle,
  applyTotalRowStyle,
  autoFitColumnsWithLimits,
  configurePayrollPrintSetup,
  mergeCells,
  pairItems,
  writeStyledCell,
  type XlsxCellStyle,
} from "@/lib/payrollExcelStyles";
import {
  payrollDetailWorkbookFilename,
  payrollExtractWorkbookFilename,
} from "@/lib/payrollDownloadFilenames";

const MONTH_NAMES = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type PayrollWorkbookStatus = "Calculated Preview" | "Draft" | "Unsaved Preview" | "Finalized";

export type PayrollRunExportRow = {
  employeeUserId: string;
  employeeName?: string | null;
  employeeCode?: string | null;
  payDays?: number | null;
  grossPay?: number | null;
  netPay?: number | null;
  deductions?: number | null;
  incentive?: number | null;
  prBonus?: number | null;
  reimbursement?: number | null;
  tds?: number | null;
  ctc?: number | null;
  takeHome?: number | null;
  bankAccountNumber?: string | null;
  payrollMode?: string | null;
  governmentMonthly?: GovernmentMonthlyComputed | Record<string, unknown> | null;
};

type NamedAmount = { label: string; amount: number };

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function gmNum(gm: Record<string, unknown> | null | undefined, camel: string, snake: string): number {
  if (!gm) return 0;
  return num(gm[camel] ?? gm[snake]);
}

function parseCustomBag(raw: unknown): Record<string, number> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return parseCustomBag(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    out[k] = num(v);
  }
  return out;
}

function titleFromFieldKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function gmDeductions(gm: Record<string, unknown> | null | undefined): Record<string, number> {
  const d = (gm?.deductions ?? {}) as Record<string, unknown>;
  return {
    incomeTax: num(d.incomeTax ?? d.income_tax ?? gm?.income_tax_amount),
    pt: num(d.pt ?? d.professionalTax ?? gm?.pt_amount),
    lic: num(d.lic ?? gm?.lic_amount),
    cpf: num(d.cpf ?? gm?.cpf_amount),
    daCpf: num(d.daCpf ?? d.da_cpf ?? gm?.da_cpf_amount),
    vpf: num(d.vpf ?? gm?.vpf_amount),
    pfLoan: num(d.pfLoan ?? d.pf_loan ?? gm?.pf_loan_amount),
    postOffice: num(d.postOffice ?? d.post_office ?? gm?.post_office_amount),
    creditSociety: num(d.creditSociety ?? d.credit_society ?? gm?.credit_society_amount),
    stdLicenceFee: num(d.stdLicenceFee ?? d.std_licence_fee ?? gm?.std_licence_fee_amount),
    electricity: num(d.electricity ?? gm?.electricity_amount),
    water: num(d.water ?? gm?.water_amount),
    mess: num(d.mess ?? gm?.mess_amount),
    loanRecovery: num(d.loanRecovery ?? d.loan_recovery ?? gm?.loan_recovery_amount),
    welfare: num(d.welfare ?? gm?.welfare_amount),
    hpl: num(d.hpl ?? gm?.hpl_amount),
    eol: num(d.eol ?? gm?.eol_amount),
    vehCharge: num(d.vehCharge ?? d.veh_charge ?? gm?.veh_charge_amount),
    other: num(d.other ?? d.otherDeduction ?? gm?.other_deduction_amount),
    quarterRent: num(d.quarterRent ?? d.quarter_rent ?? gm?.quarter_rent_amount),
  };
}

function addAmount(map: Record<string, number>, label: string, amount: number) {
  map[label] = (map[label] ?? 0) + amount;
}

export function aggregatePayrollSummary(rows: PayrollRunExportRow[]) {
  const earnings: Record<string, number> = {
    "Basic Pay": 0,
    "Dearness Allowance": 0,
    "House Rent Allowance": 0,
    "Transport Allowance": 0,
    "Medical Allowance": 0,
    "Special Pay": 0,
    EWA: 0,
    "Night Allowance": 0,
    "Uniform Allowance": 0,
    "Education Allowance": 0,
    Encashment: 0,
    "Encashment DA": 0,
  };
  const arrears: Record<string, number> = {
    "DA Arrears": 0,
    "Transport Arrears": 0,
    "Gross Arrears": 0,
  };
  const deductions: Record<string, number> = {
    "Income Tax": 0,
    "Professional Tax": 0,
    LIC: 0,
    CPF: 0,
    "DA CPF": 0,
    VPF: 0,
    "PF Loan": 0,
    "Post Office": 0,
    "Credit Society": 0,
    Electricity: 0,
    Water: 0,
    Mess: 0,
    "Bank Recovery": 0,
    Welfare: 0,
    HPL: 0,
    EOL: 0,
    "Vehicle Charge": 0,
    "Other Deduction": 0,
    "Quarter Rent": 0,
  };

  let totalEarnings = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  let totalArrears = 0;

  for (const r of rows) {
    const gm = (r.governmentMonthly ?? null) as Record<string, unknown> | null;
    if (gm) {
      earnings["Basic Pay"] += gmNum(gm, "basicPaid", "basic_paid");
      earnings["Dearness Allowance"] += gmNum(gm, "daPaid", "da_paid");
      earnings["House Rent Allowance"] += gmNum(gm, "hraPaid", "hra_paid");
      earnings["Transport Allowance"] += gmNum(gm, "transportPaid", "transport_paid");
      earnings["Medical Allowance"] += gmNum(gm, "medicalPaid", "medical_paid");
      earnings["Special Pay"] += gmNum(gm, "spPayPaid", "sp_pay_paid");
      earnings.EWA += gmNum(gm, "extraWorkAllowancePaid", "extra_work_allowance_paid");
      earnings["Night Allowance"] += gmNum(gm, "nightAllowancePaid", "night_allowance_paid");
      earnings["Uniform Allowance"] += gmNum(gm, "uniformAllowancePaid", "uniform_allowance_paid");
      earnings["Education Allowance"] += gmNum(gm, "educationAllowancePaid", "education_allowance_paid");
      earnings.Encashment += gmNum(gm, "encashmentPaid", "encashment_paid");
      earnings["Encashment DA"] += gmNum(gm, "encashmentDaPaid", "encashment_da_paid");

      for (const [key, amount] of Object.entries(
        parseCustomBag(gm.customEarnings ?? gm.custom_earnings),
      )) {
        addAmount(earnings, titleFromFieldKey(key), amount);
      }

      arrears["DA Arrears"] += gmNum(gm, "daArrearsPaid", "da_arrears_paid");
      arrears["Transport Arrears"] += gmNum(gm, "transportArrearsPaid", "transport_arrears_paid");
      arrears["Gross Arrears"] += gmNum(gm, "grossArrear", "gross_arrear");

      const d = gmDeductions(gm);
      deductions["Income Tax"] += d.incomeTax;
      deductions["Professional Tax"] += d.pt;
      deductions.LIC += d.lic;
      deductions.CPF += d.cpf;
      deductions["DA CPF"] += d.daCpf;
      deductions.VPF += d.vpf;
      deductions["PF Loan"] += d.pfLoan;
      deductions["Post Office"] += d.postOffice;
      deductions["Credit Society"] += d.creditSociety;
      deductions.Electricity += d.electricity;
      deductions.Water += d.water;
      deductions.Mess += d.mess;
      deductions["Bank Recovery"] += d.loanRecovery;
      deductions.Welfare += d.welfare;
      deductions.HPL += d.hpl;
      deductions.EOL += d.eol;
      deductions["Vehicle Charge"] += d.vehCharge;
      deductions["Other Deduction"] += d.other;
      deductions["Quarter Rent"] += d.quarterRent;

      for (const [key, amount] of Object.entries(
        parseCustomBag(gm.customDeductions ?? gm.custom_deductions),
      )) {
        addAmount(deductions, titleFromFieldKey(key), amount);
      }

      totalEarnings += gmNum(gm, "totalEarnings", "total_earnings");
      totalDeductions += gmNum(gm, "totalDeductions", "total_deductions");
      totalNet += gmNum(gm, "netSalary", "net_salary") || num(r.netPay);
      totalArrears +=
        gmNum(gm, "daArrearsPaid", "da_arrears_paid") +
        gmNum(gm, "transportArrearsPaid", "transport_arrears_paid") +
        gmNum(gm, "grossArrear", "gross_arrear");
    } else {
      totalEarnings += num(r.grossPay);
      totalDeductions += num(r.deductions);
      totalNet += num(r.takeHome ?? r.netPay);
    }
  }

  return {
    employeeCount: rows.length,
    earnings,
    arrears,
    deductions,
    totalEarnings: Math.round(totalEarnings),
    totalArrears: Math.round(totalArrears),
    totalDeductions: Math.round(totalDeductions),
    netPayable: Math.round(totalNet),
    earningsExcludingArrears: Math.round(totalEarnings - totalArrears),
  };
}

function nonZeroEntries(map: Record<string, number>): NamedAmount[] {
  return Object.entries(map)
    .filter(([, amount]) => amount !== 0)
    .map(([label, amount]) => ({ label, amount }));
}

function cell(
  ws: XLSX.WorkSheet,
  r: number,
  c: number,
  value: string | number | null | undefined,
  style?: XlsxCellStyle,
) {
  writeStyledCell(XLSX.utils.encode_cell, ws as unknown as Record<string, unknown>, r, c, value, style);
}

function fillMergedRange(
  ws: XLSX.WorkSheet,
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>,
  r: number,
  c1: number,
  c2: number,
  value: string | number,
  style: XlsxCellStyle,
) {
  cell(ws, r, c1, value, style);
  for (let c = c1 + 1; c <= c2; c++) {
    cell(ws, r, c, "", style);
  }
  mergeCells(merges, r, c1, r, c2);
}

function writePairedAmountRows(
  ws: XLSX.WorkSheet,
  startRow: number,
  items: NamedAmount[],
): number {
  let row = startRow;
  for (const [left, right] of pairItems(items)) {
    cell(ws, row, 0, left?.label ?? "", applyBodyCellStyle({ align: "left" }));
    cell(
      ws,
      row,
      1,
      left ? left.amount : "",
      left ? applyCurrencyCellStyle() : applyBodyCellStyle({ align: "right" }),
    );
    cell(ws, row, 2, right?.label ?? "", applyBodyCellStyle({ align: "left" }));
    cell(
      ws,
      row,
      3,
      right ? right.amount : "",
      right ? applyCurrencyCellStyle() : applyBodyCellStyle({ align: "right" }),
    );
    (ws["!rows"] as Array<{ hpt?: number }>)[row] = { hpt: 18 };
    row += 1;
  }
  return row;
}

function writeFullWidthTotal(
  ws: XLSX.WorkSheet,
  merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }>,
  row: number,
  label: string,
  amount: number,
  variant: "total" | "gross",
) {
  cell(ws, row, 0, label, applyTotalRowStyle(variant));
  cell(ws, row, 1, "", applyTotalRowStyle(variant));
  mergeCells(merges, row, 0, row, 1);
  cell(ws, row, 2, amount, applyTotalCurrencyStyle(variant));
  cell(ws, row, 3, "", applyTotalCurrencyStyle(variant));
  mergeCells(merges, row, 2, row, 3);
  (ws["!rows"] as Array<{ hpt?: number }>)[row] = { hpt: 20 };
}

export function buildMonthlySummarySheet(
  rows: PayrollRunExportRow[],
  opts: {
    month: number;
    year: number;
    status: PayrollWorkbookStatus;
    exportedBy?: string;
  },
): XLSX.WorkSheet {
  const summary = aggregatePayrollSummary(rows);
  const exportedAt = new Date().toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const ws = XLSX.utils.aoa_to_sheet([]) as XLSX.WorkSheet;
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  ws["!rows"] = [];

  const LAST_COL = 3;
  const monthName = (MONTH_NAMES[opts.month] ?? String(opts.month)).toUpperCase();

  // Title (two lines, matching official statement)
  fillMergedRange(
    ws,
    merges,
    0,
    0,
    LAST_COL,
    "SUMMARY OF SALARY PAYABLE TO CIRT EMPLOYEES",
    applyReportTitleStyle(),
  );
  (ws["!rows"] as Array<{ hpt?: number }>)[0] = { hpt: 26 };

  fillMergedRange(
    ws,
    merges,
    1,
    0,
    LAST_COL,
    `FOR ${monthName} ${opts.year}`,
    applyReportTitleStyle(),
  );
  (ws["!rows"] as Array<{ hpt?: number }>)[1] = { hpt: 24 };

  // Metadata
  const metaParts = [
    `Status: ${opts.status}`,
    `Employees: ${summary.employeeCount}`,
    `Exported: ${exportedAt}`,
  ];
  if (opts.exportedBy) metaParts.push(`Exported by: ${opts.exportedBy}`);
  fillMergedRange(ws, merges, 2, 0, LAST_COL, metaParts.join("  |  "), applyMetaStyle());
  (ws["!rows"] as Array<{ hpt?: number }>)[2] = { hpt: 18 };

  // Blank
  let row = 4;

  // A. Earnings
  fillMergedRange(ws, merges, row, 0, LAST_COL, "A. GROSS SALARY / EARNINGS", applySectionHeaderStyle());
  (ws["!rows"] as Array<{ hpt?: number }>)[row] = { hpt: 22 };
  row += 1;

  for (let c = 0; c < 4; c++) {
    cell(
      ws,
      row,
      c,
      c % 2 === 0 ? "Particulars" : "Amount (₹)",
      applyColumnHeaderStyle(),
    );
  }
  (ws["!rows"] as Array<{ hpt?: number }>)[row] = { hpt: 18 };
  row += 1;

  const earningItems = [
    ...nonZeroEntries(summary.earnings),
    ...nonZeroEntries(summary.arrears),
  ];
  row = writePairedAmountRows(ws, row, earningItems);

  writeFullWidthTotal(ws, merges, row, "GROSS SALARY PAYABLE", summary.totalEarnings, "gross");
  row += 1;

  // Blank between sections
  row += 1;

  // B. Deductions
  fillMergedRange(ws, merges, row, 0, LAST_COL, "B. DEDUCTIONS", applySectionHeaderStyle());
  (ws["!rows"] as Array<{ hpt?: number }>)[row] = { hpt: 22 };
  row += 1;

  for (let c = 0; c < 4; c++) {
    cell(
      ws,
      row,
      c,
      c % 2 === 0 ? "Particulars" : "Amount (₹)",
      applyColumnHeaderStyle(),
    );
  }
  (ws["!rows"] as Array<{ hpt?: number }>)[row] = { hpt: 18 };
  row += 1;

  row = writePairedAmountRows(ws, row, nonZeroEntries(summary.deductions));

  writeFullWidthTotal(ws, merges, row, "TOTAL DEDUCTIONS", summary.totalDeductions, "total");
  row += 1;

  // Blank
  row += 1;

  // C. Final totals
  fillMergedRange(ws, merges, row, 0, LAST_COL, "C. FINAL TOTALS", applySectionHeaderStyle());
  (ws["!rows"] as Array<{ hpt?: number }>)[row] = { hpt: 22 };
  row += 1;

  cell(ws, row, 0, "Particulars", applyColumnHeaderStyle());
  cell(ws, row, 1, "", applyColumnHeaderStyle());
  mergeCells(merges, row, 0, row, 1);
  cell(ws, row, 2, "Amount", applyColumnHeaderStyle());
  cell(ws, row, 3, "", applyColumnHeaderStyle());
  mergeCells(merges, row, 2, row, 3);
  row += 1;

  const finalRows: Array<{
    label: string;
    value: number;
    kind: "int" | "money" | "net" | "gross";
  }> = [
    { label: "Employee Count", value: summary.employeeCount, kind: "int" },
    { label: "Total Earnings excluding arrears", value: summary.earningsExcludingArrears, kind: "money" },
    { label: "Total Arrears", value: summary.totalArrears, kind: "money" },
    { label: "Gross Salary Payable", value: summary.totalEarnings, kind: "gross" },
    { label: "Total Deductions", value: summary.totalDeductions, kind: "money" },
    { label: "NET SALARY PAYABLE", value: summary.netPayable, kind: "net" },
  ];

  for (const item of finalRows) {
    if (item.kind === "net") {
      cell(ws, row, 0, item.label, applyFinalNetRowStyle());
      cell(ws, row, 1, "", applyFinalNetRowStyle());
      mergeCells(merges, row, 0, row, 1);
      cell(ws, row, 2, item.value, applyFinalNetCurrencyStyle());
      cell(ws, row, 3, "", applyFinalNetCurrencyStyle());
      mergeCells(merges, row, 2, row, 3);
      (ws["!rows"] as Array<{ hpt?: number }>)[row] = { hpt: 24 };
    } else if (item.kind === "int") {
      cell(ws, row, 0, item.label, applyBodyCellStyle({ align: "left" }));
      cell(ws, row, 1, "", applyBodyCellStyle({ align: "left" }));
      mergeCells(merges, row, 0, row, 1);
      cell(ws, row, 2, item.value, applyIntegerCellStyle({ bold: true }));
      cell(ws, row, 3, "", applyIntegerCellStyle({ bold: true }));
      mergeCells(merges, row, 2, row, 3);
      (ws["!rows"] as Array<{ hpt?: number }>)[row] = { hpt: 18 };
    } else {
      const variant = item.kind === "gross" ? "gross" : "total";
      cell(ws, row, 0, item.label, applyTotalRowStyle(variant));
      cell(ws, row, 1, "", applyTotalRowStyle(variant));
      mergeCells(merges, row, 0, row, 1);
      cell(ws, row, 2, item.value, applyTotalCurrencyStyle(variant));
      cell(ws, row, 3, "", applyTotalCurrencyStyle(variant));
      mergeCells(merges, row, 2, row, 3);
      (ws["!rows"] as Array<{ hpt?: number }>)[row] = { hpt: 20 };
    }
    row += 1;
  }

  const lastRow0 = row - 1;
  ws["!merges"] = merges;
  ws["!cols"] = autoFitColumnsWithLimits([34, 18, 34, 18], { min: 14, max: 40 });
  configurePayrollPrintSetup(ws as unknown as Record<string, unknown>, {
    lastRow0,
    lastCol0: LAST_COL,
    freezeRows: 0,
    landscape: true,
    titleRows: 3,
  });

  return ws;
}

function governmentMonthlyToDbShape(
  gm: Record<string, unknown> | null | undefined,
): GovernmentMonthlyRow | null {
  if (!gm) return null;
  const d = gmDeductions(gm);
  return {
    pay_level: num(gm.payLevel ?? gm.pay_level) || null,
    basic_paid: gmNum(gm, "basicPaid", "basic_paid"),
    da_paid: gmNum(gm, "daPaid", "da_paid"),
    hra_paid: gmNum(gm, "hraPaid", "hra_paid"),
    medical_paid: gmNum(gm, "medicalPaid", "medical_paid"),
    transport_paid: gmNum(gm, "transportPaid", "transport_paid"),
    sp_pay_paid: gmNum(gm, "spPayPaid", "sp_pay_paid"),
    extra_work_allowance_paid: gmNum(gm, "extraWorkAllowancePaid", "extra_work_allowance_paid"),
    night_allowance_paid: gmNum(gm, "nightAllowancePaid", "night_allowance_paid"),
    uniform_allowance_paid: gmNum(gm, "uniformAllowancePaid", "uniform_allowance_paid"),
    education_allowance_paid: gmNum(gm, "educationAllowancePaid", "education_allowance_paid"),
    da_arrears_paid: gmNum(gm, "daArrearsPaid", "da_arrears_paid"),
    transport_arrears_paid: gmNum(gm, "transportArrearsPaid", "transport_arrears_paid"),
    encashment_paid: gmNum(gm, "encashmentPaid", "encashment_paid"),
    encashment_da_paid: gmNum(gm, "encashmentDaPaid", "encashment_da_paid"),
    income_tax_amount: d.incomeTax,
    pt_amount: d.pt,
    lic_amount: d.lic,
    cpf_amount: d.cpf,
    da_cpf_amount: d.daCpf,
    vpf_amount: d.vpf,
    pf_loan_amount: d.pfLoan,
    post_office_amount: d.postOffice,
    credit_society_amount: d.creditSociety,
    std_licence_fee_amount: d.stdLicenceFee,
    electricity_amount: d.electricity,
    electricity_units_consumed: gmNum(gm, "electricityUnitsConsumed", "electricity_units_consumed"),
    electricity_unit_rate: gmNum(gm, "electricityUnitRate", "electricity_unit_rate"),
    night_hours: gmNum(gm, "nightHours", "night_hours"),
    night_allowance_rate: gmNum(gm, "nightAllowanceRate", "night_allowance_rate"),
    night_allowance_amount: gmNum(gm, "nightAllowanceAmount", "night_allowance_amount"),
    water_amount: d.water,
    mess_amount: d.mess,
    loan_recovery_amount: d.loanRecovery,
    welfare_amount: d.welfare,
    hpl_amount: d.hpl,
    eol_amount: d.eol,
    leave_remarks: (gm.leaveRemarks ?? gm.leave_remarks ?? null) as string | null,
    veh_charge_amount: d.vehCharge,
    other_deduction_amount: d.other,
    total_earnings: gmNum(gm, "totalEarnings", "total_earnings"),
    total_deductions: gmNum(gm, "totalDeductions", "total_deductions"),
    net_salary: gmNum(gm, "netSalary", "net_salary"),
    custom_earnings: gm.customEarnings ?? gm.custom_earnings,
    custom_deductions: gm.customDeductions ?? gm.custom_deductions,
    has_quarter: Boolean(gm.hasQuarter ?? gm.has_quarter),
    quarter_name: (gm.quarterName ?? gm.quarter_name ?? null) as string | null,
    quarter_type: (gm.quarterType ?? gm.quarter_type ?? null) as string | null,
    quarter_rent_amount: d.quarterRent,
  };
}

const TEXT_HEADERS = new Set([
  "AccountNumber",
  "EmployeeName",
  "EmployeeCode",
  "Division",
  "Department",
  "Remarks",
  "NightAllowanceEligible",
  "QuarterName",
  "QuarterType",
]);

export function buildEmployeeDetailSheet(
  rows: PayrollRunExportRow[],
  opts: {
    month: number;
    year: number;
    status: PayrollWorkbookStatus;
  },
): XLSX.WorkSheet {
  const govRows = rows
    .map((r) => governmentMonthlyToDbShape(r.governmentMonthly as Record<string, unknown> | null))
    .filter((g): g is GovernmentMonthlyRow => g != null) as unknown as Array<Record<string, unknown>>;
  const dynamicCols = collectDynamicPayrollExcelColumns(govRows);
  const headers = buildPayrollExcelHeaders(dynamicCols);
  const amountCols = new Set(payrollExcelAmountColumnIndices(headers.length));

  const banner =
    opts.status === "Finalized"
      ? "FINALIZED"
      : opts.status === "Draft"
        ? "DRAFT — NOT FINALIZED"
        : "PREVIEW — NOT FINALIZED";
  const statusKind =
    opts.status === "Finalized" ? "final" : opts.status === "Draft" ? "draft" : "preview";

  const ws = XLSX.utils.aoa_to_sheet([]) as XLSX.WorkSheet;
  const merges: Array<{ s: { r: number; c: number }; e: { r: number; c: number } }> = [];
  ws["!rows"] = [];

  const lastCol = Math.max(0, headers.length - 1);

  fillMergedRange(
    ws,
    merges,
    0,
    0,
    lastCol,
    `CIRT PAYROLL – ${(MONTH_NAMES[opts.month] ?? opts.month).toString().toUpperCase()} ${opts.year}`,
    applyReportTitleStyle(),
  );
  (ws["!rows"] as Array<{ hpt?: number }>)[0] = { hpt: 28 };

  fillMergedRange(ws, merges, 1, 0, lastCol, banner, applyStatusBannerStyle(statusKind));
  (ws["!rows"] as Array<{ hpt?: number }>)[1] = { hpt: 20 };

  const headerRow = 3;
  headers.forEach((h, c) => {
    cell(ws, headerRow, c, h, applyColumnHeaderStyle());
  });
  (ws["!rows"] as Array<{ hpt?: number }>)[headerRow] = { hpt: 30 };

  const dataStart = headerRow + 1;
  const totalAcc: Record<string, number> = {};
  for (const h of headers) {
    if (!TEXT_HEADERS.has(h) && h !== "PayLevel") totalAcc[h] = 0;
  }

  rows.forEach((r, idx) => {
    const gm = governmentMonthlyToDbShape(r.governmentMonthly as Record<string, unknown> | null);
    const payslip = {
      employee_user_id: r.employeeUserId,
      payroll_mode: r.payrollMode ?? "government",
      bank_account_number: r.bankAccountNumber ?? null,
      ctc: r.ctc ?? null,
      gross_pay: r.grossPay ?? null,
      net_pay: r.netPay ?? null,
      pay_days: r.payDays ?? null,
      deductions: r.deductions ?? null,
      incentive: r.incentive ?? null,
      pr_bonus: r.prBonus ?? null,
      reimbursement: r.reimbursement ?? null,
      tds: r.tds ?? null,
    };
    const rowObj = buildPayrollExcelRow(
      payslip,
      String(r.employeeName ?? ""),
      gm ? { kind: "row", row: gm } : null,
      dynamicCols,
    ) as Record<string, string | number>;

    const excelRow = dataStart + idx;
    const alt = idx % 2 === 1;
    let remarksLen = 0;

    headers.forEach((h, c) => {
      const raw = rowObj[h];
      const isText = TEXT_HEADERS.has(h) || typeof raw === "string";
      const isAmount = amountCols.has(c) && !isText;
      let value: string | number = raw ?? "";
      if (isAmount && raw != null && !(typeof raw === "string" && raw === "")) {
        value = num(raw);
        if (h in totalAcc) totalAcc[h] += value;
      }
      if (h === "Remarks") remarksLen = String(value ?? "").length;

      if (isAmount) {
        cell(ws, excelRow, c, value === "" ? 0 : value, applyCurrencyCellStyle({ alt }));
      } else if (h === "AccountNumber") {
        // Keep as text so leading zeros / long account numbers are preserved.
        const acct = raw == null ? "" : String(raw);
        const style = applyBodyCellStyle({ align: "left", alt });
        style.numFmt = "@";
        cell(ws, excelRow, c, acct, style);
      } else if (h === "PayDays" || h === "PayLevel" || h === "NightHours" || h === "ElectricityUnits") {
        cell(ws, excelRow, c, num(raw), applyIntegerCellStyle());
      } else {
        cell(ws, excelRow, c, value, applyBodyCellStyle({ align: "left", alt }));
      }
    });

    (ws["!rows"] as Array<{ hpt?: number }>)[excelRow] = {
      hpt: remarksLen > 40 ? Math.min(60, 18 + Math.ceil(remarksLen / 30) * 12) : 18,
    };
  });

  const totalsRow = dataStart + rows.length;
  headers.forEach((h, c) => {
    if (c === 0) {
      cell(ws, totalsRow, c, "TOTALS", applyTotalRowStyle("gross"));
      return;
    }
    if (h in totalAcc && !TEXT_HEADERS.has(h)) {
      cell(ws, totalsRow, c, totalAcc[h], applyTotalCurrencyStyle("gross"));
    } else {
      cell(ws, totalsRow, c, "", applyTotalRowStyle("gross"));
    }
  });
  (ws["!rows"] as Array<{ hpt?: number }>)[totalsRow] = { hpt: 22 };

  // Prefer SUM formulas for key numeric columns where practical
  const formulaTargets = ["GrossTotal", "TotalDeductions", "NetPay", "Basic", "DA"];
  for (const h of formulaTargets) {
    const c = headers.indexOf(h);
    if (c < 0 || rows.length === 0) continue;
    const start = XLSX.utils.encode_cell({ r: dataStart, c });
    const end = XLSX.utils.encode_cell({ r: totalsRow - 1, c });
    const ref = XLSX.utils.encode_cell({ r: totalsRow, c });
    (ws as Record<string, unknown>)[ref] = {
      t: "n",
      f: `SUM(${start}:${end})`,
      s: applyTotalCurrencyStyle("gross"),
      z: '"₹"#,##0.00',
    };
  }

  ws["!merges"] = merges;

  const widths = headers.map((h, i) => {
    if (i < 2) return 22;
    if (h === "Remarks") return 28;
    if (h === "EmployeeName") return 24;
    if (TEXT_HEADERS.has(h)) return 16;
    return 12;
  });
  ws["!cols"] = autoFitColumnsWithLimits(widths, { min: 10, max: 36 });

  const autoFilterRef = `A${headerRow + 1}:${XLSX.utils.encode_col(lastCol)}${totalsRow}`;
  configurePayrollPrintSetup(ws as unknown as Record<string, unknown>, {
    lastRow0: totalsRow,
    lastCol0: lastCol,
    freezeRows: headerRow + 1,
    landscape: true,
    titleRows: headerRow + 1,
    autoFilterRef,
  });

  // Ensure ref covers all used cells
  (ws as { "!ref"?: string })["!ref"] = `A1:${XLSX.utils.encode_col(lastCol)}${totalsRow + 1}`;

  return ws;
}

export function buildPayrollRunWorkbook(
  rows: PayrollRunExportRow[],
  opts: {
    month: number;
    year: number;
    status: PayrollWorkbookStatus;
    exportedBy?: string;
    includeDetail?: boolean;
    includeSummary?: boolean;
  },
): XLSX.WorkBook {
  const includeDetail = opts.includeDetail !== false;
  const includeSummary = opts.includeSummary !== false;
  const wb = XLSX.utils.book_new();

  if (includeDetail) {
    XLSX.utils.book_append_sheet(wb, buildEmployeeDetailSheet(rows, opts), "Employee Detail");
  }
  if (includeSummary) {
    XLSX.utils.book_append_sheet(wb, buildMonthlySummarySheet(rows, opts), "Monthly Summary");
  }

  return wb;
}

export function downloadPayrollRunWorkbook(
  rows: PayrollRunExportRow[],
  opts: {
    month: number;
    year: number;
    status: PayrollWorkbookStatus;
    exportedBy?: string;
    includeDetail?: boolean;
    includeSummary?: boolean;
    filename?: string;
  },
): void {
  const wb = buildPayrollRunWorkbook(rows, opts);
  const includeDetail = opts.includeDetail !== false;
  const includeSummary = opts.includeSummary !== false;
  const filename =
    opts.filename ??
    (includeDetail
      ? payrollDetailWorkbookFilename(opts.month, opts.year)
      : includeSummary
        ? payrollExtractWorkbookFilename(opts.month, opts.year)
        : payrollDetailWorkbookFilename(opts.month, opts.year));
  XLSX.writeFile(wb, filename);
}
