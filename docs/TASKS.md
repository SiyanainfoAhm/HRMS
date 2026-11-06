# TASKS

## CIRT-FIX (branch `fix/cirt-pune-issues`, local only, nothing deployed)

Rules: finalized payroll never changes (proved: md5 of monthly/payslips/periods/finalized drafts identical to the pre-change dump); fields are marked inactive, never deleted; unconfirmed rules sit behind one named constant.

- [x] CIRT-01 Electricity units 80 -> 49: Not reproduced on this branch (fixed by earlier commits); chain test Employee001ElectricityUnitsTest (save, reload x2, generate, reset)
- [x] CIRT-02 Employee 055 audit: DA, Credit Society, Mess, Quarter Rent match their rules; FIXED quarter id/name/type missing on every quarter-holder row (new runs); Sept Electricity 1484 with 0 units unexplained (clarification)
- [x] CIRT-03 Performance: Run preview 65 -> 14 queries, Master list 309 -> ~100; defaults check 44 -> 1 query; report indexes. Remaining N+1s listed in the reply
- [x] CIRT-04 Inactive fields: is_active already existed; payroll:field-usage report; Unpaid Arrears made inactive if present (none locally); candidates listed in reply
- [x] CIRT-05 Arrears labels: one source (payrollLabels.ts / PayrollLabels.php); Gross Arrears, TR Arrears, Past Arrears (free-entry field)
- [x] CIRT-06 "DA Arr" -> "CPF Arr": CPF-arrear chip added to Deductions (was missing, only counted in the total); payslip + exports use the label
- [x] CIRT-07 Net Arrears: shown in Earnings (memo, not in totals); stored as Gross - CPF Arr instead of a typed/stale 0
- [x] CIRT-08 Night Duty Allowance = (hours / 8) x rate per duty by Pay Level; rate table editable in Settings; legacy rows keep hours x rate
- [x] CIRT-09 Mess, Credit Society, Electricity amounts removed from Master Payroll Deductions entry; totals unchanged (test); electricity applicable/mode kept
- [x] CIRT-10 Activity Log: one record per action + child details + View Details; old rows under "Earlier records"
- [x] CIRT-11 Post Payroll Downloads: TDS (month range), CPF, Division-Wise (live formulas)
- [x] CIRT-12 Post Payroll Downloads: Paybill (flat + print sheet); 16 columns have no payroll source

- [x] CIRT-13 Remove "Special Pay" (SP Pay) and "Std Licence Fee": removed from Run Payroll, Payroll Master, calculations, payslip, exports, paybill, reports, amendments, field registry; the two `cirt_payroll_field_definitions` rows deleted; migration `2026_11_06_100000_remove_sp_pay_and_std_licence_fee` drops the 7 columns and strips the keys from JSON payloads. The TDS Data layout keeps its fixed "SP PAY" column (blank). Local: the three July 2026 draft Special Pay amounts (Mandavgade 200, Kedari 1,000, Desai 200) were moved to Special Allowance by a direct JSON edit (stored totals unchanged), audited as admin@cirtindia.com.

#### Deployment checklist: CIRT-13 (remove Special Pay / Std Licence Fee)
Live server and database are NOT touched by this commit. Before the deploy script runs:
- [ ] 1. Back up the live database (the deploy script's verified `pg_dump` is the minimum; take a manual one first, because this migration DROPS COLUMNS and rewrites JSON payloads and cannot be undone from the app).
- [ ] 2. Run the audit on LIVE first (read-only), from `<live>\backend`: `php artisan payroll:retired-fields-audit`. It must end with "No non-zero ... anywhere" (exit 0). If it lists anything, STOP and do not deploy: move the amount to Special Allowance first (live data differs from the local copy; the three July amounts above were only found locally).
- [ ] 3. Deploy with `scripts/deploy-cirt-hrms.ps1` as usual. Its `php artisan migrate --force` runs `2026_11_06_100000_remove_sp_pay_and_std_licence_fee`, which re-checks the same values itself and refuses (changes nothing) if any is non-zero. Do not pass `-RepairData` for this change.
- [ ] 4. `php artisan payroll:schema-check` passes; Run Payroll for the open month shows no "Special Pay" column, Monthly Summary has no "Special Pay" row, and Gross / Total Deductions / Net of the open drafts are the same as before the deploy (note them down before step 3).
- [ ] 5. Also pending on a database that has not been migrated since 5 Nov: `2026_11_05_110000_add_employer_share_rule_to_calculation_settings` (unrelated to this change) runs in the same `migrate --force`.
- Rollback: restore the step-1 backup (`-RestoreDatabase -ConfirmDatabaseRestore`); `migrate:rollback` only re-creates the empty columns.
- Not rewritten by design: activity-log rows and the "changes" paths of draft audit entries (history).

### Needs clarification
Unpaid Arrears exact field; the two extra arrears fields (which is "second" = Past Arrears); Net Arrears approved formula (kept Gross - CPF Arr); night duty rounding (NIGHT_DUTY_UNITS_DECIMALS=2, ROUND_TO_RUPEE=true) and per-duty rates (seeded hourly x 8); "DA Arr" = DA CPF or CPF Arr; where Mess/Credit Society/Electricity defaults are maintained now; employee category and division-to-report-group mapping; PENSION/EMP_CONTR split; latest report samples.

## Client-data rehearsal (local restore of the client backup, nothing touched on the client server)
- [x] Restore -> `migrate` (8 pending) -> counts, per-row hashes, rendering and catalog diff: see the report. Closed Sept 2026: 83/83 monthly rows and payslips byte-identical.
- [x] Reports (TDS, CPF, Division-Wise, Paybill) tie to every Sept row including the client's custom fields.
- Deploy: use `scripts/deploy-cirt-hrms.ps1` (backup, stage build, migrate --force, schema-check, rollback). Do NOT pass `-RepairData` until the dry run `php artisan payroll:repair-data` has been reviewed (it only touches the open July/October drafts).
- Open for the client: closed Sept has electricity 0 for all 21 employees with units; employee 055 DA 60% vs master 63%; employee 043 special allowance sits on an old master revision.
