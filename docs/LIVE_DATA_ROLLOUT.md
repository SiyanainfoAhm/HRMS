# Live data rollout (Quarters, October 2026 draft, Special Pay fold)

Status: DRAFT runbook, written from the local database and its audit trail. Nothing here has been run on live.
Step 3-4 of the plan (compare with a live copy, rehearse on `hrms_livecopy`) are not done yet; the "expected" numbers below are
derived from the local audit and are confirmed or corrected by the rehearsal (section 7).

Rules for every step
- Employees are identified by **employee code** (the code on the payslip, `cirt_users.employee_code`, also `row_payload.employeeCode`),
  quarters by **quarter name**. Never by a row id. No employee names are written in this file.
- Every command is a dry run unless it has `--apply`. Always run the dry run first and read it.
- Commands run from `<live>\backend` with `<php>` = the PHP 8.4 `php.exe`. Audit user: `--user=admin@cirtindia.com`.
- Draft steps use the normal draft save path (`PayrollDraftService::saveDraft`) or, where stated, a direct JSON edit that keeps
  stored totals; each writes one audit entry per employee, visible in the draft audit.
- Steps D4 and D5 refuse to touch an employee whose current value differs from what the sheet says is "now in app"; they report it as skipped.

## 0. Files that must be copied to the server by hand (git-ignored, contain real employee data)

| File | What | SHA-256 |
|---|---|---|
| `DA_Arrears_Entry_Oct2026.xlsx` | DA / TR arrears and CPF Arr, sheet "Arrears Entry", 81 rows | `9d231712c5f41ace2a1a5b33591f6ca1996ad1f9d95b9cb116b2644985ba4fdd` |
| `Encashment_Entry_Oct2026.xlsx` | EL encashment, sheet "Encashment Entry", 55 rows | `36995ef643035e04cbb1bdf7ebe527616125e0cbd583ddd5659a4705fb4cd20b` |
| `leave_edits.json` | leave lines for 017 and 005, Transport 0 for 077 (keyed by the name shown in the draft) | `f9133ad85a9e414f7fd2220ba5074590b8f69c7385b95a82e3a2171499c6b7b8` |

