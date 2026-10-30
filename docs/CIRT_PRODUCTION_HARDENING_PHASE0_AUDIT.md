# CIRT HRMS production hardening: Phase 0 audit

Date: 2026-10-27. This is an implementation baseline; no September 2026 payroll row was written or recalculated.

## Applications and data path

- Frontend: Next.js App Router in `src/app`, with the payroll workspace at `src/app/(app)/payroll/page.tsx`. Payroll browser requests proxy through `src/app/api/payroll/*` to Laravel.
- Backend: Laravel 11 API in `backend`, routes under `/api/v1`, with Sanctum authentication, session-version validation, company context, and managerial middleware.
- Database: PostgreSQL (`pgsql`), configured locally as database `hrms` on `127.0.0.1:5432`. Schema history is in `backend/database/migrations`; the repository also has Supabase/PostgreSQL migration scripts in `supabase/migrations` and `database/sql`. This audit did not run migrations.
- Current API routes are defined in `backend/routes/api.php`. No OpenAPI specification or Postman collection exists in this checkout.

## Payroll implementation

- Frontend calculation: `src/lib/governmentPayroll.ts`, `govRunPayrollCompute.ts`, and `resolveRunPayrollRow.ts`.
- Backend payroll/master calculation: `PayrollCalculationService`, `PayrollController`, `PayrollMasterService`, and `PayrollPreflightValidationService`.
- Draft storage: `cirt_payroll_drafts` / `cirt_payroll_draft_employees`; `PayrollDraftService` writes JSON row snapshots transactionally and increments a draft version. `PayrollDraftController` currently accepts an omitted expected version, which leaves an optimistic-concurrency bypass to close.
- Generated and audited payroll: `cirt_monthly_payroll`, `cirt_payslips`, and `cirt_monthly_payroll_audits`. Generated rows are snapshots; amendment audits store before/after payloads.
- Draft reset history: `cirt_payroll_draft_audits`; currently records draft resets, not general application activity.
- Payslips: `PayslipController` returns the persisted monthly snapshot; `GovernmentPayslipPrint` renders it.
- Excel: browser workbook construction is in `payrollExcelExport.ts` and `payrollRunWorkbook.ts`; persisted exports are built through `src/app/api/payroll/export/route.ts` and Laravel export services.
- Existing EOL/HPL policy: EOL reduces Basic, DA, HRA, and Medical; HPL reduces Basic and DA only. The engine rounds each paid component to rupees and suppresses duplicate automatic HPL/EOL deduction lines. This policy was retained.

## State, caches, authorization, and history

- Audit mode is transient React state in the payroll page. Draft and preview fetch effects reject stale responses on month changes; the three in-memory row maps are cleared on year/month changes. A successful amendment currently does not exit audit mode.
- Payroll rows are not persisted in browser storage. `localStorage` use found in this repository covers sidebar collapse, Payroll Master add-form recovery, and a Payroll Master autosave preference. Laravel uses file cache/session by default; `DefaultCompanyService` caches the fixed company ID. No Redis or payroll server-side result cache was found.
- Payroll APIs sit behind `auth:sanctum`, `hrms.session`, `cirt.company`, and managerial authorization, with self-service payslip/profile routes separately scoped. Role casts currently treat unknown stored roles as administrative, and public password/Google signup currently creates admin-role users; these are security defects addressed in this change set.
- Existing history tables include payroll master history, monthly payroll audits, payroll draft audits, salary increments, and arrear batches/lines. Ordinary payroll rows and audit histories must not be deleted to implement a reset.
- Existing test coverage includes frontend payroll calculation/hydration tests and Laravel payroll security, draft, export, and calculation tests. The installed PHP is 8.2.12, while the checked-in Composer vendor platform check requires PHP 8.4, so Laravel tests and the existing Laravel-based snapshot script cannot run in this environment.

## Protected September 2026 baseline and restore check

- A full PostgreSQL custom-format dump is stored at `outputs/cirt-production-hardening-backup-20261027/hrms-full.dump` (ignored by Git). `pg_restore --list` validated the archive.
- The archive was restored to an isolated temporary database, queried, and removed after successful verification.
- A full employee-level JSONL snapshot, including period, employee, monthly payroll, and payslip records, is stored beside the dump. It captures run-row and payslip identifiers, leave and electricity fields, and saved monetary components.
- Protected September run: `a30895ff-b1a4-4775-bd2b-cdf8d6e5004f`; 83 employees; gross ₹8,685,518; deductions ₹2,702,034; net ₹5,983,484. Live PostgreSQL and restored backup totals matched exactly.
- Existing reconciliation notes document September electricity as saved zero with no tariff inference authorized. No tariff or historical electricity value was changed.

## Working tree preservation

At start of work, eight payroll files already had uncommitted changes covering server-authoritative electricity recalculation, quarter-aware HRA validation, and draft electricity hydration. Those changes were reviewed and preserved; they were present before this task's edits.
