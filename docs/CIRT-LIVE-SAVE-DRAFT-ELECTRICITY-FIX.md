# CIRT live Save Draft and Electricity fix — release note

Date: 2026-10-30
Scope: local source and tests. No production data was accessed or changed; no deployment was run.

## Findings

### Save Draft

The live exception text points to a direct array index. In the prior local controller version, the exact unsafe access was `backend/app/Http/Controllers/Api/V1/PayrollDraftController.php` at the service argument `$data['employees']` (line 52 before the validation guard was added). The checkout already had Laravel `required|array|min:1` validation, so missing employees should have been a 422. The reported production 500 therefore suggests a deployed controller/version mismatch, a nonstandard validation path, or a different throw site; live logs were not available to distinguish these. A read-only GET to `http://192.168.10.5:8081/payroll?tab=run` timed out.

Current UI POST contract remains `{year, month, version, replaceAllEmployees, employees:[{employeeUserId, changedFields, rowPayload, ...}]}`. The Next.js proxy converts nested camelCase keys to snake_case while keeping the `employees` collection. The controller now accepts both casing variants, validates every employee row and ID, and throws a Laravel ValidationException if the validated list is absent/empty/malformed. This avoids undefined-key access and retains HTTP 422 behavior. Version conflicts remain HTTP 409; the service locks/checks the version inside its transaction. Existing field masks preserve unrelated values, and an edited numeric 0 stays explicit.

### Electricity

The UI recalculates a unit edit using the effective tariff supplied by the payroll preview. The previous draft-save service merged the client’s calculated bill and recomputed totals, but did not independently verify the amount against the effective tariff. Stale or missing bill data could therefore persist even when units were present. The saved draft resolver also recalculates unit-based bills when hydrating rows, but that did not guarantee server-persisted values were correct.

The follow-up ₹49/₹711 evidence identified a separate reload/display conflict: `deserializePayrollDraftEmployee` retained the saved unit bill, but `resolveRunPayrollRow` rebuilt the calculation and chose the preview's `masterRecalc.electricityMode` ahead of the draft mode. A preview seeded as `manual_fixed` with Master default ₹49 therefore recalculated the saved 80-unit row as ₹49. Old unflagged `deductionPaidOverrides.electricity` entries could also be promoted to manual overrides. The resolver now uses the saved monthly bill/mode ahead of Payroll Master, and the deserializer treats the explicit manual flag or bill marker as the approval signal. Server draft reconciliation also detects disagreement between the saved bill total, summary Electricity amount, and monthly deduction, recalculates against the effective tariff, and removes unapproved stale cached overrides on GET/save.

The draft service now recalculates from the company tariff effective on the payroll month end when units change, the bill is missing/invalid, a positive unit-based bill is zero without an explicit manual override, or the effective tariff ID/configuration changes (including a same-ID configuration edit). A saved `electricityManualOverride` distinguishes an approved manual zero from an uncalculated zero. Positive applicable unit-based consumption cannot be recalculated/saved without an effective tariff; the request receives a controlled validation error and transaction rollback. It uses `ElectricityTariffService` for progressive slabs, charges and final whole-rupee rounding. Explicit manual amount overrides remain authoritative even if the tariff changes; unrelated field saves retain a valid bill and all other components. Server recalculation updates electricity breakdown/metadata, deduction totals and net salary. Generated payroll continues through the existing revision-checked amendment workflow; this fix does not rewrite generated rows.

## Local verification

- PHP 8.4: 203 tests, 965 assertions passed.
- TypeScript check: passed.
- Electricity tariff tests: passed.
- Draft patch tests: passed.
- Run Payroll resolver: 10 tests passed, including the ₹49 Master / 80-unit ₹711 draft conflict across repeat reload and Excel row generation.
- Draft/service regression: 40 units with a prior calculated ₹49 changed to 80 units; the tariff result replaced ₹49, while Mess, Credit Society, and Quarter Rent remained unchanged and totals were recomputed. A separate case confirms an approved manual override remains visible and authoritative when the tariff configuration changes.
- Draft decision regressions: positive units with missing/zero bill recalculates; approved manual zero does not; missing active tariff is rejected for positive unit-based billing; a tariff configuration change is detected; unrelated component patch keeps saved units and bill.
- Excel export test: passed (test process exit code 0).
- Next.js production build: passed in unrestricted Windows execution; all 73 static pages generated. Sandboxed build worker had `spawn EPERM`.
- `git diff --check`: passed.

These checks establish local behavior only; they do not verify actual production tariff configuration, employee applicability, the live request body, or the live deployment version.

## Changed files for these fixes

- `backend/app/Http/Controllers/Api/V1/PayrollDraftController.php` — guarded and validated employees request contract (modified earlier in this local release work).
- `backend/app/Services/PayrollDraftService.php` — server-authoritative electricity snapshot reconciliation on draft read/save.
- `backend/tests/Unit/PayrollDraftServiceTest.php` — request and server reconciliation regressions.
- `src/lib/resolveRunPayrollRow.test.ts` — draft missing/zero bill, Master-mode conflict and intentional-zero regressions.
- `src/lib/deserializePayrollDraftEmployee.ts` — saved monthly electricity precedence and stale override filtering.
- `src/lib/resolveRunPayrollRow.ts` — saved monthly mode precedence during draft hydration.

The working tree also contains earlier quarter/payroll integrity work. Do not cherry-pick these files into an unknown production revision without reviewing the full dependency set and producing one compatible release artifact.

## Deployment status / operator sequence

**Not deployed.** The production URL did not respond to the read-only version probe; production frontend/backend SHAs, service names, filesystem roots, database backup configuration, and maintenance window are unverified. Do not run `-Apply` until the operator has verified those facts and the payroll team has approved the window. No migration is required by these two fixes.

Use the existing manual script from the reviewed release checkout on the Windows server. First stage/build only (replace every placeholder with verified server values):

```powershell
.\scripts\deploy-cirt-hrms.ps1 `
  -CurrentRoot '<verified-current-root>' -StagedRelease '<same-volume-staged-release>' `
  -BackupRoot '<protected-backup-root>' -DatabaseName '<verified-database>' `
  -NextServiceName '<verified-next-service>' -LaravelServiceName '<verified-laravel-service>' `
  -WebHealthUri 'http://<verified-host>:8081/up-or-health-path' `
  -LaravelHealthUri 'http://<verified-host>:<api-port>/up' -BuildOnly
```

Review the staged build, PHP 8.4 dependency install, migration status (script does not run migrations), and backup destination. During the approved maintenance window, only after a verified database and application backup and a second operator check, the existing script's `-Apply -ConfirmProductionRelease` option performs the service swap/health check and code rollback on failure. It does not automatically restore the database. Exact arguments must come from the server operator; they are intentionally not guessed here.

After deployment, verify backend `/up`, web health, frontend/backend release IDs, and a valid draft save on a designated ungenerated test period/employee without changing salary data. Verify malformed employee payload returns 422, stale version returns 409, and the original reported request succeeds. Compare the applicable tariff ID/effective date and units/amount in preview, saved draft GET, and detailed Excel output. For October generated payroll, use read-only exports/snapshots first; reconcile employee component values and totals against the approved source. Any confirmed change must go through the audited amendment flow with expected revision and payroll-team approved values. Do not reset or regenerate October or script corrections to employee amounts.
