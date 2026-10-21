# CIRT September 2026 reset and reconciliation audit

Audit date: 2026-10-21 (local workspace only)

## Continuation update (2026-10-21)

- CIRT development configuration uses `http://127.0.0.1:8001`; the separate
  application on port 8000 was not changed or restarted.
- Laravel commands were run with `C:\php84\php.exe` (PHP 8.4.25). The Laravel
  server was already listening on port 8001 and was not restarted.
- The target was verified as PostgreSQL 18.6 at `127.0.0.1:5432`, database
  `hrms`, with `APP_ENV=local` and the expected CIRT schema. This supports the
  intended local test workflow only; it is not authorization for production
  operations.
- A restorable, validated PostgreSQL custom-format backup was created at
  `backend/storage/app/backups/cirt_hrms_pre_sep2026_reset_20261021_110311.dump`.
  Restore with PostgreSQL 18 `pg_restore` into a separately created empty local
  database; do not restore over another database without explicit approval.
- Preservation inventory: one `super_admin`, one institute, two role records,
  one calculation-settings row, one electricity tariff, six quarter types and
  seven quarter records.
- The two required source workbooks remain absent. The staging folder contains
  only its README, therefore cleanup and import have not run.
- PHP unit tests now pass under PHP 8.4: 159 passed / 677 assertions. One
  pre-existing risky-test warning remains in `EmployeePayrollExportLongFormatTest`.
- Fixed payroll electricity rounding parity: detailed bill values retain paisa,
  while the persisted final deduction rounds to whole rupees. Updated the
  obsolete arrear test setup for the current quarter-service dependency.

## Status

Execution is blocked before backup or cleanup. The required source workbooks
are absent, and the configured database target has not been verified as an
isolated local development database. No database connection, backup, deletion,
import, payroll calculation, or export was performed.

Required source location:

`C:\Users\goura\Desktop\HRMS\data\imports\september-2026\`

Expected files:

1. `September Salary 2026 - Foxpro(1).xlsx`
2. `Salary Data as on 15.10.2026(1).xlsx`

The only discovered workbooks are prior sample/export artifacts:

- `backend/storage/app/employee_payroll_export_quarter_check.xlsx`
- `backend/storage/app/employee_payroll_export_sample.xlsx`
- `tmp/CIRT_Payroll_Draft_Sep_2026_SAMPLE.xlsx`
- `tmp/CIRT_Payroll_Summary_Sep_2026_Draft_SAMPLE.xlsx`

They are not substitutes for the missing source books.

## Application and database architecture

- Frontend: Next.js 16 / React / TypeScript.
- Backend: Laravel / PHP, PostgreSQL configured through `backend/.env`.
- Current authoritative schema: Laravel migrations in
  `backend/database/migrations`; the old `supabase/` SQL is not authoritative.
- Authentication: `cirt_users`, Laravel Sanctum and role-based access; the
  administrator record is preserved by any later cleanup.
- Company scope: business data is partitioned with `company_id` referencing
  `cirt_institute`.

## Records to preserve

- Original administrator identity, password hash, role, permissions and active
  access.
- `cirt_institute`, `cirt_roles`, organizational reference tables, payroll
  calculation settings, transport settings, CPF configuration, electricity
  tariffs, quarter types and quarter/rent masters.
- Migration history, authentication infrastructure and unrelated modules.

## Payroll data eligible for scoped cleanup after backup and target verification

- Non-admin employee users and `cirt_employees` profiles.
- Their payroll masters, bank-account history, monthly payroll rows, payslips,
  payroll periods that are test-only, drafts and draft employees.
- Employee-specific payroll field values, arrear lines/batches, salary
  increments, active quarter assignments, attendance and other dependent test
  records when present in the verified local schema.
- Stale export artifacts only when their exact local-storage ownership is
  confirmed.

Cleanup must be performed in a transaction with dependency-aware deletes; do
not truncate tables or disable foreign keys. It must exclude the preserved
administrator and master/configuration rows and must be repeatable.

## Important implementation findings

- `PayrollMasterController` exposes Excel preview/import and payroll exports.
  Current source imports require the application payroll-master template; a
  source-adapter/mapping layer is needed before these two supplied workbooks can
  be safely imported.
- `EmployeePayrollExportService` already exports monthly values including
  CPF, DA CPF, statutory deductions, utilities, quarters and arrears. This is
  the appropriate CIRT export to compare with source data.
- `PayrollCalculationService` computes DA from `gross_basic_pay`, currently
  rounds to whole rupees, suppresses HRA when a quarter is assigned, and uses a
  configurable CPF basis/rate or explicit fixed/default amount. DA CPF is a
  separately stored deduction, not currently derived by that service.
- The existing import logic resolves quarter rent from the configured quarter
  master when a matching quarter name is imported. Source rents therefore need
  an explicit audit before master updates; silently overwriting a source amount
  would hide a discrepancy.
- Existing UI has payroll draft/reconciliation-adjacent previews and imports,
  but no dedicated FoxPro-vs-CIRT reconciliation screen or required ten-sheet
  reconciliation workbook generator was identified.

## Required gates before destructive or calculation work

1. Add the two original source workbooks to the staging folder above.
2. Verify the effective database identity from `backend/.env` and database
   metadata; reject any production or staging target.
3. Create and test a timestamped PostgreSQL backup/restore path.
4. Inventory actual row counts, foreign keys, triggers and September 2026
   records in that verified database.
5. Parse all source cells, preserve raw staging data, and emit CPF/code/name
   mapping exceptions before creating employee accounts.

## Test baseline

`php artisan test --testsuite=Unit` could not start. Composer requires PHP
`>= 8.4.0`; the installed CLI is PHP `8.2.12`. No tests ran. Upgrade/select a
PHP 8.4+ CLI and rerun the test suite before executing the workflow.

## Phase 2 execution â€” 21 October 2026

- The verified local PostgreSQL `hrms` database was used; no production target
  was contacted. The existing pre-reset custom-format backup remains restorable.
- The September 2026 CIRT run was calculated through the same frontend
  government-payroll calculation module used by Run Payroll, then persisted
  through Laravel's `PayrollController::run` path. No FoxPro net values were
  written into CIRT calculated fields.
- Run ID: `a30895ff-b1a4-4775-bd2b-cdf8d6e5004f`. It has 83 unapproved,
  unlocked September payroll snapshots/payslips. No approval, payment or
  accounting-posting operation was invoked.
- CIRT totals: gross `8,670,218.43`, deductions `2,682,254.00`, net
  `5,987,964.43`. The controller export returned 83 payslips and 83 matching
  monthly snapshots.
- CPF mapping verified 80 employee pairs. Three CIRT input rows have no CPF
  and remain `Manual Review`; they were included in CIRT calculation but
  excluded from employee-wise FoxPro variance totals.
- The two source extracts differ by `997,738` in deductions. The source-level
  explanation is `974,258` CPF plus `23,480` electricity. This is a source
  policy/data question, not a basis for overriding CIRT payroll amounts.
- PHP 8.4.25 unit suite: 159 passed / 677 assertions. PHPUnit reports one
  existing risky-test warning in `EmployeePayrollExportLongFormatTest`.
- A local, confidential 12-sheet reconciliation workbook was generated under
  `outputs/cirt-september-2026-reconciliation/`; it is ignored by Git.
