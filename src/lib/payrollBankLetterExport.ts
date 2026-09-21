/**
 * Bank Letter exports: Word (server template), Excel + PDF (client).
 */
import * as XLSX from "xlsx-js-style";
import type { BankLetterEmployeePayload } from "@/lib/payrollBankLetter";
import { formatPayrollMonthYear } from "@/lib/payrollDownloadFilenames";

export type BankLetterExportFormat = "docx" | "xlsx" | "pdf";

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
] as const;

/** Indian grouping with 2 decimal places, e.g. 1,27,858.00 */
export function formatBankLetterAmount(amount: number): string {
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const negative = n < 0;
  const abs = Math.abs(n);
  const [intRaw, dec = "00"] = abs.toFixed(2).split(".");
  const last3 = intRaw.slice(-3);
  let rest = intRaw.slice(0, -3);
  if (rest) {
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    return `${negative ? "-" : ""}${rest},${last3}.${dec}`;
  }
  return `${negative ? "-" : ""}${last3}.${dec}`;
}

export function bankLetterSalaryMonthLabel(month: number | string, year: number | string): string {
  const m = typeof month === "string" ? parseInt(month, 10) : month;
  const y = typeof year === "string" ? parseInt(year, 10) : year;
  if (!Number.isFinite(m) || m < 1 || m > 12 || !Number.isFinite(y)) {
    throw new Error(`Invalid payroll month/year: ${month}/${year}`);
  }
  return `${MONTH_NAMES[m]} ${y}`;
}

export function bankLetterLetterDateNow(d = new Date()): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function payrollBankLetterFilenameForFormat(
  format: BankLetterExportFormat,
  month: number | string,
  year: number | string,
): string {
  const base = `Bank Letter ${formatPayrollMonthYear(month, year)}`;
  if (format === "xlsx") return `${base}.xlsx`;
  if (format === "pdf") return `${base}.pdf`;
  return `${base}.docx`;
}

function totalAmount(employees: BankLetterEmployeePayload[]): number {
  return Math.round(employees.reduce((s, e) => s + (Number(e.netPay) || 0), 0) * 100) / 100;
}

