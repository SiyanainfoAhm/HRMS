# CIRT live payroll integrity investigation

Date: 2026-10-30

## Timeline and version comparison

Local Git records hardening work in `9e521d4` (2026-10-30 10:50 +0530), concurrency/revision work in `174d657` (13:32), and draft snapshot merge/audit work in `6b1e9c5` (14:42). These are local repository commit times only. No production deployment receipt, build ID, server Git SHA, deployment log, or live version endpoint is available in this workspace. It is therefore impossible to determine whether any reported incident occurred before or after the latest deployment or whether production runs this code. Do not infer deployment timing from the local commit history.

## Confirmed local save risk

Run Payroll draft saving retrieves the full canonical payroll set, serializes every resolved employee row, and sends `replaceAllEmployees: true` (`src/app/(app)/payroll/page.tsx`, around lines 2698–2869). `PayrollDraftService::mergeSnapshot` preserves absent/null values but accepts explicit numeric zeroes (`backend/app/Services/PayrollDraftService.php`, around line 426). `resolveRunPayrollRow` previously treated a period-wide dirty flag as authorization to reuse any cached employee row before persisted draft hydration (`src/lib/resolveRunPayrollRow.ts`, around lines 280–281). The page keeps a full-period row cache, so one edit could cause unrelated employees’ stale cached rows to be serialized and saved. Draft version checks reject stale draft versions, but cannot tell an intentional zero from a stale zero sent in a full snapshot.

## Local mitigation

The resolver now uses cached rows only when the caller explicitly marks that employee row as edited. The Run Payroll page tracks edited row keys; untouched employees hydrate from the saved draft. A regression was added in `src/lib/resolveRunPayrollRow.test.ts` for period-wide dirty state versus explicit row edit. This removes the identified cross-employee stale-cache path. It does not fully implement a field-level changed-field contract: the backend still accepts explicit zeros in a full row payload, so a stale component within the edited employee row is not ruled out. This local mitigation is not proof that the deployed code caused or cured the reported incidents.

## Component pipeline observations

- **Mess, Credit Society, Overtime, Night Allowance:** user edits are applied into the row’s monthly snapshot and recalculated totals. Full-row serialization can transmit all component values; a supplied zero is accepted by draft persistence. Night Allowance calculation uses hours/rate/slab eligibility and supports a manual override. Inspect driver edits and audit snapshots before deciding why a value changed.
- **Electricity:** units are an input; the configured tariff derives the deduction. Rehydration recalculates rows with saved units. Editing the amount creates a manual override; editing units clears that override and recalculates. Tariff, applicability, units, and override state must be compared in live evidence.
- **Quarter Rent:** initial calculation follows accommodation assignment, then master/employee rent and catalog default; unassigned rows calculate to zero. It is also directly editable in the Run Payroll deduction sheet and explicit zero is preserved. Verify assignment, master rent, catalog rent and saved override before correction.
- **Audit/amendment:** generated payroll amendment code updates locked existing monthly payroll IDs in a transaction, syncs the linked payslip, and stores before/after snapshots and changed fields. It does not insert a duplicate monthly row. Confirm the deployed endpoint’s expected revision enforcement before using it for stale-write protection.
- **Excel:** exports are built from resolved payroll rows. An export from a stale browser state is not independent evidence; reconcile database snapshot/revision first.

## Automated checks

- PHP 8.4: 187 tests, 839 assertions passed.
- TypeScript `tsc --noEmit --incremental false`: passed after the local resolver mitigation.
- Full `npm run lint`: failed with 7 errors and 10 warnings, including a vendored PHPUnit JavaScript file and unrelated existing React hook/immutability errors.
- Focused resolver suite: 8 tests passed using the installed `jiti` runtime with the project alias configured locally; no dependency was added.
- Final unrestricted Next production build after the resolver mitigation passed compilation, TypeScript, all 73 static pages, and build traces. Existing middleware deprecation and Browserslist data-age warnings remain.
- No live CIRT diagnostics were run and no payroll data was changed.

## Safe recovery procedure

1. Use the existing read-only October diagnostic with a verified production host/database and a database read-only account. Preserve revision snapshots, current monthly rows, payslips, amendment audits, draft-save audits and Activity Log events with timestamps.
2. Compare affected employee/component values to the original approved payroll reference. Obtain payroll-team written confirmation of the correct figures; do not assume the headline amount defines the adjustment.
3. Compare the server’s deployed SHA/build ID and deployment time with local release evidence before placing incidents on the timeline.
4. For a confirmed generated-row error, amend only the existing monthly payroll ID through the audited amendment workflow, with current expected revision and reason/source. Verify before/after audit, revision, totals, and payslip. For a draft-only error, preserve evidence and correct through Run Payroll with the current draft version.
5. Never use direct SQL edits, reset the period, delete revisions/snapshots/audits, or regenerate finalized payroll. Do not set a field to zero without an approved reference confirming zero.

## Manual deployment checklist

1. Capture local release SHA; obtain server SHA/build ID, deployment log, and deployment time.
2. Complete read-only diagnostics and employee-wise reconciliation; get payroll-team signoff on correction values.
3. Run focused resolver, sequential draft-save, intentional-zero, PHP, TypeScript, preview/export, revision/amendment, and concurrency checks on the final staged tree. Resolve or document global lint baseline errors.
4. Confirm Windows paths, service names, IIS pool if used, health URLs, protected backup storage, PostgreSQL backup credentials, and approved maintenance window.
5. Run deployment script preflight and `-BuildOnly`, inspect backup output, then have an operator manually decide whether to use `-Apply -ConfirmProductionRelease`. This script has not been run against production. Check health endpoints and payroll read-only smoke views after release; if checks fail, use the script’s code-only rollback and leave the database untouched.
