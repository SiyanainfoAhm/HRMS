# TASKS

## CIRT-FIX (branch `fix/cirt-pune-issues`, local only, nothing deployed)

Rules: finalized payroll never changes (proved: md5 of monthly/payslips/periods/finalized drafts identical to the pre-change dump); fields are marked inactive, never deleted; unconfirmed rules sit behind one named constant.

- [x] CIRT-01 Electricity units 80 -> 49: Not reproduced on this branch (fixed by earlier commits); chain test SubhashElectricityUnitsTest (save, reload x2, generate, reset)
- [x] CIRT-02 Prakash audit: DA, Credit Society, Mess, Quarter Rent match their rules; FIXED quarter id/name/type missing on every quarter-holder row (new runs); Sept Electricity 1484 with 0 units unexplained (clarification)
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

### Needs clarification
Unpaid Arrears exact field; the two extra arrears fields (which is "second" = Past Arrears); Net Arrears approved formula (kept Gross - CPF Arr); night duty rounding (NIGHT_DUTY_UNITS_DECIMALS=2, ROUND_TO_RUPEE=true) and per-duty rates (seeded hourly x 8); "DA Arr" = DA CPF or CPF Arr; where Mess/Credit Society/Electricity defaults are maintained now; employee category and division-to-report-group mapping; PENSION/EMP_CONTR split; latest report samples.