/** Build HDFC-style bank letter Excel workbook. */
export function buildBankLetterExcelBlob(
  employees: BankLetterEmployeePayload[],
  month: number | string,
  year: number | string,
  letterDate = bankLetterLetterDateNow(),
): Blob {
  const salaryMonth = bankLetterSalaryMonthLabel(month, year);
  const total = totalAmount(employees);

  const headerStyle = {
    font: { bold: true, sz: 11 },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    fill: { patternType: "solid", fgColor: { rgb: "E2E8F0" } },
  };
  const titleStyle = { font: { bold: true, sz: 14 }, alignment: { horizontal: "left" } };
  const metaStyle = { font: { sz: 11 } };
  const textStyle = { font: { sz: 10 }, alignment: { vertical: "center" } };
  const amountStyle = {
    font: { sz: 10 },
    alignment: { horizontal: "right", vertical: "center" },
  };
  const totalStyle = {
    font: { bold: true, sz: 11 },
    alignment: { horizontal: "right", vertical: "center" },
  };

  const rows: unknown[][] = [
    ["BANK SALARY LETTER"],
    [`DATE: ${letterDate}`],
    [`Salary for the month of ${salaryMonth}`],
    [],
    ["Sr No", "Employee ID", "Employee Name", "Account Number", "Amount (Rs.)"],
  ];

  employees.forEach((e, i) => {
    rows.push([
      i + 1,
      e.employeeCode,
      e.employeeName,
      e.bankAccountNumber,
      formatBankLetterAmount(e.netPay),
    ]);
  });

  rows.push([]);
  rows.push(["", "", "", "Total", formatBankLetterAmount(total)]);
  rows.push([]);
  rows.push([`For Rs. ${formatBankLetterAmount(total)} /- drawn in your favour.`]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 },
    { wch: 14 },
    { wch: 28 },
    { wch: 22 },
    { wch: 16 },
  ];

  const ref = ws["!ref"];
  if (ref) {
    const titleCell = ws["A1"];
    if (titleCell && typeof titleCell === "object") Object.assign(titleCell, { s: titleStyle });
    for (const addr of ["A2", "A3"] as const) {
      const cell = ws[addr];
      if (cell && typeof cell === "object") Object.assign(cell, { s: metaStyle });
    }
    for (const col of ["A", "B", "C", "D", "E"]) {
      const cell = ws[`${col}5`];
      if (cell && typeof cell === "object") Object.assign(cell, { s: headerStyle });
    }
    // Keep account numbers as text (leading zeros).
    employees.forEach((_, i) => {
      const r = 6 + i;
      const acct = ws[`D${r}`];
      if (acct && typeof acct === "object") {
        Object.assign(acct, { t: "s", z: "@", s: textStyle });
      }
      for (const col of ["A", "B", "C"]) {
        const cell = ws[`${col}${r}`];
        if (cell && typeof cell === "object") Object.assign(cell, { s: textStyle });
      }
      const amt = ws[`E${r}`];
      if (amt && typeof amt === "object") Object.assign(amt, { s: amountStyle });
    });
    const totalRow = 6 + employees.length + 1;
    const totalLabel = ws[`D${totalRow}`];
    const totalVal = ws[`E${totalRow}`];
    if (totalLabel && typeof totalLabel === "object") Object.assign(totalLabel, { s: totalStyle });
    if (totalVal && typeof totalVal === "object") Object.assign(totalVal, { s: totalStyle });
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Bank Letter");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Build bank letter PDF (tabular salary advice). */
export async function buildBankLetterPdfBlob(
  employees: BankLetterEmployeePayload[],
  month: number | string,
  year: number | string,
  letterDate = bankLetterLetterDateNow(),
): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const salaryMonth = bankLetterSalaryMonthLabel(month, year);
  const total = totalAmount(employees);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const margin = 14;
  const usable = pageW - margin * 2;
  let y = 18;

  const ensureSpace = (need: number) => {
    const pageH = pdf.internal.pageSize.getHeight();
    if (y + need > pageH - 16) {
      pdf.addPage();
      y = 18;
      return true;
    }
    return false;
  };

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.text("BANK SALARY LETTER", margin, y);
  y += 8;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(`DATE: ${letterDate}`, margin, y);
  y += 6;
  pdf.text(`Salary for the month of ${salaryMonth}.`, margin, y);
  y += 10;

  const cols = [
    { title: "Sr", w: 12 },
    { title: "Emp ID", w: 28 },
    { title: "Employee Name", w: 55 },
    { title: "Account Number", w: 42 },
    { title: "Amount (Rs.)", w: usable - 12 - 28 - 55 - 42 },
  ];

  const drawHeader = () => {
    pdf.setFillColor(226, 232, 240);
    pdf.rect(margin, y - 4, usable, 7, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    let x = margin;
    for (const c of cols) {
      pdf.text(c.title, x + 1, y);
      x += c.w;
    }
    y += 6;
    pdf.setFont("helvetica", "normal");
  };

  drawHeader();

  pdf.setFontSize(8);
  employees.forEach((e, i) => {
    if (ensureSpace(8)) drawHeader();
    const values = [
      String(i + 1),
      e.employeeCode,
      e.employeeName,
      e.bankAccountNumber,
      formatBankLetterAmount(e.netPay),
    ];
    let x = margin;
    values.forEach((val, ci) => {
      const col = cols[ci];
      const align = ci === 4 ? "right" : "left";
      const textX = align === "right" ? x + col.w - 1 : x + 1;
      const clipped = pdf.splitTextToSize(val, col.w - 2);
      pdf.text(clipped[0] ?? "", textX, y, { align: align as "left" | "right" });
      x += col.w;
    });
    y += 5.5;
  });

  ensureSpace(16);
  y += 2;
  pdf.setDrawColor(148, 163, 184);
  pdf.line(margin, y, margin + usable, y);
  y += 6;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.text("Total", margin + usable - 50, y, { align: "right" });
  pdf.text(formatBankLetterAmount(total), margin + usable - 1, y, { align: "right" });
  y += 10;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(`For Rs. ${formatBankLetterAmount(total)} /- drawn in your favour.`, margin, y);

  return pdf.output("blob");
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