Local copies: the two sheets are in the repo root, `leave_edits.json` is in `backups/live-rollout/` (git-excluded). Check the hashes on the server
(`Get-FileHash -Algorithm SHA256 <file>`) before use. Put them in one folder outside the app, for example `D:\hrms-rollout\`.

Sheet matching: the two sheets match the draft row by the employee's **name in the app** (column "Name in app"); a name that matches
other than exactly one draft row is skipped and reported. The column "Now in app: ..." is the safety check (see rules above).

## 1. Order

| # | Step | Where | Changes |
|---|---|---|---|
| 1 | Back up the live database | server | nothing |
| 2 | Retired-fields audit (read-only) | staged build, live DB | nothing |
| 2b | Special Pay fold (only if the audit lists any) | staged build, live DB | drafts |
| 3 | Deploy code + migrations (`deploy-cirt-hrms.ps1`) | server | schema, Quarters |
| 4 | Data steps D1, D1b, D1c, then D2-D9 (Quarters first, then the October draft) | live backend | Quarters, October draft (and July if 2b) |
| 5 | Verification (section 5) | live | nothing |
| 6 | Export Monthly Summary for October | app | nothing |

## 2. Before the deploy

### 2.1 Back up (step 1)
Take a manual dump in addition to the one the deploy script takes (see `TASKS.md`, CIRT-13). Command in section 6.

### 2.2 Retired-fields audit (step 2)
`php artisan` of the new code is not on live yet, so run it from the staged build (after `deploy-cirt-hrms.ps1 ... -BuildOnly`, which also copies the live `backend\.env` into the stage):

```powershell
cd <stage>\backend
<php> artisan payroll:retired-fields-audit
```
Expected: ends with "No non-zero Special Pay / Std Licence Fee value anywhere" (exit 0). If it lists anything, go to 2b. If it lists Std Licence Fee amounts or anything in
generated payroll, Payroll Master or finalized months: **stop**, do not deploy.

### 2.3 Special Pay fold, only if 2.2 lists draft values (step 2b)
Local result: July 2026 draft, 3 employees (codes 081 = 200, 004 = 1,000, 043 = 200) moved to Special Allowance; stored gross / earnings / deductions / net of all 83 rows unchanged; draft v57 -> v58.
```powershell
cd <stage>\backend
<php> artisan payroll:fold-special-pay --year=2026 --month=7 --user=admin@cirtindia.com           # dry run
<php> artisan payroll:fold-special-pay --year=2026 --month=7 --user=admin@cirtindia.com --apply
# repeat with --month=<n> for every open draft the audit listed (October has none locally)
<php> artisan payroll:retired-fields-audit        # must now end clean
```
Identification: employee code from the row. It refuses (rolls back) if any stored total would change, or if Special Pay, its "actual" and its override disagree for a row.

## 3. Deploy (step 3)

`deploy-cirt-hrms.ps1` as in the CIRT-13 checklist (`docs/TASKS.md`), without `-RepairData`. It runs `php artisan migrate --force`. Run `<php> artisan migrate:status` first and list what is pending.
Migrations that matter for this rollout, in file-name order (any that live already ran are skipped):

| Migration | What it does to live data |
|---|---|
| `2026_11_04_100000_remove_unused_dummy_quarters` | deletes the placeholder quarters "Quarter 2" and "Q1- 400" **only if** nothing references them |
| `2026_11_04_100000_add_org_name_snapshot_to_monthly_payroll` | adds division / designation name text to generated payroll rows (no amounts) |
| `2026_11_04_110000_resync_quarter_rent_snapshots` | Payroll Master quarter mirror (`quarter_id`, `has_quarter`, `quarter_rent`) re-synced from the open assignments; a master with no open assignment loses its quarter |
| `2026_11_04_130000_merge_pathare_and_collapse_duplicate_quarter_assignments` | employee 042: one B2/7 assignment from the earliest "Quarter 2" start, open-ended; "Quarter 2" rows removed; repeated same-employee-same-quarter assignments collapsed into one; dummy quarters deleted again if now unreferenced. Logged to the Laravel log under `quarter-data-fix` (before / after) |
| `2026_11_05_100000_add_leave_lines_to_monthly_payroll` | nullable leave columns on generated payroll rows |
| `2026_11_05_110000_add_employer_share_rule_to_calculation_settings` | three nullable CPF employer-share settings |
| `2026_11_06_100000_remove_sp_pay_and_std_licence_fee` | CIRT-13: drops the 2 fields (refuses if non-zero anywhere) |

## 4. Data steps (after the deploy)

Local starting point is not the same as live's, so each step states what to expect as a **change**; section 7 gets the exact figures from the rehearsal.

### D1. Quarters: migrations (section 3), then D1b and D1c (commands)
Rows identified by quarter name and employee code. After the migrations of section 3 (merge of 042, duplicate collapse, mirror sync, "Quarter 2" removal), run D1b and D1c.

### D1b. Remove the placeholder quarter "Q1- 400" and its orphan assignment
The delete migration keeps a placeholder quarter that anything references. Locally "Q1- 400" had one closed assignment (2026-07-01 to 2026-10-30) to an employee id that no longer exists in `cirt_users`. This command deletes that orphan assignment and then the quarter, and refuses (changes nothing) unless the quarter is inactive with no assigned employee, nothing in Payroll Master or generated payroll references it, and every assignment of it is closed with a non-existent employee.
```powershell
<php> artisan payroll:remove-orphan-quarter "Q1- 400"            # dry run
<php> artisan payroll:remove-orphan-quarter "Q1- 400" --apply
```
Expected: dry run lists "1 orphan closed assignment(s)" (rent_at_assignment 20,000); after --apply a second run says "No quarter named 'Q1- 400': nothing to do". If live refuses, read the reasons: an open assignment or an existing employee means it is not a placeholder, stop and ask. Every deleted row is also written to the Laravel log (`quarter-data-fix`).

### D1c. Quarter rents (by quarter name) and rent_at_assignment
Sets `monthly_rent` of every quarter from `backend/database/data/quarter_rents.json` (the local Quarters master of 2026-11-06: 21 quarters, A/B quarters 440, D quarters 880, E-I / E-2 / E-3 1,710; the file lists every name), syncs `rent_at_assignment` of the **open** assignments of those quarters, and `quarter_rent` of the current Payroll Master rows holding them. Closed assignments, Payroll Master history and generated / finalized payroll are never touched. It refuses unless every name in the file exists exactly once and no other active quarter exists, and it rolls back unless the result is **21 open assignments with a rent total of 15,690** (rent_at_assignment total equal).
```powershell
<php> artisan payroll:set-quarter-rents            # dry run: lists each rent / rent_at_assignment it would change
<php> artisan payroll:set-quarter-rents --apply
```
Locally the dry run listed no rent change and 4 `rent_at_assignment` changes: 073 B1/2 1,000 -> 440; 046 E-2, 040 E-3, 065 E-I 1,650 -> 1,710. On live the dry run is the comparison: any other line is a difference between live's Quarters master and local's, read it before applying.
Expected end state of D1 (also local's): Quarters 21, all `assigned`, none inactive; assignments 21, all open; 0 repeated employee+quarter pairs; 0 employees with two open assignments; employee 042 has exactly one assignment, B2/7 from 2026-07-02; current Payroll Masters with a quarter 21, `quarter_rent` sum 15,690; open-assignment rent total 15,690.

### D2. October draft: quarter rent from the Quarters master
Automatic: the draft takes quarter id / name / type / rent from the Quarters master every time it is opened or saved (`applyAuthoritativeQuarterValues`); there is no command. The draft rows are rewritten by the saves of D4-D9, so run D1b/D1c **first**.
Expected: quarter rent 15,690 for exactly 21 employees (all others 0), HRA 0 for those 21.

### D3. (reserved: Special Pay fold, done in 2.3 before the deploy)

### D4. DA / TR arrears and CPF Arr (sheet `DA_Arrears_Entry_Oct2026.xlsx`)
```powershell
<php> artisan payroll:apply-arrears-sheet D:\hrms-rollout\DA_Arrears_Entry_Oct2026.xlsx --year=2026 --month=10 --user=admin@cirtindia.com --note="DA arrears 60%→63%, Jul–Sep 2026, from DA_Arrears_Entry_Oct2026.xlsx" --dry-run
<php> artisan payroll:apply-arrears-sheet D:\hrms-rollout\DA_Arrears_Entry_Oct2026.xlsx --year=2026 --month=10 --user=admin@cirtindia.com --note="DA arrears 60%→63%, Jul–Sep 2026, from DA_Arrears_Entry_Oct2026.xlsx"
```
Local: 81 employees changed. Expected after: sum of DA arrears 378,930, TR arrears 29,745, CPF Arr 43,495. Local deltas: Gross +45,975, Total Deductions +63,303, Net -17,328.

### D5. EL encashment (sheet `Encashment_Entry_Oct2026.xlsx`)
```powershell
<php> artisan payroll:apply-encashment-sheet D:\hrms-rollout\Encashment_Entry_Oct2026.xlsx --year=2026 --month=10 --user=admin@cirtindia.com --note="EL encashment FY 2026-27, Ref Adm:Gen:1515 dtd 28.10.2026" --dry-run
<php> artisan payroll:apply-encashment-sheet D:\hrms-rollout\Encashment_Entry_Oct2026.xlsx --year=2026 --month=10 --user=admin@cirtindia.com --note="EL encashment FY 2026-27, Ref Adm:Gen:1515 dtd 28.10.2026"
```
Local: 55 employees. Expected after: sum of Encash. 2,295,106. Local deltas: Gross +2,206,434, Net +2,206,434, deductions 0.

### D6. Leave lines (017, 005) and Transport 0 (077)
Needs Node on the server: the row is calculated by the same code the screen uses, run with the pinned local `tsx` (`node node_modules\tsx\dist\cli.mjs scripts\draft-edit-replay.ts`; `tsx` 4.23.15 is a devDependency installed by `npm ci`, nothing is downloaded at run time, see open item C). Check first: `Test-Path <live>\node_modules\tsx\dist\cli.mjs` must be True, otherwise run `npm ci` in `<live>` (or run this one step from the staged build). The command stops with a clear message if tsx is missing.
```powershell
<php> artisan payroll:apply-leave-lines --year=2026 --month=10 --user=admin@cirtindia.com --note="Leave deduction Ref ADM:Gen:1521 dtd 27.10.2026" --edits=D:\hrms-rollout\leave_edits.json
<php> artisan payroll:apply-leave-lines --year=2026 --month=10 --user=admin@cirtindia.com --note="Leave deduction Ref ADM:Gen:1521 dtd 27.10.2026" --edits=D:\hrms-rollout\leave_edits.json --apply
```
Content: 017: HPL 4 d + EOL 2 d (Sept 2026), HPL 1 d + EOL 2 d (Oct 2026); 005: HPL 1 d (Sept 2026); 077: Transport manual override 0.
Local: 3 employees. Deltas: Gross -25,068, CPF and Total Deductions -2,890, Net -22,178. (The audit rows of this step carry a different code in `employeeCode` than the real one, a pre-existing quirk of the draft's code column, see open item D.)

### D7. CPF re-derived from the paid lines (TR-arrears rule, round up)
```powershell
<php> artisan payroll:repair-draft-cpf --year=2026 --month=10                                    # dry run
<php> artisan payroll:repair-draft-cpf --year=2026 --month=10 --user=admin@cirtindia.com --apply
```
Local: 78 employees. Deltas: CPF and Total Deductions -26,081, Net +26,081, Gross 0.

### D8. Desai (043) Special Allowance 200
```powershell
<php> artisan payroll:set-draft-custom-earning 043 special_allowance 200 --year=2026 --month=10 --user=admin@cirtindia.com --note="Special Allowance 200"          # dry run
<php> artisan payroll:set-draft-custom-earning 043 special_allowance 200 --year=2026 --month=10 --user=admin@cirtindia.com --note="Special Allowance 200" --apply
```
Local: 1 employee, Gross +200, Net +200 (typed in the screen locally; same save path). If the dry run says `200 -> 200`, live already has it.
All other October Special Allowance amounts (042 200, 004 1,000, 049 4,000, 067 3,000, 081 200, 043 200 = 8,600) come from Payroll Master and need no step.

### D9. Row-level arrear fields aligned with the paid arrear lines
```powershell
<php> artisan payroll:repair-row-arrears --all --year=2026 --month=10                              # dry run
<php> artisan payroll:repair-row-arrears --all --year=2026 --month=10 --user=admin@cirtindia.com --note="Align row-level grossArrear/netArrear with the paid arrear lines; pay unchanged" --apply
```
Local: 82 rows (1 + 81), nothing that is paid changes (the command refuses to save otherwise). Then 3 employees (codes 017, 010, 005) had a stale `governmentMonthly.cpf_arrear` aligned with `cpfArrear`: run the dry run again; if it still lists rows, apply with `--note="Align stale governmentMonthly.cpf_arrear with cpfArrear"`.

## 5. Expected end state and verification (October 2026 draft)

Local draft v22, 82 employees. After all steps on live (to be confirmed by the rehearsal):

| Check | Expected |
|---|---|
| Quarters | 21 quarters (all assigned), 21 assignments (all open), rent total 15,690, no "Q1- 400" / "Quarter 2" |
| Quarter rent in the October draft | 15,690 for 21 employees |
| Gross (Total Earnings) | 1,14,12,817 |
| Total Deductions | 27,83,121 |
| Net | 86,29,696 |
| CPF | 10,01,144 |
| DA CPF (= CPF Arr) | 43,495 |
| DA arrears / TR arrears / Encash. | 378,930 / 29,745 / 2,295,106 |
| Special Allowance | 8,600 |
| Retired fields audit | clean; columns `sp_pay_*`, `std_licence_fee_*`, `standard_licence_fee`, `std_licence_fee_default` do not exist |
| `payroll:schema-check` | passes |

Audit-derived checkpoints (local) after each draft step, for the rehearsal to confirm: after D4 Gross 92,31,251 / Net 64,19,159; after D5 Gross 1,14,37,685 / Ded 28,12,092 / Net 86,25,593 / CPF 10,30,115; after D6 Gross 1,14,12,617 / Ded 28,09,202 / Net 86,03,415 / CPF 10,27,225; after D7 Ded 27,83,121 / Net 86,29,496 / CPF 10,01,144; after D8 Gross 1,14,12,817 / Net 86,29,696.

Then: export the October **Monthly Summary** from the app and tie its totals to the table above.

## 6. Taking the dump of the live database

On the server, in an elevated PowerShell (password from a protected pgpass file, never on the command line):
```powershell
$env:PGHOST = 'localhost'; $env:PGPORT = '5432'; $env:PGUSER = '<db user>'; $env:PGPASSFILE = '<path to pgpass.conf>'
& "C:\Program Files\PostgreSQL\<version>\bin\pg_dump.exe" --no-password --format=custom --no-owner --file D:\hrms-livedump-<yyyymmdd>.dump --dbname <db name>
& "C:\Program Files\PostgreSQL\<version>\bin\pg_restore.exe" --list D:\hrms-livedump-<yyyymmdd>.dump | Select-Object -First 5
(Get-FileHash -Algorithm SHA256 D:\hrms-livedump-<yyyymmdd>.dump).Hash
```
This is the same invocation `deploy-cirt-hrms.ps1` uses for its own backup (`--format=custom --no-owner`). Restore locally as `hrms_livecopy`, never as `hrms`.

## 7. Rehearsal result

Not done yet: waiting for the live dump. To be filled in: migrations run on `hrms_livecopy`, every step above (dry run, apply) with the counts and totals it produced, the comparison with local October v22, and any difference.

## Open items (decisions taken are marked)

A. **"Q1- 400"**: decided, scripted as D1b. Applied to local `hrms` on 2026-11-06 (backup `hrms_before_quarter_cleanup_20261106.dump`), so local no longer has it.
B. **Quarter rents**: decided, scripted as D1c (`quarter_rents.json` = local Quarters master). Applied to local `hrms` the same day: 4 `rent_at_assignment` values synced, no rent changed.
C. **`tsx`**: decided, pinned as devDependency `tsx@4.23.15` (published 2026-09-20, 47 days before the pin) and run from `node_modules` by `payroll:apply-leave-lines` and by `npm test`; no `npx --yes` remains in code.
D. **The draft `employee_code` column** differs from the real employee code in 77 of 82 October rows (for example a legacy number instead of the payslip code). Report only, nothing changed. Where it is printed:
   - **Settings > payroll draft audit log** (`PayrollDraftAuditLogs`): every line starts with the audit entry's `employeeCode` (or the user id if there is none). Entries written by a normal draft save carry the **draft column value** (the legacy number); entries written by `payroll:fold-special-pay` carry the real code. So one employee can appear under two different codes on that screen.
   - The draft **reset** record stores the same column value in its employee snapshot (same screen).
   - Run Payroll rows: the app takes `employeeCode` from the draft column first, then the row payload. The value rides along in the row objects passed to the draft save and to the workbook builders, but **no screen column, Excel / Employee Detail / Monthly Summary column or payslip prints it**: the Employee Detail header has no EmployeeCode column (checked), the Monthly Summary has none.
   - **Not affected:** generated payroll, payslips and the post-payroll reports (TDS, CPF, Division-wise, Paybill) read the code from Payroll Master / the employee, never from the draft column.
E. **Employee 001, 2026-11-06 11:16-11:17: who changed what.** The activity log has no entry for it (its last `payroll_master.changed` is 2026-10-30 16:25, and today has only three logins by admin@cirtindia.com at 09:14, 09:20 and 13:27). The Laravel log shows it: user admin@cirtindia.com (user id a1deb014, the same one that made every other edit) saved employee 001's Payroll Master from the screen three times (`payroll_master.http_update`, master id ending ...4473f): 11:16:41 saved, DA 63 unchanged, `structure_changed=false`; 11:17:02 **rejected** by the concurrency check ("Payroll was updated in another tab or session"); 11:17:05 saved again. The only data difference left in the database is a **new recurring Special Allowance value of 500** for 001 (`cirt_payroll_field_values`, created 11:17:05, no end date); the master row, its full-history row and 001's quarter assignment got `updated_at` 11:17:05 as a side effect of that save (DA 63, HRA 30, quarter D2/3, rent 880 are unchanged). The October draft does **not** include this 500 (it was built earlier and does not re-read Master values), so October Special Allowance stays 8,600. Open question for you: should live's Payroll Master for 001 also get Special Allowance 500 (recurring)? It is not scripted: say so and I add a step, otherwise it is a local-only master change that the comparison will report.
F. **Employee 010 has one no-pay-effect screen save (2026-11-05 08:56)**: leave lines `[]`, a Transport override of 5,868 cleared, `prBonus` / `incentive` / `reimbursement` stored as 0. Pay is identical either way; it can show up as a cosmetic payload difference in the field-by-field comparison.
G. **Not covered here:** the July draft is stale against the corrected Quarters (stored vs shown differ in all 83 rows). It is not part of this rollout.
