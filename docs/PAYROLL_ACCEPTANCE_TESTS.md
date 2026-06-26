# Payroll Acceptance Tests

Manual and regression checklist for Payroll Master import validation and Run Payroll export.

## Payroll Master Import

### EMP-010 — Invalid/partial import handling

**Steps**

1. Open Payroll Master → Import.
2. Upload an Excel/CSV file with invalid rows.
3. Include missing required fields (PAN, Aadhaar, Name, Employee Code, or Bank Account Number).
4. Include duplicate email/PAN/Aadhaar inside the file or already in Payroll Master.
5. Review the validation panel before confirming import.

**Expected**

- All rows are validated before any save.
- Import is blocked if any row is invalid.
- Invalid row numbers are shown.
- Employee identifier is shown when available (name/code/email) or "Unknown employee".
- Field-level error reasons are shown per row.
- Confirm Import stays disabled.
- Message: *Import blocked. Please fix the listed errors and upload again.*
- No partial data is imported.

---

### EMP-011 — Successful Payroll Master import

**Steps**

1. Download the latest Payroll Master import template.
2. Fill all required fields with unique Employee Code, Email, Phone, PAN, Aadhaar, and Bank Account Number.
3. Upload the file.
4. Confirm import.

**Expected**

- Validation passes (valid row count matches data rows).
- Confirm Import is enabled (warnings acknowledged if any).
- Import completes successfully.
- New employees appear in Payroll Master.
- No duplicate records are created.

---

### EMP-012 — Missing import template columns

**Steps**

1. Upload an old/invalid template missing User Role, Password, Confirm Password, PAN, Aadhaar, or Bank Account Number.
2. Review the validation panel.

**Expected**

- Application does not crash.
- Template format issue panel lists missing column names.
- Confirm Import stays disabled.
- User is instructed to download the latest template.

---

## Run Payroll Export

### PAYRUN-001 — No duplicate columns in export

**Steps**

1. Open Run Payroll.
2. Select month/year and generate payroll.
3. Export/download the Run Payroll Excel report.
4. Inspect column headers.

**Expected**

- `PayrollMode` column is **not** present.
- `PT` column is **not** present.
- `TakeHome` column is **not** present.
- `ProfessionalTax` column **is** present.
- `NetPay` column **is** present.
- PT values appear under `ProfessionalTax` only.
- Final payable amount appears under `NetPay` only.
- Payroll formulas and amounts are unchanged.

---

### PAYRUN-002 — Values correct after duplicate column cleanup

**Steps**

1. Generate payroll for existing employees.
2. Compare on-screen Run Payroll values with the exported report.
3. Verify Professional Tax, Total Deductions, and Net Pay.

**Expected**

- Professional Tax values match preview.
- Net Pay values match preview.
- Total Deductions are correct.
- Removing duplicate columns did not change calculations.

---

## Implementation notes

| Area | Key files |
|------|-----------|
| Import validation | `backend/app/Services/PayrollMasterService.php` |
| Import UI | `src/components/payroll/PayrollMasterScreen.tsx` |
| Import error report | `src/lib/payrollMasterImportReport.ts` |
| Run Payroll export | `src/lib/payrollExcelExport.ts` |
| Run Payroll preview | `src/components/payroll/GovernmentRunPreviewTable.tsx` |

Import template columns are defined in `PayrollMasterService::importTemplateColumns()` and are **not** mixed with Run Payroll export columns.
