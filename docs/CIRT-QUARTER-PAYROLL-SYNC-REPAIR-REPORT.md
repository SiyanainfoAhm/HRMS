# CIRT quarter / Payroll Master / draft reconciliation report

Date: 2026-10-30
Scope: local repository and local test database only. No CIRT production server was accessed, no production payroll was modified, and no migration or deployment was run.

## Authoritative schema

- **Quarter catalog:** model `HrmsQuarter`, table `cirt_quarters`; stores `quarter_name`, `quarter_type`, `quarter_type_id`, `monthly_rent`, and legacy status/assignee mirrors.
- **Quarter types:** model `HrmsQuarterType`, table `cirt_quarter_types`; canonical display name is `name`.
- **Assignment history/current assignment:** model `HrmsQuarterAssignment`, table `cirt_quarter_assignments`; fields are `company_id`, `quarter_id`, `employee_id`, `assigned_from`, `assigned_to`, and `rent_at_assignment`. The app now treats the assignment row effective on the payroll month’s last day as authoritative. `assigned_to` is exclusive; an open row has `assigned_to IS NULL`.
- **Payroll Master:** `HrmsPayrollMaster`, table `cirt_payroll_master`; duplicate assignment fields are `has_quarter`, `quarter_id`, `quarter_rent`. HRA entitlement remains in `hra` / `hra_percent` and is not cleared when a quarter is assigned.
- **Drafts:** `HrmsPayrollDraft` / `HrmsPayrollDraftEmployee`, tables `cirt_payroll_drafts` / `cirt_payroll_draft_employees`; employee calculations and component snapshots are in `row_payload`, with versioned summary columns.
- **Generated payroll snapshot:** `HrmsGovernmentMonthlyPayroll`, table `cirt_monthly_payroll`; persisted historical quarter/HRA values include `has_quarter`, `quarter_id`, `quarter_name`, `quarter_type`, `quarter_rent_amount`, `hra_actual`, and `hra_paid`.

## Confirmed root cause

Quarter assignment actions wrote the quarter catalog and assignment-history tables but did not keep the duplicated Payroll Master flags synchronized. Payroll Master formatting and Run Payroll preview then read those stale master flags. Draft hydration preferred saved draft quarter/HRA/rent values, so it could preserve stale values over a correct fresh calculation. Generated preview construction could also inherit current assignment context where the saved monthly row lacked explicit quarter metadata.

## Permanent fix

- `backend/app/Services/QuarterService.php` resolves period-specific assignment history, rejects duplicate active assignments, resolves quarter type and assignment rent, and syncs `has_quarter`, `quarter_id`, and `quarter_rent` to the single current Payroll Master row during assign/unassign. It never changes base HRA entitlement or rate.
- `backend/app/Services/PayrollMasterService.php` now returns assignment-derived quarter state for the current Payroll Master response/export.
- `backend/app/Http/Controllers/Api/V1/PayrollController.php` uses period-effective assignments for new/draft previews. Generated views use persisted monthly quarter metadata and do not apply today’s assignment to historical rows.
- `backend/app/Services/PayrollDraftService.php` overlays authoritative period quarter state on draft load and save, restores/suppresses prorated payable HRA, sets the period rent, removes only stale HRA/quarter-rent overrides, recalculates totals, and retains unrelated component edits. A server-synced quarter-context marker prevents an older preview response from undoing a just-saved authoritative context.
- `src/lib/resolveRunPayrollRow.ts` and `src/lib/deserializePayrollDraftEmployee.ts` overlay period-authoritative quarter/HRA/rent on legacy draft snapshots and retain server-synced values over stale preview responses.
- Quarter assignment and unassignment now reject ambiguity and avoid duplicate open history rows.

## One-time repair tool

