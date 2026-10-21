# Payroll Export Scope Fix

Date: 2026-10-21. Scope: local UI/export behavior only. The September 2026
payroll run `a30895ff-b1a4-4775-bd2b-cdf8d6e5004f` was not changed.

## Root cause

The backend export service correctly treats an empty `employee_user_ids` list
as the complete saved population. The frontend Run Payroll page, however,
treated active grid filters (search, division, department, designation) as
export scope and supplied the resulting employee IDs to some downloads. The
employee-payroll dialog also automatically used that resolver whenever filters
were active. Audit mode is not a backend eligibility filter, but an audit-time
filter/search could therefore make a partial export look complete.

## Fix

* Preview Excel, Extract, generated Excel, and bank-letter documents now load
  the complete saved payroll population by default.
* The generated Excel request no longer forwards display-filter fields or
  employee IDs by default.
* Employee Payroll Excel now presents an explicit export scope when it is
  launched from Run Payroll: **All employees** is the default; **Current
  filtered results** must be selected before filtered IDs are sent.
* Pagination was already excluded from collection by `all=1`; the corrected
  default uses that complete collection.

For September, the default complete scope is **All employees (83)**. A
filtered/selected export is intentionally distinguishable by its explicit
scope choice; it is not a complete payroll report.

## Population and integrity rules

| Output | Default population | Filtered population |
| --- | --- | --- |
| Preview Excel / Extract | All saved payroll rows for the run | Not automatic from display state |
| Generated Excel | All saved snapshots/payslips for the run | Requires an explicit export API filter in a dedicated UI flow |
| Bank letter/document | All resolved payroll rows | Not automatic from display state |
| Employee Payroll monthly/quarterly Excel | All saved rows for each selected month | Explicit `Current filtered results` dialog choice |

Quarterly selection remains monthly-snapshot based: it includes employees
actually saved in each chosen period, including joiners/leavers, rather than
applying September's 83-person headcount to every month. Dynamic custom
earnings/deductions are still collected directly from those saved snapshots.

## Verification

* TypeScript compilation: passed.
* PHP 8.4 focused suite: 33 passed, 191 assertions.
* `EmployeePayrollExportLongFormatTest` verifies snapshot-sourced rows,
  dynamic columns, long-format monthly behavior, and quarter metadata.
* `PayrollAmendmentServiceTest` verifies amending one employee updates the
  existing snapshot/payslip path rather than inserting a new run.

No query filters on `audited`, `is_audited`, `audit_status`, `review_status`,
`is_modified`, `approved`, `locked`, or `updated_at` were found in the saved
payroll export population. Audit state remains a workflow indicator only.
