# Payroll Master, Settings, Export and Electricity Fix

Date: 2026-10-21. All work is local. The protected September run
`a30895ff-b1a4-4775-bd2b-cdf8d6e5004f` was not opened for mutation,
recalculation, approval, or locking.

## Implemented controls

* Removed PT Annual from the company-settings display and edit form. The
  historical database attribute remains untouched; monthly Professional Tax
  remains the payroll-master, calculation, payslip, and export component.
* Removed the Settings Add Role control. Existing role data, assignments, and
  backend authorization routes remain intact.
* Removed the custom-field Calculation type control and list column. New UI
  fields remain manual-entry/fixed-value assignments, while the backend retains
  existing historical calculation types unchanged.
* Removed Payroll Master's Sync Employees control. The backend relationship and
  idempotent synchronization endpoint were intentionally retained for internal
  maintenance; no employee or master record was changed.
* Replaced the confusing master export controls with **Export All** and
  **Export Selected**. All uses the complete eligible-master population and
  never inherits search, pagination, audit, or edited-state filters. Selected
  uses explicit stable Payroll Master IDs retained across pages.
* Fixed the Payroll Master export timeout. The export now preloads users and
  custom field values and serializes persisted master values directly, rather
  than invoking interactive CPF/quarter formatting for every employee. Dynamic
  export columns are built once per workbook rather than once per row.

## Imports and exports

The existing master template is already generated from the active Payroll Field
Registry, includes a stable field key for dynamic columns, and includes an
Instructions worksheet. Import validation uses the same dynamic-field registry;
it preserves zero versus blank semantics and validates custom field group/type.
The previous report fix remains in force: one-to-three-month salary exports use
saved payroll-month snapshots, not residential quarter assignments.

The grid provides explicit per-row and visible-page selection. Selected export
is disabled until at least one master is selected; pagination does not clear
the selected ID set.

## Electricity finding

The calculation and export paths already include electricity once in deductions
when a valid fixed or metered input exists. Unit tests cover tariff slabs, fixed
amounts, manual zero, non-applicable employees, rounding, and aggregation.

September's INR 23,480 variance is not a presentation or export omission:
the protected snapshots contain `manual_fixed`, zero units, and zero amount;
the source has 2,333 units but no approved charge/billing basis. No amount was
derived or added. An approved tariff-effective/meter-billing input is required
before a future authorized run can calculate it.

## Payroll scrolling

Removed the reset-scroll control. Arrow buttons now support click scrolling,
pointer hold continuous scrolling, pointer release/leave/cancel stop, window
blur stop, and unmount cleanup through `requestAnimationFrame` cancellation.
Native table scrolling remains available.

## Verification

* PHP 8.4 full suite: 166 passed, 729 assertions.
* TypeScript compilation passed.
* The existing actual-XLSX round-trip regression for saved monthly/three-month
  payroll rows remains passing.
* No migrations, database writes, imports, payroll recalculation, approvals,
  locks, payments, or deployments were performed.

## Approval-required items

* The authoritative September electricity charge needs approved tariff and
  meter/billing evidence.
* CPF basis, transport eligibility, HRA rounding, GPF mapping, and unmatched
  employee identities remain subject to the prior reconciliation decisions.
