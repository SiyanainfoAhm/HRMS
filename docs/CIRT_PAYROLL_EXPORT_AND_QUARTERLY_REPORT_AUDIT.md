# Payroll Export and Three-Month Report Audit

Date: 2026-10-21. The protected September payroll run
`a30895ff-b1a4-4775-bd2b-cdf8d6e5004f` was not changed.

## Domain separation

| Concept | Source of truth | May affect salary amount | May select salary-report employees |
| --- | --- | --- | --- |
| One-to-three-month payroll report | Selected `cirt_payroll_periods` and saved `cirt_monthly_payroll` snapshots | No | Yes |
| Residential accommodation quarter | Quarter assignment/name/type/rent fields | HRA, rent, electricity, water | No |

The prior Employee Payroll export accepted residential `quarterIds` and used
them to filter salary rows. This was a domain error. The request/controller
and export service no longer accept that accommodation filter, and its picker
has been removed from the report UI. Residential metadata remains output-only.
Select one month for a monthly report or up to three saved payroll months for
a custom three-month report.

## Population and scope

* Each selected month contributes its actual saved employee snapshots; a person
  present only in one or two months has only those saved monthly rows.
* The default scope is all employees saved in each selected month. September
  therefore exports all 83 saved rows.
* Audit state, edited state, search, pagination, and residential accommodation
  never change default scope.
* The Employee Payroll dialog keeps an explicit **All employees** default and
  sends employee IDs only for **Current filtered results** or an explicitly
  entered **Selected employees** list.

## Components and exports

`EmployeePayrollExportService` produces one employee × month row from saved
monthly snapshots. Standard fields (CPF, DA CPF, Transport, HRA, electricity,
water, quarter rent) and dynamic custom earning/deduction maps are read from
each saved month. It does not apply present-day master/configuration amounts to
historical rows. The resulting rows are the basis for monthly and selected
three-month Excel reporting.

## Verification

* TypeScript compilation passed.
* PHP 8.4 export/dynamic-field suite: 22 passed, 150 assertions.
* Full PHP 8.4 suite: 164 passed, 706 assertions.
* The isolated three-month fixture uses June/July/August populations of
  10/12/11 snapshots, writes an actual XLSX and reloads it. It verifies 33
  employee-month rows, a 12-person union, no fabricated missing-month rows,
  audit/accommodation independence, custom earning/deduction values, and
  explicit selected-employee filtering.
* Long-format export tests also verify monthly snapshot values, dynamic
  columns, and month labels.
* No migration, reset, reimport, new payroll run, approval, lock, or policy
  change was performed.

## Scope and remaining limitation

The regression fixture is isolated and never opens or writes the September
reconciliation run. It validates the shared workbook builder and actual XLSX
round-trip. Browser-level selection/search interaction remains covered by
TypeScript compilation rather than an end-to-end browser test.