Created [repair-cirt-quarter-payroll-sync.php](C:/Users/goura/Desktop/HRMS/backend/scripts/repair-cirt-quarter-payroll-sync.php). It is read-only by default and accepts `--year`, `--month`, optional `--employee-code`, and `--apply`. Apply also requires `--actor-id=<manager UUID>` for auditable identity. It refuses generated periods, duplicate/ambiguous employee or quarter mappings, duplicate draft employees, unresolved type/rent, or state changed since dry run. Master updates create Activity Log before/after entries. Draft repairs use the versioned `PayrollDraftService` field patch so other draft deductions, units, hours, remarks, arrears, and custom fields are retained; draft audit snapshots record the changed values.

The local dry run was attempted against the local configured company and safely aborted before printing a repair plan because that test dataset contains a current Payroll Master row without an employee-user mapping. This is an expected safety stop; no data changed. A clean sample plan therefore must be generated from the verified production read-only data or a clean isolated fixture, not invented from this malformed local dataset.

Illustrative output shape (placeholders only, not payroll figures):

```text
Mode: DRY RUN (read only)
Period: YYYY-MM | Company: CIRT
Generated payroll present: no
Employee Code  Employee Name  Quarter  Quarter Type  Quarter Rent  Master Current  Master Correct  Current effective HRA  Correct effective HRA  Draft Current  Draft Correct  Repair
<code>         <name>         <name>   <type>        <amount>      <json>          <json>          <amount>                <amount>               <json>         <json>         YES/no
Dry run complete. No data was changed.
```

## Verification

- PHP 8.4 full suite: **198 passed, 919 assertions**.
- Targeted quarter tests cover HRA suppression/restoration, rent, authoritative assignment resolution, Payroll Master sync, generated snapshot preservation, duplicate-abort and dry-run safeguards.
- Draft unit coverage verifies assigned quarter zeroes payable HRA, applies assignment rent, restores HRA when unassigned, stops rent, and preserves Mess, Credit Society, LIC, VPF, PF Loan, Post Office, Water, Electricity and unrelated earnings.
- TypeScript `npx tsc --noEmit --incremental false`: passed.
- All **15 `src/lib/*.test.ts`** runtime tests passed, including 9 resolver cases for stale quarter draft HRA/rent and stale preview responses.
- Targeted ESLint on edited payroll UI/resolver/deserializer/calculation files passed.
- Rollback-only local QuarterService integration passed: temporary assignment resolved to rent ₹138, synchronized master assignment state, and retained HRA entitlement/rate on both assign and unassign. The outer transaction was rolled back.
- PHP syntax checks passed for changed services, controller, script, and migration.
- Final Next.js production build is being verified after the last source change; sandbox runs hit Windows `spawn EPERM` after compiling, so the build is rerun with local elevated process permission. Build completion is to be recorded after that run finishes.

## Migration requirement

No new columns are required. A database constraint is recommended to prevent concurrent writes from creating multiple open assignments. Added migration `backend/database/migrations/2026_10_30_120000_add_unique_open_quarter_assignment_indexes.php` adds partial unique indexes for one open assignment per employee and one open employee per quarter. Its preflight aborts if duplicate open rows exist. **The migration has not been run.** Production must first complete read-only duplicate diagnostics and an approved migration review; do not run it automatically.

## Production commands and blockers

Run from the verified server’s `HRMS\backend` directory:

```powershell
C:\php84\php.exe scripts\repair-cirt-quarter-payroll-sync.php --year=2026 --month=10
```

This is the read-only command. The local October 2026 payroll is already generated according to the prior verification, and this script intentionally refuses `--apply` for any period with generated monthly payroll or payslips. Do **not** apply a repair to generated October payroll. For a confirmed, ungenerated draft month only, after payroll team approval and from the authorized operator’s account:

```powershell
C:\php84\php.exe scripts\repair-cirt-quarter-payroll-sync.php --year=YYYY --month=MM --apply --actor-id=<manager UUID>
```

Production remains blocked on access to read-only CIRT data, confirmation of correct employee/reference figures, a clean mapping/duplicate-assignment dry run, production server path/PHP configuration, and explicit migration review. Any generated-payroll correction must use the existing audited amendment process after the payroll team confirms reference figures. No production change or deployment occurred here.
