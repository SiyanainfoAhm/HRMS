# CIRT HRMS field-level payroll integrity — release report

Date: 2026-10-30
Scope: local workspace and isolated local test database only. No production connection, deployment, migration, or payroll write was performed.

## Fix delivered locally

- `src/app/(app)/payroll/page.tsx` records operator-edited field tokens per employee. Existing drafts submit only employees with a nonempty field mask, use `replaceAllEmployees: false`, and retain the expected draft version. Initial draft creation remains a full snapshot.
- `src/lib/payrollDraftPatch.ts` builds this payload while preserving explicit zero values. Empty masks produce no write; separate employee masks prevent cross-employee leakage.
- `backend/app/Http/Controllers/Api/V1/PayrollDraftController.php` validates optional `changedFields` arrays.
- `backend/app/Services/PayrollDraftService.php` rejects full replacement on an existing draft, requires an existing employee row and explicit field mask, merges only approved field paths into the locked saved snapshot, recalculates totals, and leaves other employees and rows intact. Draft version checking and row locking remain active. Audit snapshots include old/new changed paths, actor, and event timestamps.
- Electricity Units patches carry the recalculated Electricity amount and tariff details and remove only the Electricity amount override. Quarter Rent amount edits preserve their explicit override; initial authoritative value continues to come from accommodation/payroll calculation. Night Hours/rate patches clear only the Night Allowance override and retain unrelated earnings and deduction overrides.
- `src/lib/runPayrollSheetEdit.ts` narrows Night Allowance override clearing to the Night Allowance field.
- Generated payroll revision/amendment code was not changed in this task. Existing revision and optimistic concurrency controls remain in place.

## Root cause and boundaries

The full-row draft request allowed stale values in an edited employee’s unrelated fields—including explicit zero—to overwrite their saved values. A period-wide dirty/cache path could also make unrelated employee rows stale. Draft-level version checks prevented concurrent version writes but did not distinguish operator intent at individual field level. The field-mask patch makes the server merge only explicit field paths and allows explicit zero only when accompanied by that field token.

This confirms a local code-level risk and verifies the local fix. It does not establish which deployed build was active during a reported incident or identify the live historical change event. No production SHA/build ID, deployment record, or server payload was available.

## Verification evidence

- PHP 8.4 full suite: **194 passed, 882 assertions** (`C:\php84\php.exe artisan test`).
- Targeted frontend runtime suite: all **15 `src/lib/*.test.ts` files** completed successfully with project aliases enabled. Includes draft serialization, explicit zero, saved-draft hydration, resolver isolation (8 cases), Electricity, Quarter Rent, Night Allowance override isolation, generated audit and Excel export assertions.
- TypeScript: `npx tsc --noEmit --incremental false` passed.
- Targeted ESLint for edited payroll page and helper/test files passed.
- Production build: first restricted run compiled then failed at Next.js TypeScript worker creation with `spawn EPERM`. The local build was then run with elevated process permission and passed compilation, TypeScript, all 73 static pages, and trace finalization. No deploy was run.
- Rollback-only service integration against local `TRest`, period 2098-01: sequential Mess/Credit Society, Electricity Units, Quarter Rent, Night Allowance, intentional zero, two-employee isolation, stale draft version rejection, and audit creation all passed. The outer transaction was rolled back; subsequent read-only check found **0 drafts and 0 audit rows** for that fixture period.
- `git diff --check` passed. The full-repository lint command was not rerun; its earlier documented failures were pre-existing/unrelated files.

## October preservation and reconciliation

The integration probe used only the local `TRest` test company and a 2098-01 transaction. It did not target October 2026. Per the previously completed local October verification supplied for this release, 83 monthly rows, 83 payslips and the three revision checksums were validated and no material difference was found between revision 3 and current local payroll. This task made no October payroll, revision, payslip, or Activity Log changes. No live CIRT October reconciliation is claimed.

## Production-only blockers and remaining risks

1. Obtain read-only live server build/SHA and deployment timestamps to compare the incident timeline with the deployed code.
2. Run the prepared read-only CIRT October diagnostics against the verified production host with a read-only database identity. Compare revisions, current monthly rows, payslips, and earlier approved Excel where available.
3. Have payroll owners confirm authoritative employee/component reference figures before preparing any correction. No ₹11,800 adjustment has been manufactured.
4. Validate the build artifact and PHP version on the Windows server, deployment paths, service/IIS process name, health endpoint, backup destination/credentials, and rollback access during an approved window. These server facts cannot be inferred from local build success.
5. Test the final staged release on the approved production-like environment and ensure frontend and backend are deployed together; older clients that send full replacement requests will now receive a validation error and must refresh/reload.
6. Use the existing audited amendment flow only for a confirmed generated-payroll correction with the current revision and a recorded reason. Do not reset, regenerate, edit SQL, or remove October evidence.

## Manual deployment readiness

**Local code/build readiness: ready for review. Production deployment readiness: blocked pending items 1–5 above.** The existing Windows deployment script is manual-only; it has not been run. No command in this task deployed code or modified CIRT production data. The release operator must inspect the generated backup, run verification/health checks, and make the deployment decision manually; rollback must restore code only and leave payroll data untouched.

