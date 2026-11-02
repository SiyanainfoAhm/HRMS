/**
 * Single source of display labels for the arrears family and the CPF-arrear
 * deduction (CIRT-05/06/07). Entry, preview, payslip, Excel exports and the
 * audit trail import these instead of hard-coding strings.
 *
 * Mirror: backend/app/Support/PayrollLabels.php (kept in sync by
 * payrollLabels.test.ts, which parses the PHP file).
 */
export const PAYROLL_LABELS = {
  daArrears: "DA Arrears",
  transportArrears: "TR Arrears",
  /** First arrears field (aggregate; contains DA + TR arrears). */
  grossArrears: "Gross Arrears",
  /** Second arrears field: open free-entry earning, no formula. */
  pastArrears: "Past Arrears",
  /** Derived memo: Gross Arrears - CPF Arr. Never added to totals. */
  netArrears: "Net Arrears",
  /** Deduction: CPF recovered on arrears. */
  cpfArrears: "CPF Arr",
  /** Field key of the Past Arrears free-entry earning. */
  pastArrearsFieldKey: "past_arrears",
} as const;

export type PayrollLabelKey = keyof typeof PAYROLL_LABELS;
