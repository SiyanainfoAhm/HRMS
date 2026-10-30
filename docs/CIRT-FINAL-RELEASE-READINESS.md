# CIRT HRMS final release readiness

## Status

The application has a successful local Next.js production build (`npm run build`) when run in an unrestricted Windows process with the dead `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` variables cleared for that process. Build compiled with webpack, completed TypeScript, generated all 73 static pages, and collected traces. No source or proxy configuration was changed for this build. Next.js reports two existing warnings: deprecated `middleware` convention and Node `crypto` imported into an Edge Runtime path.

The code is prepared for manual review; production deployment has not been run. The deployment script is opt-in and performs preflight by default. A production deployment remains blocked on the actual server paths/service names/health endpoints, an approved maintenance window, database backup credentials, and payroll-team signoff on the production October comparison. It never runs migrations or restores a database automatically.

## Test evidence

- PHP 8.4 suite: 187 tests, 839 assertions passed.
- Sequential draft-save regression: passed, including preservation of earlier component values, reload, unrelated edit, and stale revision rejection.
- Payroll revision and amendment checks: passed in rollback-only local transactions; audits/revisions were inspected and the test amendment was rolled back.
- Local October: 83 monthly rows and 83 payslips preserved; all 3 revision checksums valid; revision 3 matched current material payroll values.
- Local October totals: Night Allowance 2,506; Extra Work Allowance 0; Electricity Units 80; Mess 13,710; Credit Society 601,290; earnings 8,629,274.87; deductions 2,683,918; net 5,945,357.13.
- Excel preview and detailed export: configured numeric earning/deduction fields persist across reload and appear once with correct headings/classification and totals. Text statutory identifiers remain excluded.
- Build: passed unrestricted as noted above. A non-blocking Edge Runtime crypto warning and middleware deprecation warning remain.
- PowerShell deployment script parser and PHP diagnostic script syntax checks passed; `git diff --check` passed (only Git line-ending notices).

The tested local institute is `TRest`, not the CIRT production institute. These local totals are test evidence only and must not be represented as CIRT production reconciliation.

## October discrepancy finding

No unexplained 11,800 difference was reproduced in local October. The isolated sentinel used in earlier rollback-only regression testing is not evidence of a real payroll variance. One local October verified Excel workbook was not available: the repository contains a September workbook, so no October Excel comparison was possible. The read-only diagnostic script accepts a verified source workbook for the production comparison.

The actual CIRT employee-wise ₹11,800 report is therefore pending a read-only run against the verified CIRT production database and the original verified October workbook (or equivalent payroll reference figures). The script reports exact changed values by employee/component across saved revisions, current monthly rows, and supplied Excel where a unique employee account identifier can be matched. It also includes revision checksums, audit/event data and payroll totals. Do not treat the local TRest report as a production answer.

Run only from a controlled host with a production read-only database account, after verifying host/database identity:

```powershell
C:\php84\php.exe scripts\diagnose-cirt-october-payroll-readonly.php `
  --environment=production --confirm-read-only `
  --company-id=<verified-CIRT-company-UUID> `
  --excel=<path-to-original-verified-October-workbook.xlsx> `
  --out=<new-unique-report-path.json>
```

The diagnostic starts a transaction and executes `SET TRANSACTION READ ONLY`; it makes no payroll, audit, or activity-log writes. The report includes DB identity. Stop if host/database/user or institute identity is unexpected. Never provide production credentials in a command line or report.

## Correction instructions after payroll-team confirmation

No correction is currently authorized by evidence. First obtain written confirmation of each affected employee’s correct component values and source (approved October workbook/payroll register), plus gross, deductions, and net. Then use the application’s existing audited amendment workflow for the specific monthly payroll row, with the current expected revision and a reason referencing the confirmed source. Review the resulting amendment revision and audit event and reconcile the employee and payroll totals. Do not run direct SQL updates, regenerate the run, reset payroll, or amend values based only on the ₹11,800 headline. The application routes are `/api/payroll/monthly/{id}/audit` and `/api/payroll/run/audit`; use the route appropriate to the confirmed row/workflow.

## Manual deployment

Script: `scripts/deploy-cirt-hrms.ps1`. It has three modes:

- Default: prints preflight settings only.
- `-BuildOnly`: builds a separate staged release; no service restart or deployment.
- `-Apply -ConfirmProductionRelease`: explicitly opts into deployment after a complete staged build and clean migration-status check.

Before `-Apply`, the operator must establish the exact current/staged/backup paths, database name, Next.js and Laravel service names, health URLs, optional IIS app pool, and working PostgreSQL backup environment (`PGHOST`, `PGUSER`, and a protected `PGPASSFILE` or `PGSERVICE`). Verify the target host and database identity. The script makes a custom-format `pg_dump`, copies the current app tree, checks for pending migrations but never runs one, swaps same-volume release directories, restarts services, and checks both health endpoints. If health checks fail, it retains the failed release and restores the previous code directory; it does not restore the database. Keep the database unchanged during code rollback and have an operator investigate any schema compatibility concern.

Example preflight/build (replace all placeholders; no deployment):

```powershell
.\scripts\deploy-cirt-hrms.ps1 `
  -CurrentRoot '<server-current-root>' -StagedRelease '<same-volume-staged-release>' `
  -BackupRoot '<protected-backup-root>' -DatabaseName '<database-name>' `
  -NextServiceName '<next-service>' -LaravelServiceName '<laravel-service>' `
  -WebHealthUri 'https://<host>/<web-health-path>' `
  -LaravelHealthUri 'https://<host>/<api-health-path>' -BuildOnly
```

The exact server parameters are intentionally not guessed. Do not add `-Apply` until the release has been reviewed, payroll signoff is complete, backups have sufficient protected storage, and the approved maintenance window is active. No production deployment has occurred.

## Preserved records and remaining production checks

The local test process preserved the generated October payroll: row counts remained 83 monthly rows and 83 payslips; all three snapshots/revisions remained and their checksums validated; audit history was not reset. Test amendments were performed in rollback-only transactions. No production database was connected to or modified.

Before release, production-only evidence is still needed for the verified CIRT institute/company UUID, October payroll and employee counts, current and saved revision comparison, original October Excel comparison, employee-level ₹11,800 discrepancy report, payroll-team-confirmed correction values, target server deployment parameters, protected database backup connectivity, and post-deployment smoke checks. The code build passed; operational deployment readiness is conditional on those items.
