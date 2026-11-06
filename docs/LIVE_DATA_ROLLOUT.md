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
| 4 | Data steps D1-D8 | live backend | October draft (and July if 2b) |
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

### D1. Quarters (done by the migrations in section 3; no separate command)
Rows identified by quarter name and employee code. Expected local result, to compare after the migrations:
- Quarters: 21 with status `assigned` + 1 `inactive` ("Q1- 400", see open item A). "Quarter 2" is gone.
- Assignments: 22 in total, 21 open (`assigned_to` NULL), 0 repeated employee+quarter pairs, 0 employees with two open assignments.
- Employee 042: exactly one assignment, quarter B2/7, from 2026-07-02, open.
- Current Payroll Masters with a quarter: 21, `quarter_rent` sum 15,690.
- `rent_at_assignment` is **not** rewritten by any migration (historical record, payroll ignores it). Locally 4 open assignments differ from the quarter's current rent: 065 E-I, 046 E-2, 040 E-3 (1,650 vs 1,710) and 073 B1/2 (1,000 vs 440). That is expected and not a rollout step.
- Quarter rents themselves live in the Quarters master. Locally E-I, E-2, E-3 = 1,710, B1/2 = 440, the other 17 quarters = 440 / 880 as listed in the app. No migration or command sets rent: if live's Quarters master rent differs it must be edited in the app, see open item B.

### D2. October draft: quarter rent from the Quarters master
Automatic: the draft takes quarter id / name / type / rent from the Quarters master every time it is opened or saved (`applyAuthoritativeQuarterValues`); there is no command.
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
Needs Node on the server: the row is calculated by the same code the screen uses (`npx --yes tsx scripts/draft-edit-replay.ts`); see open item C.
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
| Quarter rent | 15,690 for 21 employees |
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

## Open items found while preparing this (decide before the live run)

A. **"Q1- 400" is NOT deleted locally.** The delete migration keeps a dummy quarter that anything references. It still has one closed assignment (2026-07-01 to 2026-10-30) to an employee id that no longer exists in `cirt_users`. "Quarter 2" is gone. If "Q1- 400" must go too, that assignment row has to be removed first (a decision, not scripted).
B. **Quarter rent edits are not captured by any script.** Locally E-I / E-2 / E-3 (1,710) and B1/2 (440) differ from `rent_at_assignment`; the Quarters master edits were made in the app (rows last edited 2026-09-25 .. 2026-10-14). Whether live has the same rents is checked in the comparison (step 3); if not, they must be set in the app before D2.
C. **`tsx` is not a project dependency.** D6 runs `npx --yes tsx`, which downloads it from the npm registry the first time. A server without internet access needs `tsx` added as a devDependency (so `npm ci` installs it) or D6 run from a machine that has it.
D. **The draft's `employee_code` column differs from the real employee code for 77 of 82 rows** (for example the draft column holds a legacy number while `employeeCode` in the row is the payslip code). The commands match by name/user, not by that column, and report both; the draft column itself was not changed by this work.
E. **Employee 001's assignment and Payroll Master were both updated at 11:17 on 2026-11-06 (same second)**, apparently an edit in the app; assigned-from date and rent are unchanged. Not scripted; the comparison will show whether live differs.
F. **Employee 010 has one no-pay-effect screen save (2026-11-05 08:56)**: leave lines `[]`, a Transport override of 5,868 cleared, `prBonus` / `incentive` / `reimbursement` stored as 0. Pay is identical either way; it can show up as a cosmetic payload difference in the field-by-field comparison.
G. **Not covered here:** the July draft is stale against the corrected Quarters (stored vs shown differ in all 83 rows). It is not part of this rollout.
