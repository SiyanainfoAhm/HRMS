export type ImportValidationIssue = {
  rowNumber: number;
  employeeCode?: string | null;
  employeeName?: string | null;
  employeeLabel?: string | null;
  field: string;
  errorType: "error" | "warning" | string;
  message: string;
};

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Download validation issues as CSV for correction in Excel. */
export function downloadImportValidationReport(
  issues: ImportValidationIssue[],
  filename = "payroll_master_import_validation.csv",
): void {
  const header = "Row No,Employee Code,Employee Name,Field,Error Type,Message";
  const lines = [header];
  for (const issue of issues) {
    lines.push(
      [
        issue.rowNumber,
        issue.employeeCode ?? "",
        issue.employeeName ?? "",
        issue.field,
        issue.errorType,
        issue.message,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatImportFieldLabel(field: string): string {
  const labels: Record<string, string> = {
    employee_code: "Employee Code",
    user_role: "User Role",
    confirm_password: "Confirm Password",
    pay_level: "Pay Level",
    gross_basic_pay: "Gross Basic Pay",
    effective_from: "Effective From",
    date_of_joining: "Date of Joining",
    date_of_birth: "Date of Birth",
    bank_name: "Bank Name",
    bank_account_number: "Bank Account Number",
    bank_ifsc: "IFSC",
  };
  if (labels[field]) return labels[field];
  return field
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
