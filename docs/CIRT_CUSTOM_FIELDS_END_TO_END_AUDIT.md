# CIRT Custom Fields — End-to-End Audit

Audit date: 2026-10-21  
Scope: local CIRT source only. The protected September 2026 payroll run
`a30895ff-b1a4-4775-bd2b-cdf8d6e5004f` was not mutated, recalculated,
approved, locked, or replaced.

## Component contract

| Property | Contract |
| --- | --- |
| Stable identifier | `field_key`, unique per company; it cannot change after employee values exist. |
| Classification | `earnings`, `deductions`, and numeric `statutory` recoveries are payroll groups. |
| Employee assignment | `cirt_payroll_field_values`, keyed by company, payroll master, definition, and field key. |
| Totals | Earnings need `include_in_total_earnings`; numeric deduction/statutory values reduce deductions. |
| Rounding | Shared government calculation rounds monetary totals to two decimal places; CPF has its dedicated configured calculation. |
| Visibility | Definition flags control master, preview, and current payslip configuration. Saved maps remain authoritative historically. |
| Historical identity | Saved `custom_earnings` / `custom_deductions` keys are preserved; payslips render the key beside the label. |

Dedicated components remain separate from generic custom values: CPF, DA CPF, GPF,
electricity, water, and quarter rent retain their own calculation/export classification.

## Lifecycle trace and result

| Stage / output | Implementation | Earnings | Deductions | Result |
| --- | --- | --- | --- | --- |
| Definition/configuration | `PayrollFieldController`, `PayrollFieldService`, `cirt_payroll_field_definitions` | Yes | Yes | Pass |
| Master assignment/import | `PayrollMasterService`, `cirt_payroll_field_values` | Yes | Yes | Pass |
| Active field filtering | `PayrollFieldService::custom*FromValues` | Yes | Yes | Pass; inactive fields are excluded from new calculations. |
| Government calculation | `governmentPayroll.ts`, `PayrollCalculationService` | Once in earnings | Once in deductions | Pass |
| Run preview and saved draft | `PayrollController` | Yes | Yes | Pass; preview and snapshot carry the shared maps. |
| Monthly snapshot | `cirt_monthly_payroll` JSON maps | Yes | Yes | Pass |
| Amendment/recalculation | `PayrollAmendmentService` | Preserved | Preserved | Pass; existing snapshot is amended, not duplicated. |
| Payslip | `governmentPayslipLayout.ts` | Yes | Yes | Fixed: inactive/deleted definitions no longer hide a saved component. |
| Monthly Excel | `EmployeePayrollExportService` | Yes | Yes | Pass; rows use saved snapshot values. |
| Quarterly selection | `EmployeePayrollExportService` | Per month | Per month | Pass; long format emits employee × month, not a copied quarterly value. |
| Run/summary workbooks | `payrollExcelExport.ts`, `payrollRunWorkbook.ts` | Yes | Yes | Pass |

There is no independent quarterly value snapshot: the quarterly selection is the sum of the
actual saved months and therefore respects month-specific values and future effective-date work.

## Verified defects and safe fixes

| ID | Defect | Fix | Status |
| --- | --- | --- | --- |
| CF-HIST-001 | Current payslip metadata omitted a saved component if its definition was later deactivated/deleted. | Configured fields render first; non-zero saved keys absent from metadata are appended with a stable key reference. | Fixed |
| CF-CONTRACT-002 | Settings advertised percentage/formula custom fields although no generic evaluator/base existed. | New definitions and calculation-type changes accept only `manual_entry` or `fixed_amount`; percentage/formula rules require a dedicated implementation. Existing definitions and snapshots are untouched. | Fixed |

`fixed_amount` means a fixed employee-specific numeric value in the current architecture. It
does not create a global auto-applied allowance. System formula fields, including CPF, are not
changed by this guard.

## Decisions still required

| Topic | Current behavior | Decision needed |
| --- | --- | --- |
| Field-level effective dates | Master effective dates exist; dynamic definitions/values have no independent effective-from/to dates. | Approve a model, calculation base, rounding, and historical semantics before adding it. |
| Percentage/formula custom component | Not generically supported after CF-CONTRACT-002. | Specify base components, caps, rounding, and export/history behavior. |
| Existing historical labels | Older snapshots store the stable key, not a frozen label. | The key is now displayed unambiguously; a label backfill needs approved source mapping. |
| Strict external template | Long-format export can add dynamic columns. | If prohibited, approve a supplementary components sheet rather than omit values. |

## Tests

`PayrollDynamicFieldsTest` covers configurable CPF bases, custom earning/deduction impact,
multiple components counted once, gross/deduction/net consistency, and GPF/telephone separation.
`EmployeePayrollExportLongFormatTest` asserts monthly snapshot row values, dynamic headers,
and quarter metadata fallback. TypeScript compilation covers the frontend helper integration.

No CPF, transport, HRA, electricity, identity, or source-reconciliation policy was changed.
